import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import * as Dialog from "@radix-ui/react-dialog";
import {
  LayoutDashboard,
  Network,
  Layers,
  Settings,
  Plus,
  Sun,
  Moon,
  LogOut,
  ArrowRight,
  ShieldCheck,
  X,
  Check,
} from "lucide-react";
import type {
  NodeRecord,
  Profile,
  NormalizedNode,
  Envelope,
  NodeGroup,
} from "../../../packages/shared/schema";
import { ApiError, api, setCsrf } from "./api";
import { getField, setField } from "./fields";
import { NodeLibrary } from "./NodeLibrary";
import { SubscriptionDetail, SubscriptionList } from "./Subscriptions";
import "./style.css";
type SettingsData = {
  site_name: string;
  admin_base_url: string;
  subscription_base_url: string;
  default_format: string;
};
type Preview = {
  index: number;
  status: string;
  envelope: Envelope | null;
  duplicate: boolean;
  duplicate_scope?: "existing" | "batch" | null;
  error: string | null;
  code?: string;
  field?: string;
};
type BusinessData = {
  nodes: NodeRecord[];
  profiles: Profile[];
  groups: NodeGroup[];
  settings: SettingsData;
};
type AppPhase =
  | "bootstrapping"
  | "unauthenticated"
  | "loading-data"
  | "ready"
  | "error";
type AppFailure = {
  scope: "connection" | "data";
  message: string;
};
const protocols = ["vless", "vmess", "trojan", "ss", "hysteria2", "tuic"];
const date = (s: string) => new Date(s).toLocaleString();
const labelProtocol = (s: string) =>
  s === "ss"
    ? "Shadowsocks"
    : s === "hysteria2"
      ? "Hysteria2"
      : s.toUpperCase();
const security = (n: NormalizedNode) =>
  n["reality-opts"] ? "Reality" : n.tls ? "TLS" : "无 TLS";
