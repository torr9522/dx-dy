import { useEffect, useRef, useState } from "react";

export function QueuedSwitch({
  enabled: externalEnabled,
  label,
  persist,
  changed,
  notify,
  enabledMessage,
  disabledMessage,
}: {
  enabled: boolean;
  label: (enabled: boolean) => string;
  persist: (enabled: boolean) => Promise<void>;
  changed: () => Promise<void>;
  notify: (message: string) => void;
  enabledMessage: string;
  disabledMessage: string;
}) {
  const [enabled, setEnabled] = useState(externalEnabled);
  const desired = useRef(externalEnabled);
  const persisted = useRef(externalEnabled);
  const working = useRef(false);

  useEffect(() => {
    desired.current = externalEnabled;
    persisted.current = externalEnabled;
    setEnabled(externalEnabled);
  }, [externalEnabled]);

  const flush = async () => {
    if (working.current) return;
    working.current = true;
    try {
      while (persisted.current !== desired.current) {
        const target = desired.current;
        await persist(target);
        persisted.current = target;
      }
      await changed();
      notify(persisted.current ? enabledMessage : disabledMessage);
    } catch (error) {
      desired.current = persisted.current;
      setEnabled(persisted.current);
      notify((error as Error).message);
    } finally {
      working.current = false;
      if (persisted.current !== desired.current) void flush();
    }
  };

  return (
    <button
      className={`switch-control${enabled ? " is-on" : ""}`}
      role="switch"
      aria-checked={enabled}
      aria-label={label(enabled)}
      onClick={() => {
        const next = !desired.current;
        desired.current = next;
        setEnabled(next);
        void flush();
      }}
    >
      <span aria-hidden="true" />
      {enabled ? "启用" : "禁用"}
    </button>
  );
}
