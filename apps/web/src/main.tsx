import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import * as Dialog from "@radix-ui/react-dialog";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  LayoutDashboard,
  Network,
  Layers,
  Settings,
  Plus,
  Search,
  Sun,
  Moon,
  LogOut,
  ArrowRight,
  ShieldCheck,
  Copy,
  GripVertical,
  X,
  Check,
  ChevronUp,
  ChevronDown,
  ExternalLink,
} from "lucide-react";
import QRCode from "qrcode";
import type {
  NodeRecord,
  Profile,
  NormalizedNode,
  Envelope,
  NodeCollection,
} from "../../../packages/shared/schema";
import { api, setCsrf } from "./api";
import { getField, setField, nodeMatches } from "./fields";
import { NodeLibrary } from "./NodeLibrary";
import {
  SelectedNodesDialog,
  SelectionMaster,
  shouldToggleRow,
  semanticDuplicateOf,
  useNodeSelection,
} from "./nodeSelection";
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
  error: string | null;
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
    [boot, setBoot] = useState(true),
    [page, setPage] = useState("dashboard");
  const [nodes, setNodes] = useState<NodeRecord[]>([]),
    [profiles, setProfiles] = useState<Profile[]>([]),
    [collections, setCollections] = useState<NodeCollection[]>([]),
    [settings, setSettings] = useState<SettingsData>({
      site_name: "dx-dy",
      admin_base_url: "",
      subscription_base_url: "",
      default_format: "v2ray",
    });
  const [toast, setToast] = useState(""),
    [pending, setPending] = useState(false),
    [theme, setTheme] = useState(localStorage.getItem("psm-theme") || "system");
  const [importOpen, setImportOpen] = useState(false),
    [editing, setEditing] = useState<NodeRecord | null>(null),
    [profile, setProfile] = useState<Profile | null>(null),
    [newProfile, setNewProfile] = useState(false);
  const [confirm, setConfirm] = useState<Confirmation | null>(null);
  const confirmationFocus = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    if (confirm) confirmationFocus.current = confirm.returnFocus;
  }, [confirm]);
  const notify = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(""), 4500);
  };
  const refresh = async () => {
    const [n, p, s, c] = await Promise.all([
      api<NodeRecord[]>("/nodes"),
      api<Profile[]>("/subscriptions"),
      api<SettingsData>("/settings"),
      api<NodeCollection[]>("/collections"),
    ]);
    setNodes(n);
    setProfiles(p);
    setSettings(s);
    setCollections(c);
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
    api<{ username: string; csrf: string }>("/auth/me")
      .then(async (me) => {
        setCsrf(me.csrf);
        setUser(me.username);
        await refresh();
      })
      .catch(() => setUser(null))
      .finally(() => setBoot(false));
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
  if (boot) return <div className="loading">正在连接 dx-dy…</div>;
  if (!user)
    return (
      <>
        <Login
          onLogin={async (username, csrf) => {
            setCsrf(csrf);
            setUser(username);
            await refresh();
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
          <small>dx-dy v0.1.8</small>
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
                  setUser(null);
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
                    ? "每个节点只存一份，更新自动应用到所有订阅。"
                    : page === "subscriptions"
                      ? "为设备或使用场景组合节点，独立、安全地分发。"
                      : "管理工作空间与账户安全。"}
              </p>
            </div>
            {page === "nodes" && (
              <button className="primary" onClick={() => setImportOpen(true)}>
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
              collections={collections}
              refresh={refresh}
              notify={notify}
              copy={copy}
              edit={setEditing}
              confirm={setConfirm}
            />
          )}
          {page === "subscriptions" &&
            (profile ? (
              <ProfileDetail
                key={profile.id}
                initial={profile}
                nodes={nodes}
                notify={notify}
                copy={copy}
                onSaved={async () => {
                  await refresh();
                }}
                onBack={() => setProfile(null)}
                confirm={setConfirm}
                collections={collections}
              />
            ) : (
              <div className="profile-grid">
                {profiles.length ? (
                  profiles.map((p) => (
                    <div className="card profile-card" key={p.id}>
                      <div className="profile-top">
                        <span className="profile-icon">
                          <Layers size={22} />
                        </span>
                        <span className={p.enabled ? "state enabled" : "state"}>
                          {p.enabled ? "启用" : "禁用"}
                        </span>
                      </div>
                      <h2>{p.name}</h2>
                      <p>{p.remark || "独立订阅配置"}</p>
                      <div className="profile-meta">
                        {p.node_ids.length} 个节点
                        <span>{date(p.updated_at)}</span>
                      </div>
                      <SubscriptionActions
                        profileId={p.id}
                        name={p.name}
                        copy={copy}
                        notify={notify}
                        compact
                        deleteAction={
                          <DeleteSubscriptionAction
                            profileId={p.id}
                            name={p.name}
                            confirm={setConfirm}
                            onDeleted={refresh}
                          />
                        }
                      />
                      <button
                        className="profile-open"
                        onClick={() => setProfile(p)}
                      >
                        管理订阅
                        <ArrowRight size={16} />
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="card">
                    <Empty text="还没有订阅" />
                  </div>
                )}
              </div>
            ))}
          {page === "settings" && (
            <SettingsPage
              initial={settings}
              onSave={refresh}
              notify={notify}
              onPasswordChanged={() => setUser(null)}
            />
          )}
          <footer>只管理节点与订阅 · 数据保存在您的服务器上</footer>
        </div>
      </main>
      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onSaved={refresh}
        notify={notify}
        collections={collections}
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
          collections={collections}
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
        <p>{confirm?.text}</p>
        <div className="modal-actions">
          <button onClick={() => setConfirm(null)}>取消</button>
          <button
            className="danger"
            disabled={pending}
            onClick={() =>
              action(async () => {
                await confirm?.run();
                setConfirm(null);
                notify(confirm?.successMessage || "操作已完成");
              })
            }
          >
            确认
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
function Login({
  onLogin,
  notify,
}: {
  onLogin: (username: string, csrf: string) => Promise<void>;
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
            const m = await api<{ username: string; csrf: string }>(
              "/auth/login",
              "POST",
              { username, password },
            );
            await onLogin(m.username, m.csrf);
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
function CollectionPicker({
  collections,
  selected,
  setSelected,
  label,
}: {
  collections: NodeCollection[];
  selected: number[];
  setSelected: (ids: number[]) => void;
  label: string;
}) {
  return (
    <fieldset className="collection-picker">
      <legend>{label}</legend>
      {collections.length ? (
        collections.map((c) => (
          <label key={c.id}>
            <input
              type="checkbox"
              checked={selected.includes(c.id)}
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? [...selected, c.id]
                    : selected.filter((id) => id !== c.id),
                )
              }
            />
            {c.name}
          </label>
        ))
      ) : (
        <span className="muted">尚无节点集合</span>
      )}
    </fieldset>
  );
}
function ImportDialog({
  open,
  onClose,
  onSaved,
  notify,
  collections,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
  notify: (s: string) => void;
  collections: NodeCollection[];
}) {
  const [text, setText] = useState(""),
    [rows, setRows] = useState<Preview[]>([]),
    [selected, setSelected] = useState<Set<number>>(new Set()),
    [names, setNames] = useState<Record<number, string>>({}),
    [busy, setBusy] = useState(false);
  const [collectionIds, setCollectionIds] = useState<number[]>([]);
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
          disabled={busy || !text.trim()}
          onClick={() =>
            work(async () => {
              const result = await api<Preview[]>("/nodes/preview", "POST", {
                text,
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
          <CollectionPicker
            collections={collections}
            selected={collectionIds}
            setSelected={setCollectionIds}
            label="导入到节点集合（可多选）"
          />
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
                        disabled={!r.envelope}
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
                              ? "可能重复，默认不选中；可手动确认保留"
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
                    collection_ids: collectionIds,
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
  run: () => Promise<void>;
  returnFocus?: () => void;
  successMessage?: string;
};
type ConfirmSetter = (v: Confirmation | null) => void;
function NodeDrawer({
  node,
  onClose,
  onSaved,
  notify,
  copy,
  confirm,
  collections,
}: {
  node: NodeRecord;
  onClose: () => void;
  onSaved: () => Promise<void>;
  notify: (s: string) => void;
  copy: (s: string) => Promise<void>;
  confirm: ConfirmSetter;
  collections: NodeCollection[];
}) {
  const [config, setConfig] = useState<NormalizedNode>(
      structuredClone(node.normalized_config),
    ),
    [remark, setRemark] = useState(node.remark),
    [tags, setTags] = useState(node.tags.join(", ")),
    [enabled, setEnabled] = useState(node.enabled),
    [collectionIds, setCollectionIds] = useState(node.collection_ids),
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
          <CollectionPicker
            collections={collections}
            selected={collectionIds}
            setSelected={setCollectionIds}
            label="节点集合（可多选）"
          />
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
                  collection_ids: collectionIds,
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
function SortableNode({
  node,
  remove,
  up,
  down,
  duplicate = false,
}: {
  node: NodeRecord;
  remove: () => void;
  up: () => void;
  down: () => void;
  duplicate?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: node.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className="selected-node"
    >
      <button
        className="drag"
        aria-label={`拖动 ${node.name}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={18} />
      </button>
      <div>
        <strong>{node.name}</strong>
        <small>
          {labelProtocol(node.protocol)} · {node.enabled ? "启用" : "禁用"}
        </small>
        {duplicate && <small className="duplicate-note">重复配置</small>}
      </div>
      <button
        aria-label={`上移 ${node.name}`}
        className="icon-button"
        onClick={up}
      >
        <ChevronUp size={15} />
      </button>
      <button
        aria-label={`下移 ${node.name}`}
        className="icon-button"
        onClick={down}
      >
        <ChevronDown size={15} />
      </button>
      <button
        className="icon-button"
        aria-label={`移除 ${node.name}`}
        onClick={remove}
      >
        <X size={15} />
      </button>
    </div>
  );
}
function DeleteSubscriptionAction({
  profileId,
  name,
  confirm,
  onDeleted,
}: {
  profileId: number;
  name: string;
  confirm: ConfirmSetter;
  onDeleted: () => Promise<void>;
}) {
  const button = useRef<HTMLButtonElement>(null);
  return (
    <button
      ref={button}
      className="danger-text subscription-delete"
      aria-label="删除订阅"
      title="删除订阅"
      onClick={() =>
        confirm({
          title: "删除订阅",
          text: `即将删除订阅“${name}”。删除后当前订阅链接立即失效；仅删除 Subscription Profile 和关联关系，全局节点本身不会被删除。`,
          successMessage: "订阅已删除",
          returnFocus: () => {
            if (button.current?.isConnected) button.current.focus();
            else
              document
                .querySelector<HTMLButtonElement>(
                  'button[data-page="subscriptions"]',
                )
                ?.focus();
          },
          run: async () => {
            await api(`/subscriptions/${profileId}`, "DELETE", {});
            await onDeleted();
          },
        })
      }
    >
      删除订阅
    </button>
  );
}
function SubscriptionActions({
  profileId,
  name,
  copy,
  notify,
  compact = false,
  deleteAction,
}: {
  profileId: number;
  name: string;
  copy: (s: string) => Promise<void>;
  notify: (s: string) => void;
  compact?: boolean;
  deleteAction?: React.ReactNode;
}) {
  const previewButton = useRef<HTMLButtonElement>(null),
    qrButton = useRef<HTMLButtonElement>(null);
  const [url, setUrl] = useState(""),
    [qr, setQr] = useState(""),
    [qrOpen, setQrOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [output, setOutput] = useState<{
      decoded: string;
      nodes: { name: string; protocol: string }[];
      selected_node_count: number;
      emitted_node_count: number;
      suppressed_duplicate_count: number;
      duplicate_groups: {
        node_id: number;
        name: string;
        protocol: string;
      }[][];
    } | null>(null);
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
  // Fetch on every action so rotations/settings changes cannot leave a stale cached URL.
  const currentUrl = async () => {
    const result = await api<{ url: string }>(
      `/subscriptions/${profileId}/url`,
    );
    setUrl(result.url);
    return result.url;
  };
  return (
    <>
      <div
        className={
          compact ? "subscription-actions compact" : "subscription-actions"
        }
        role="group"
        aria-label={name + "订阅快捷操作"}
      >
        <button
          disabled={busy}
          title="复制订阅链接"
          aria-label="复制订阅链接"
          onClick={() => work(async () => copy(await currentUrl()))}
        >
          <Copy size={15} />
          {compact ? "复制订阅" : "复制订阅链接"}
        </button>
        {!compact && (
          <button
            ref={previewButton}
            disabled={busy}
            title="预览通用订阅"
            aria-label="预览"
            onClick={() =>
              work(async () =>
                setOutput(await api(`/subscriptions/${profileId}/preview`)),
              )
            }
          >
            <ExternalLink size={15} />
            预览
          </button>
        )}
        <button
          ref={qrButton}
          disabled={busy}
          title="显示订阅二维码"
          aria-label="二维码"
          onClick={() =>
            work(async () => {
              const link = await currentUrl();
              setQr(await QRCode.toDataURL(link, { width: 300, margin: 2 }));
              setQrOpen(true);
            })
          }
        >
          二维码
        </button>
        {compact && deleteAction}
      </div>
      <Modal
        open={!!output}
        returnFocus={() => previewButton.current?.focus()}
        onClose={() => setOutput(null)}
        title="通用订阅预览"
        description="含敏感节点凭据，仅管理员可见。"
      >
        <p>已选择：{output?.selected_node_count ?? 0} 个节点</p>
        <p>实际订阅输出：{output?.emitted_node_count ?? 0} 个唯一节点</p>
        {!!output?.suppressed_duplicate_count && (
          <div className="duplicate-warning" role="status">
            检测到 {output.suppressed_duplicate_count}{" "}
            个重复连接配置，订阅输出已抑制。
          </div>
        )}
        <ol aria-label="订阅节点顺序">
          {output?.nodes.map((node, i) => (
            <li key={i}>
              {node.protocol.toUpperCase()} · {node.name}
            </li>
          ))}
        </ol>
        <details>
          <summary>高级：查看解码后的 URI（含凭据）</summary>
          <pre className="output">{output?.decoded || "（空订阅）"}</pre>
        </details>
      </Modal>
      <Modal
        open={qrOpen}
        returnFocus={() => qrButton.current?.focus()}
        onClose={() => setQrOpen(false)}
        title="订阅二维码"
        description="扫码获取订阅凭证，请勿公开截图。"
      >
        <img
          className="qr"
          src={qr}
          alt="订阅二维码"
          data-subscription-url={url}
        />
        <a href={url} className="mono" rel="noreferrer">
          订阅链接
        </a>
      </Modal>
    </>
  );
}
function ProfileDetail({
  initial,
  nodes,
  notify,
  copy,
  onSaved,
  onBack,
  confirm,
  collections,
}: {
  initial: Profile;
  nodes: NodeRecord[];
  notify: (s: string) => void;
  copy: (s: string) => Promise<void>;
  onSaved: () => Promise<void>;
  onBack: () => void;
  confirm: ConfirmSetter;
  collections: NodeCollection[];
}) {
  const [profile, setProfile] = useState(initial),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState(""),
    [tag, setTag] = useState(""),
    [status, setStatus] = useState(""),
    [collectionId, setCollectionId] = useState<number | null>(null),
    [reviewOpen, setReviewOpen] = useState(false),
    [busy, setBusy] = useState(false);
  const semanticGroup = (id: number) =>
    nodes.find((node) => node.id === id)?.semantic_key || `node:${id}`;
  const selection = useNodeSelection(initial.node_ids, {
    group: semanticGroup,
    onBlocked: () => notify("重复配置：该节点与已选择节点连接配置相同"),
  });
  const ids = selection.selectedIds;
  const setIds = selection.replace;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
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
  const selected = ids
    .map((id) => nodes.find((n) => n.id === id))
    .filter((n): n is NodeRecord => !!n);
  const sourceNodes =
    collectionId === null
      ? nodes
      : nodes.filter((node) => node.collection_ids.includes(collectionId));
  const candidateNodes = sourceNodes.filter((node) =>
    nodeMatches(node, search, filter, tag, status),
  );
  const candidateIds = candidateNodes.map((node) => node.id);
  const reservedGroups = new Set(ids.map(semanticGroup));
  const candidateSelectableIds: number[] = [];
  for (const node of candidateNodes) {
    if (selection.isSelected(node.id)) {
      candidateSelectableIds.push(node.id);
      reservedGroups.add(semanticGroup(node.id));
    } else if (!reservedGroups.has(semanticGroup(node.id))) {
      candidateSelectableIds.push(node.id);
      reservedGroups.add(semanticGroup(node.id));
    }
  }
  const duplicateOf = (nodeId: number) =>
    semanticDuplicateOf(nodeId, selection.selected, semanticGroup);
  const duplicateConflicts = new Set(
    ids
      .filter((nodeId) => duplicateOf(nodeId) !== undefined)
      .map(semanticGroup),
  ).size;
  const selectedCollection = collections.find((c) => c.id === collectionId);
  useEffect(
    () => selection.resetAnchor(),
    [search, filter, tag, status, collectionId],
  );
  const move = (from: number, to: number) => {
    if (to >= 0 && to < ids.length) setIds(arrayMove(ids, from, to));
  };
  const drag = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id)
      move(ids.indexOf(Number(active.id)), ids.indexOf(Number(over.id)));
  };
  return (
    <>
      <button className="text-button" onClick={onBack}>
        ← 返回订阅列表
      </button>
      <section className="card section-pad profile-form">
        <div className="form-grid">
          <Field label="名称">
            <input
              value={profile.name}
              onChange={(e) => setProfile({ ...profile, name: e.target.value })}
            />
          </Field>
          <Field label="备注">
            <input
              value={profile.remark}
              onChange={(e) =>
                setProfile({ ...profile, remark: e.target.value })
              }
            />
          </Field>
        </div>
        <div className="modal-actions">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={profile.enabled}
              onChange={(e) =>
                setProfile({ ...profile, enabled: e.target.checked })
              }
            />
            启用订阅
          </label>
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              work(async () => {
                await api(`/subscriptions/${profile.id}`, "PATCH", profile);
                await onSaved();
                notify("订阅信息已保存");
              })
            }
          >
            保存信息
          </button>
        </div>
      </section>
      <div className="assignment-grid">
        <section className="card section-pad">
          <h2>选择节点</h2>
          <p className="muted">
            来源只筛选候选节点；订阅仍由明确勾选的节点决定
          </p>
          {!!duplicateConflicts && (
            <div className="duplicate-warning" role="alert">
              当前订阅存在 {duplicateConflicts}{" "}
              个重复配置，请取消重复节点后再保存。
            </div>
          )}
          <div className="subscription-source" aria-label="节点来源">
            <div className="source-master">
              <small>节点库</small>
              <button
                className={collectionId === null ? "active" : ""}
                onClick={() => {
                  setCollectionId(null);
                  setSearch("");
                }}
              >
                <span>全部节点</span>
                <b>{nodes.length}</b>
              </button>
            </div>
            <div className="source-collections">
              <small>节点集合</small>
              <div>
                {collections.map((c) => (
                  <button
                    key={c.id}
                    className={collectionId === c.id ? "active" : ""}
                    onClick={() => {
                      setCollectionId(c.id);
                      setSearch("");
                    }}
                  >
                    <span>{c.name}</span>
                    <b>{c.node_count}</b>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <label className="search subscription-search">
            <Search size={16} />
            <input
              aria-label="搜索可选节点"
              placeholder={
                selectedCollection
                  ? `搜索 ${selectedCollection.name} 中节点…`
                  : "搜索全部节点…"
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <div className="row-actions selector-filters">
            <select
              aria-label="选择器协议"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="">所有协议</option>
              {protocols.map((p) => (
                <option key={p} value={p}>
                  {labelProtocol(p)}
                </option>
              ))}
            </select>
            <select
              aria-label="选择器标签"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
            >
              <option value="">所有标签</option>
              {[...new Set(nodes.flatMap((n) => n.tags))].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <select
              aria-label="选择器状态"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">所有状态</option>
              <option value="enabled">启用</option>
              <option value="disabled">禁用</option>
            </select>
            <small>
              {candidateNodes.length === sourceNodes.length
                ? `${sourceNodes.length} 个候选节点`
                : `${candidateNodes.length} / ${sourceNodes.length} 个候选节点`}
            </small>
          </div>
          <div className="selection-toolbar">
            <SelectionMaster
              selected={selection.selected}
              selectableIds={candidateSelectableIds}
              toggle={() => selection.toggleVisible(candidateSelectableIds)}
              label="当前候选节点"
            />
          </div>
          <div className="node-picker">
            {candidateNodes.map((n) => {
              const duplicateNodeId = duplicateOf(n.id);
              const duplicate =
                !selection.isSelected(n.id) && duplicateNodeId !== undefined;
              return (
                <div
                  key={n.id}
                  className={`picker-node selectable-row${selection.isSelected(n.id) ? " is-selected" : ""}${duplicate ? " is-duplicate" : ""}`}
                  aria-disabled={duplicate || undefined}
                  onMouseDown={(event) => {
                    if (event.shiftKey && shouldToggleRow(event.target, true)) {
                      event.preventDefault();
                      selection.toggleOne(n.id, {
                        shiftKey: true,
                        visibleIds: candidateIds,
                      });
                    }
                  }}
                  onClick={(event) => {
                    if (!event.shiftKey && shouldToggleRow(event.target))
                      selection.toggleOne(n.id, {
                        visibleIds: candidateNodes.map((node) => node.id),
                      });
                  }}
                >
                  <input
                    type="checkbox"
                    aria-label={`选择订阅节点 ${n.name}`}
                    checked={selection.isSelected(n.id)}
                    aria-disabled={duplicate || undefined}
                    onClick={(event) => {
                      event.stopPropagation();
                      selection.toggleOne(n.id, {
                        checked: event.currentTarget.checked,
                        shiftKey: event.shiftKey,
                        visibleIds: candidateIds,
                      });
                    }}
                    onChange={() => undefined}
                  />
                  <div>
                    <strong>{n.name}</strong>
                    <small>
                      {labelProtocol(n.protocol)} · {n.normalized_config.server}
                    </small>
                    {duplicate && (
                      <small className="duplicate-note">
                        重复配置 · 与已选择节点相同
                      </small>
                    )}
                  </div>
                  <span className={n.enabled ? "state enabled" : "state"}>
                    {n.enabled ? "启用" : "禁用"}
                  </span>
                </div>
              );
            })}
            {!candidateNodes.length && (
              <div className="selector-empty">
                <Network size={28} />
                <strong>
                  {selectedCollection && !sourceNodes.length
                    ? `${selectedCollection.name} 暂无节点`
                    : "没有匹配的节点"}
                </strong>
                <small>
                  {selectedCollection && !sourceNodes.length
                    ? `你可以先到节点库 → ${selectedCollection.name} → 从节点库添加节点。`
                    : "调整搜索或筛选条件后重试。"}
                </small>
              </div>
            )}
          </div>
          {!!selection.selectedCount && (
            <div
              className="bulk-bar"
              role="toolbar"
              aria-label="订阅节点批量操作"
            >
              <strong>已选择 {selection.selectedCount} 个节点</strong>
              <button onClick={() => setReviewOpen(true)}>
                查看已选择 {selection.selectedCount} 个
              </button>
              <button onClick={selection.clearAll}>清空选择</button>
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  work(async () => {
                    await api(`/subscriptions/${profile.id}/nodes`, "PUT", {
                      node_ids: ids,
                    });
                    await onSaved();
                    notify("节点关联与顺序已保存");
                  })
                }
              >
                保存
              </button>
            </div>
          )}
        </section>
        <section className="card section-pad">
          <div className="section-heading">
            <h2>
              已选节点 <span className="count">{ids.length}</span>
            </h2>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                work(async () => {
                  await api(`/subscriptions/${profile.id}/nodes`, "PUT", {
                    node_ids: ids,
                  });
                  await onSaved();
                  notify("节点关联与顺序已保存");
                })
              }
            >
              保存节点与顺序
            </button>
          </div>
          <p className="muted">
            拖动排序；也可使用上下箭头。禁用节点不会输出。
          </p>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={drag}
          >
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
              {selected.map((n, i) => (
                <SortableNode
                  node={n}
                  key={n.id}
                  remove={() => selection.removeOne(n.id)}
                  up={() => move(i, i - 1)}
                  down={() => move(i, i + 1)}
                  duplicate={duplicateOf(n.id) !== undefined}
                />
              ))}
            </SortableContext>
          </DndContext>
          {!ids.length && (
            <p className="notice">
              没有显式关联时返回空订阅，绝不会返回全节点。
            </p>
          )}
        </section>
      </div>
      <section className="card section-pad">
        <h2>订阅分发</h2>
        <p className="muted">
          链接即访问凭证，请不要公开分享。轮换后旧链接立即失效。
        </p>
        <div className="subscription-links">
          <p className="muted">
            适用于 Shadowrocket、v2rayN、v2rayNG 及其他支持标准 Base64 URI
            Subscription 的客户端。
          </p>
          <div className="link-row">
            <strong>通用订阅</strong>
            <span className="mono muted">/s/••••••••</span>
            <SubscriptionActions
              profileId={profile.id}
              name={profile.name}
              copy={copy}
              notify={notify}
            />
          </div>
        </div>
        <div className="modal-actions">
          <button
            onClick={() =>
              confirm({
                title: "轮换订阅 Token",
                text: "旧链接将立即失效。所有客户端需重新添加新的订阅链接。",
                run: async () => {
                  await api(`/subscriptions/${profile.id}/rotate`, "POST", {});
                  await onSaved();
                },
              })
            }
          >
            重新生成 Token
          </button>
          <DeleteSubscriptionAction
            profileId={profile.id}
            name={profile.name}
            confirm={confirm}
            onDeleted={async () => {
              await onSaved();
              onBack();
            }}
          />
        </div>
      </section>
      <SelectedNodesDialog
        open={reviewOpen}
        close={() => setReviewOpen(false)}
        nodes={nodes}
        selected={selection.selected}
        remove={selection.removeOne}
        protocolLabel={labelProtocol}
        duplicateOf={duplicateOf}
      />
    </>
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
