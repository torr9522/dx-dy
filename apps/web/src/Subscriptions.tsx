import React, { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  GripVertical,
  Layers,
  Link as LinkIcon,
  Pencil,
  Plus,
  QrCode,
  Search,
  Trash2,
  X,
} from "lucide-react";
import QRCode from "qrcode";
import type {
  Envelope,
  NodeCollection,
  NodeRecord,
  NormalizedNode,
  Profile,
  SubscriptionEntry,
} from "../../../packages/shared/schema";
import { api } from "./api";
import { getField, nodeMatches, setField } from "./fields";
import {
  SelectionMaster,
  SelectedNodesDialog,
  semanticDuplicateOf,
  shouldToggleRow,
  useNodeSelection,
} from "./nodeSelection";
import { buildShadowrocketSubscriptionLink } from "./subscriptionLinks";
import { QueuedSwitch } from "./QueuedSwitch";

type ConfirmSetter = (
  value: {
    title: string;
    text: string;
    run: () => Promise<void>;
    successMessage?: string;
    returnFocus?: () => void;
  } | null,
) => void;
type CommonProps = {
  notify: (message: string) => void;
  copy: (value: string) => Promise<void>;
  confirm: ConfirmSetter;
};
type Preview = {
  index: number;
  status: string;
  envelope: Envelope | null;
  duplicate: boolean;
  error: string | null;
  code?: string;
  field?: string;
};

const protocols = ["vless", "vmess", "trojan", "ss", "hysteria2", "tuic"];
const protocolLabel = (value: string) =>
  value === "ss"
    ? "Shadowsocks"
    : value === "hysteria2"
      ? "Hysteria2"
      : value.toUpperCase();
const sameNumbers = (left: number[], right: number[]) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

