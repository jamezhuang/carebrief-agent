import asyncio
import json
import math
from typing import TypeVar
import httpx
from pydantic import BaseModel, ValidationError
from .config import Settings

T = TypeVar("T", bound=BaseModel)

class ProviderError(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        self.public_message = message
        super().__init__(message)

class APIClient:
    def __init__(self, settings: Settings, transport=None):
        self.settings = settings
        self.transport = transport

    async def post(self, base: str, path: str, key: str, body: dict):
        if not key:
            raise ProviderError("missing_key", "未配置 API Key，请检查 apps/api/.env。")
        # Never include provider response text or Authorization in errors / logs.
        async with httpx.AsyncClient(timeout=self.settings.timeout, transport=self.transport) as client:
            for attempt in range(2):
                try:
                    response = await client.post(base + path, headers={"Authorization": "Bearer " + key}, json=body)
                    if response.status_code in {429, 500, 502, 503, 504} and attempt == 0:
                        await asyncio.sleep(0.3)
                        continue
                    if response.status_code >= 400:
                        raise ProviderError("provider_http", f"上游 API 返回 HTTP {response.status_code}，请检查 Key、模型名称、额度和 Base URL。")
                    return response.json()
                except (httpx.TimeoutException, httpx.TransportError):
                    if attempt == 0:
                        await asyncio.sleep(0.3)
                        continue
                    raise ProviderError("provider_timeout", "上游请求超时或网络连接失败，请稍后重试。") from None
                except (ValueError, TypeError):
                    raise ProviderError("provider_format", "上游返回了无法解析的数据。") from None

    async def complete(self, messages: list[dict], **extra):
        body = {"model": self.settings.chat_model, "messages": messages, "max_tokens": 1800}
        if self.settings.disable_thinking:
            body["thinking"] = {"type": "disabled"}
        body.update(extra)
        data = await self.post(self.settings.deepseek_base, "/chat/completions", self.settings.deepseek_key, body)
        try:
            if data["choices"][0]["finish_reason"] == "length":
                raise ProviderError("truncated", "模型输出达到长度限制，请缩短输入后重试。")
            return data["choices"][0]["message"]
        except (KeyError, IndexError, TypeError):
            raise ProviderError("provider_format", "聊天 API 响应结构不正确。") from None

    async def structured(self, schema: type[T], instruction: str, data: dict) -> T:
        # JSON mode ensures JSON syntax; Pydantic validates our own schema.
        prompt = instruction + "\n只输出 JSON。严格符合 JSON schema：\n" + json.dumps(schema.model_json_schema(), ensure_ascii=False)
        messages = [{"role": "system", "content": prompt},
                    {"role": "user", "content": json.dumps(data, ensure_ascii=False)}]
        try:
            msg = await self.complete(messages, response_format={"type": "json_object"})
            return schema.model_validate_json(msg.get("content") or "")
        except ValidationError:
            raise ProviderError("invalid_schema", "模型返回的字段不符合约定，本次未生成结果。") from None

    async def embed(self, texts: list[str]) -> list[list[float]]:
        data = await self.post(self.settings.embedding_base, "/embeddings", self.settings.embedding_key, {
            "model": self.settings.embedding_model, "input": texts,
            "encoding_format": "float", "dimensions": self.settings.dimensions,
        })
        try:
            rows = sorted(data["data"], key=lambda r: r["index"])
            if [r["index"] for r in rows] != list(range(len(texts))):
                raise ValueError("indices")
            vectors = [[float(v) for v in row["embedding"]] for row in rows]
            if any(len(v) != self.settings.dimensions or not all(math.isfinite(x) for x in v)
                   or sum(x*x for x in v) == 0 for v in vectors):
                raise ValueError("vectors")
            return vectors
        except (KeyError, ValueError, TypeError):
            raise ProviderError("embedding_format", "Embedding 返回的数量、维度或向量内容不正确。") from None
