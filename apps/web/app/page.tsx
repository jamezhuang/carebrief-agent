"use client";
import { useEffect, useRef, useState } from "react";

type Source = {
  id: string;
  title: string;
  institution: string;
  url: string;
  text: string;
  collected_at: string;
  published_at: string | null;
  kind: string;
};
type Claim = { text: string; evidence_id: string; quote: string };
type Result = {
  run_id: string;
  provider_mode: "demo" | "live";
  intent: string;
  summary: string;
  department: string;
  claims: Claim[];
  sources: Source[];
  missing_information: string[];
  follow_up_questions: string[];
  risk_notice: string | null;
  risk_inputs: string[];
  limitation: string;
  retrieval_notice: string;
  answer_basis?: "general" | "retrieved" | "mixed" | "insufficient";
};
type Session = {
  id: string;
  messages: { role: "user" | "assistant"; content: string }[];
  facts: Record<string, string>;
  last_result: Result | null;
  last_turn: Result | null;
  memory_context: Record<string, string>;
  candidates: Record<string, string>;
};
type Health = {
  provider_mode: "demo" | "live";
  index_ready: boolean;
  keys_ready: boolean;
};
type User = { id: string; email: string };
type History = { id: string; title: string; updated_at: string };
type Profile = Record<
  string,
  { value: string; source: string; confirmed_at: string }
>;
type Row = {
  name: string;
  value: string;
  unit: string;
  reference: string;
  location: string;
};
type Report = {
  id: string;
  session_id: string;
  name: string;
  original_text: string;
  confirmed_text: string;
  rows: Row[];
  confirmed: boolean;
  revision: number;
  notice: string;
};
const API = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";
const label: Record<string, string> = {
  age: "年龄",
  symptom: "症状",
  duration: "持续时间",
  associated: "伴随信息",
  history: "相关病史",
};
const demoText = "我28岁，咳嗽3天，想了解就诊方向。";
const intro =
  "你好，欢迎来到 CareBrief。先说说最关心的不适、持续时间，或者上传报告；我会帮你整理信息，并展示有出处的辅助资料。";
const basisLabels = {
  general: "模型通用知识 · 本轮无检索引用",
  retrieved: "基于本轮引用资料",
  mixed: "通用知识与本轮引用资料",
  insufficient: "当前信息不足",
};
function displayAnswer(text: string): string {
  return text.replace(/[ \t]*\[KB-[A-Za-z0-9_-]+\]/g, "");
}
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(API + path, {
    ...options,
    credentials: "include",
  });

  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    let message =
      data.error ||
      (typeof data.detail === "string"
        ? data.detail
        : "请求失败，请检查输入和后端服务。");
    if (data.run_id) message += " 记录编号：" + data.run_id;
    throw new Error(message);
  }
  return data as T;
}