function Field({
  label,
  children,
}: React.PropsWithChildren<{ label: string }>) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Modal({
  open,
  onClose,
  title,
  description,
  drawer = false,
  returnFocus,
  children,
}: React.PropsWithChildren<{
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  drawer?: boolean;
  returnFocus?: () => void;
}>) {
  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content
          className={drawer ? "modal drawer" : "modal"}
          onCloseAutoFocus={
            returnFocus
              ? (event) => {
                  event.preventDefault();
                  returnFocus();
                }
              : undefined
          }
        >
          <div className="modal-head">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description>
                {description || "更改将在确认后保存。"}
              </Dialog.Description>
            </div>
            <Dialog.Close className="icon-button" aria-label="关闭">
              <X size={18} />
            </Dialog.Close>
          </div>
          <div className="modal-body">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
// Kept during the 0.2.5 UI transition for legacy layout regression coverage.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function Empty({ text }: { text: string }) {
  return (
    <div className="empty">
      <Network size={34} />
      <h3>{text}</h3>
      <p>从一条节点分享链接开始，建立自己的订阅。</p>
    </div>
  );
}
function App() {
  const [user, setUser] = useState<string | null>(null),
    [phase, setPhase] = useState<AppPhase>("bootstrapping"),
    [page, setPage] = useState("dashboard");
  const [businessData, setBusinessData] = useState<BusinessData | null>(null);
  const [failure, setFailure] = useState<AppFailure | null>(null);
  const [toast, setToast] = useState(""),
    [pending, setPending] = useState(false),
    [theme, setTheme] = useState(localStorage.getItem("psm-theme") || "system");
  const [importOpen, setImportOpen] = useState(false),
    [editing, setEditing] = useState<NodeRecord | null>(null),
    [profile, setProfile] = useState<Profile | null>(null),
    [newProfile, setNewProfile] = useState(false);
  const [confirm, setConfirm] = useState<Confirmation | null>(null);
  const [activeGroupId, setActiveGroupId] = useState<number | null>(null);
  const confirmationFocus = useRef<(() => void) | undefined>(undefined);
  const authGeneration = useRef(0);
  useEffect(() => {
    if (confirm) confirmationFocus.current = confirm.returnFocus;
  }, [confirm]);
  const notify = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(""), 4500);
  };
  const fetchBusinessData = async (signal?: AbortSignal) => {
    const [n, p, s, g] = await Promise.all([
      api<NodeRecord[]>("/nodes", "GET", undefined, { signal }),
      api<Profile[]>("/subscriptions", "GET", undefined, { signal }),
      api<SettingsData>("/settings", "GET", undefined, { signal }),
      api<NodeGroup[]>("/node-groups", "GET", undefined, { signal }),
    ]);
    return { nodes: n, profiles: p, settings: s, groups: g };
  };
  const fetchBusinessDataWithRetry = async (signal?: AbortSignal) => {
    try {
      return await fetchBusinessData(signal);
    } catch (error) {
      if (
        !(error instanceof ApiError) ||
        !["NETWORK", "ABORTED"].includes(error.code) ||
        signal?.aborted
      )
        throw error;
      return fetchBusinessData(signal);
    }
  };
  const commitBusinessData = (data: BusinessData) => {
    setBusinessData(data);
    setActiveGroupId((current) =>
      data.groups.some((group) => group.id === current)
        ? current
        : (data.groups[0]?.id ?? null),
    );
  };
  const refresh = async () => commitBusinessData(await fetchBusinessData());
  const establishSession = async (
    scope: AppFailure["scope"],
    signal?: AbortSignal,
  ) => {
    const generation = ++authGeneration.current;
    setFailure(null);
    if (scope === "data") setPhase("loading-data");
    try {
      const me = await api<{ username: string; csrf: string }>(
        "/auth/me",
        "GET",
        undefined,
        { signal },
      );
      setCsrf(me.csrf);
      const data = await fetchBusinessDataWithRetry(signal);
      if (signal?.aborted || generation !== authGeneration.current) return;
      commitBusinessData(data);
      setUser(me.username);
      setPhase("ready");
    } catch (error) {
      if (signal?.aborted || generation !== authGeneration.current) return;
      if (error instanceof ApiError && error.status === 401) {
        setCsrf("");
        setUser(null);
        setBusinessData(null);
        setPhase("unauthenticated");
        return;
      }
      setFailure({
        scope,
        message: (error as Error).message || "请求失败",
      });
      setPhase("error");
      throw error;
    }
  };
  const action = async (fn: () => Promise<void>) => {
    setPending(true);
    try {
      await fn();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setPending(false);
    }
  };
  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    notify("已复制到剪贴板");
  };
  useEffect(() => {
    const controller = new AbortController();
    establishSession("connection", controller.signal).catch(() => undefined);
    return () => controller.abort();
  }, []);
  useEffect(() => {
    localStorage.setItem("psm-theme", theme);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      document.documentElement.classList.toggle(
        "dark",
        theme === "dark" || (theme === "system" && media.matches),
      );
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  if (phase === "bootstrapping") return <AppStatus title="正在连接 dx-dy…" />;
  if (phase === "loading-data") return <AppStatus title="正在加载工作空间…" />;
  if (phase === "error" && failure)
    return (
      <AppStatus
        title={
          failure.scope === "connection" ? "连接服务器失败" : "数据加载失败"
        }
        detail={failure.message}
        retry={() => {
          setPhase(
            failure.scope === "connection" ? "bootstrapping" : "loading-data",
          );
          establishSession(failure.scope).catch(() => undefined);
        }}
      />
    );
  if (phase === "unauthenticated")
    return (
      <>
        <Login
          onLogin={async () => {
            setPhase("loading-data");
            try {
              await establishSession("data");
            } catch (error) {
              if (error instanceof ApiError && error.status === 401)
                notify("登录会话未能建立，请重新登录");
            }
          }}
          notify={notify}
        />
        {toast && (
          <div className="toast" role="status">
            {toast}
          </div>
        )}
      </>
    );
  if (phase !== "ready" || !user || !businessData) return null;
  const { nodes, profiles, groups, settings } = businessData;
  const nav = [
    ["dashboard", "Dashboard", LayoutDashboard],
    ["nodes", "节点库", Network],
    ["subscriptions", "订阅", Layers],
    ["settings", "设置", Settings],
  ] as const;
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Network size={21} />
          </div>
          <div>
            <strong>{settings.site_name}</strong>
            <small>PRIVATE NODE SPACE</small>
          </div>
        </div>
        <div className="nav-label">工作空间</div>
        <nav>
          {nav.map(([key, label, Icon]) => (
            <button
              key={key}
              data-page={key}
              className={page === key ? "nav active" : "nav"}
              onClick={() => {
                setPage(key);
                setProfile(null);
              }}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="secure-note">
            <ShieldCheck size={15} />
            单管理员 · 私有管理
          </span>
          <a href="/source.tar.gz">源码 · AGPL-3.0</a>
          <small>dx-dy v0.3.3</small>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span className="breadcrumb">
            工作空间 <span>/</span> {nav.find((n) => n[0] === page)?.[1]}
          </span>
          <div className="top-actions">
            <select
              aria-label="主题"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
            >
              <option value="system">跟随系统</option>
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
            {theme === "dark" ? <Moon size={17} /> : <Sun size={17} />}
            <span className="avatar">A</span>
            <span>{user}</span>
            <button
              className="icon-button"
              aria-label="退出登录"
              onClick={() =>
                action(async () => {
                  await api("/auth/logout", "POST", {});
                  authGeneration.current += 1;
                  setCsrf("");
                  setUser(null);
                  setBusinessData(null);
                  setPhase("unauthenticated");
                })
              }
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>
        <div className="page">
          <div className="page-heading">
            <div>
              <div className="eyebrow">YOUR PRIVATE NETWORK</div>
              <h1>
                {page === "dashboard"
                  ? "总览"
                  : page === "nodes"
                    ? "节点库"
                    : page === "subscriptions"
                      ? "订阅"
                      : "设置"}
              </h1>
              <p>
                {page === "dashboard"
                  ? "节点集中管理，订阅随时保持同步。"
                  : page === "nodes"
                    ? "分组独立管理节点，更新按节点引用应用到订阅。"
                    : page === "subscriptions"
                      ? "为设备或使用场景组合节点，独立、安全地分发。"
                      : "管理工作空间与账户安全。"}
              </p>
            </div>
            {page === "nodes" && (
              <button
                className="primary"
                disabled={!activeGroupId}
                onClick={() => setImportOpen(true)}
              >
                <Plus size={17} />
                添加 / 批量添加节点
              </button>
            )}
            {page === "subscriptions" && (
              <button className="primary" onClick={() => setNewProfile(true)}>
                <Plus size={17} />
                创建订阅
              </button>
            )}
          </div>
          {page === "dashboard" && (
            <Dashboard nodes={nodes} profiles={profiles} go={setPage} />
          )}
          {page === "nodes" && (
            <NodeLibrary
              nodes={nodes}
              groups={groups}
              activeGroupId={activeGroupId}
              setActiveGroupId={setActiveGroupId}
              refresh={refresh}
              notify={notify}
              copy={copy}
              edit={setEditing}
              confirm={setConfirm}
            />
          )}
          {page === "subscriptions" &&
            (profile ? (
              <SubscriptionDetail
                key={profile.id}
                initial={profile}
                nodes={nodes}
                groups={groups}
                notify={notify}
                copy={copy}
                onSaved={async () => {
                  await refresh();
                }}
                onBack={() => setProfile(null)}
                confirm={setConfirm}
              />
            ) : (
              <SubscriptionList
                profiles={profiles}
                open={setProfile}
                refresh={refresh}
                notify={notify}
                copy={copy}
                confirm={setConfirm}
              />
            ))}
          {page === "settings" && (
            <SettingsPage
              initial={settings}
              onSave={refresh}
              notify={notify}
              onPasswordChanged={() => {
                authGeneration.current += 1;
                setCsrf("");
                setUser(null);
                setBusinessData(null);
                setPhase("unauthenticated");
              }}
            />
          )}
          <footer>只管理节点与订阅 · 数据保存在您的服务器上</footer>
        </div>
      </main>
      <ImportDialog
        key={`${importOpen}:${activeGroupId}`}
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onSaved={refresh}
        notify={notify}
        groups={groups}
        initialGroupId={activeGroupId}
      />
      {editing && (
        <NodeDrawer
          key={editing.id}
          node={editing}
          onClose={() => setEditing(null)}
          onSaved={refresh}
          notify={notify}
          copy={copy}
          confirm={setConfirm}
        />
      )}
      <NewProfile
        open={newProfile}
        close={() => setNewProfile(false)}
        saved={refresh}
        notify={notify}
      />
      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm?.title || "确认"}
        returnFocus={() => {
          if (confirmationFocus.current) confirmationFocus.current();
          else
            document
              .querySelector<HTMLButtonElement>("button.nav.active")
              ?.focus();
        }}
      >
        <p
          style={{
            overflowWrap: "anywhere",
            maxHeight: "45vh",
            overflowY: "auto",
          }}
        >
          {confirm?.text}
        </p>
        <div className="modal-actions">
          <button onClick={() => setConfirm(null)}>取消</button>
          <button
            className="danger"
            disabled={pending}
            onClick={() =>
              action(async () => {
                const message = await confirm?.run();
                setConfirm(null);
                notify(message || confirm?.successMessage || "操作已完成");
              })
            }
          >
            {confirm?.confirmLabel || "确认"}
          </button>
        </div>
      </Modal>
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
    </div>
  );
}
function AppStatus({
  title,
  detail,
  retry,
}: {
  title: string;
  detail?: string;
  retry?: () => void;
}) {
  return (
    <main className="app-status" aria-live="polite">
      <div className="brand-mark">
        <Network size={21} />
      </div>
      <h1>{title}</h1>
      {detail && <p>{detail}</p>}
      {retry && (
        <button className="primary" onClick={retry}>
          重试
        </button>
      )}
    </main>
  );
}
function Login({
  onLogin,
  notify,
}: {
  onLogin: () => Promise<void>;
  notify: (s: string) => void;
}) {
  const [username, setUsername] = useState("admin"),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="login-screen">
      <div className="login-decoration">
        <div className="brand-mark">
          <Network size={27} />
        </div>
        <span>PRIVATE SUBSCRIPTIONS</span>
        <h1>
          你的节点。
          <br />
          你的私人空间。
        </h1>
        <p>
          一个节点库，多份订阅。
          <br />
          让每台设备保持同步。
        </p>
        <div className="login-lines">
          <i />
          <i />
          <i />
        </div>
      </div>
      <form
        className="login-card"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api<{ username: string; csrf: string }>(
              "/auth/login",
              "POST",
              { username, password },
            );
            await onLogin();
          } catch (err) {
            notify((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="eyebrow">WELCOME BACK</div>
        <h2>登录管理后台</h2>
        <p>仅限管理员访问</p>
        <Field label="用户名">
          <input
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </Field>
        <Field label="密码">
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        <button className="primary" disabled={busy}>
          {busy ? "登录中…" : "安全登录"}
          <ArrowRight size={16} />
        </button>
        <small>
          <ShieldCheck size={14} />
          服务器端安全会话 · dx-dy
        </small>
        <a href="/source.tar.gz">对应源码 · AGPL-3.0</a>
      </form>
    </div>
  );
}
function Dashboard({
  nodes,
  profiles,
  go,
}: {
  nodes: NodeRecord[];
  profiles: Profile[];
  go: (s: string) => void;
}) {
  const cards = [
    ["节点总数", nodes.length, Network],
    ["启用节点", nodes.filter((n) => n.enabled).length, ShieldCheck],
    ["订阅配置", profiles.length, Layers],
  ] as const;
  const recent = [
    ...nodes.map((n) => ({ name: n.name, kind: "节点", at: n.updated_at })),
    ...profiles.map((n) => ({ name: n.name, kind: "订阅", at: n.updated_at })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 7);
  return (
    <>
      <div className="stats">
        {cards.map(([title, count, Icon]) => (
          <div className="card stat" key={title}>
            <div>
              <span>{title}</span>
              <strong>{count}</strong>
              <small>当前工作空间</small>
            </div>
            <div className="stat-icon">
              <Icon size={22} />
            </div>
          </div>
        ))}
      </div>
      <div className="dashboard-grid">
        <section className="card section-pad">
          <h2>协议分布</h2>
          <p className="muted">节点库中的协议组成</p>
          {protocols.map((p) => {
            const count = nodes.filter((n) => n.protocol === p).length;
            return (
              <div className="distribution" key={p}>
                <span>{labelProtocol(p)}</span>
                <div className="bar">
                  <i
                    style={{
                      width: `${nodes.length ? (count / nodes.length) * 100 : 0}%`,
                    }}
                  />
                </div>
                <strong>{count}</strong>
              </div>
            );
          })}
        </section>
        <section className="card section-pad">
          <h2>最近更新</h2>
          <p className="muted">节点与订阅的最新更改</p>
          {recent.length ? (
            recent.map((r, i) => (
              <div className="recent" key={i}>
                <span className="recent-dot" />
                <div>
                  <strong>{r.name}</strong>
                  <small>
                    {r.kind} · {date(r.at)}
                  </small>
                </div>
              </div>
            ))
          ) : (
            <p className="muted">还没有记录</p>
          )}
        </section>
      </div>
      <div className="welcome-strip">
        <div>
          <h3>集中维护，自动同步</h3>
          <p>修改节点库配置，所有引用它的订阅将在下次更新时获取新配置。</p>
        </div>
        <button onClick={() => go("nodes")}>
          管理节点
          <ArrowRight size={16} />
        </button>
      </div>
    </>
  );
}
function ImportDialog({
  open,
  onClose,
  onSaved,
  notify,
  groups,
  initialGroupId,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
  notify: (s: string) => void;
  groups: NodeGroup[];
  initialGroupId: number | null;
}) {
  const [text, setText] = useState(""),
    [rows, setRows] = useState<Preview[]>([]),
    [selected, setSelected] = useState<Set<number>>(new Set()),
    [names, setNames] = useState<Record<number, string>>({}),
    [busy, setBusy] = useState(false);
  const [groupId, setGroupId] = useState<number | null>(initialGroupId);
  const work = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="粘贴节点链接"
      description="一行一条，支持 VLESS / VMess / Trojan / SS / HY2 / TUIC。先预览，再确认导入。"
    >
      <label className="field">
        <span>目标分组</span>
        <select
          aria-label="导入目标分组"
          value={groupId ?? ""}
          onChange={(event) => {
            setGroupId(event.target.value ? Number(event.target.value) : null);
            setRows([]);
          }}
        >
          <option value="" disabled>
            请选择分组
          </option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </select>
      </label>
      <textarea
        aria-label="节点链接"
        className="uri-input"
        rows={7}
        placeholder="vless://…\nvmess://…\nhysteria2://…"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setRows([]);
        }}
      />
      <div className="modal-actions">
        <span className="muted">每批最多 300 行，不会自动丢弃失败项</span>
        <button
          className="primary"
          disabled={busy || !text.trim() || !groupId}
          onClick={() =>
            work(async () => {
              const result = await api<Preview[]>("/nodes/preview", "POST", {
                text,
                group_id: groupId,
              });
              setRows(result);
              setSelected(
                new Set(
                  result
                    .filter((r) => r.envelope && !r.duplicate)
                    .map((r) => r.index),
                ),
              );
              setNames(
                Object.fromEntries(
                  result
                    .filter((r) => r.envelope)
                    .map((r) => [r.index, r.envelope!.normalized_config.name]),
                ),
              );
            })
          }
        >
          解析预览
        </button>
      </div>
      {rows.length > 0 && (
        <>
          <div className="import-summary">
            {rows.filter((r) => r.status === "success").length} 成功 ·{" "}
            {rows.filter((r) => r.status === "warning").length} 警告 ·{" "}
            {rows.filter((r) => r.status === "failure").length} 失败
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>选择</th>
                  <th>状态 / 名称</th>
                  <th>协议 / 地址</th>
                  <th>结果</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.index}>
                    <td>
                      <input
                        aria-label={`导入第 ${r.index + 1} 行`}
                        type="checkbox"
                        checked={selected.has(r.index)}
                        disabled={!r.envelope || r.duplicate}
                        onChange={(e) =>
                          setSelected((s) => {
                            const n = new Set(s);
                            if (e.target.checked) n.add(r.index);
                            else n.delete(r.index);
                            return n;
                          })
                        }
                      />
                    </td>
                    <td>
                      <small>
                        第 {r.index + 1} 行 ·{" "}
                        {r.status === "success"
                          ? "成功"
                          : r.status === "warning"
                            ? "警告"
                            : "失败"}
                      </small>
                      {r.envelope && (
                        <input
                          aria-label={`第 ${r.index + 1} 行名称`}
                          value={names[r.index] || ""}
                          onChange={(e) =>
                            setNames({ ...names, [r.index]: e.target.value })
                          }
                        />
                      )}
                    </td>
                    <td>
                      {r.envelope && (
                        <>
                          {labelProtocol(r.envelope.normalized_config.type)}
                          <small className="block">
                            {r.envelope.normalized_config.server}:
                            {r.envelope.normalized_config.port}
                          </small>
                          <small>
                            {security(r.envelope.normalized_config)} /{" "}
                            {r.envelope.normalized_config.network || "tcp"}
                          </small>
                        </>
                      )}
                    </td>
                    <td>
                      <small className={r.error ? "danger-text" : "muted"}>
                        {r.error ||
                          [
                            r.duplicate
                              ? r.duplicate_scope === "batch"
                                ? "与本次导入前面的节点重复"
                                : "与节点库已有节点重复"
                              : "",
                            ...r.envelope!.parse_warnings,
                          ]
                            .filter(Boolean)
                            .join("；") ||
                          "解析成功"}
                      </small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="modal-actions">
            <span>已选择 {selected.size} 条</span>
            <button
              className="primary"
              disabled={busy || !selected.size}
              onClick={() =>
                work(async () => {
                  await api("/nodes/import", "POST", {
                    group_id: groupId,
                    items: rows
                      .filter((r) => selected.has(r.index) && r.envelope)
                      .map((r) => ({
                        uri: r.envelope!.original_uri,
                        name: names[r.index],
                      })),
                  });
                  await onSaved();
                  notify(`已导入 ${selected.size} 个节点`);
                  setText("");
                  setRows([]);
                  onClose();
                })
              }
            >
              确认导入
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
type Confirmation = {
  title: string;
  text: string;
  run: () => Promise<void | string>;
  returnFocus?: () => void;
  successMessage?: string;
  confirmLabel?: string;
};
type ConfirmSetter = (v: Confirmation | null) => void;
function NodeDrawer({
  node,
  onClose,
  onSaved,
  notify,
  copy,
  confirm,
}: {
  node: NodeRecord;
  onClose: () => void;
  onSaved: () => Promise<void>;
  notify: (s: string) => void;
  copy: (s: string) => Promise<void>;
  confirm: ConfirmSetter;
}) {
  const [config, setConfig] = useState<NormalizedNode>(
      structuredClone(node.normalized_config),
    ),
    [remark, setRemark] = useState(node.remark),
    [tags, setTags] = useState(node.tags.join(", ")),
    [enabled, setEnabled] = useState(node.enabled),
    [tab, setTab] = useState("form"),
    [newUri, setNewUri] = useState(""),
    [diff, setDiff] = useState<
      { field: string; old: unknown; new: unknown }[] | null
    >(null),
    [busy, setBusy] = useState(false),
    [advanced, setAdvanced] = useState(
      JSON.stringify(node.normalized_config, null, 2),
    );
  const work = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const input = (label: string, key: string, numeric = false) => {
    const v = getField(config, key);
    return (
      <Field key={key} label={label}>
        <input
          type={numeric ? "number" : "text"}
          value={
            Array.isArray(v) ? v.join(",") : v === undefined ? "" : String(v)
          }
          onChange={(e) =>
            setConfig(
              setField(
                config,
                key,
                e.target.value === ""
                  ? undefined
                  : numeric
                    ? Number(e.target.value)
                    : e.target.value,
              ),
            )
          }
        />
      </Field>
    );
  };
  const net = config.network || "tcp";
  return (
    <Modal
      open
      onClose={onClose}
      title={node.name}
      description="原始来源与当前配置分开保存；结构化编辑不会覆盖原始链接。"
      drawer
    >
      <div className="tabs">
        {[
          ["form", "参数编辑"],
          ["reimport", "重新导入"],
          ["original", "原始链接"],
          ["advanced", "高级配置"],
        ].map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? "active" : ""}
            onClick={() => {
              setTab(key);
              if (key === "advanced")
                setAdvanced(JSON.stringify(config, null, 2));
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "form" && (
        <>
          <div className="form-grid">
            {input("节点名称", "name")}
            {input("服务器 IP / Domain", "server")}
            {input("端口", "port", true)}
            <Field label="协议">
              <input disabled value={labelProtocol(config.type)} />
            </Field>
            {["vless", "vmess", "tuic"].includes(config.type) &&
              input("UUID", "uuid")}
            {["trojan", "ss", "hysteria2", "tuic"].includes(config.type) &&
              input("Password", "password")}
            {["ss", "vmess"].includes(config.type) && input("Cipher", "cipher")}
            {config.type === "vmess" && input("Alter ID", "alterId", true)}
            {["vless", "vmess", "trojan"].includes(config.type) && (
              <Field label="Transport">
                <select
                  value={net}
                  onChange={(e) =>
                    setConfig({ ...config, network: e.target.value })
                  }
                >
                  {[
                    "tcp",
                    "ws",
                    "grpc",
                    "httpupgrade",
                    "xhttp",
                    "http",
                    "h2",
                  ].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </Field>
            )}
            {config.type === "vless" && input("Flow / Vision", "flow")}
            <Field label="安全类型">
              <select
                value={
                  config["reality-opts"]
                    ? "reality"
                    : config.tls
                      ? "tls"
                      : "none"
                }
                onChange={(e) => {
                  const c: NormalizedNode = {
                    ...config,
                    tls: e.target.value !== "none",
                  };
                  if (e.target.value === "reality")
                    c["reality-opts"] = c["reality-opts"] || {
                      "public-key": "",
                      "short-id": "",
                    };
                  else delete c["reality-opts"];
                  setConfig(c);
                }}
              >
                <option value="none">无 TLS</option>
                <option value="tls">TLS</option>
                {config.type === "vless" && (
                  <option value="reality">Reality</option>
                )}
              </select>
            </Field>
            {(config.tls ||
              ["trojan", "hysteria2", "tuic"].includes(config.type)) && (
              <>
                {input("SNI", "sni")}
                {input("Fingerprint", "client-fingerprint")}
                <Field label="ALPN（逗号分隔）">
                  <input
                    value={config.alpn?.join(",") || ""}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        alpn: e.target.value
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </Field>
                <Field label="证书校验">
                  <select
                    value={config["skip-cert-verify"] ? "skip" : "verify"}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        "skip-cert-verify": e.target.value === "skip",
                      })
                    }
                  >
                    <option value="verify">验证证书</option>
                    <option value="skip">跳过验证（不推荐）</option>
                  </select>
                </Field>
              </>
            )}
            {config["reality-opts"] && (
              <>
                {input("Reality Public Key", "reality-opts.public-key")}
                {input("Short ID", "reality-opts.short-id")}
                {input("SpiderX", "reality-opts._spider-x")}
              </>
            )}
            {["ws", "http", "httpupgrade", "xhttp", "h2"].includes(net) && (
              <>
                {input("Path", `${net}-opts.path`)}
                {input(
                  "Host",
                  net === "xhttp"
                    ? "xhttp-opts.host"
                    : `${net}-opts.headers.Host`,
                )}
              </>
            )}
            {net === "grpc" &&
              input("gRPC serviceName", "grpc-opts.grpc-service-name")}
            {net === "xhttp" && input("XHTTP mode", "xhttp-opts.mode")}
            {config.type === "ss" && (
              <>
                {input("Plugin", "plugin")}
                {input("Plugin mode", "plugin-opts.mode")}
                {input("Plugin host", "plugin-opts.host")}
                {input("Plugin path", "plugin-opts.path")}
              </>
            )}
            {config.type === "hysteria2" && (
              <>
                {input("Obfs", "obfs")}
                {input("Obfs password", "obfs-password")}
                {input("端口跳跃", "ports")}
                {input("Hop interval", "hop-interval", true)}
                {input("Up Mbps", "up", true)}
                {input("Down Mbps", "down", true)}
              </>
            )}
            {config.type === "tuic" && (
              <>
                {input("Congestion controller", "congestion-controller")}
                {input("UDP relay mode", "udp-relay-mode")}
                {input("Heartbeat interval", "heartbeat-interval", true)}
              </>
            )}
          </div>
          <Field label="备注">
            <textarea
              rows={2}
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
            />
          </Field>
          <Field label="标签（逗号分隔）">
            <input value={tags} onChange={(e) => setTags(e.target.value)} />
          </Field>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            启用节点
          </label>
          <div className="notice">
            私有参数原始编码保留。高级配置可编辑其他成熟 parser 字段。
          </div>
        </>
      )}
      {tab === "advanced" && (
        <>
          <p className="muted">
            当前结构化配置。敏感凭据仅在本页面显示，不进入日志。
          </p>
          <textarea
            className="code-input"
            rows={22}
            value={advanced}
            onChange={(e) => setAdvanced(e.target.value)}
          />
          <button
            onClick={() => {
              try {
                setConfig(JSON.parse(advanced) as NormalizedNode);
                setTab("form");
                notify("已应用到表单，点击保存提交");
              } catch {
                notify("JSON 格式无效");
              }
            }}
          >
            应用到表单
          </button>
          <details>
            <summary>保留的 raw sidecar</summary>
            <pre>{JSON.stringify(node.unknown_params, null, 2)}</pre>
          </details>
        </>
      )}
      {tab === "reimport" && (
        <>
          <textarea
            aria-label="重新导入链接"
            rows={5}
            value={newUri}
            onChange={(e) => {
              setNewUri(e.target.value);
              setDiff(null);
            }}
            placeholder="粘贴新的完整 URI"
          />
          <button
            disabled={busy || !newUri.trim()}
            onClick={() =>
              work(async () => {
                const d = await api<{
                  diff: { field: string; old: unknown; new: unknown }[];
                }>(`/nodes/${node.id}/reimport-preview`, "POST", {
                  uri: newUri,
                });
                setDiff(d.diff);
              })
            }
          >
            解析并比较
          </button>
          {diff && (
            <>
              <table>
                <thead>
                  <tr>
                    <th>字段</th>
                    <th>原值</th>
                    <th>新值</th>
                  </tr>
                </thead>
                <tbody>
                  {diff.map((d) => (
                    <tr key={d.field}>
                      <td>{d.field}</td>
                      <td className="break">{JSON.stringify(d.old)}</td>
                      <td className="break">{JSON.stringify(d.new)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button
                className="primary"
                onClick={() =>
                  confirm({
                    title: "确认重新导入",
                    text: "将替换当前配置、原始 URI 与 sidecar；备注与标签保持不变。",
                    run: async () => {
                      await api(`/nodes/${node.id}/reimport`, "POST", {
                        uri: newUri,
                        confirm: true,
                      });
                      await onSaved();
                      onClose();
                    },
                  })
                }
              >
                确认替换来源与配置
              </button>
            </>
          )}
        </>
      )}
      {tab === "original" && (
        <>
          <p>这是最近一次明确导入的来源，可能与当前有效配置不同。</p>
          <textarea readOnly rows={8} value={node.original_uri} />
          <div className="row-actions">
            <button onClick={() => work(() => copy(node.original_uri))}>
              复制原始链接
            </button>
            <button
              onClick={() =>
                confirm({
                  title: "恢复原始参数",
                  text: "重新解析原始 URI，覆盖当前协议参数；备注与标签不变。",
                  run: async () => {
                    await api(`/nodes/${node.id}/restore`, "POST", {
                      confirm: true,
                    });
                    await onSaved();
                    onClose();
                  },
                })
              }
            >
              恢复原始参数
            </button>
          </div>
        </>
      )}
      <div className="modal-actions sticky">
        <button
          onClick={() =>
            work(async () => {
              const { uri } = await api<{ uri: string }>(
                `/nodes/${node.id}/uri`,
              );
              await copy(uri);
            })
          }
        >
          复制已保存当前链接
        </button>
        {tab === "form" && (
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              work(async () => {
                await api(`/nodes/${node.id}`, "PATCH", {
                  normalized_config: config,
                  remark,
                  tags: tags
                    .split(/[,，]/)
                    .map((t) => t.trim())
                    .filter(Boolean),
                  enabled,
                });
                await onSaved();
                notify("节点已更新，关联订阅自动同步");
                onClose();
              })
            }
          >
            保存更改
          </button>
        )}
      </div>
    </Modal>
  );
}
function NewProfile({
  open,
  close,
  saved,
  notify,
}: {
  open: boolean;
  close: () => void;
  saved: () => Promise<void>;
  notify: (s: string) => void;
}) {
  const [name, setName] = useState(""),
    [remark, setRemark] = useState("");
  return (
    <Modal open={open} onClose={close} title="创建订阅">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api("/subscriptions", "POST", {
              name,
              remark,
              enabled: true,
            });
            await saved();
            close();
            setName("");
            setRemark("");
            notify("订阅已创建");
          } catch (err) {
            notify((err as Error).message);
          }
        }}
      >
        <Field label="订阅名称">
          <input
            required
            placeholder="例如 iPhone"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="备注">
          <input value={remark} onChange={(e) => setRemark(e.target.value)} />
        </Field>
        <div className="modal-actions">
          <button className="primary">创建订阅</button>
        </div>
      </form>
    </Modal>
  );
}
function SettingsPage({
  initial,
  onSave,
  notify,
  onPasswordChanged,
}: {
  initial: SettingsData;
  onSave: () => Promise<void>;
  notify: (s: string) => void;
  onPasswordChanged: () => void;
}) {
  const [settings, setSettings] = useState(initial),
    [current, setCurrent] = useState(""),
    [password, setPassword] = useState("");
  useEffect(() => setSettings(initial), [initial]);
  return (
    <div className="settings-grid">
      <form
        className="card section-pad"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const previous = initial.subscription_base_url;
            const result = await api<{ subscription_base_url: string }>(
              "/settings",
              "PUT",
              settings,
            );
            setSettings({
              ...settings,
              subscription_base_url: result.subscription_base_url,
            });
            await onSave();
            notify(
              previous === result.subscription_base_url
                ? "设置已保存"
                : "订阅域名已更新",
            );
          } catch (err) {
            notify((err as Error).message);
          }
        }}
      >
        <h2>工作空间</h2>
        <Field label="站点名称">
          <input
            value={settings.site_name}
            onChange={(e) =>
              setSettings({ ...settings, site_name: e.target.value })
            }
          />
        </Field>
        <Field label="Admin Base URL（部署环境）">
          <input
            aria-label="Admin Base URL"
            type="url"
            value={settings.admin_base_url}
            readOnly
          />
        </Field>
        <Field label="订阅域名">
          <input
            aria-label="订阅域名"
            type="url"
            value={settings.subscription_base_url}
            onChange={(e) =>
              setSettings({
                ...settings,
                subscription_base_url: e.target.value,
              })
            }
            required
          />
        </Field>
        <div className="notice">
          用于生成复制链接和二维码。修改不会改变现有 Token。如果使用 dx-dy 内置
          Caddy/HTTPS，请通过 SSH 执行 dx-dy domain，使
          Caddy、证书和应用配置同步更新。 客户端中已保存的旧地址不会自动修改。
        </div>
        <button className="primary">保存设置</button>
      </form>
      <form
        className="card section-pad"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api("/auth/password", "POST", { current, password });
            notify("密码已修改，请重新登录");
            onPasswordChanged();
          } catch (err) {
            notify((err as Error).message);
          }
        }}
      >
        <h2>账户安全</h2>
        <p className="muted">修改密码后所有会话立即退出。</p>
        <Field label="当前密码">
          <input
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
        </Field>
        <Field label="新密码（至少 12 字符）">
          <input
            type="password"
            autoComplete="new-password"
            minLength={12}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        <button className="primary">修改密码</button>
        <div className="notice">
          加密 master key 仅由服务器环境配置，不能通过此页面修改。
        </div>
      </form>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
