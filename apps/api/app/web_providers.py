"""搜索与正文服务适配器；不对患者内容、密钥或上游正文做日志输出。"""

import os
from collections import Counter

import httpx

from .web_access import AccessError, checked_addresses, clean_url, host_of, resolve_public


class ProviderFailure(Exception):
    def __init__(self, code, *, retryable=False, status=None):
        self.code, self.retryable, self.status = code, retryable, status
        super().__init__(code)


class WebProviders:
    def __init__(self, settings, policy, transport=None, resolver=resolve_public):
        self.settings, self.policy = settings, policy
        self.transport, self.resolver = transport, resolver
        self.tavily_key = os.getenv("TAVILY_API_KEY", "").strip()
        # 国内模式确保即使环境中残留其他服务密钥，也不会调用该服务。
        self.domestic_only = os.getenv("WEB_DOMESTIC_ONLY", "false").strip().lower() == "true"
        if self.domestic_only:
            self.tavily_key = ""
        self.primary = os.getenv("WEB_SEARCH_PROVIDER", "bocha").strip().lower()
        if self.primary not in {"bocha", "tavily"}:
            raise ValueError("WEB_SEARCH_PROVIDER must be bocha or tavily")
        if self.domestic_only:
            self.primary = "bocha"

    def configured(self, provider):
        return bool(getattr(self.settings, "bocha_key", "") if provider == "bocha" else self.tavily_key)

    def available(self):
        return [name for name in ("bocha", "tavily") if self.configured(name)]

    async def post(self, url, key, body):
        if not key:
            raise ProviderFailure("search_key_missing")
        try:
            async with httpx.AsyncClient(timeout=8, transport=self.transport,
                                         follow_redirects=False) as client:
                response = await client.post(url, headers={"Authorization": "Bearer " + key}, json=body)
                response.raise_for_status()
                result = response.json()
                if not isinstance(result, dict):
                    raise ValueError("schema")
                return result
        except httpx.HTTPStatusError as error:
            status = error.response.status_code
            raise ProviderFailure("search_http_error", status=status,
                                  retryable=status in {429, 500, 502, 503, 504}) from None
        except httpx.TimeoutException:
            raise ProviderFailure("search_timeout", retryable=True) from None
        except httpx.HTTPError:
            raise ProviderFailure("search_network_error", retryable=True) from None
        except (TypeError, ValueError):
            raise ProviderFailure("search_schema_error") from None

    async def one_search(self, provider, query, scope):
        if provider == "bocha":
            body = {"query": query, "count": 50, "summary": False, "freshness": "noLimit"}
            if scope == "trusted" and self.policy.registered:
                body["include"] = "|".join(sorted(self.policy.registered)[:100])
            data = await self.post(self.settings.bocha_url, self.settings.bocha_key, body)
            if data.get("code") not in (None, 200, "200"):
                raise ProviderFailure("search_business_error")
            try:
                items = data["data"]["webPages"]["value"]
            except (KeyError, TypeError):
                raise ProviderFailure("search_schema_error") from None
        else:
            body = {"query": query, "max_results": 20, "search_depth": "advanced",
                    "include_answer": False, "include_raw_content": False}
            if scope == "trusted" and self.policy.registered:
                body["include_domains"] = sorted(self.policy.registered)
            data = await self.post("https://api.tavily.com/search", self.tavily_key, body)
            items = data.get("results")
        if not isinstance(items, list):
            raise ProviderFailure("search_schema_error")
        seen, candidates, filtered = set(), [], Counter()
        for item in items[:50]:
            if not isinstance(item, dict):
                filtered["invalid_item"] += 1
                continue
            try:
                url = clean_url(item.get("url", ""))
            except AccessError as error:
                filtered[error.code] += 1
                continue
            if url in seen:
                filtered["duplicate_url"] += 1
                continue
            seen.add(url)
            authority = self.policy.classify(url)
            if scope == "trusted" and authority == "unverified":
                filtered["outside_trusted_scope"] += 1
                continue
            title = item.get("name") or item.get("title") or "网页候选"
            snippet = item.get("snippet") or item.get("content") or item.get("summary") or ""
            candidates.append({"url": url, "title": title[:180] if isinstance(title, str) else "网页候选",
                               "snippet": snippet[:500] if isinstance(snippet, str) else "",
                               "institution": host_of(url), "authority": authority,
                               "provider": provider})
        # 保持各可信度分组内的搜索排序；公共发现不丢弃未知网站。
        candidates.sort(key=lambda item: item["authority"] == "unverified")
        return candidates, {"provider": provider, "raw_count": len(items),
                            "candidate_count": len(candidates), "filtered_reasons": dict(filtered)}

    async def search(self, query, limit, provider="auto", scope="public"):
        available = self.available()
        if provider != "auto" and provider not in available:
            return {"ok": False, "candidates": [], "provider_attempts": [],
                    "available_providers": available, "outcome": "search_failed",
                    "error": "provider_not_configured", "retryable": False}
        ordered = [self.primary, "tavily" if self.primary == "bocha" else "bocha"]
        providers = [provider] if provider != "auto" else [name for name in ordered if name in available]
        attempts = []
        for name in providers:
            if not self.configured(name):
                attempts.append({"provider": name, "error": "search_key_missing", "retryable": False})
                continue
            try:
                candidates, details = await self.one_search(name, query, scope)
            except ProviderFailure as error:
                attempts.append({"provider": name, "error": error.code,
                                 "retryable": error.retryable, "http_status": error.status})
                continue
            attempts.append(details)
            if candidates:
                return {"ok": True, "candidates": candidates[:limit], "provider_attempts": attempts,
                        "available_providers": available, "outcome": "ok"}
        # 成功但空与接口全失败区分，供模型换词或换工具。
        any_success = any("raw_count" in row for row in attempts)
        return {"ok": any_success, "candidates": [], "provider_attempts": attempts,
                "available_providers": available,
                "outcome": "search_empty" if any_success else "search_failed",
                "error": None if any_success else "all_search_providers_failed",
                "retryable": any(row.get("retryable", False) for row in attempts)}

    async def extract(self, url, query=""):
        if not self.tavily_key:
            raise ProviderFailure("extract_key_missing")
        await checked_addresses(url, self.resolver)
        data = await self.post("https://api.tavily.com/extract", self.tavily_key, {
            "urls": [url], "extract_depth": "advanced", "format": "markdown",
            # 不使用服务端query切片，避免 [...] 拼接混入逐字引用；本地按query选片段。
            "include_images": False, "timeout": 6,
        })
        results = data.get("results") or []
        if not isinstance(results, list):
            raise ProviderFailure("extract_schema_error")
        for item in results:
            if not isinstance(item, dict):
                continue
            final_url = clean_url(item.get("url", ""))
            # 托管服务内部重定向不可逐跳观察；只接受同一主机的已核验输出。
            if host_of(final_url) != host_of(url) or not self.policy.may_read(final_url):
                raise ProviderFailure("extract_source_changed")
            text = item.get("raw_content")
            if isinstance(text, str) and len(text.strip()) >= 40:
                return {"url": final_url, "text": text[:80_000], "title": "网页提取正文",
                        "links": [], "document_type": "hosted_extract"}
        raise ProviderFailure("extract_empty")
