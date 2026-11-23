import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

export interface ShortcutItem {
  id: string;
  /** Ex: "ctrl+enter", "alt+t", "alt+1", "[" */
  combo: string;
  /** Rótulo visual das teclas, ex: "Ctrl+Enter" */
  keys: string;
  label: string;
  action: () => void;
  /** Se true, dispara mesmo com foco dentro de input/textarea. Padrão: true quando usa Ctrl/Alt, false para tecla simples. */
  allowInInput?: boolean;
}

interface ShortcutContextValue {
  pageShortcuts: ShortcutItem[];
  registerPageShortcuts: (items: ShortcutItem[]) => void;
}

const ShortcutContext = createContext<ShortcutContextValue>({
  pageShortcuts: [],
  registerPageShortcuts: () => {},
});

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

export function matchesCombo(e: KeyboardEvent, combo: string): boolean {
  const parts = combo.toLowerCase().split("+");
  const keyPart = parts[parts.length - 1];
  const needCtrl = parts.includes("ctrl");
  const needAlt = parts.includes("alt");
  const needShift = parts.includes("shift");

  if (e.ctrlKey !== needCtrl) return false;
  if (e.altKey !== needAlt) return false;
  if (e.shiftKey !== needShift) return false;

  const pressed = e.key.toLowerCase();
  if (keyPart === "enter") return pressed === "enter";
  if (keyPart === "tab") return pressed === "tab";
  if (keyPart === "esc" || keyPart === "escape") return pressed === "escape";
  if (keyPart === "space") return pressed === " ";
  return pressed === keyPart;
}

export function ShortcutProvider({
  children,
  disabled,
}: {
  children: React.ReactNode;
  disabled?: boolean;
}) {
  const [pageShortcuts, setPageShortcuts] = useState<ShortcutItem[]>([]);
  const shortcutsRef = useRef<ShortcutItem[]>([]);
  const disabledRef = useRef(Boolean(disabled));

  useEffect(() => {
    disabledRef.current = Boolean(disabled);
  }, [disabled]);

  const registerPageShortcuts = useCallback((items: ShortcutItem[]) => {
    shortcutsRef.current = items;
    setPageShortcuts(items);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (disabledRef.current) return;
      const editable = isEditableTarget(e.target);

      for (const item of shortcutsRef.current) {
        if (!matchesCombo(e, item.combo)) continue;
        const hasMod = item.combo.toLowerCase().includes("ctrl+") || item.combo.toLowerCase().includes("alt+");
        const allow = item.allowInInput ?? hasMod;
        if (editable && !allow) continue;

        e.preventDefault();
        item.action();
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const value = useMemo(
    () => ({ pageShortcuts, registerPageShortcuts }),
    [pageShortcuts, registerPageShortcuts]
  );

  return <ShortcutContext.Provider value={value}>{children}</ShortcutContext.Provider>;
}

export function useShortcutContext() {
  return useContext(ShortcutContext);
}

/**
 * Registra atalhos contextuais para a página ativa.
 * Os handlers sempre usam as referências mais recentes sem recriar listeners globais.
 */
export function usePageShortcuts(items: ShortcutItem[]) {
  const { registerPageShortcuts } = useShortcutContext();
  const latestRef = useRef(items);
  latestRef.current = items;

  const signature = items.map((i) => `${i.id}:${i.combo}:${i.label}`).join("|");

  useEffect(() => {
    const wrapped: ShortcutItem[] = latestRef.current.map((item, idx) => ({
      ...item,
      action: () => latestRef.current[idx]?.action(),
    }));
    registerPageShortcuts(wrapped);
    return () => registerPageShortcuts([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, registerPageShortcuts]);
}

