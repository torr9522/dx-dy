import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Check,
  ChevronUp,
  Copy,
  FolderPlus,
  Pencil,
  Plus,
  Search,
  X,
} from "lucide-react";
import type {
  NodeCollection,
  NodeRecord,
} from "../../../packages/shared/schema";
import { api } from "./api";
import { nodeMatches } from "./fields";

const protocols = ["vless", "vmess", "trojan", "ss", "hysteria2", "tuic"];
const protocolLabel = (value: string) =>
  value === "ss"
    ? "Shadowsocks"
    : value === "hysteria2"
      ? "Hysteria2"
      : value.toUpperCase();
type Confirm = (value: {
  title: string;
  text: string;
  successMessage?: string;
  run: () => Promise<void>;
}) => void;

function LibraryModal({
  open,
  close,
  title,
  description,
  children,
}: React.PropsWithChildren<{
  open: boolean;
  close: () => void;
  title: string;
  description: string;
}>) {
  return (
    <Dialog.Root open={open} onOpenChange={(value) => !value && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="modal collection-modal">
          <div className="modal-head">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description>{description}</Dialog.Description>
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

function Filters({
  nodes,
  search,
  setSearch,
  protocol,
  setProtocol,
  tag,
  setTag,
  status,
  setStatus,
  searchLabel,
}: {
  nodes: NodeRecord[];
  search: string;
  setSearch: (value: string) => void;
  protocol: string;
  setProtocol: (value: string) => void;
  tag: string;
  setTag: (value: string) => void;
  status: string;
  setStatus: (value: string) => void;
  searchLabel: string;
}) {
  return (
    <div className="node-filters">
      <label className="search">
        <Search size={16} />
        <input
          aria-label={searchLabel}
          placeholder="搜索名称、服务器或标签…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      <select
        aria-label={`${searchLabel}协议`}
        value={protocol}
        onChange={(e) => setProtocol(e.target.value)}
      >
        <option value="">所有协议</option>
        {protocols.map((item) => (
          <option key={item} value={item}>
            {protocolLabel(item)}
          </option>
        ))}
      </select>
      <select
        aria-label={`${searchLabel}标签`}
        value={tag}
        onChange={(e) => setTag(e.target.value)}
      >
        <option value="">所有标签</option>
        {[...new Set(nodes.flatMap((node) => node.tags))].sort().map((item) => (
          <option key={item}>{item}</option>
        ))}
      </select>
      <select
        aria-label={`${searchLabel}状态`}
        value={status}
        onChange={(e) => setStatus(e.target.value)}
      >
        <option value="">所有状态</option>
        <option value="enabled">启用</option>
        <option value="disabled">禁用</option>
      </select>
    </div>
  );
}

function CollectionChooser({
  title,
  collections,
  selected,
  setSelected,
}: {
  title: string;
  collections: NodeCollection[];
  selected: number[];
  setSelected: (ids: number[]) => void;
}) {
  return (
    <fieldset className="collection-picker">
      <legend>{title}</legend>
      {collections.map((collection) => (
        <label key={collection.id}>
          <input
            type="checkbox"
            checked={selected.includes(collection.id)}
            onChange={(event) =>
              setSelected(
                event.target.checked
                  ? [...selected, collection.id]
                  : selected.filter((id) => id !== collection.id),
              )
            }
          />
          {collection.name} <small>{collection.node_count}</small>
        </label>
      ))}
    </fieldset>
  );
}

export function NodeLibrary({
  nodes,
  collections,
  refresh,
  notify,
  copy,
  edit,
  confirm,
}: {
  nodes: NodeRecord[];
  collections: NodeCollection[];
  refresh: () => Promise<void>;
  notify: (message: string) => void;
  copy: (value: string) => Promise<void>;
  edit: (node: NodeRecord) => void;
  confirm: Confirm;
}) {
  const [activeId, setActiveId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [protocol, setProtocol] = useState("");
  const [tag, setTag] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [bulkMode, setBulkMode] = useState<"add" | "remove" | null>(null);
  const [quickNode, setQuickNode] = useState<NodeRecord | null>(null);
  const [editor, setEditor] = useState<NodeCollection | "new" | null>(null);
  const active = collections.find((item) => item.id === activeId) || null;
  const source = active
    ? nodes.filter((node) => node.collection_ids.includes(active.id))
    : nodes;
  const visible = source.filter((node) =>
    nodeMatches(node, search, protocol, tag, status),
  );
  const mutate = async (
    action: "add" | "remove" | "set",
    collectionIds: number[],
    nodeIds: number[],
  ) => {
    await api("/collection-memberships", "PUT", {
      action,
      collection_ids: collectionIds,
      node_ids: nodeIds,
    });
    setSelected([]);
    await refresh();
  };
  const chooseView = (id: number | null) => {
    setActiveId(id);
    setSelected([]);
    setSearch("");
    setProtocol("");
    setTag("");
    setStatus("");
  };
  useEffect(() => {
    if (activeId !== null && !collections.some((item) => item.id === activeId))
      chooseView(null);
  }, [activeId, collections]);

  return (
    <div className="node-library card">
      <aside className="collection-sidebar" aria-label="节点库导航">
        <div className="master-pool">
          <small>节点库</small>
          <button
            className={active ? "" : "active"}
            onClick={() => chooseView(null)}
          >
            <span>
              <strong>全部节点</strong>
              <small>全局节点唯一来源</small>
            </span>
            <b>{nodes.length}</b>
          </button>
        </div>
        <div className="collection-section">
          <div className="collection-section-title">
            <span>节点集合</span>
            <small>管理视图</small>
          </div>
          {collections.map((collection, index) => (
            <div className="collection-nav-row" key={collection.id}>
              <button
                className={activeId === collection.id ? "active" : ""}
                onClick={() => chooseView(collection.id)}
              >
                <span>{collection.name}</span>
                <b>{collection.node_count}</b>
              </button>
              <button
                className="icon-button"
                aria-label={`编辑集合 ${collection.name}`}
                onClick={() => setEditor(collection)}
              >
                <Pencil size={14} />
              </button>
              <button
                className="icon-button"
                aria-label={`上移集合 ${collection.name}`}
                disabled={!index}
                onClick={async () => {
                  const ids = collections.map((item) => item.id);
                  [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
                  await api("/collections/order", "PUT", { ids });
                  await refresh();
                }}
              >
                <ChevronUp size={14} />
              </button>
            </div>
          ))}
          <button className="new-collection" onClick={() => setEditor("new")}>
            <Plus size={14} />
            新建集合
          </button>
        </div>
      </aside>
      <section className="node-library-main">
        <div className="node-view-heading">
          <div>
            <h2>{active?.name || "全部节点"}</h2>
            <p>
              {active
                ? active.remark || "从全部节点中整理出的管理集合"
                : "Global Node Library · 所有节点的 Master Pool"}
            </p>
          </div>
          {active && (
            <button className="primary" onClick={() => setAddOpen(true)}>
              <FolderPlus size={16} />
              从节点库添加节点
            </button>
          )}
        </div>
        <Filters
          nodes={source}
          search={search}
          setSearch={setSearch}
          protocol={protocol}
          setProtocol={setProtocol}
          tag={tag}
          setTag={setTag}
          status={status}
          setStatus={setStatus}
          searchLabel={active ? `搜索 ${active.name} 中节点` : "搜索全部节点"}
        />
        <div className="result-count">
          {visible.length === source.length
            ? `${source.length} 个节点`
            : `${visible.length} / ${source.length} 个节点`}
        </div>
        {!visible.length ? (
          <div className="collection-empty">
            <FolderPlus size={32} />
            <h3>
              {active && !source.length
                ? `${active.name} 还没有节点`
                : "没有匹配的节点"}
            </h3>
            <p>
              {active && !source.length
                ? "从全部节点库中选择节点加入这个集合。"
                : "调整搜索或筛选条件后重试。"}
            </p>
            {active && !source.length && (
              <button className="primary" onClick={() => setAddOpen(true)}>
                从节点库添加节点
              </button>
            )}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="node-table">
              <thead>
                <tr>
                  <th className="select-cell">
                    <input
                      aria-label="选择当前结果"
                      type="checkbox"
                      checked={visible.every((node) =>
                        selected.includes(node.id),
                      )}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? [
                                ...new Set([
                                  ...selected,
                                  ...visible.map((node) => node.id),
                                ]),
                              ]
                            : selected.filter(
                                (id) => !visible.some((node) => node.id === id),
                              ),
                        )
                      }
                    />
                  </th>
                  <th>名称 / 集合</th>
                  <th>服务器</th>
                  <th>协议 / 标签</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((node) => (
                  <tr key={node.id}>
                    <td className="select-cell">
                      <input
                        aria-label={`选择 ${node.name}`}
                        type="checkbox"
                        checked={selected.includes(node.id)}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, node.id]
                              : selected.filter((id) => id !== node.id),
                          )
                        }
                      />
                    </td>
                    <td>
                      <button
                        className="text-button node-title"
                        onClick={() => edit(node)}
                      >
                        {node.name}
                      </button>
                      <div className="collection-chips">
                        {node.collection_ids.slice(0, 2).map((id) => (
                          <span key={id}>
                            {collections.find((item) => item.id === id)?.name}
                          </span>
                        ))}
                        {node.collection_ids.length > 2 && (
                          <span>+{node.collection_ids.length - 2}</span>
                        )}
                        <button
                          aria-label={`管理 ${node.name} 的节点集合`}
                          onClick={() => setQuickNode(node)}
                        >
                          <Plus size={12} />
                          集合
                        </button>
                      </div>
                    </td>
                    <td className="mono">
                      {node.normalized_config.server}:
                      {node.normalized_config.port}
                    </td>
                    <td>
                      <span className={`badge ${node.protocol}`}>
                        {protocolLabel(node.protocol)}
                      </span>
                      <div>
                        {node.tags.map((item) => (
                          <span className="tag" key={item}>
                            {item}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <span
                        className={node.enabled ? "state enabled" : "state"}
                      >
                        {node.enabled ? "启用" : "禁用"}
                      </span>
                    </td>
                    <td>
                      <div className="row-actions">
                        {active && (
                          <button
                            onClick={async () => {
                              await mutate("remove", [active.id], [node.id]);
                              notify(`已从 ${active.name} 移除`);
                            }}
                          >
                            从 {active.name} 移除
                          </button>
                        )}
                        <button onClick={() => edit(node)}>编辑</button>
                        <button
                          aria-label={`复制 ${node.name}`}
                          onClick={async () => {
                            const result = await api<{ uri: string }>(
                              `/nodes/${node.id}/uri`,
                            );
                            await copy(result.uri);
                          }}
                        >
                          <Copy size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!!selected.length && (
          <div className="bulk-bar" role="toolbar" aria-label="节点批量操作">
            <strong>已选择 {selected.length} 个节点</strong>
            {active ? (
              <button
                onClick={() => {
                  void mutate("remove", [active.id], selected);
                }}
              >
                从 {active.name} 移除
              </button>
            ) : (
              <>
                <button onClick={() => setBulkMode("add")}>加入集合</button>
                <button onClick={() => setBulkMode("remove")}>移出集合</button>
              </>
            )}
            <button
              className="icon-button"
              aria-label="取消选择"
              onClick={() => setSelected([])}
            >
              <X size={16} />
            </button>
          </div>
        )}
      </section>
      {addOpen && (
        <AddNodesDialog
          collection={active}
          nodes={nodes}
          open
          close={() => setAddOpen(false)}
          save={async (ids) => {
            if (!active) return;
            await mutate("add", [active.id], ids);
            setAddOpen(false);
            notify(`已添加 ${ids.length} 个节点到 ${active.name}`);
          }}
        />
      )}
      {bulkMode && (
        <BulkMembershipDialog
          mode={bulkMode}
          collections={collections}
          count={selected.length}
          close={() => setBulkMode(null)}
          save={async (ids) => {
            await mutate(bulkMode, ids, selected);
            setBulkMode(null);
            notify(bulkMode === "add" ? "节点集合已更新" : "已从所选集合移除");
          }}
        />
      )}
      {quickNode && (
        <QuickMembershipDialog
          key={quickNode.id}
          node={quickNode}
          collections={collections}
          close={() => setQuickNode(null)}
          save={async (next) => {
            await mutate("set", next, [quickNode.id]);
            setQuickNode(null);
            notify("节点集合已更新");
          }}
        />
      )}
      {editor !== null && (
        <CollectionEditorDialog
          key={editor === "new" ? "new" : editor.id}
          collection={editor === "new" ? null : editor}
          open
          close={() => setEditor(null)}
          saved={async () => {
            setEditor(null);
            await refresh();
          }}
          confirm={confirm}
        />
      )}
    </div>
  );
}

function AddNodesDialog({
  collection,
  nodes,
  open,
  close,
  save,
}: {
  collection: NodeCollection | null;
  nodes: NodeRecord[];
  open: boolean;
  close: () => void;
  save: (ids: number[]) => Promise<void>;
}) {
  const [selected, setSelected] = useState<number[]>([]),
    [search, setSearch] = useState(""),
    [protocol, setProtocol] = useState(""),
    [tag, setTag] = useState(""),
    [status, setStatus] = useState("");
  const visible = useMemo(
    () =>
      nodes.filter((node) => nodeMatches(node, search, protocol, tag, status)),
    [nodes, search, protocol, tag, status],
  );
  return (
    <LibraryModal
      open={open}
      close={close}
      title={`添加节点到 ${collection?.name || "节点集合"}`}
      description="从全局节点库搜索、筛选并一次选择多个节点。"
    >
      <Filters
        nodes={nodes}
        search={search}
        setSearch={setSearch}
        protocol={protocol}
        setProtocol={setProtocol}
        tag={tag}
        setTag={setTag}
        status={status}
        setStatus={setStatus}
        searchLabel="搜索节点库"
      />
      <div className="picker-list">
        {visible.map((node) => {
          const exists =
            !!collection && node.collection_ids.includes(collection.id);
          return (
            <label
              className={exists ? "picker-node already-member" : "picker-node"}
              key={node.id}
            >
              <input
                type="checkbox"
                aria-label={`添加 ${node.name}`}
                disabled={exists}
                checked={exists || selected.includes(node.id)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? [...selected, node.id]
                      : selected.filter((id) => id !== node.id),
                  )
                }
              />
              <div>
                <strong>{node.name}</strong>
                <small>
                  {protocolLabel(node.protocol)} ·{" "}
                  {node.normalized_config.server} · {node.tags.join(" · ")}
                </small>
              </div>
              {exists && (
                <span>
                  <Check size={14} />
                  已在 {collection?.name} 中
                </span>
              )}
            </label>
          );
        })}
      </div>
      <div className="modal-actions sticky">
        <span>已选择 {selected.length} 个节点</span>
        <button
          className="primary"
          disabled={!selected.length}
          onClick={() => save(selected)}
        >
          添加 {selected.length} 个节点
        </button>
      </div>
    </LibraryModal>
  );
}

function BulkMembershipDialog({
  mode,
  collections,
  count,
  close,
  save,
}: {
  mode: "add" | "remove" | null;
  collections: NodeCollection[];
  count: number;
  close: () => void;
  save: (ids: number[]) => Promise<void>;
}) {
  const [selected, setSelected] = useState<number[]>([]);
  return (
    <LibraryModal
      open={mode !== null}
      close={close}
      title={mode === "add" ? "加入节点集合" : "移出节点集合"}
      description={`为已选择的 ${count} 个节点批量更新集合关联。`}
    >
      <CollectionChooser
        title={mode === "add" ? "加入一个或多个集合" : "从一个或多个集合移出"}
        collections={collections}
        selected={selected}
        setSelected={setSelected}
      />
      <div className="modal-actions">
        <span>已选择 {selected.length} 个集合</span>
        <button
          className="primary"
          disabled={!selected.length}
          onClick={() => save(selected)}
        >
          {mode === "add" ? "加入集合" : "移出集合"}
        </button>
      </div>
    </LibraryModal>
  );
}

function QuickMembershipDialog({
  node,
  collections,
  close,
  save,
}: {
  node: NodeRecord | null;
  collections: NodeCollection[];
  close: () => void;
  save: (ids: number[]) => Promise<void>;
}) {
  const [selected, setSelected] = useState<number[]>(
    node?.collection_ids || [],
  );
  return (
    <LibraryModal
      open={!!node}
      close={close}
      title={`管理 ${node?.name || "节点"} 的集合`}
      description="只更新节点与集合的关联，不会改变节点或订阅。"
    >
      <CollectionChooser
        title="所属节点集合"
        collections={collections}
        selected={selected}
        setSelected={setSelected}
      />
      <div className="modal-actions">
        <span>已选择 {selected.length} 个集合</span>
        <button className="primary" onClick={() => save(selected)}>
          保存集合
        </button>
      </div>
    </LibraryModal>
  );
}

function CollectionEditorDialog({
  collection,
  open,
  close,
  saved,
  confirm,
}: {
  collection: NodeCollection | null;
  open: boolean;
  close: () => void;
  saved: () => Promise<void>;
  confirm: Confirm;
}) {
  const [name, setName] = useState(collection?.name || ""),
    [remark, setRemark] = useState(collection?.remark || "");
  return (
    <LibraryModal
      open={open}
      close={close}
      title={collection ? "编辑节点集合" : "新建节点集合"}
      description="集合用于管理和筛选，不会自动改变订阅。"
    >
      <label className="field">
        <span>集合名称</span>
        <input
          aria-label="集合名称"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="field">
        <span>备注</span>
        <textarea
          aria-label="集合备注"
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
        />
      </label>
      <div className="modal-actions">
        {collection && (
          <button
            className="danger-text"
            onClick={() =>
              confirm({
                title: "删除节点集合",
                text: `只删除集合“${collection.name}”及其节点关联；不会删除任何全局节点，也不会影响已有订阅。`,
                successMessage: "节点集合已删除",
                run: async () => {
                  await api(`/collections/${collection.id}`, "DELETE", {});
                  await saved();
                },
              })
            }
          >
            删除集合
          </button>
        )}
        <button
          className="primary"
          disabled={!name.trim()}
          onClick={async () => {
            await api(
              collection ? `/collections/${collection.id}` : "/collections",
              collection ? "PATCH" : "POST",
              { name, remark },
            );
            await saved();
          }}
        >
          保存集合
        </button>
      </div>
    </LibraryModal>
  );
}
