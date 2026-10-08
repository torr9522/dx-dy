import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Search, X } from "lucide-react";
import type { NodeRecord } from "../../../packages/shared/schema";

export type NodeId = number;
export type SelectionGroup = (id: NodeId) => string;

export function visibleSelectionState(
  selected: ReadonlySet<NodeId>,
  selectableIds: readonly NodeId[],
) {
  const selectedVisible = selectableIds.filter((id) => selected.has(id)).length;
  return {
    all: selectableIds.length > 0 && selectedVisible === selectableIds.length,
    some: selectedVisible > 0 && selectedVisible < selectableIds.length,
    selectedVisible,
  };
}

export function setVisibleSelection(
  selected: ReadonlySet<NodeId>,
  selectableIds: readonly NodeId[],
  shouldSelect: boolean,
) {
  const next = new Set(selected);
  for (const id of selectableIds)
    if (shouldSelect) next.add(id);
    else next.delete(id);
  return next;
}

export function setGroupedSelection(
  selected: ReadonlySet<NodeId>,
  ids: readonly NodeId[],
  shouldSelect: boolean,
  group: SelectionGroup,
) {
  if (!shouldSelect)
    return { selected: setVisibleSelection(selected, ids, false), blocked: [] };
  const next = new Set(selected);
  const groups = new Set([...selected].map(group));
  const blocked: NodeId[] = [];
  for (const id of ids) {
    if (next.has(id)) continue;
    const key = group(id);
    if (groups.has(key)) blocked.push(id);
    else {
      groups.add(key);
      next.add(id);
    }
  }
  return { selected: next, blocked };
}

export function semanticDuplicateOf(
  id: NodeId,
  selected: ReadonlySet<NodeId>,
  group: SelectionGroup,
) {
  const key = group(id);
  return [...selected].find(
    (selectedId) => selectedId !== id && group(selectedId) === key,
  );
}

export function setRangeSelection(
  selected: ReadonlySet<NodeId>,
  visibleIds: readonly NodeId[],
  anchorId: NodeId | null,
  targetId: NodeId,
  disabledIds: ReadonlySet<NodeId> = new Set(),
  shouldSelect = true,
) {
  const anchorIndex = anchorId === null ? -1 : visibleIds.indexOf(anchorId);
  const targetIndex = visibleIds.indexOf(targetId);
  if (anchorIndex < 0 || targetIndex < 0) {
    return setVisibleSelection(
      selected,
      disabledIds.has(targetId) ? [] : [targetId],
      shouldSelect,
    );
  }
  const [start, end] = [anchorIndex, targetIndex].sort((a, b) => a - b);
  return setVisibleSelection(
    selected,
    visibleIds.slice(start, end + 1).filter((id) => !disabledIds.has(id)),
    shouldSelect,
  );
}

export function selectedNodes<T extends { id: NodeId }>(
  nodes: readonly T[],
  selected: ReadonlySet<NodeId>,
) {
  return nodes.filter((node) => selected.has(node.id));
}

export function useNodeSelection(
  initialIds: readonly NodeId[] = [],
  options: {
    group?: SelectionGroup;
    onBlocked?: (ids: readonly NodeId[]) => void;
  } = {},
) {
  const [selected, setSelected] = useState<Set<NodeId>>(
    () => new Set(initialIds),
  );
  const anchor = useRef<NodeId | null>(null);
  const selectedIds = useMemo(() => [...selected], [selected]);
  const clearAll = useCallback(() => {
    setSelected(new Set());
    anchor.current = null;
  }, []);
  const resetAnchor = useCallback(() => {
    anchor.current = null;
  }, []);
  const replace = useCallback((ids: readonly NodeId[]) => {
    setSelected(new Set(ids));
    anchor.current = null;
  }, []);
  const toggleOne = useCallback(
    (
      id: NodeId,
      options: {
        checked?: boolean;
        shiftKey?: boolean;
        visibleIds?: readonly NodeId[];
        disabledIds?: ReadonlySet<NodeId>;
      } = {},
    ) => {
      const disabled = options.disabledIds || new Set<NodeId>();
      if (disabled.has(id)) return;
      const anchorId = anchor.current;
      setSelected((current) => {
        const shouldSelect = options.checked ?? !current.has(id);
        const changed =
          options.shiftKey && options.visibleIds
            ? setRangeSelection(
                current,
                options.visibleIds,
                anchorId,
                id,
                disabled,
                shouldSelect,
              )
            : setVisibleSelection(current, [id], shouldSelect);
        if (!shouldSelect || !optionsRef.current.group) return changed;
        const targetIds = [...changed].filter(
          (candidate) => !current.has(candidate),
        );
        const result = setGroupedSelection(
          current,
          targetIds,
          true,
          optionsRef.current.group,
        );
        if (result.blocked.length)
          optionsRef.current.onBlocked?.(result.blocked);
        return result.selected;
      });
      anchor.current = id;
    },
    [],
  );
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const toggleVisible = useCallback((ids: readonly NodeId[]) => {
    setSelected((current) => {
      const { all } = visibleSelectionState(current, ids);
      if (all || !optionsRef.current.group)
        return setVisibleSelection(current, ids, !all);
      const result = setGroupedSelection(
        current,
        ids,
        true,
        optionsRef.current.group,
      );
      if (result.blocked.length) optionsRef.current.onBlocked?.(result.blocked);
      return result.selected;
    });
  }, []);
  const removeOne = useCallback((id: NodeId) => {
    setSelected((current) => setVisibleSelection(current, [id], false));
  }, []);
  return {
    selected,
    selectedIds,
    selectedCount: selected.size,
    isSelected: (id: NodeId) => selected.has(id),
    toggleOne,
    toggleVisible,
    clearAll,
    removeOne,
    resetAnchor,
    replace,
  };
}

