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
  Trash2,
  X,
} from "lucide-react";
import type {
  NodeGroup,
  NodeCollection,
  NodeRecord,
  NodeDeleteImpact,
} from "../../../packages/shared/schema";
import { api } from "./api";
import { nodeMatches } from "./fields";
import {
  SelectedNodesDialog,
  SelectionMaster,
  shouldToggleRow,
  useNodeSelection,
} from "./nodeSelection";
import { QueuedSwitch } from "./QueuedSwitch";

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
  confirmLabel?: string;
  run: () => Promise<void | string>;
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
  groups,
  activeGroupId,
  setActiveGroupId,
  collections,
  refresh,
  notify,
  copy,
  edit,
  confirm,
}: {
  nodes: NodeRecord[];
  groups: NodeGroup[];
  activeGroupId: number | null;
  setActiveGroupId: (id: number | null) => void;
  collections: NodeCollection[];
  refresh: () => Promise<void>;
  notify: (message: string) => void;
  copy: (value: string) => Promise<void>;
  edit: (node: NodeRecord) => void;
  confirm: Confirm;
}) {
  const [activeId, setActiveId] = useState<number | null>(null);
  const [groupEditor, setGroupEditor] = useState<NodeGroup | "new" | null>(
    null,
  );
  const [groupName, setGroupName] = useState("");
  const [copyOpen, setCopyOpen] = useState(false);
  const [sourceGroupId, setSourceGroupId] = useState<number | null>(null);
  const copySelection = useNodeSelection();
  const [groupBusy, setGroupBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [protocol, setProtocol] = useState("");
  const [tag, setTag] = useState("");
  const [status, setStatus] = useState("");
  const selection = useNodeSelection();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [bulkMode, setBulkMode] = useState<"add" | "remove" | null>(null);
  const [quickNode, setQuickNode] = useState<NodeRecord | null>(null);
  const [editor, setEditor] = useState<NodeCollection | "new" | null>(null);
  const active = collections.find((item) => item.id === activeId) || null;
  const activeGroup = groups.find((item) => item.id === activeGroupId) || null;
  const groupNodes =
    activeGroupId === null
      ? []
      : nodes.filter((node) => node.group_id === activeGroupId);
  const source = active
    ? groupNodes.filter((node) => node.collection_ids.includes(active.id))
    : groupNodes;
  const visible = source.filter((node) =>
    nodeMatches(node, search, protocol, tag, status),
  );
  const editGroup = (group: NodeGroup | "new") => {
    setGroupEditor(group);
    setGroupName(group === "new" ? "" : group.name);
  };
  const targetKeys = new Set(groupNodes.map((node) => node.semantic_key));
  const copyCandidates = nodes.filter(
    (node) => node.group_id === sourceGroupId,
  );
  const copyDisabled = (node: NodeRecord) => targetKeys.has(node.semantic_key);
  useEffect(() => {
    selection.clearAll();
  }, [activeGroupId]);
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
    selection.clearAll();
    await refresh();
  };
  const chooseView = (id: number | null) => {
    setActiveId(id);
    selection.resetAnchor();
    setSearch("");
    setProtocol("");
    setTag("");
    setStatus("");
  };
  useEffect(() => {
    if (activeId !== null && !collections.some((item) => item.id === activeId))
      chooseView(null);
  }, [activeId, collections]);
  useEffect(() => {
    const existing = new Set(nodes.map((node) => node.id));
    const retained = selection.selectedIds.filter((id) => existing.has(id));
    if (retained.length !== selection.selectedCount)
      selection.replace(retained);
  }, [
    nodes,
    selection.selectedIds,
    selection.selectedCount,
    selection.replace,
  ]);

  const deleteNodes = async (selectedNodes: NodeRecord[]) => {
    const count = selectedNodes.length;
    let impact: NodeDeleteImpact;
    try {
      impact = await api<NodeDeleteImpact>("/nodes/delete-impact", "POST", {
        node_ids: selectedNodes.map((node) => node.id),
      });
    } catch (error) {
      notify(error instanceof Error ? error.message : "无法获取删除影响");
      return;
    }
    const names = impact.subscriptions.slice(0, 4).map((item) => item.name);
    confirm({
      title: count === 1 ? "删除节点" : `删除已选（${count}）`,
      text: `${count === 1 ? `将永久删除节点库中的节点“${selectedNodes[0].name}”。` : `将永久删除节点库中已选择的 ${count} 个节点。`}${
        impact.subscriptionCount
          ? `其中 ${impact.referencedNodeCount} 个节点正在被 ${impact.subscriptionCount} 个订阅使用，将自动移除 ${impact.relationshipCount} 条订阅节点引用。受影响订阅：${names.join("、")}${impact.subscriptionCount > names.length ? `，+ ${impact.subscriptionCount - names.length} 个` : ""}。订阅本身、Token / URL、启用状态及其它 Global / Local 节点保持不变。`
          : ""
      }`,
      confirmLabel: impact.subscriptionCount
        ? "删除节点并从订阅移除"
        : "删除节点",
      run: async () => {
        const result =
          count === 1
            ? await api<NodeDeleteImpact & { deleted: number }>(
                `/nodes/${selectedNodes[0].id}`,
                "DELETE",
                { confirm: true },
              )
            : await api<NodeDeleteImpact & { deleted: number }>(
                "/nodes/batch-delete",
                "POST",
                {
                  node_ids: selectedNodes.map((node) => node.id),
                  confirm: true,
                },
              );
        for (const node of selectedNodes) selection.removeOne(node.id);
        await refresh();
        return result.subscriptionCount
          ? `已删除 ${result.deleted} 个节点，并从 ${result.subscriptionCount} 个订阅中移除 ${result.relationshipCount} 条引用`
          : `已删除 ${result.deleted} 个节点`;
      },
    });
  };

  return (
    <div className="node-library card">
      <aside className="collection-sidebar" aria-label="节点库导航">
        <div className="master-pool">
          <small>节点分组</small>
          <button className="new-collection" onClick={() => editGroup("new")}>
            <Plus size={14} /> 新建分组
          </button>
          {groups.map((group) => (
            <div className="collection-nav-row" key={group.id}>
              <button
                className={activeGroupId === group.id ? "active" : ""}
                onClick={() => {
                  setActiveGroupId(group.id);
                  chooseView(null);
                }}
              >
                <span>
                  <strong>{group.name}</strong>
                </span>
                <b>{group.node_count}</b>
              </button>
              <button
                className="icon-button"
                aria-label={`编辑分组 ${group.name}`}
                onClick={() => editGroup(group)}
              >
                <Pencil size={14} />
              </button>
              <button
                className="icon-button"
                aria-label={`删除分组 ${group.name}`}
                disabled={group.node_count > 0}
                title={
                  group.node_count ? "请先复制或删除组内节点" : "删除空分组"
                }
                onClick={() =>
                  confirm({
                    title: "删除空分组",
                    text: `删除空分组“${group.name}”？`,
                    run: async () => {
                      await api(`/node-groups/${group.id}`, "DELETE");
                      await refresh();
                    },
                  })
                }
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {!groups.length && (
            <p className="notice">创建第一个分组后开始添加节点。</p>
          )}
        </div>
        <details className="collection-section">
          <summary>Legacy Collections（保留数据）</summary>
          <button onClick={() => chooseView(null)}>当前分组全部节点</button>
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
        </details>
      </aside>
      <section className="node-library-main">
        <div className="node-view-heading">
          <div>
            <h2>
              {activeGroup?.name || "暂无分组"}
              {active ? ` · ${active.name}` : ""}
            </h2>
            <p>
              {active
                ? active.remark || "从全部节点中整理出的管理集合"
                : "Global Node Library · 当前分组内节点"}
            </p>
          </div>
          {active && (
            <button className="primary" onClick={() => setAddOpen(true)}>
              <FolderPlus size={16} />
              从节点库添加节点
            </button>
          )}
          {activeGroup && (
            <button
              disabled={groups.length < 2}
              onClick={() => {
                copySelection.clearAll();
                setSourceGroupId(
                  groups.find((group) => group.id !== activeGroupId)?.id ??
                    null,
                );
                setCopyOpen(true);
              }}
            >
              <Copy size={16} /> 从其他分组添加
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
          <>
            <div className="selection-toolbar">
              <SelectionMaster
                selected={selection.selected}
                selectableIds={visible.map((node) => node.id)}
                toggle={() =>
                  selection.toggleVisible(visible.map((node) => node.id))
                }
                label="当前节点"
              />
            </div>
            <div className="table-wrap">
              <table className="node-table">
                <thead>
                  <tr>
                    <th className="select-cell">选择</th>
                    <th>名称 / 集合</th>
                    <th>服务器</th>
                    <th>协议 / 标签</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((node) => (
                    <tr
                      key={node.id}
                      className={
                        selection.isSelected(node.id)
                          ? "is-selected selectable-row"
                          : "selectable-row"
                      }
                      onMouseDown={(event) => {
                        if (
                          event.shiftKey &&
                          shouldToggleRow(event.target, true)
                        ) {
                          event.preventDefault();
                          selection.toggleOne(node.id, {
                            shiftKey: true,
                            visibleIds: visible.map((item) => item.id),
                          });
                        }
                      }}
                      onClick={(event) => {
                        if (!event.shiftKey && shouldToggleRow(event.target))
                          selection.toggleOne(node.id, {
                            visibleIds: visible.map((item) => item.id),
                          });
                      }}
                    >
                      <td className="select-cell">
                        <input
                          aria-label={`选择 ${node.name}`}
                          type="checkbox"
                          checked={selection.isSelected(node.id)}
                          onClick={(event) => {
                            event.stopPropagation();
                            selection.toggleOne(node.id, {
                              checked: event.currentTarget.checked,
                              shiftKey: event.shiftKey,
                              visibleIds: visible.map((item) => item.id),
                            });
                          }}
                          onChange={() => undefined}
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
                        <div className="row-actions">
                          <QueuedSwitch
                            enabled={node.enabled}
                            label={(enabled) =>
                              `${enabled ? "禁用" : "启用"}节点 ${node.name}`
                            }
                            persist={(enabled) =>
                              api(`/nodes/${node.id}/enabled`, "PATCH", {
                                enabled,
                              })
                            }
                            changed={refresh}
                            notify={notify}
                            enabledMessage="节点已启用"
                            disabledMessage="节点已禁用"
                          />
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
                          <button
                            className="icon-button"
                            aria-label={`编辑 ${node.name}`}
                            title="编辑节点"
                            onClick={() => edit(node)}
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            className="icon-button"
                            aria-label={`复制 ${node.name}`}
                            title="复制节点链接"
                            onClick={async () => {
                              const result = await api<{ uri: string }>(
                                `/nodes/${node.id}/uri`,
                              );
                              await copy(result.uri);
                            }}
                          >
                            <Copy size={15} />
                          </button>
                          <button
                            className="icon-button danger-text"
                            aria-label={`删除 ${node.name}`}
                            title="删除节点"
                            onClick={() => deleteNodes([node])}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {!!selection.selectedCount && (
          <div className="bulk-bar" role="toolbar" aria-label="节点批量操作">
            <strong>已选择 {selection.selectedCount} 个节点</strong>
            {active ? (
              <button
                onClick={() => {
                  void mutate("remove", [active.id], selection.selectedIds);
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
            <button onClick={() => setReviewOpen(true)}>
              查看已选择 {selection.selectedCount} 个
            </button>
            <button
              className="danger-text"
              onClick={() =>
                deleteNodes(
                  nodes.filter((node) => selection.selected.has(node.id)),
                )
              }
            >
              <Trash2 size={14} />
              删除已选（{selection.selectedCount}）
            </button>
            <button onClick={selection.clearAll}>清空选择</button>
          </div>
        )}
      </section>
      <LibraryModal
        open={groupEditor !== null}
        close={() => !groupBusy && setGroupEditor(null)}
        title={groupEditor === "new" ? "创建分组" : "重命名分组"}
        description="每个节点只属于一个分组；组内连接配置不可重复。"
      >
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (groupBusy || !groupName.trim()) return;
            setGroupBusy(true);
            try {
              const saved = await api<NodeGroup>(
                groupEditor === "new"
                  ? "/node-groups"
                  : `/node-groups/${groupEditor?.id}`,
                groupEditor === "new" ? "POST" : "PATCH",
                { name: groupName },
              );
              await refresh();
              setActiveGroupId(saved.id);
              chooseView(null);
              setGroupEditor(null);
            } catch (error) {
              notify((error as Error).message);
            } finally {
              setGroupBusy(false);
            }
          }}
        >
          <label className="field">
            <span>分组名称</span>
            <input
              aria-label="分组名称"
              value={groupName}
              maxLength={100}
              onChange={(event) => setGroupName(event.target.value)}
            />
          </label>
          <div className="modal-actions">
            <button
              className="primary"
              type="submit"
              disabled={groupBusy || !groupName.trim()}
            >
              保存分组
            </button>
          </div>
        </form>
      </LibraryModal>
      <LibraryModal
        open={copyOpen}
        close={() => !groupBusy && setCopyOpen(false)}
        title="从其他分组添加"
        description={`创建独立节点副本到 ${activeGroup?.name || "当前分组"}；不会共享节点 ID。`}
      >
        <label className="field">
          <span>来源分组</span>
          <select
            aria-label="来源分组"
            value={sourceGroupId ?? ""}
            onChange={(event) => {
              setSourceGroupId(Number(event.target.value));
              copySelection.clearAll();
            }}
          >
            {groups
              .filter((group) => group.id !== activeGroupId)
              .map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
          </select>
        </label>
        <div className="picker-list">
          {copyCandidates.map((node) => (
            <label className="picker-node" key={node.id}>
              <input
                type="checkbox"
                aria-label={`复制 ${node.name}`}
                disabled={copyDisabled(node)}
                checked={copySelection.isSelected(node.id)}
                onChange={(event) =>
                  copySelection.toggleOne(node.id, {
                    checked: event.target.checked,
                  })
                }
              />
              <span>
                <strong>{node.name}</strong>
                <small>
                  {node.group_name} · {protocolLabel(node.protocol)}
                  {copyDisabled(node) ? " · 目标分组已存在相同配置" : ""}
                </small>
              </span>
            </label>
          ))}
        </div>
        <div className="modal-actions">
          <span>已选择 {copySelection.selectedCount} 个节点</span>
          <button
            className="primary"
            disabled={
              groupBusy || !copySelection.selectedCount || !activeGroupId
            }
            onClick={async () => {
              setGroupBusy(true);
              try {
                await api(`/node-groups/${activeGroupId}/copy`, "POST", {
                  node_ids: copySelection.selectedIds,
                });
                await refresh();
                setCopyOpen(false);
                notify("独立节点副本已创建");
              } catch (error) {
                notify((error as Error).message);
              } finally {
                setGroupBusy(false);
              }
            }}
          >
            确认复制
          </button>
        </div>
      </LibraryModal>
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
          count={selection.selectedCount}
          close={() => setBulkMode(null)}
          save={async (ids) => {
            await mutate(bulkMode, ids, selection.selectedIds);
            setBulkMode(null);
            notify(bulkMode === "add" ? "节点集合已更新" : "已从所选集合移除");
          }}
        />
      )}
      <SelectedNodesDialog
        open={reviewOpen}
        close={() => setReviewOpen(false)}
        nodes={nodes}
        selected={selection.selected}
        remove={selection.removeOne}
        protocolLabel={protocolLabel}
      />
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
  const selection = useNodeSelection(),
    [reviewOpen, setReviewOpen] = useState(false),
    [search, setSearch] = useState(""),
    [protocol, setProtocol] = useState(""),
    [tag, setTag] = useState(""),
    [status, setStatus] = useState("");
  const visible = useMemo(
    () =>
      nodes.filter((node) => nodeMatches(node, search, protocol, tag, status)),
    [nodes, search, protocol, tag, status],
  );
  const disabledIds = useMemo(
    () =>
      new Set(
        nodes
          .filter(
            (node) =>
              collection?.id && node.collection_ids.includes(collection.id),
          )
          .map((node) => node.id),
      ),
    [nodes, collection?.id],
  );
  const selectableVisibleIds = visible
    .map((node) => node.id)
    .filter((id) => !disabledIds.has(id));
  useEffect(() => selection.resetAnchor(), [search, protocol, tag, status]);
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
      <div className="selection-toolbar">
        <SelectionMaster
          selected={selection.selected}
          selectableIds={selectableVisibleIds}
          toggle={() => selection.toggleVisible(selectableVisibleIds)}
          label="当前可选节点"
        />
        <small>
          {selectableVisibleIds.length} 个可选
          {visible.length - selectableVisibleIds.length
            ? ` · ${visible.length - selectableVisibleIds.length} 个已在集合中`
            : ""}
        </small>
      </div>
      <div className="picker-list">
        {visible.map((node) => {
          const exists =
            !!collection && node.collection_ids.includes(collection.id);
          return (
            <div
              className={`${exists ? "picker-node already-member" : "picker-node selectable-row"}${selection.isSelected(node.id) ? " is-selected" : ""}`}
              key={node.id}
              onMouseDown={(event) => {
                if (
                  !exists &&
                  event.shiftKey &&
                  shouldToggleRow(event.target, true)
                ) {
                  event.preventDefault();
                  selection.toggleOne(node.id, {
                    shiftKey: true,
                    visibleIds: visible.map((item) => item.id),
                    disabledIds,
                  });
                }
              }}
              onClick={(event) => {
                if (!exists && !event.shiftKey && shouldToggleRow(event.target))
                  selection.toggleOne(node.id, {
                    visibleIds: visible.map((item) => item.id),
                    disabledIds,
                  });
              }}
            >
              <input
                type="checkbox"
                aria-label={`添加 ${node.name}`}
                disabled={exists}
                checked={exists || selection.isSelected(node.id)}
                onClick={(event) => {
                  event.stopPropagation();
                  selection.toggleOne(node.id, {
                    checked: event.currentTarget.checked,
                    shiftKey: event.shiftKey,
                    visibleIds: visible.map((item) => item.id),
                    disabledIds,
                  });
                }}
                onChange={() => undefined}
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
            </div>
          );
        })}
      </div>
      <div className="modal-actions sticky">
        <span>已选择 {selection.selectedCount} 个节点</span>
        {!!selection.selectedCount && (
          <>
            <button onClick={() => setReviewOpen(true)}>
              查看已选择 {selection.selectedCount} 个
            </button>
            <button onClick={selection.clearAll}>清空选择</button>
          </>
        )}
        <button
          className="primary"
          disabled={!selection.selectedCount}
          onClick={() => save(selection.selectedIds)}
        >
          添加 {selection.selectedCount} 个节点
        </button>
      </div>
      <SelectedNodesDialog
        open={reviewOpen}
        close={() => setReviewOpen(false)}
        nodes={nodes}
        selected={selection.selected}
        remove={selection.removeOne}
        protocolLabel={protocolLabel}
      />
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