export default function Home() {
  const [health, setHealth] = useState<Health | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [history, setHistory] = useState<History[]>([]);
  const [profile, setProfile] = useState<Profile>({});
  const [profileDraft, setProfileDraft] = useState({
    age: "",
    history: "",
    allergies: "",
  });
  const [authOpen, setAuthOpen] = useState(false);
  const [registering, setRegistering] = useState(true);
  const [auth, setAuth] = useState({ email: "", password: "" });
  const [reports, setReports] = useState<Report[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [reportText, setReportText] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [dirty, setDirty] = useState(false);
  const [paste, setPaste] = useState("");
  const [notice, setNotice] = useState("");
  const [failureRun, setFailureRun] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"result" | "sources" | "reports" | "profile">(
    "result",
  );
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ age: "", duration: "", associated: "" });
  const [riskOpen, setRiskOpen] = useState(false);
  const [showDev, setShowDev] = useState(false);
  const [token, setToken] = useState("");
  const [events, setEvents] = useState<Record<string, unknown>[]>([]);
  const [devError, setDevError] = useState("");
  const [devBusy, setDevBusy] = useState(false);
  const scrollEnd = useRef<HTMLDivElement>(null);
  const draft = useRef<HTMLTextAreaElement>(null);
  const sending = useRef(false);
  const result = session?.last_result;
  const runId = failureRun || session?.last_turn?.run_id || result?.run_id;

  useEffect(() => {
    let active = true;
    request<Health>("/health")
      .then((h) => {
        if (active) setHealth(h);
      })
      .catch(() => {
        if (active) setError("尚未连接后端，请先启动 FastAPI（8000端口）。");
      });
    request<{ user: User | null }>("/auth/me")
      .then((data) => {
        if (active) setUser(data.user);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    if (!user) {
      setHistory([]);
      setProfile({});
      return;
    }
    Promise.all([
      request<{ items: History[] }>("/sessions"),
      request<{ fields: Profile }>("/profile"),
    ])
      .then(([h, p]) => {
        if (!active) return;
        setHistory(h.items);
        setProfile(p.fields);
        setProfileDraft({
          age: p.fields.age?.value || "",
          history: p.fields.history?.value || "",
          allergies: p.fields.allergies?.value || "",
        });
      })
      .catch((e) => {
        if (active) setError(String(e.message));
      });
    const id = localStorage.getItem("carebrief-v1-session-" + user.id);
    if (id)
      request<Session>("/sessions/" + id)
        .then((s) => {
          if (active) setSession(s);
        })
        .catch(() =>
          localStorage.removeItem("carebrief-v1-session-" + user.id),
        );
    return () => {
      active = false;
    };
  }, [user]);
  useEffect(() => {
    if (!user || !session) {
      setReports([]);
      return;
    }
    let active = true;
    request<{ items: Report[] }>("/sessions/" + session.id + "/reports")
      .then((r) => {
        if (active) setReports(r.items);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [session?.id, user]);
  useEffect(() => {
    scrollEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [session?.messages.length]);
  useEffect(() => {
    if (!riskOpen && !authOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]');
    const dialog = dialogs[dialogs.length - 1];
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setRiskOpen(false);
        setAuthOpen(false);
      }
      if (event.key === "Tab" && dialog) {
        const targets = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
          ),
        );
        const first = targets[0],
          last = targets[targets.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handle);
    return () => {
      document.removeEventListener("keydown", handle);
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, [riskOpen, authOpen]);

  async function send(text = input) {
    if (sending.current || !text.trim()) return;
    sending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    setFailureRun("");
    setEvents([]);
    setDevError("");
    try {
      const current = await ensureSession();
      const updated = await request<Session>(
        "/sessions/" + current.id + "/messages",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text }),
        },
      );
      setSession(updated);
      setInput("");
      setShowForm(false);
      setRiskOpen(Boolean(updated.last_turn?.risk_notice));
      await refreshHistory();
      if (updated.last_result)
        setHealth((h) =>
          h ? { ...h, provider_mode: updated.last_result!.provider_mode } : h,
        );
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
      sending.current = false;
      draft.current?.focus();
    }
  }

  async function reset() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const created = await request<Session>("/sessions", { method: "POST" });
      remember(created);
      setInput("");
      setEvents([]);
      setFailureRun("");
      setRiskOpen(false);
      setTab("result");
      setReport(null);
      setReports([]);
      setNotice("");
      await refreshHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : "清除失败");
    } finally {
      setBusy(false);
    }
  }

  async function loadEvents() {
    if (!runId || devBusy) return;
    setDevBusy(true);
    setDevError("");
    try {
      const data = await request<{ events: Record<string, unknown>[] }>(
        "/dev/runs/" + runId,
        { headers: { "X-Dev-Token": token } },
      );
      setEvents(data.events);
    } catch (e) {
      setDevError(e instanceof Error ? e.message : "读取日志失败");
    } finally {
      setDevBusy(false);
    }
  }

  function fail(e: unknown) {
    const text = e instanceof Error ? e.message : "请求失败";
    setError(text);
    const match = text.match(/记录编号：([a-z0-9-]+)/i);
    if (match) setFailureRun(match[1]);
  }
  function remember(s: Session) {
    setSession(s);
    if (user) localStorage.setItem("carebrief-v1-session-" + user.id, s.id);
  }
  async function ensureSession() {
    if (session) return session;
    const s = await request<Session>("/sessions", { method: "POST" });
    remember(s);
    return s;
  }
  async function refreshHistory() {
    if (user)
      setHistory((await request<{ items: History[] }>("/sessions")).items);
  }
  async function act(task: () => Promise<void>) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
    } catch (e) {
      fail(e);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  function json(method: string, data: unknown): RequestInit {
    return {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    };
  }
  function editReport(r: Report) {
    setReport(r);
    setReportText(r.confirmed_text || r.original_text);
    setRows(r.rows.map((row) => ({ ...row })));
    setDirty(false);
  }
  async function refreshReports(id: string) {
    setReports(
      (await request<{ items: Report[] }>("/sessions/" + id + "/reports"))
        .items,
    );
  }
  async function addTextReport() {
    const s = await ensureSession();
    const r = await request<Report>(
      "/sessions/" + s.id + "/reports/text",
      json("POST", { name: "粘贴的报告", text: paste }),
    );
    editReport(r);
    setPaste("");
    await refreshReports(s.id);
  }
  async function uploadReport(file: File) {
    if (file.size > 8 * 1024 * 1024) throw new Error("报告需小于8MB。");
    const s = await ensureSession();
    const form = new FormData();
    form.append("file", file);
    const r = await request<Report>("/sessions/" + s.id + "/reports/upload", {
      method: "POST",
      body: form,
    });
    editReport(r);
    await refreshReports(s.id);
  }
  async function confirmReport() {
    if (!report) return;
    const r = await request<Report>(
      "/reports/" + report.id + "/confirm",
      json("PUT", {
        revision: report.revision,
        confirmed_text: reportText,
        rows,
      }),
    );
    editReport(r);
    await refreshReports(r.session_id);
    setNotice("核对内容已保存，可以整理这份报告。");
  }
  async function analyzeReport() {
    if (!report) return;
    const s = await request<Session>("/reports/" + report.id + "/analyze", {
      method: "POST",
    });
    remember(s);
    setRiskOpen(Boolean(s.last_turn?.risk_notice));
    setTab("result");
    await refreshHistory();
  }

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand-mark">+</span>
          <span>
            CareBrief<small>就诊前，把信息理清楚</small>
          </span>
        </a>
        <div className="top-actions">
          <span className="version">V1 · 对话与记忆</span>
          {user ? (
            <>
              <span className="account-name">{user.email}</span>
              <button
                className="text-button"
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    await request("/auth/logout", { method: "POST" });
                    setUser(null);
                    setSession(null);
                    setReport(null);
                    setInput("");
                    setToken("");
                    setEvents([]);
                  })
                }
              >
                退出登录
              </button>
            </>
          ) : (
            <button
              className="primary"
              onClick={() => {
                setAuthOpen(true);
                setError("");
              }}
            >
              登录 / 注册
            </button>
          )}
          <button
            className="text-button"
            onClick={() => setShowDev((v) => !v)}
            aria-pressed={showDev}
          >
            {showDev ? "返回用户视图" : "开发者视图"}
          </button>
        </div>
      </header>
      <main className="workspace">
        <aside className="sidebar card">
          <div className="eyebrow">CONSULTATION</div>
          <h2>你的咨询空间</h2>
          <button className="primary wide" onClick={reset} disabled={busy}>
            ＋ 新建咨询
          </button>
          <div className="section-label">本次咨询</div>
          <div className="session-item">
            <span className="status-dot" />
            {session ? "当前咨询" : "欢迎开始"}
          </div>
          <div className="section-label">历史咨询</div>
          <div className="history-list">
            {user ? (
              history.length ? (
                history.map((h) => (
                  <div
                    className={
                      "history-row " + (h.id === session?.id ? "selected" : "")
                    }
                    key={h.id}
                  >
                    <button
                      disabled={busy}
                      onClick={() =>
                        act(async () => {
                          remember(await request<Session>("/sessions/" + h.id));
                          setReport(null);
                          setRiskOpen(false);
                          setFailureRun("");
                        })
                      }
                    >
                      {h.title}
                      <small>
                        {new Date(h.updated_at).toLocaleDateString("zh-CN")}
                      </small>
                    </button>
                    <button
                      aria-label={"删除咨询 " + h.title}
                      disabled={busy}
                      onClick={() =>
                        act(async () => {
                          if (
                            !window.confirm(
                              "删除这次咨询及其报告？此操作无法撤销。",
                            )
                          )
                            return;
                          await request("/sessions/" + h.id, {
                            method: "DELETE",
                          });
                          if (session?.id === h.id) {
                            setSession(null);
                            setReport(null);
                            localStorage.removeItem(
                              "carebrief-v1-session-" + user.id,
                            );
                          }
                          await refreshHistory();
                        })
                      }
                    >
                      ×
                    </button>
                  </div>
                ))
              ) : (
                <p className="muted small">登录后的咨询会自动保存在这里。</p>
              )
            ) : (
              <p className="muted small">
                匿名体验仅使用模拟信息；登录后保存咨询和报告。
              </p>
            )}
          </div>
          <div className="section-label">已整理的信息</div>
          {session && Object.keys(session.facts).length ? (
            <dl className="facts">
              {Object.entries(session.facts).map(([key, value]) => (
                <div key={key}>
                  <dt>{label[key] || key}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="muted small">输入描述后，会在这里整理已知信息。</p>
          )}
          {user && session && Object.keys(session.candidates).length > 0 && (
            <div className="memory-box">
              <strong>待确认的档案信息</strong>
              <p>确认后才会用于后续咨询；请核对是否属于本人。</p>
              {Object.entries(session.candidates).map(([field, value]) => (
                <div key={field}>
                  <p>
                    {label[field]}：{value}
                  </p>
                  <button
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        const p = await request<{ fields: Profile }>(
                          "/sessions/" + session.id + "/memory",
                          json("POST", { field, value }),
                        );
                        setProfile(p.fields);
                        setProfileDraft({
                          age: p.fields.age?.value || "",
                          history: p.fields.history?.value || "",
                          allergies: p.fields.allergies?.value || "",
                        });
                        remember(
                          await request<Session>("/sessions/" + session.id),
                        );
                      })
                    }
                  >
                    确认存入档案
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="sidebar-bottom">
            <span className="demo-badge">
              {health?.provider_mode === "live"
                ? "真实 API 模式"
                : health
                  ? "本地演示模式"
                  : "等待连接"}
            </span>
            <p>
              {health?.provider_mode === "live"
                ? "DeepSeek＋SiliconFlow。输入及已确认上下文会发送给配置的模型服务。"
                : "规则对话＋关键词检索，不调用真实模型。"}
              <br />
              {user
                ? "登录后的咨询保存在本地数据库。"
                : "匿名咨询保存在内存，1小时未使用会过期。"}
            </p>
          </div>
        </aside>

        <section className="chat card">
          <div className="chat-heading">
            <div>
              <div className="eyebrow">START WITH YOUR STORY</div>
              <h1>今天想了解什么？</h1>
            </div>
            <span className="soft-tag">辅助信息</span>
          </div>
          <div className="messages" aria-live="polite">
            {!session?.messages.length && (
              <div className="welcome">
                <div className="welcome-icon">✦</div>
                <h2>你好，先聊聊你的问题</h2>
                <p>{intro}</p>
                <div className="example">
                  <span>模拟病例 · 不是真实患者</span>
                  <p>{demoText}</p>
                  <button onClick={() => send(demoText)} disabled={busy}>
                    体验这个案例 →
                  </button>
                </div>
                <div className="welcome-options">
                  <button onClick={() => setShowForm(true)} disabled={busy}>
                    填写快速表单
                  </button>
                  <button onClick={() => draft.current?.focus()}>
                    自由描述
                  </button>
                </div>
                {process.env.NEXT_PUBLIC_DEMO_VIDEO_URL && (
                  <video
                    className="demo-video"
                    controls
                    preload="none"
                    src={process.env.NEXT_PUBLIC_DEMO_VIDEO_URL}
                    aria-label="项目演示视频"
                  />
                )}
              </div>
            )}
            {session?.messages.map((m, i) => (
              <div className={"message " + m.role} key={i}>
                <div className="avatar">{m.role === "user" ? "你" : "+"}</div>
                <div className="bubble">
                  {m.role === "assistant"
                    ? displayAnswer(m.content)
                    : m.content}
                </div>
              </div>
            ))}
            <div ref={scrollEnd} />
          </div>
          {showForm && (
            <form
              className="quick-form"
              onSubmit={(e) => {
                e.preventDefault();
                send(
                  "我" +
                    form.age +
                    "岁，咳嗽" +
                    form.duration +
                    "。" +
                    form.associated,
                );
              }}
            >
              <div className="form-title">
                快速补充信息
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setShowForm(false)}
                >
                  收起
                </button>
              </div>
              <div className="form-grid">
                <label>
                  年龄
                  <input
                    required
                    type="number"
                    min="18"
                    max="120"
                    value={form.age}
                    onChange={(e) => setForm({ ...form, age: e.target.value })}
                  />
                </label>
                <label>
                  持续时间
                  <input
                    required
                    placeholder="例如：3天"
                    value={form.duration}
                    onChange={(e) =>
                      setForm({ ...form, duration: e.target.value })
                    }
                  />
                </label>
              </div>
              <label>
                伴随症状（可选）
                <input
                  maxLength={500}
                  placeholder="请明确说明有或没有"
                  value={form.associated}
                  onChange={(e) =>
                    setForm({ ...form, associated: e.target.value })
                  }
                />
              </label>
              <button className="primary" disabled={busy}>
                提交信息
              </button>
            </form>
          )}
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="notice" role="status">
              {notice}
            </div>
          )}
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <label className="sr-only" htmlFor="message">
              咨询内容
            </label>
            <textarea
              id="message"
              ref={draft}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              maxLength={2000}
              placeholder="直接描述你的问题，例如：我感冒了，流鼻涕和咳嗽五天…"
              disabled={busy}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <div className="composer-footer">
              <span>{input.length}/2000 · Shift＋Enter换行</span>
              <button className="primary" disabled={busy || !input.trim()}>
                {busy ? "请稍候…" : "发送 →"}
              </button>
            </div>
          </form>
          <p className="footnote">
            健康信息辅助，不提供确诊、处方或排除风险的结论。
          </p>
        </section>

        <aside className="evidence card">
          <div className="panel-heading">
            <div className="eyebrow">EVIDENCE MATTERS</div>
            <h2>让每条依据可查看</h2>
          </div>
          <div className="tabs" role="tablist" aria-label="咨询资料">
            {(
              [
                ["result", "初步结果"],
                ["sources", "资料来源"],
                ["reports", "报告"],
                ["profile", "档案"],
              ] as const
            ).map(([id, text]) => (
              <button
                key={id}
                id={id + "-tab"}
                role="tab"
                aria-selected={tab === id}
                aria-controls={id + "-panel"}
                onClick={() => setTab(id)}
              >
                {text}
              </button>
            ))}
          </div>
          <div
            className="panel-scroll"
            id={tab + "-panel"}
            role="tabpanel"
            aria-labelledby={tab + "-tab"}
          >
            {tab === "profile" ? (
              <>
                <h3>健康档案</h3>
                <p className="muted small">
                  由你手动填写或确认。新咨询会读取这份档案，并与本次症状分开记录。
                </p>
                {!user ? (
                  <button className="primary" onClick={() => setAuthOpen(true)}>
                    登录后管理档案
                  </button>
                ) : (
                  <form
                    className="profile-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      act(async () => {
                        const p = await request<{ fields: Profile }>(
                          "/profile",
                          json("PUT", profileDraft),
                        );
                        setProfile(p.fields);
                        setNotice(
                          "档案已保存。下一次新咨询会读取更新后的信息。",
                        );
                      });
                    }}
                  >
                    <label>
                      年龄
                      <input
                        maxLength={40}
                        value={profileDraft.age}
                        onChange={(e) =>
                          setProfileDraft({
                            ...profileDraft,
                            age: e.target.value,
                          })
                        }
                        placeholder="例如：28岁（咨询时仍需核实）"
                      />
                    </label>
                    <label>
                      相关病史
                      <textarea
                        maxLength={400}
                        value={profileDraft.history}
                        onChange={(e) =>
                          setProfileDraft({
                            ...profileDraft,
                            history: e.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      过敏信息
                      <textarea
                        maxLength={400}
                        value={profileDraft.allergies}
                        onChange={(e) =>
                          setProfileDraft({
                            ...profileDraft,
                            allergies: e.target.value,
                          })
                        }
                      />
                    </label>
                    <button className="primary" disabled={busy}>
                      保存档案
                    </button>
                    <p className="muted small">留空并保存可删除对应字段。</p>
                    {Object.entries(profile).map(([key, item]) => (
                      <div className="provenance" key={key}>
                        {label[key] || "过敏信息"} ·{" "}
                        {item.source === "manual" ? "手动填写" : "咨询中确认"}
                        <br />
                        确认于{" "}
                        {new Date(item.confirmed_at).toLocaleString("zh-CN")}
                      </div>
                    ))}
                  </form>
                )}
              </>
            ) : tab === "reports" ? (
              <>
                <h3>上传、核对，再整理</h3>
                <p className="muted small">
                  支持文本、表格和文字PDF。PNG/JPEG需后端启用可选OCR。请使用模拟或已脱敏的报告。
                </p>
                {!user ? (
                  <button className="primary" onClick={() => setAuthOpen(true)}>
                    登录后上传报告
                  </button>
                ) : (
                  <>
                    <label className="upload-label">
                      选择文件（不超过8MB）
                      <input
                        type="file"
                        accept=".txt,.csv,.tsv,.pdf,.png,.jpg,.jpeg"
                        disabled={busy}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) act(() => uploadReport(f));
                          e.target.value = "";
                        }}
                      />
                    </label>
                    <label className="report-paste">
                      或粘贴报告文字
                      <textarea
                        maxLength={18000}
                        value={paste}
                        onChange={(e) => setPaste(e.target.value)}
                        placeholder="可粘贴自由文本；表格推荐CSV：项目,结果,单位,参考区间"
                      />
                    </label>
                    <button
                      disabled={busy || !paste.trim()}
                      onClick={() => act(addTextReport)}
                    >
                      提交文字
                    </button>
                    <button
                      disabled={busy}
                      className="text-button"
                      onClick={() =>
                        setPaste(
                          "项目,结果,单位,参考区间\n白细胞计数,6.5,10^9/L,3.5-9.5\n血红蛋白,140,g/L,130-175",
                        )
                      }
                    >
                      填入模拟报告
                    </button>
                    <div className="report-list">
                      {reports.map((r) => (
                        <button
                          className={report?.id === r.id ? "active" : ""}
                          key={r.id}
                          onClick={() => editReport(r)}
                        >
                          {r.name} · {r.confirmed ? "已确认" : "待核对"}
                        </button>
                      ))}
                    </div>
                    {report && (
                      <div className="report-editor">
                        <h4>核对：{report.name}</h4>
                        <p className="muted small">{report.notice}</p>
                        <details>
                          <summary>提取原文（只读）</summary>
                          <pre>{report.original_text}</pre>
                        </details>
                        <label>
                          确认文字
                          <textarea
                            value={reportText}
                            maxLength={18000}
                            onChange={(e) => {
                              setReportText(e.target.value);
                              setDirty(true);
                            }}
                          />
                        </label>
                        {rows.map((row, i) => (
                          <fieldset key={i} className="report-row">
                            <legend>
                              项目 {i + 1} · {row.location}
                            </legend>
                            {(
                              [
                                ["name", "项目"],
                                ["value", "结果"],
                                ["unit", "单位"],
                                ["reference", "参考区间"],
                              ] as const
                            ).map(([key, text]) => (
                              <label key={key}>
                                {text}
                                <input
                                  value={row[key]}
                                  maxLength={key === "unit" ? 40 : 80}
                                  onChange={(e) => {
                                    setRows(
                                      rows.map((r, j) =>
                                        i === j
                                          ? { ...r, [key]: e.target.value }
                                          : r,
                                      ),
                                    );
                                    setDirty(true);
                                  }}
                                />
                              </label>
                            ))}
                            <button
                              onClick={() => {
                                setRows(rows.filter((_, j) => i !== j));
                                setDirty(true);
                              }}
                            >
                              删除此项
                            </button>
                          </fieldset>
                        ))}
                        <button
                          disabled={rows.length >= 80}
                          onClick={() => {
                            setRows([
                              ...rows,
                              {
                                name: "",
                                value: "",
                                unit: "",
                                reference: "",
                                location: "用户补充",
                              },
                            ]);
                            setDirty(true);
                          }}
                        >
                          ＋ 添加项目
                        </button>
                        <div className="report-actions">
                          <button
                            className="primary"
                            disabled={
                              busy ||
                              !reportText.trim() ||
                              rows.some(
                                (r) => !r.name.trim() || !r.value.trim(),
                              )
                            }
                            onClick={() => act(confirmReport)}
                          >
                            确认核对内容
                          </button>
                          <button
                            disabled={busy || !report.confirmed || dirty}
                            onClick={() => act(analyzeReport)}
                          >
                            整理已确认报告
                          </button>
                        </div>
                        {dirty && (
                          <p className="muted small">
                            内容已修改，请再次确认后整理。
                          </p>
                        )}
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() =>
                            act(async () => {
                              if (!window.confirm("删除这份报告？")) return;
                              await request("/reports/" + report.id, {
                                method: "DELETE",
                              });
                              setReport(null);
                              await refreshReports(report.session_id);
                            })
                          }
                        >
                          删除报告
                        </button>
                      </div>
                    )}
                  </>
                )}
              </>
            ) : !result ? (
              <div className="empty-panel">
                <div>◎</div>
                <h3>依据会出现在这里</h3>
                <p>
                  开始咨询后查看初步方向、引用片段和待补充资料。问候和澄清输入不会生成医学结果。
                </p>
              </div>
            ) : tab === "result" ? (
              <>
                {result.risk_notice && (
                  <div className="risk-card">
                    <strong>普通分析已暂停</strong>
                    <p>{result.risk_notice}</p>
                    <button onClick={() => setRiskOpen(true)}>
                      查看触发信息
                    </button>
                  </div>
                )}
                <div className="result-section">
                  <span className="section-label">本轮回复</span>
                  {result.department && (
                    <h3>就诊方向参考：{result.department}</h3>
                  )}
                  <p>{displayAnswer(result.summary)}</p>
                  <p className="muted small">
                    {
                      basisLabels[
                        result.answer_basis ??
                          (result.claims.length ? "retrieved" : "general")
                      ]
                    }
                  </p>
                </div>
                {!!result.claims.length && (
                  <div className="result-section">
                    <span className="section-label">资料解释</span>
                    {result.claims.map((c, i) => (
                      <div className="claim" key={i}>
                        <p>{displayAnswer(c.text)}</p>
                        <button onClick={() => setTab("sources")}>
                          查看来源 ↗
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="result-section">
                  <span className="section-label">可选补充</span>

                  {result.missing_information.length ? (
                    result.missing_information.map((item) => (
                      <button
                        className="missing-item"
                        key={item}
                        disabled={busy}
                        onClick={() => {
                          setInput("补充" + item + "：");
                          draft.current?.focus();
                        }}
                      >
                        {item}
                        <span>＋</span>
                      </button>
                    ))
                  ) : (
                    <p>可以继续自由输入，无需按固定字段填写。</p>
                  )}
                </div>
                <p className="muted small">{result.limitation}</p>
                {result.retrieval_notice && (
                  <p className="notice">{result.retrieval_notice}</p>
                )}
              </>
            ) : (
              <>
                <p className="muted small">
                  本轮资料来自本地知识库或外部检索，来源类型标注在每条资料中。
                </p>
                {result.sources.length ? (
                  result.sources.map((s) => (
                    <article className="source" key={s.id}>
                      <span className="source-tag">
                        {s.institution} ·{" "}
                        {s.kind === "external_excerpt"
                          ? "外部正文，待审核"
                          : "本地整理摘要"}
                      </span>
                      <h3>{s.title}</h3>

                      <details
                        open={result.claims.some((c) => c.evidence_id === s.id)}
                      >
                        <summary>查看检索片段</summary>
                        <p>{s.text}</p>
                      </details>
                      <small>
                        发布日期：{s.published_at || "未核实"}
                        <br />
                        采集日期：{s.collected_at}
                      </small>
                      <a href={s.url} target="_blank" rel="noopener noreferrer">
                        打开官方页面 ↗
                      </a>
                    </article>
                  ))
                ) : (
                  <p>本轮没有检索引用。</p>
                )}
              </>
            )}
          </div>
        </aside>
      </main>
      {showDev && (
        <section className="developer card">
          <h2>实际执行记录</h2>
          <p className="muted small">
            只展示节点和调用元数据，不展示模型内部推理。需在后端配置 DEV_TOKEN。
          </p>
          <div className="developer-controls">
            <input
              type="password"
              aria-label="开发者令牌"
              placeholder="DEV_TOKEN（不保存）"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <button
              className="primary"
              onClick={loadEvents}
              disabled={!runId || !token || devBusy}
            >
              读取当前运行日志
            </button>
          </div>
          {runId && <p className="muted small">运行编号：{runId}</p>}
          {devError && (
            <p role="alert" className="error">
              {devError}
            </p>
          )}
          <pre>
            {events.length ? JSON.stringify(events, null, 2) : "暂无已读取记录"}
          </pre>
        </section>
      )}
      {authOpen && (
        <div className="modal-backdrop">
          <section
            className="auth-modal card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="auth-title"
          >
            <button
              className="close-modal"
              aria-label="关闭登录"
              onClick={() => setAuthOpen(false)}
            >
              ×
            </button>
            <h2 id="auth-title">{registering ? "创建演示账号" : "欢迎回来"}</h2>
            <p className="muted small">
              邮箱仅作为登录账号，当前版本不发送验证邮件。
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                act(async () => {
                  const u = await request<User>(
                    registering ? "/auth/register" : "/auth/login",
                    json("POST", auth),
                  );
                  setUser(u);
                  setSession(null);
                  setReport(null);
                  setAuthOpen(false);
                  setAuth({ email: "", password: "" });
                  setInput("");
                });
              }}
            >
              <label>
                邮箱
                <input
                  autoFocus
                  type="email"
                  autoComplete="username"
                  required
                  value={auth.email}
                  onChange={(e) => setAuth({ ...auth, email: e.target.value })}
                />
              </label>
              <label>
                密码（至少10位）
                <input
                  type="password"
                  autoComplete={
                    registering ? "new-password" : "current-password"
                  }
                  minLength={10}
                  maxLength={128}
                  required
                  value={auth.password}
                  onChange={(e) =>
                    setAuth({ ...auth, password: e.target.value })
                  }
                />
              </label>
              {error && (
                <div className="error" role="alert">
                  {error}
                </div>
              )}
              <button className="primary wide" disabled={busy}>
                {busy ? "请稍候…" : registering ? "注册并登录" : "登录"}
              </button>
            </form>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => {
                setRegistering(!registering);
                setError("");
              }}
            >
              {registering ? "已有账号，去登录" : "没有账号，去注册"}
            </button>
          </section>
        </div>
      )}
      {riskOpen && result?.risk_notice && (
        <div className="modal-backdrop">
          <section
            className="risk-modal card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="risk-title"
          >
            <span className="risk-label">需要优先线下评估</span>
            <h2 id="risk-title">本轮触发风险提示</h2>
            <p>{result.risk_notice}</p>
            <div className="risk-inputs">
              触发内容：{result.risk_inputs.join("、")}
            </div>
            <p className="muted small">已整理的信息仍保留在当前页面。</p>
            <button
              autoFocus
              className="primary"
              onClick={() => setRiskOpen(false)}
            >
              知道了，查看已整理的信息
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
