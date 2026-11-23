import { useEffect, useMemo, useRef, useState } from "react";
import { Command, CornerDownLeft, Keyboard, Moon, Search, Sun, Zap } from "lucide-react";
import { MODULOS, ModuloId } from "../modules/registry";
import { useShortcutContext } from "../hooks/useShortcuts";

export interface PaletteCommand {
  id: string;
  section: "TELA ATUAL" | "NAVEGAÇÃO" | "SISTEMA";
  label: string;
  detail?: string;
  shortcut?: string;
  run: () => void;
}

export function CommandPalette({
  open,
  onClose,
  atual,
  dark,
  sidebarCollapsed,
  onNavigate,
  onToggleTheme,
  onToggleSidebar,
  onNextTab,
  onPrevTab,
  onOpenHelp,
  onOpenUpdater,
}: {
  open: boolean;
  onClose: () => void;
  atual: ModuloId | "about";
  dark: boolean;
  sidebarCollapsed: boolean;
  onNavigate: (id: ModuloId | "about") => void;
  onToggleTheme: () => void;
  onToggleSidebar: () => void;
  onNextTab: () => void;
  onPrevTab: () => void;
  onOpenHelp: () => void;
  onOpenUpdater?: () => void;
}) {
  const { pageShortcuts } = useShortcutContext();
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIdx(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const commands = useMemo<PaletteCommand[]>(() => {
    const list: PaletteCommand[] = [];

    for (const sc of pageShortcuts) {
      list.push({
        id: `page:${sc.id}`,
        section: "TELA ATUAL",
        label: sc.label,
        shortcut: sc.keys,
        run: sc.action,
      });
    }

    list.push({
      id: "nav:inicio",
      section: "NAVEGAÇÃO",
      label: "Centro de Comando",
      detail: "HOME // Visão geral das bancadas",
      shortcut: "Ctrl+0",
      run: () => onNavigate("inicio"),
    });

    MODULOS.forEach((m, idx) => {
      list.push({
        id: `nav:${m.id}`,
        section: "NAVEGAÇÃO",
        label: m.nome,
        detail: `${m.codigo} // ${m.grupo} • ${m.descricao}`,
        shortcut: `Ctrl+${idx + 1}`,
        run: () => onNavigate(m.id),
      });
    });

    list.push({
      id: "nav:about",
      section: "NAVEGAÇÃO",
      label: "Especificações & Arquitetura",
      detail: "SPECS // Informações do sistema",
      shortcut: "Alt+I",
      run: () => onNavigate("about"),
    });

    list.push(
      {
        id: "sys:theme",
        section: "SISTEMA",
        label: dark ? "Mudar para Tema Claro" : "Mudar para Tema Escuro",
        detail: "Alterna modo claro / escuro da estação",
        shortcut: "Alt+T",
        run: onToggleTheme,
      },
      {
        id: "sys:sidebar",
        section: "SISTEMA",
        label: sidebarCollapsed ? "Expandir Barra Lateral (Sidebar)" : "Recolher Barra Lateral (Sidebar)",
        detail: "Alterna entre barra completa e modo compacto de ícones",
        shortcut: "Ctrl+B",
        run: onToggleSidebar,
      },
      {
        id: "sys:next",
        section: "SISTEMA",
        label: "Próxima Aba / Módulo",
        detail: "Avança para o próximo módulo na barra lateral",
        shortcut: "Ctrl+Tab",
        run: onNextTab,
      },
      {
        id: "sys:prev",
        section: "SISTEMA",
        label: "Aba / Módulo Anterior",
        detail: "Retorna ao módulo anterior na barra lateral",
        shortcut: "Ctrl+Shift+Tab",
        run: onPrevTab,
      },
      {
        id: "sys:help",
        section: "SISTEMA",
        label: "Abrir Mapa de Atalhos de Teclado",
        detail: "Mostra todos os atalhos globais e da tela atual",
        shortcut: "F1",
        run: onOpenHelp,
      },
      ...(onOpenUpdater
        ? [
            {
              id: "sys:updater",
              section: "SISTEMA" as const,
              label: "Verificar Atualizações do Sistema (UPD-00)",
              detail: "Verifica e instala novas versões do PCP Central",
              shortcut: "Alt+U",
              run: onOpenUpdater,
            },
          ]
        : [])
    );

    return list;
  }, [pageShortcuts, dark, sidebarCollapsed, onNavigate, onToggleTheme, onToggleSidebar, onNextTab, onPrevTab, onOpenHelp, onOpenUpdater]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        (c.detail && c.detail.toLowerCase().includes(q)) ||
        c.section.toLowerCase().includes(q) ||
        (c.shortcut && c.shortcut.toLowerCase().includes(q))
    );
  }, [commands, query]);

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  useEffect(() => {
    const activeEl = listRef.current?.querySelector(`[data-idx="${selectedIdx}"]`);
    if (activeEl instanceof HTMLElement) {
      activeEl.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIdx]);

  if (!open) return null;

  const executar = (cmd: PaletteCommand | undefined) => {
    if (!cmd) return;
    onClose();
    requestAnimationFrame(() => cmd.run());
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "ArrowDown" || (e.ctrlKey && e.key.toLowerCase() === "j")) {
      e.preventDefault();
      setSelectedIdx((i) => (filtered.length > 0 ? (i + 1) % filtered.length : 0));
    } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key.toLowerCase() === "k")) {
      e.preventDefault();
      setSelectedIdx((i) => (filtered.length > 0 ? (i - 1 + filtered.length) % filtered.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      executar(filtered[selectedIdx]);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-[1px] flex items-start justify-center pt-[12vh] px-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={onKeyDown}
    >
      <div className="w-full max-w-xl bg-white dark:bg-[#111114] border border-slate-300 dark:border-zinc-700 rounded shadow-2xl overflow-hidden flex flex-col">
        {/* Barra de Busca */}
        <div className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-[#0c0c0e]">
          <Search className="w-4 h-4 text-slate-400 dark:text-zinc-500 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Digite um módulo, código (RIP-01, CUT-03) ou comando..."
            className="flex-1 bg-transparent text-xs font-mono text-slate-900 dark:text-zinc-100 placeholder:text-slate-400 dark:placeholder:text-zinc-500 focus:outline-none"
          />
          <kbd className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-slate-300 dark:border-zinc-700 text-slate-500 dark:text-zinc-400 bg-white dark:bg-zinc-900">
            ESC
          </kbd>
        </div>

        {/* Lista de Comandos */}
        <div ref={listRef} className="max-h-[55vh] overflow-y-auto divide-y divide-slate-100 dark:divide-zinc-800/60">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs font-mono text-slate-400 dark:text-zinc-500">
              NENHUM COMANDO ENCONTRADO PARA "{query}"
            </div>
          ) : (
            filtered.map((cmd, idx) => {
              const selected = idx === selectedIdx;
              const isCurrent = cmd.id === `nav:${atual}`;
              return (
                <button
                  key={cmd.id}
                  data-idx={idx}
                  type="button"
                  onMouseEnter={() => setSelectedIdx(idx)}
                  onClick={() => executar(cmd)}
                  className={`w-full text-left px-3.5 py-2 flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                    selected
                      ? "bg-slate-900 dark:bg-zinc-100 text-white dark:text-slate-900"
                      : "bg-white dark:bg-[#111114] text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-900"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className={`shrink-0 ${
                        selected ? "text-blue-400 dark:text-blue-600" : "text-slate-400 dark:text-zinc-500"
                      }`}
                    >
                      {cmd.section === "TELA ATUAL" ? (
                        <Zap className="w-3.5 h-3.5" />
                      ) : cmd.id === "sys:theme" ? (
                        dark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />
                      ) : cmd.id === "sys:help" ? (
                        <Keyboard className="w-3.5 h-3.5" />
                      ) : (
                        <Command className="w-3.5 h-3.5" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold truncate">{cmd.label}</span>
                        <span
                          className={`text-[9px] font-mono px-1 rounded uppercase ${
                            selected
                              ? "bg-slate-800 dark:bg-zinc-200 text-slate-300 dark:text-zinc-700"
                              : "bg-slate-100 dark:bg-zinc-800 text-slate-500 dark:text-zinc-400"
                          }`}
                        >
                          {cmd.section}
                        </span>
                        {isCurrent && (
                          <span className="text-[9px] font-mono px-1 rounded bg-emerald-500/20 text-emerald-500">
                            ATIVO
                          </span>
                        )}
                      </div>
                      {cmd.detail && (
                        <div
                          className={`text-[10px] font-mono truncate mt-0.5 ${
                            selected ? "text-slate-300 dark:text-zinc-600" : "text-slate-400 dark:text-zinc-500"
                          }`}
                        >
                          {cmd.detail}
                        </div>
                      )}
                    </div>
                  </div>
                  {cmd.shortcut && (
                    <kbd
                      className={`shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                        selected
                          ? "border-slate-700 dark:border-zinc-300 bg-slate-800 dark:bg-zinc-200 text-slate-200 dark:text-zinc-800"
                          : "border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 text-slate-500 dark:text-zinc-400"
                      }`}
                    >
                      {cmd.shortcut}
                    </kbd>
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* Rodapé de Navegação */}
        <div className="px-3.5 py-1.5 border-t border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-[#0c0c0e] flex items-center justify-between text-[10px] font-mono text-slate-500 dark:text-zinc-400">
          <div className="flex items-center gap-3">
            <span>[↑/↓] Navegar</span>
            <span className="flex items-center gap-1">
              <CornerDownLeft className="w-3 h-3" /> Executar
            </span>
          </div>
          <span>PALETA DE COMANDOS // PCP</span>
        </div>
      </div>
    </div>
  );
}