function Modal({
  open,
  close,
  title,
  description,
  children,
}: React.PropsWithChildren<{
  open: boolean;
  close: () => void;
  title: string;
  description?: string;
}>) {
  return (
    <Dialog.Root open={open} onOpenChange={(value) => !value && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="modal">
          <div className="modal-head">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              {description && (
                <Dialog.Description>{description}</Dialog.Description>
              )}
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

function SubscriptionQr({
  profileId,
  name,
  notify,
}: {
  profileId: number;
  name: string;
  notify: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"generic" | "shadowrocket">("generic");
  const [url, setUrl] = useState("");
  const [payload, setPayload] = useState("");
  const [qr, setQr] = useState("");
  const [busy, setBusy] = useState(false);
  const show = async () => {
    setBusy(true);
    try {
      const result = await api<{ url: string }>(
        `/subscriptions/${profileId}/url`,
      );
      setUrl(result.url);
      setMode("generic");
      setPayload(result.url);
      setQr(await QRCode.toDataURL(result.url, { width: 300, margin: 2 }));
      setOpen(true);
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const choose = async (next: "generic" | "shadowrocket") => {
    const nextPayload =
      next === "generic" ? url : buildShadowrocketSubscriptionLink(url, name);
    setMode(next);
    setPayload(nextPayload);
    setQr(await QRCode.toDataURL(nextPayload, { width: 300, margin: 2 }));
  };
  return (
    <>
      <button disabled={busy} aria-label={`二维码 ${name}`} onClick={show}>
        <QrCode size={15} />
        二维码
      </button>
      <Modal
        open={open}
        close={() => setOpen(false)}
        title="订阅二维码"
        description="通用二维码保持普通订阅 URL；客户端专用二维码仅改变导入表达。"
      >
        <div className="segmented" role="group" aria-label="二维码类型">
          <button
            className={mode === "generic" ? "active" : ""}
            onClick={() => choose("generic")}
          >
            通用订阅
          </button>
          <button
            className={mode === "shadowrocket" ? "active" : ""}
            onClick={() => choose("shadowrocket")}
          >
            Shadowrocket（带名称）
          </button>
        </div>
        <img
          className="qr"
          src={qr}
          alt={`${mode === "generic" ? "通用" : "Shadowrocket"}订阅二维码`}
          data-qr-payload={payload}
        />
        <p className="muted">
          {mode === "generic"
            ? "兼容普通订阅扫描。"
            : `扫码导入时使用订阅名称“${name}”。`}
        </p>
      </Modal>
    </>
  );
}

function CopySubscription({
  profileId,
  copy,
}: {
  profileId: number;
  copy: (s: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      aria-label="复制订阅链接"
      onClick={async () => {
        setBusy(true);
        try {
          const result = await api<{ url: string }>(
            `/subscriptions/${profileId}/url`,
          );
          await copy(result.url);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Copy size={15} />
      复制订阅
    </button>
  );
}

function EnabledSwitch({
  profile,
  changed,
  notify,
}: {
  profile: Profile;
  changed: () => Promise<void>;
  notify: (message: string) => void;
}) {
  return (
    <QueuedSwitch
      enabled={profile.enabled}
      label={(enabled) => `${enabled ? "禁用" : "启用"}订阅 ${profile.name}`}
      persist={(enabled) =>
        api(`/subscriptions/${profile.id}`, "PATCH", {
          name: profile.name,
          remark: profile.remark,
          enabled,
        })
      }
      changed={changed}
      notify={notify}
      enabledMessage="订阅已启用"
      disabledMessage="订阅已禁用"
    />
  );
}

export function SubscriptionList({
  profiles,
  open,
  refresh,
  ...common
}: CommonProps & {
  profiles: Profile[];
  open: (profile: Profile) => void;
  refresh: () => Promise<void>;
}) {
  return (
    <div className="subscription-list card">
      {profiles.length ? (
        profiles.map((profile) => (
          <div className="subscription-row" key={profile.id}>
            <div className="subscription-row-name">
              <strong>{profile.name}</strong>
              {profile.remark && <small>{profile.remark}</small>}
            </div>
            <EnabledSwitch
              profile={profile}
              changed={refresh}
              notify={common.notify}
            />
            <span className="subscription-count">
              {profile.node_count} 个节点
            </span>
            <div className="subscription-row-actions">
              <CopySubscription profileId={profile.id} copy={common.copy} />
              <SubscriptionQr
                profileId={profile.id}
                name={profile.name}
                notify={common.notify}
              />
              <button onClick={() => open(profile)}>
                <ArrowRight size={15} />
                管理订阅
              </button>
              <button
                className="danger-text"
                onClick={() =>
                  common.confirm({
                    title: "删除订阅",
                    text: `即将删除订阅“${profile.name}”。独立节点将随订阅删除，全局节点不受影响。`,
                    successMessage: "订阅已删除",
                    run: async () => {
                      await api(`/subscriptions/${profile.id}`, "DELETE", {});
                      await refresh();
                    },
                  })
                }
              >
                <Trash2 size={15} />
                删除
              </button>
            </div>
          </div>
        ))
      ) : (
        <div className="empty">还没有订阅</div>
      )}
    </div>
  );
}

function SortableEntry({
  entry,
  index,
  total,
  move,
  remove,
  edit,
}: {
  entry: SubscriptionEntry;
  index: number;
  total: number;
  move: (from: number, to: number) => void;
  remove: () => void;
  edit: () => void;
}) {
  const sortable = useSortable({ id: entry.id });
  return (
    <div
      ref={sortable.setNodeRef}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
      }}
      className="subscription-node-row"
      data-source={entry.source}
    >
      <button
        className="drag icon-button"
        aria-label={`拖动 ${entry.node.name}`}
        {...sortable.attributes}
        {...sortable.listeners}
      >
        <GripVertical size={18} />
      </button>
      <div className="subscription-node-main">
        <strong>{entry.node.name}</strong>
        <small>
          {protocolLabel(entry.node.protocol)} ·{" "}
          {entry.source === "global" ? "节点库" : "独立节点"} ·{" "}
          {entry.node.enabled ? "启用" : "禁用"}
        </small>
      </div>
      <span className={`source-badge ${entry.source}`}>
        {entry.source === "global" ? "节点库" : "独立"}
      </span>
      {entry.source === "local" && (
        <button
          className="icon-button"
          aria-label={`编辑 ${entry.node.name}`}
          title="编辑独立节点"
          onClick={edit}
        >
          <Pencil size={15} />
        </button>
      )}
      <button
        className="icon-button"
        aria-label={`上移 ${entry.node.name}`}
        disabled={!index}
        onClick={() => move(index, index - 1)}
      >
        <ChevronUp size={15} />
      </button>
      <button
        className="icon-button"
        aria-label={`下移 ${entry.node.name}`}
        disabled={index === total - 1}
        onClick={() => move(index, index + 1)}
      >
        <ChevronDown size={15} />
      </button>
      <button
        className="icon-button danger-text"
        aria-label={`移除 ${entry.node.name}`}
        onClick={remove}
      >
        <X size={15} />
      </button>
    </div>
  );
}

function LibrarySelector({
  profileId,
  nodes,
  collections,
  initialIds,
  close,
  saved,
  finish,
  notify,
  confirm,
}: {
  profileId: number;
  nodes: NodeRecord[];
  collections: NodeCollection[];
  initialIds: number[];
  close: () => void;
  saved: () => Promise<void>;
  finish: () => void;
  notify: (message: string) => void;
  confirm: ConfirmSetter;
}) {
  const [search, setSearch] = useState("");
  const [protocol, setProtocol] = useState("");
  const [tag, setTag] = useState("");
  const [status, setStatus] = useState("");
  const [collectionId, setCollectionId] = useState<number | null>(null);
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const semanticGroup = (nodeId: number) =>
    nodes.find((node) => node.id === nodeId)?.semantic_key || `node:${nodeId}`;
  const selection = useNodeSelection(initialIds, {
    group: semanticGroup,
    onBlocked: () => notify("重复配置：该节点与已选择节点连接配置相同"),
  });
  const selectedIds = selection.selectedIds;
  const dirty = !sameNumbers(initialIds, selectedIds);
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);
  const source =
    collectionId === null
      ? nodes
      : nodes.filter((node) => node.collection_ids.includes(collectionId));
  const visible = source.filter(
    (node) =>
      nodeMatches(node, search, protocol, tag, status) &&
      (!selectedOnly || selection.isSelected(node.id)),
  );
  const visibleIds = visible.map((node) => node.id);
  const reservedGroups = new Set(selectedIds.map(semanticGroup));
  const selectable: number[] = [];
  for (const node of visible) {
    if (selection.isSelected(node.id)) {
      selectable.push(node.id);
      reservedGroups.add(semanticGroup(node.id));
    } else if (!reservedGroups.has(semanticGroup(node.id))) {
      selectable.push(node.id);
      reservedGroups.add(semanticGroup(node.id));
    }
  }
  const duplicateOf = (nodeId: number) =>
    semanticDuplicateOf(nodeId, selection.selected, semanticGroup);
  const requestClose = () => {
    if (!dirty) return close();
    confirm({
      title: "放弃未保存更改？",
      text: "当前节点选择只保存在草稿中。返回后不会改变订阅。",
      run: async () => close(),
    });
  };
  return (
    <section className="subscription-subpage">
      <button className="text-button" onClick={requestClose}>
        <ArrowLeft size={15} /> 返回
      </button>
      <div className="subpage-heading">
        <div>
          <h2>从节点库选择节点</h2>
          <p className="muted">所有选择都是草稿；保存后才会更新当前订阅。</p>
        </div>
        <button
          className="primary"
          disabled={busy || !dirty}
          onClick={async () => {
            setBusy(true);
            try {
              await api(`/subscriptions/${profileId}/nodes`, "PUT", {
                node_ids: selectedIds,
              });
              await saved();
              notify("节点选择已保存");
              finish();
            } catch (error) {
              notify((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Check size={15} /> 保存并返回
        </button>
      </div>
      <div className="subscription-source" aria-label="节点来源">
        <button
          className={collectionId === null ? "active" : ""}
          onClick={() => setCollectionId(null)}
        >
          全部节点 <b>{nodes.length}</b>
        </button>
        {collections.map((collection) => (
          <button
            key={collection.id}
            className={collectionId === collection.id ? "active" : ""}
            onClick={() => setCollectionId(collection.id)}
          >
            {collection.name} <b>{collection.node_count}</b>
          </button>
        ))}
      </div>
      <div className="selector-filters">
        <label className="search">
          <Search size={16} />
          <input
            aria-label="搜索可选节点"
            placeholder="搜索名称、服务器或标签…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <select
          aria-label="选择器协议"
          value={protocol}
          onChange={(event) => setProtocol(event.target.value)}
        >
          <option value="">所有协议</option>
          {protocols.map((item) => (
            <option key={item} value={item}>
              {protocolLabel(item)}
            </option>
          ))}
        </select>
        <select
          aria-label="选择器标签"
          value={tag}
          onChange={(event) => setTag(event.target.value)}
        >
          <option value="">所有标签</option>
          {[...new Set(nodes.flatMap((node) => node.tags))]
            .sort()
            .map((item) => (
              <option key={item}>{item}</option>
            ))}
        </select>
        <select
          aria-label="选择器状态"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">所有状态</option>
          <option value="enabled">启用</option>
          <option value="disabled">禁用</option>
        </select>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={selectedOnly}
            onChange={(event) => setSelectedOnly(event.target.checked)}
          />
          仅看已选
        </label>
      </div>
      <div className="selection-toolbar">
        <SelectionMaster
          selected={selection.selected}
          selectableIds={selectable}
          toggle={() => selection.toggleVisible(selectable)}
          label="当前筛选节点"
        />
        <span>
          {visible.length} 个候选 · 草稿已选 {selection.selectedCount}
        </span>
        <button onClick={() => setReviewOpen(true)}>查看已选</button>
        <button onClick={selection.clearAll}>清空选择</button>
      </div>
      <div className="node-picker subscription-picker-full">
        {visible.map((node) => {
          const duplicateNodeId = duplicateOf(node.id);
          const duplicate =
            !selection.isSelected(node.id) && duplicateNodeId !== undefined;
          return (
            <div
              key={node.id}
              className={`picker-node selectable-row${selection.isSelected(node.id) ? " is-selected" : ""}${duplicate ? " is-duplicate" : ""}`}
              aria-disabled={duplicate || undefined}
              onMouseDown={(event) => {
                if (event.shiftKey && shouldToggleRow(event.target, true)) {
                  event.preventDefault();
                  selection.toggleOne(node.id, { shiftKey: true, visibleIds });
                }
              }}
              onClick={(event) => {
                if (!event.shiftKey && shouldToggleRow(event.target))
                  selection.toggleOne(node.id, { visibleIds });
              }}
            >
              <input
                type="checkbox"
                aria-label={`选择订阅节点 ${node.name}`}
                checked={selection.isSelected(node.id)}
                aria-disabled={duplicate || undefined}
                onClick={(event) => {
                  event.stopPropagation();
                  selection.toggleOne(node.id, {
                    checked: event.currentTarget.checked,
                    shiftKey: event.shiftKey,
                    visibleIds,
                  });
                }}
                onChange={() => undefined}
              />
              <div>
                <strong>{node.name}</strong>
                <small>
                  {protocolLabel(node.protocol)} ·{" "}
                  {node.normalized_config.server}
                </small>
                {duplicate && (
                  <small className="duplicate-note">重复配置</small>
                )}
              </div>
              <span className={node.enabled ? "state enabled" : "state"}>
                {node.enabled ? "启用" : "禁用"}
              </span>
            </div>
          );
        })}
      </div>
      <div className="sticky-save-bar">
        <span>{dirty ? "有未保存更改" : "选择未改变"}</span>
        <button onClick={requestClose}>取消</button>
        <button
          className="primary"
          disabled={busy || !dirty}
          onClick={async () => {
            setBusy(true);
            try {
              await api(`/subscriptions/${profileId}/nodes`, "PUT", {
                node_ids: selectedIds,
              });
              await saved();
              notify("节点选择已保存");
              finish();
            } catch (error) {
              notify((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          保存
        </button>
      </div>
      <SelectedNodesDialog
        open={reviewOpen}
        close={() => setReviewOpen(false)}
        nodes={nodes}
        selected={selection.selected}
        remove={selection.removeOne}
        protocolLabel={protocolLabel}
        duplicateOf={duplicateOf}
      />
    </section>
  );
}

function LocalImport({
  profileId,
  close,
  saved,
  finish,
  notify,
}: {
  profileId: number;
  close: () => void;
  saved: () => Promise<void>;
  finish: () => void;
  notify: (message: string) => void;
}) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Preview[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [names, setNames] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const dirty = !!text.trim();
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);
  return (
    <section className="subscription-subpage local-import-page">
      <button className="text-button" onClick={close}>
        <ArrowLeft size={15} /> 返回添加节点
      </button>
      <div className="subpage-heading">
        <div>
          <h2>添加节点链接</h2>
          <p className="muted">节点仅属于当前订阅，不会进入节点库或集合。</p>
        </div>
      </div>
      <textarea
        aria-label="独立节点链接"
        className="uri-input"
        rows={8}
        placeholder="一行一条，支持 VLESS / VMess / Trojan / SS / HY2 / TUIC"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setRows([]);
        }}
      />
      <div className="modal-actions">
        <span className="muted">每批最多 300 行</span>
        <button
          className="primary"
          disabled={busy || !text.trim()}
          onClick={async () => {
            setBusy(true);
            try {
              const result = await api<Preview[]>(
                `/subscriptions/${profileId}/local-nodes/preview`,
                "POST",
                { text },
              );
              setRows(result);
              setSelected(
                new Set(
                  result
                    .filter((row) => row.envelope && !row.duplicate)
                    .map((row) => row.index),
                ),
              );
              setNames(
                Object.fromEntries(
                  result
                    .filter((row) => row.envelope)
                    .map((row) => [
                      row.index,
                      row.envelope!.normalized_config.name,
                    ]),
                ),
              );
            } catch (error) {
              notify((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          解析预览
        </button>
      </div>
      {!!rows.length && (
        <>
          <div className="import-summary">
            {rows.filter((row) => row.status === "success").length} 成功 ·{" "}
            {rows.filter((row) => row.status === "warning").length} 警告 ·{" "}
            {rows.filter((row) => row.status === "failure").length} 失败
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
                {rows.map((row) => (
                  <tr key={row.index}>
                    <td>
                      <input
                        aria-label={`导入独立节点第 ${row.index + 1} 行`}
                        type="checkbox"
                        checked={selected.has(row.index)}
                        disabled={!row.envelope || row.duplicate}
                        onChange={(event) =>
                          setSelected((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(row.index);
                            else next.delete(row.index);
                            return next;
                          })
                        }
                      />
                    </td>
                    <td>
                      <small>
                        第 {row.index + 1} 行 ·{" "}
                        {row.status === "success"
                          ? "成功"
                          : row.status === "warning"
                            ? "警告"
                            : "失败"}
                      </small>
                      {row.envelope && (
                        <input
                          aria-label={`独立节点第 ${row.index + 1} 行名称`}
                          value={names[row.index] || ""}
                          onChange={(event) =>
                            setNames({
                              ...names,
                              [row.index]: event.target.value,
                            })
                          }
                        />
                      )}
                    </td>
                    <td>
                      {row.envelope && (
                        <>
                          {protocolLabel(row.envelope.normalized_config.type)}
                          <small className="block">
                            {row.envelope.normalized_config.server}:
                            {row.envelope.normalized_config.port}
                          </small>
                        </>
                      )}
                    </td>
                    <td>
                      <small className={row.error ? "danger-text" : "muted"}>
                        {row.error ||
                          (row.duplicate
                            ? "与当前订阅节点重复"
                            : row.envelope?.parse_warnings.join("；") ||
                              "解析成功")}
                      </small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="sticky-save-bar">
            <span>已选择 {selected.size} 条</span>
            <button
              className="primary"
              disabled={busy || !selected.size}
              onClick={async () => {
                setBusy(true);
                try {
                  await api(
                    `/subscriptions/${profileId}/local-nodes/import`,
                    "POST",
                    {
                      items: rows
                        .filter(
                          (row) => selected.has(row.index) && row.envelope,
                        )
                        .map((row) => ({
                          uri: row.envelope!.original_uri,
                          name: names[row.index],
                        })),
                    },
                  );
                  await saved();
                  notify(`已添加 ${selected.size} 个独立节点`);
                  finish();
                } catch (error) {
                  notify((error as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              确认添加
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function LocalEditor({
  profileId,
  node,
  close,
  saved,
  notify,
}: {
  profileId: number;
  node: NodeRecord;
  close: () => void;
  saved: () => Promise<void>;
  notify: (message: string) => void;
}) {
  const [config, setConfig] = useState<NormalizedNode>(
    structuredClone(node.normalized_config),
  );
  const [remark, setRemark] = useState(node.remark);
  const [enabled, setEnabled] = useState(node.enabled);
  const [advanced, setAdvanced] = useState(
    JSON.stringify(node.normalized_config, null, 2),
  );
  const [advancedMode, setAdvancedMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = (label: string, field: string, numeric = false) => (
    <label className="field">
      <span>{label}</span>
      <input
        value={String(getField(config, field) ?? "")}
        type={numeric ? "number" : "text"}
        onChange={(event) =>
          setConfig(
            setField(
              config,
              field,
              event.target.value === ""
                ? undefined
                : numeric
                  ? Number(event.target.value)
                  : event.target.value,
            ),
          )
        }
      />
    </label>
  );
  return (
    <Modal
      open
      close={close}
      title={`编辑独立节点 · ${node.name}`}
      description="更改只影响当前订阅。原始 URI 与当前配置继续分开保留。"
    >
      <div className="tabs">
        <button
          className={!advancedMode ? "active" : ""}
          onClick={() => setAdvancedMode(false)}
        >
          参数编辑
        </button>
        <button
          className={advancedMode ? "active" : ""}
          onClick={() => {
            setAdvanced(JSON.stringify(config, null, 2));
            setAdvancedMode(true);
          }}
        >
          高级配置
        </button>
      </div>
      {advancedMode ? (
        <>
          <textarea
            className="code-input"
            rows={20}
            value={advanced}
            onChange={(event) => setAdvanced(event.target.value)}
          />
          <button
            onClick={() => {
              try {
                setConfig(JSON.parse(advanced) as NormalizedNode);
                setAdvancedMode(false);
              } catch {
                notify("JSON 格式无效");
              }
            }}
          >
            应用到表单
          </button>
        </>
      ) : (
        <>
          <div className="form-grid">
            {input("节点名称", "name")}
            {input("服务器", "server")}
            {input("端口", "port", true)}
            <label className="field">
              <span>协议</span>
              <input disabled value={protocolLabel(config.type)} />
            </label>
            {["vless", "vmess", "tuic"].includes(config.type) &&
              input("UUID", "uuid")}
            {["trojan", "ss", "hysteria2", "tuic"].includes(config.type) &&
              input("Password", "password")}
            {input("SNI", "sni")}
          </div>
          <label className="field">
            <span>备注</span>
            <textarea
              rows={2}
              value={remark}
              onChange={(event) => setRemark(event.target.value)}
            />
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            启用节点
          </label>
        </>
      )}
      <div className="modal-actions">
        <button
          className="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api(
                `/subscriptions/${profileId}/local-nodes/${node.id}`,
                "PATCH",
                { normalized_config: config, remark, tags: [], enabled },
              );
              await saved();
              notify("独立节点已更新");
              close();
            } catch (error) {
              notify((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          保存更改
        </button>
      </div>
    </Modal>
  );
}

export function SubscriptionDetail({
  initial,
  nodes,
  collections,
  onBack,
  onSaved,
  ...common
}: CommonProps & {
  initial: Profile;
  nodes: NodeRecord[];
  collections: NodeCollection[];
  onBack: () => void;
  onSaved: () => Promise<void>;
}) {
  const [profile, setProfile] = useState(initial);
  const [entries, setEntries] = useState<SubscriptionEntry[]>([]);
  const [ordered, setOrdered] = useState<SubscriptionEntry[]>([]);
  const [view, setView] = useState<"main" | "add" | "library" | "local">(
    "main",
  );
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<NodeRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const reloadEntries = async () => {
    const result = await api<SubscriptionEntry[]>(
      `/subscriptions/${profile.id}/entries`,
    );
    setEntries(result);
    setOrdered(result);
    await onSaved();
  };
  useEffect(() => {
    void reloadEntries();
  }, [profile.id]);
  const orderDirty = !sameNumbers(
    entries.map((entry) => entry.id),
    ordered.map((entry) => entry.id),
  );
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return ordered;
    return ordered.filter((entry) =>
      `${entry.node.name} ${entry.node.protocol} ${entry.node.normalized_config.server}`
        .toLowerCase()
        .includes(query),
    );
  }, [ordered, search]);
  const duplicateCount = useMemo(() => {
    const seen = new Set<string>();
    let count = 0;
    for (const entry of ordered) {
      const key = entry.node.semantic_key;
      if (!key) continue;
      if (seen.has(key)) count += 1;
      else seen.add(key);
    }
    return count;
  }, [ordered]);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= ordered.length) return;
    setOrdered(arrayMove(ordered, from, to));
  };
  const drag = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    move(
      ordered.findIndex((entry) => entry.id === Number(active.id)),
      ordered.findIndex((entry) => entry.id === Number(over.id)),
    );
  };
  const leaveMain = () => {
    if (!orderDirty) return onBack();
    common.confirm({
      title: "放弃未保存顺序？",
      text: "节点顺序尚未保存。返回后将恢复已持久化顺序。",
      run: async () => onBack(),
    });
  };
  if (view === "library")
    return (
      <LibrarySelector
        profileId={profile.id}
        nodes={nodes}
        collections={collections}
        initialIds={entries
          .filter((entry) => entry.source === "global")
          .map((entry) => entry.node.id)}
        close={() => setView("add")}
        saved={reloadEntries}
        finish={() => setView("main")}
        notify={common.notify}
        confirm={common.confirm}
      />
    );
  if (view === "local")
    return (
      <LocalImport
        profileId={profile.id}
        close={() => setView("add")}
        saved={reloadEntries}
        finish={() => setView("main")}
        notify={common.notify}
      />
    );
  if (view === "add")
    return (
      <section className="subscription-subpage">
        <button className="text-button" onClick={() => setView("main")}>
          <ArrowLeft size={15} /> 返回订阅
        </button>
        <div className="subpage-heading">
          <div>
            <h2>添加节点</h2>
            <p className="muted">
              选择全局节点，或添加仅属于此订阅的独立节点。
            </p>
          </div>
        </div>
        <div className="add-node-options">
          <button onClick={() => setView("library")}>
            <Layers size={22} />
            <span>
              <strong>从节点库选择节点</strong>
              <small>进入完整筛选器，选择保存前保持为草稿</small>
            </span>
            <ArrowRight size={17} />
          </button>
          <button onClick={() => setView("local")}>
            <LinkIcon size={22} />
            <span>
              <strong>添加节点链接</strong>
              <small>单条或批量导入，只保存在当前订阅</small>
            </span>
            <ArrowRight size={17} />
          </button>
        </div>
      </section>
    );
  return (
    <>
      <button className="text-button" onClick={leaveMain}>
        <ArrowLeft size={15} /> 返回订阅列表
      </button>
      <section className="subscription-detail-head">
        <div className="form-grid">
          <label className="field">
            <span>名称</span>
            <input
              value={profile.name}
              onChange={(event) =>
                setProfile({ ...profile, name: event.target.value })
              }
            />
          </label>
          <label className="field">
            <span>备注</span>
            <input
              value={profile.remark}
              onChange={(event) =>
                setProfile({ ...profile, remark: event.target.value })
              }
            />
          </label>
        </div>
        <div className="subscription-detail-actions">
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const updated = await api<Profile>(
                  `/subscriptions/${profile.id}`,
                  "PATCH",
                  profile,
                );
                setProfile(updated);
                await onSaved();
                common.notify("订阅信息已保存");
              } catch (error) {
                common.notify((error as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            保存信息
          </button>
          <CopySubscription profileId={profile.id} copy={common.copy} />
          <SubscriptionQr
            profileId={profile.id}
            name={profile.name}
            notify={common.notify}
          />
          <button className="primary" onClick={() => setView("add")}>
            <Plus size={16} /> 添加节点
          </button>
        </div>
      </section>
      <section className="subscription-saved-list card">
        <div className="subscription-list-heading">
          <div>
            <h2>
              已保存节点 <span className="count">{entries.length}</span>
            </h2>
            <p className="muted">
              Global 与 Local 共用同一顺序；搜索只过滤显示。
            </p>
          </div>
          <label className="search">
            <Search size={16} />
            <input
              aria-label="搜索当前订阅节点"
              placeholder="搜索当前订阅节点…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <button
            className="primary"
            disabled={busy || !orderDirty}
            onClick={async () => {
              setBusy(true);
              try {
                await api(`/subscriptions/${profile.id}/entries/order`, "PUT", {
                  entry_ids: ordered.map((entry) => entry.id),
                });
                await reloadEntries();
                common.notify("节点顺序已保存");
              } catch (error) {
                common.notify((error as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            保存节点与顺序
          </button>
        </div>
        {!!duplicateCount && (
          <div className="duplicate-warning" role="alert">
            当前订阅存在 {duplicateCount} 个重复配置，请移除重复节点后再保存。
          </div>
        )}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={drag}
        >
          <SortableContext
            items={visible.map((entry) => entry.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="subscription-node-list">
              {visible.map((entry) => {
                const index = ordered.findIndex(
                  (candidate) => candidate.id === entry.id,
                );
                return (
                  <SortableEntry
                    key={entry.id}
                    entry={entry}
                    index={index}
                    total={ordered.length}
                    move={move}
                    edit={() => setEditing(entry.node)}
                    remove={() =>
                      common.confirm({
                        title:
                          entry.source === "local"
                            ? "删除独立节点"
                            : "移除节点",
                        text:
                          entry.source === "local"
                            ? `将永久删除当前订阅中的独立节点“${entry.node.name}”。`
                            : `仅从当前订阅移除“${entry.node.name}”，节点库记录不受影响。`,
                        successMessage:
                          entry.source === "local"
                            ? "独立节点已删除"
                            : "节点已移除",
                        run: async () => {
                          await api(
                            `/subscriptions/${profile.id}/entries/${entry.id}`,
                            "DELETE",
                            {},
                          );
                          await reloadEntries();
                        },
                      })
                    }
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
        {!visible.length && (
          <div className="empty">
            {entries.length ? "没有匹配的节点" : "当前订阅还没有节点"}
          </div>
        )}
      </section>
      <section className="subscription-distribution card section-pad">
        <h2>订阅分发</h2>
        <p className="muted">
          复制保持普通订阅 URL；二维码可选择通用或 Shadowrocket 命名导入。
        </p>
        <div className="row-actions">
          <CopySubscription profileId={profile.id} copy={common.copy} />
          <SubscriptionQr
            profileId={profile.id}
            name={profile.name}
            notify={common.notify}
          />
          <button
            onClick={async () => {
              try {
                const output = await api<{ decoded: string }>(
                  `/subscriptions/${profile.id}/preview`,
                );
                await common.copy(output.decoded);
                common.notify("已复制解码预览");
              } catch (error) {
                common.notify((error as Error).message);
              }
            }}
          >
            <ExternalLink size={15} />
            复制解码预览
          </button>
        </div>
      </section>
      {editing && (
        <LocalEditor
          profileId={profile.id}
          node={editing}
          close={() => setEditing(null)}
          saved={reloadEntries}
          notify={common.notify}
        />
      )}
    </>
  );
}