export function SelectionMaster({
  selected,
  selectableIds,
  toggle,
  label = "当前结果",
}: {
  selected: ReadonlySet<NodeId>;
  selectableIds: readonly NodeId[];
  toggle: () => void;
  label?: string;
}) {
  const checkbox = useRef<HTMLInputElement>(null);
  const state = visibleSelectionState(selected, selectableIds);
  useEffect(() => {
    if (checkbox.current) checkbox.current.indeterminate = state.some;
  }, [state.some]);
  return (
    <label className="selection-master">
      <input
        ref={checkbox}
        type="checkbox"
        checked={state.all}
        disabled={!selectableIds.length}
        aria-label={state.all ? `取消选择${label}` : `全选${label}`}
        onChange={toggle}
      />
      <span>
        {state.all ? "取消选择当前结果" : "全选当前结果"}（
        {selectableIds.length}）
      </span>
    </label>
  );
}

export function SelectedNodesDialog({
  open,
  close,
  nodes,
  selected,
  remove,
  protocolLabel,
  duplicateOf,
}: {
  open: boolean;
  close: () => void;
  nodes: NodeRecord[];
  selected: ReadonlySet<NodeId>;
  remove: (id: NodeId) => void;
  protocolLabel: (protocol: string) => string;
  duplicateOf?: (id: NodeId) => NodeId | undefined;
}) {
  const [search, setSearch] = useState("");
  const chosen = selectedNodes(nodes, selected).filter(
    (node) =>
      !search ||
      `${node.name} ${node.normalized_config.server} ${node.protocol} ${node.tags.join(" ")}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  return (
    <Dialog.Root open={open} onOpenChange={(value) => !value && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="modal collection-modal">
          <div className="modal-head">
            <div>
              <Dialog.Title>查看已选择节点</Dialog.Title>
              <Dialog.Description>
                共选择 {selected.size} 个节点，可搜索检查或单个取消。
              </Dialog.Description>
            </div>
            <Dialog.Close className="icon-button" aria-label="关闭">
              <X size={18} />
            </Dialog.Close>
          </div>
          <div className="modal-body">
            <label className="search selected-search">
              <Search size={16} />
              <input
                aria-label="搜索已选择节点"
                placeholder="搜索已选择节点…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <div className="picker-list">
              {chosen.map((node) => (
                <div className="picker-node selected-row" key={node.id}>
                  <div>
                    <strong>{node.name}</strong>
                    <small>
                      {protocolLabel(node.protocol)} ·{" "}
                      {node.normalized_config.server}
                    </small>
                    {duplicateOf?.(node.id) !== undefined && (
                      <small className="duplicate-note">重复配置</small>
                    )}
                  </div>
                  <button onClick={() => remove(node.id)}>取消选择</button>
                </div>
              ))}
              {!chosen.length && <p className="notice">没有匹配的已选节点。</p>}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function shouldToggleRow(target: EventTarget | null, shiftKey = false) {
  if (!(target instanceof Element)) return false;
  if (target.closest("button, input, select, textarea, a, [role='button']"))
    return false;
  if (shiftKey) return true;
  const selection = window.getSelection();
  const row = target.closest(".selectable-row");
  return !(
    selection &&
    !selection.isCollapsed &&
    row &&
    ((selection.anchorNode && row.contains(selection.anchorNode)) ||
      (selection.focusNode && row.contains(selection.focusNode)))
  );
}
