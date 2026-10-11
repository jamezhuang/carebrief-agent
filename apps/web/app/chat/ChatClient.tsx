"use client";

import { useEffect, useRef, useState } from "react";
import {
  API_BASE, ApiError, chatApi, cleanCitationIds, sessionStorageKey, sourceUrl,
  type Health, type HistoryItem, type Integration, type RunEvent, type Session, type User,
} from "../../lib/carebrief-client";
import styles from "./chat.module.css";

const EXAMPLES = [
  "眼睛流泪能是干眼吗？广东省人民医院哪个科室覆盖眼表疾病？",
  "尿酸盐结晶为什么能让关节红肿痛？中山一院哪个科室看这类问题？",
  "到广东省人民医院普通门诊，实名认证和预约报到怎么办？",
];
const factNames: Record<string, string> = { age: "年龄", symptom: "症状", duration: "持续时间", history: "病史", associated: "伴随情况" };
const stageNames: Record<string, string> = {
  classify: "识别问题", retrieve: "检索节点", retrieval: "本地检索", tool: "工具调用",
  retrieval_strategy: "检索策略", query_planning: "问题拆分", rerank: "语义重排",
  answer: "生成回答", validate: "校验回答", finished: "处理完成", failed: "处理失败",
};

export default function ChatClient() {
  const [health, setHealth] = useState<Health | null>(null);
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [failureRun, setFailureRun] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [registering, setRegistering] = useState(false);
  const [uncertain, setUncertain] = useState<{ id: string; count: number; text: string; rejected?: boolean } | null>(null);
  const [showDev, setShowDev] = useState(false);
  const [devToken, setDevToken] = useState("");
  const [devBusy, setDevBusy] = useState(false);
  const [devError, setDevError] = useState("");
  const [integration, setIntegration] = useState<Integration | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [selectedSource, setSelectedSource] = useState<number | null>(null);
  const gate = useRef(false);
  const devGate = useRef(false);
  const end = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const mounted = useRef(false);
  const viewRevision = useRef(0);
  const turn = session?.last_turn ?? session?.last_result;
  const runId = failureRun || turn?.run_id;
  const requiresLogin = health?.provider_mode === "live" && !user;

  useEffect(() => {
    mounted.current = true;
    let active = true;
    Promise.allSettled([chatApi.health(), chatApi.me()]).then(([h, account]) => {
      if (!active) return;
      if (h.status === "fulfilled") setHealth(h.value);
      else setError(h.reason instanceof Error ? h.reason.message : "后端连接失败。");
      if (account.status === "fulfilled") setUser(account.value.user);
      else setError(account.reason instanceof Error ? account.reason.message : "登录状态读取失败。");
      setReady(true);
    });
    return () => { active = false; mounted.current = false; };
  }, []);

  useEffect(() => {
    let active = true;
    if (!user) { setHistory([]); return; }
    chatApi.history().then(data => { if (active) setHistory(data.items); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : "历史读取失败。"); });
    let id: string | null = null;
    try { id = localStorage.getItem(sessionStorageKey(user.id)); } catch { /* 存储不可用仍能聊天。 */ }
    const revision = viewRevision.current;
    if (id) chatApi.read(id).then(data => {
      if (active && viewRevision.current === revision && !gate.current) setSession(data);
    }).catch(e => {
      if (!active) return;
      if (e instanceof ApiError && e.status === 404) {
        try { localStorage.removeItem(sessionStorageKey(user.id)); } catch { /* ignore */ }
        setNotice("上次咨询已不存在，可以新建咨询。");
      } else setError(e instanceof Error ? e.message : "咨询恢复失败。");
    });
    return () => { active = false; };
  }, [user]);

  useEffect(() => { end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [session?.messages.length, busy]);
  useEffect(() => { setEvents([]); setDevError(""); setSelectedSource(null); }, [runId]);
  useEffect(() => {
    if (selectedSource !== null) document.getElementById(`chat-source-${selectedSource}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedSource]);

  function remember(value: Session) {
    viewRevision.current += 1;
    setSession(value);
    if (user) { try { localStorage.setItem(sessionStorageKey(user.id), value.id); } catch { /* ignore */ } }
  }

  function fail(value: unknown) {
    const e = value instanceof Error ? value : new Error("操作失败。");
    setError(e.message);
    if (e instanceof ApiError) {
      if (e.runId) setFailureRun(e.runId);
      if (e.status === 401) {
        setUser(null); setSession(null); setPassword(""); setDevToken(""); setIntegration(null); setEvents([]);
        setNotice("登录已失效，请重新登录。");
      }
      if (e.status === 409) setNotice("后端拒绝了重复或冲突操作，请先刷新当前咨询。");
      if (e.status === 404) setNotice("该咨询已不存在或无法访问，可以新建咨询。");
    }
  }

  async function act(kind: string, task: () => Promise<void>) {
    if (gate.current || !ready) return;
    gate.current = true; setBusy(kind); setError(""); setNotice("");
    try { await task(); } catch (e) { if (mounted.current) fail(e); }
    finally { gate.current = false; if (mounted.current) setBusy(null); }
  }

  async function refreshHistory() {
    if (!user) return;
    try { setHistory((await chatApi.history()).items); }
    catch { setNotice("操作已完成，历史列表暂未刷新，可稍后重新读取。"); }
  }

  function clearTurnState() {
    viewRevision.current += 1;
    setFailureRun(""); setEvents([]); setUncertain(null); setSelectedSource(null);
  }

  async function send() {
    const text = input.trim();
    if (!text || uncertain || requiresLogin) return;
    await act("send", async () => {
      let current = session;
      if (!current) { current = await chatApi.create(); remember(current); }
      const pending = { id: current.id, count: current.messages.length, text };
      clearTurnState();
      try {
        const updated = await chatApi.send(current.id, text);
        remember(updated); setInput(""); await refreshHistory();
      } catch (e) {
        // 请求可能已执行成功；网络/响应异常时先核对，禁止自动重发。
        if (e instanceof ApiError && (e.status === 0 || e.code === "invalid_response" || e.status === 409)) {
          setUncertain({ ...pending, rejected: e.status === 409 });
        }
        throw e;
      }
    });
    textarea.current?.focus();
  }

  async function refreshSession() {
    await act("load", async () => {
      const id = uncertain?.id || session?.id;
      if (!id) { await refreshHistory(); return; }
      const updated = await chatApi.read(id);
      remember(updated); setFailureRun("");
      if (uncertain) {
        const completed = uncertain.rejected || updated.messages.length > uncertain.count;
        if (completed) {
          if (updated.messages.slice(uncertain.count).some(m => m.role === "user" && m.content === uncertain.text)) setInput("");
          setUncertain(null); setNotice("已读取后端最新记录，请核对后继续。");
        } else setNotice("暂未读到新的已保存记录。请求可能仍在处理，请稍后刷新；也可新建咨询。");
      }
      await refreshHistory();
    });
  }

  async function loadDiagnostics() {
    if (devGate.current || !devToken.trim()) return;
    devGate.current = true; setDevBusy(true); setDevError("");
    try {
      const token = devToken.trim();
      const checked = await chatApi.integration(token);
      if (mounted.current) setIntegration(checked);
      if (runId) {
        const value = await chatApi.events(runId, token);
        if (mounted.current) setEvents(value.events);
      }
    } catch (e) { if (mounted.current) setDevError(e instanceof Error ? e.message : "诊断读取失败。"); }
    finally { devGate.current = false; if (mounted.current) setDevBusy(false); }
  }

  return <div className={styles.shell}>
    <header className={styles.topbar}>
      <a className={styles.brand} href="/"><span>＋</span><div>CareBrief<small>把问题说清楚，让依据看得见</small></div></a>
      <div className={styles.topActions}><span className={styles.mode}>{!health ? "连接中" : health.provider_mode === "live" ? "模型模式" : "演示模式"}</span><a href="/">原首页</a>
        <button type="button" aria-expanded={showDev} onClick={() => setShowDev(v => !v)}>开发者检查</button></div>
    </header>
    <main className={styles.workspace}>
      <aside className={styles.sidebar} aria-label="账号与历史咨询">
        <p className={styles.eyebrow}>咨询空间</p>
        <button className={styles.primary} disabled={Boolean(busy) || !ready || requiresLogin} onClick={() => act("load", async () => {
          remember(await chatApi.create()); setInput(""); clearTurnState(); await refreshHistory();
        })}>＋ 新建咨询</button>
        {user ? <div className={styles.account}><strong>{user.email}</strong><button disabled={Boolean(busy)} onClick={() => act("auth", async () => {
          await chatApi.logout(); setUser(null); setSession(null); setHistory([]); setInput(""); setPassword("");
          setDevToken(""); setIntegration(null); clearTurnState();
        })}>退出登录</button></div> : <form className={styles.authForm} onSubmit={e => { e.preventDefault(); act("auth", async () => {
          const account = await chatApi.authenticate(registering, email, password);
          setSession(null); clearTurnState(); setPassword(""); setUser(account); setNotice("已登录，可以继续已有咨询或新建咨询。");
        }); }}>
          <h2>{registering ? "注册账号" : "登录后继续咨询"}</h2>
          <label>邮箱<input type="email" autoComplete="username" required maxLength={160} value={email} disabled={Boolean(busy)} onChange={e => setEmail(e.target.value)} /></label>
          <label>密码<input type="password" autoComplete={registering ? "new-password" : "current-password"} required minLength={10} maxLength={128} value={password} disabled={Boolean(busy)} onChange={e => setPassword(e.target.value)} /></label>
          <button className={styles.primary} disabled={Boolean(busy) || !ready}>{busy === "auth" ? "处理中…" : registering ? "注册并登录" : "登录"}</button>
          <button type="button" disabled={Boolean(busy)} onClick={() => setRegistering(v => !v)}>{registering ? "已有账号，去登录" : "没有账号，去注册"}</button>
        </form>}
        <div className={styles.sectionHeading}><h2>历史咨询</h2><button disabled={!user || Boolean(busy)} onClick={() => act("load", refreshHistory)}>刷新</button></div>
        <div className={styles.history}>
          {history.map(item => <button className={session?.id === item.id ? styles.selected : ""} key={item.id} disabled={Boolean(busy)} onClick={() => act("load", async () => {
            remember(await chatApi.read(item.id)); setInput(""); clearTurnState();
          })}><span>{item.title || "未命名咨询"}</span><small>{new Date(item.updated_at).toLocaleDateString("zh-CN")}</small></button>)}
          {!history.length && <p className={styles.muted}>{user ? "开始对话后，咨询会出现在这里。" : "登录后可读取历史咨询。"}</p>}
        </div>
        {session && Object.keys(session.facts).length > 0 && <details className={styles.facts}><summary>本次已整理的信息</summary><dl>{Object.entries(session.facts).map(([key, value]) => <div key={key}><dt>{factNames[key] || key}</dt><dd>{value}</dd></div>)}</dl></details>}
      </aside>

      <section className={styles.chat} aria-label="多轮对话">
        <div className={styles.chatHeading}><div><p className={styles.eyebrow}>自由描述 · 连续追问</p><h1>今天想了解什么？</h1></div><button disabled={!session || Boolean(busy)} onClick={refreshSession}>刷新当前咨询</button></div>
        <div className={styles.messages} role="log" aria-label="聊天记录" aria-live="polite" aria-busy={busy === "send"}>
          {!session?.messages.length && <div className={styles.welcome}><div className={styles.welcomeIcon}>✦</div><h2>从你的问题开始</h2><p>直接描述不适、问一般知识，或询问医院科室。追问时会沿用当前咨询的上下文。</p><div className={styles.examples}>{EXAMPLES.map(text => <button key={text} disabled={Boolean(busy)} onClick={() => { setInput(text); textarea.current?.focus(); }}>{text}<span>↗</span></button>)}</div><p className={styles.muted}>示例只填入输入框，由你确认发送。</p></div>}
          {session?.messages.map((message, index) => <article key={index} className={`${styles.message} ${message.role === "user" ? styles.userMessage : styles.assistantMessage}`}><span className={styles.avatar}>{message.role === "user" ? "你" : "＋"}</span><div className={styles.bubble}>{message.role === "assistant" ? cleanCitationIds(message.content) : message.content}</div></article>)}
          {busy === "send" && <p className={styles.processing} role="status">正在处理你的问题…</p>}
          <div ref={end} />
        </div>
        {turn?.risk_notice && <div className={styles.risk} role="alert">{turn.risk_notice}</div>}
        {error && <div className={styles.error} role="alert">{error}</div>}
        {notice && <div className={styles.notice} role="status">{notice}</div>}
        {uncertain && <div className={styles.notice}>本次提交需要核对，先刷新当前咨询再继续，避免重复发送。</div>}
        <form className={styles.composer} onSubmit={e => { e.preventDefault(); void send(); }}>
          <label className={styles.srOnly} htmlFor="chat-question">你的问题</label>
          <textarea id="chat-question" ref={textarea} value={input} maxLength={2000} disabled={Boolean(busy) || !ready || Boolean(uncertain)}
            onChange={e => setInput(e.target.value)} placeholder="比如：眼睛总流泪可能是什么原因？去省人民医院挂什么科？"
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
          <div className={styles.composerFooter}><span>{input.length}/2000 · Shift + Enter 换行</span><button className={styles.primary} disabled={Boolean(busy) || !ready || !input.trim() || Boolean(uncertain) || requiresLogin}>{busy === "send" ? "处理中…" : requiresLogin ? "请先登录" : "发送 ↑"}</button></div>
        </form>
        <p className={styles.footnote}>辅助健康信息与就诊准备，不提供个人诊断或处方。</p>
      </section>

      <aside className={styles.evidence} aria-label="当前回答依据">
        <p className={styles.eyebrow}>当前回答 · 资料依据</p><h2>查看来源与原文</h2>
        <div className={styles.evidenceScroll}>
          {!turn && <div className={styles.empty}><span>◎</span><p>发送问题后，本轮返回的资料会显示在这里。</p></div>}
          {turn?.department && <div className={styles.direction}><small>回答中的科室方向</small><strong>{turn.department}</strong></div>}
          {!!turn?.claims.length && <div className={styles.claims}>{turn.claims.map((claim, index) => {
            const sourceIndex = turn.sources.findIndex(s => s.id === claim.evidence_id);
            return <div key={index}><p>{cleanCitationIds(claim.text)}</p><blockquote>{claim.quote}</blockquote>{sourceIndex >= 0 && <button onClick={() => setSelectedSource(sourceIndex)}>查看来源 {sourceIndex + 1} ↗</button>}</div>;
          })}</div>}
          {turn?.sources.map((source, index) => {
            const url = sourceUrl(source.url);
            return <article id={`chat-source-${index}`} key={source.id} className={`${styles.source} ${selectedSource === index ? styles.highlight : ""}`}>
              <span className={styles.sourceTag}>来源 {index + 1} · {source.kind === "external_excerpt" ? "外部检索" : "本地资料"}</span>
              <h3>{source.title}</h3><p className={styles.institution}>{source.institution}</p>
              <details open={selectedSource === index}><summary>展开检索正文</summary><p>{source.text}</p></details>
              {source.published_at && <small>发布日期：{source.published_at}</small>}
              {url && <a href={url} target="_blank" rel="noopener noreferrer">打开原始页面 ↗</a>}
            </article>;
          })}
          {turn && !turn.sources.length && <p className={styles.muted}>本轮没有返回可展示的检索来源。可在开发者检查中查看实际调用记录。</p>}
          {turn?.retrieval_notice && <p className={styles.notice}>{turn.retrieval_notice}</p>}
          {turn?.limitation && <p className={styles.muted}>{turn.limitation}</p>}
        </div>
      </aside>
    </main>

    {showDev && <section className={styles.developer} aria-label="开发者接入检查">
      <h2>接入检查与实际调用记录</h2><p>输入后端 DEV_TOKEN。只读取配置状态与执行元数据，不展示模型内部推理；令牌只保留在当前页面内存。</p>
      <div className={styles.devControls}><label className={styles.srOnly} htmlFor="chat-dev-token">DEV_TOKEN</label><input id="chat-dev-token" type="password" autoComplete="off" value={devToken} onChange={e => setDevToken(e.target.value)} placeholder="DEV_TOKEN" /><button className={styles.primary} disabled={devBusy || !devToken.trim()} onClick={loadDiagnostics}>{devBusy ? "读取中…" : "检查接入 / 读取本轮日志"}</button></div>
      {integration && <div className={styles.integration}><p>检索器：<code>{integration.retriever_class}</code></p><p>模式：{integration.provider_mode} · 问题拆分：{integration.planning_enabled ? "已开启" : "未开启"} · 重排：{integration.rerank_enabled ? "已开启" : "未开启"}</p><small>{integration.note}</small></div>}
      {runId && <p className={styles.muted}>运行编号：{runId}</p>}
      {devError && <p className={styles.error} role="alert">{devError}</p>}
      <div className={styles.eventList}>{events.map((event, index) => <div key={index}><strong>{stageNames[event.stage] || event.stage}</strong><span>{event.status || "记录"}</span><span>{event.tool || event.mode || ""}</span><small>{event.source_count !== undefined ? `来源 ${event.source_count} 条` : ""}{event.duration_ms !== undefined ? ` · ${event.duration_ms} ms` : ""}{event.error_code ? ` · ${event.error_code}` : ""}</small></div>)}</div>
      {!events.length && <p className={styles.muted}>尚未读取本轮日志。接入检查显示开关状态，实际使用需以发送问题后的记录为准。</p>}
      <details><summary>当前 API 地址</summary><code>{API_BASE}</code></details>
    </section>}
  </div>;
}
