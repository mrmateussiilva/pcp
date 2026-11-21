import { useEffect } from "react";
import { Keyboard, X } from "lucide-react";
import { useShortcutContext } from "../hooks/useShortcuts";

const GLOBAL_NAV = [
  { keys: "Ctrl+K / Ctrl+P", desc: "Abrir Paleta de Comandos (busca rápida de módulos e ações)" },
  { keys: "Ctrl+0", desc: "Ir para o Centro de Comando (Início)" },
  { keys: "Ctrl+1 .. Ctrl+9", desc: "Saltar direto para o módulo 1 a 9 da barra lateral" },
  { keys: "Ctrl+Tab / Alt+→", desc: "Avançar para a próxima aba/módulo" },
  { keys: "Ctrl+Shift+Tab / Alt+←", desc: "Voltar para a aba/módulo anterior" },
  { keys: "Alt+H", desc: "Voltar ao Centro de Comando (Home)" },
  { keys: "Alt+I", desc: "Abrir Especificações do Sistema (Specs)" },
];

const GLOBAL_SYS = [
  { keys: "Ctrl+B", desc: "Recolher ou expandir a barra lateral (Sidebar)" },
  { keys: "Alt+T / Ctrl+Shift+L", desc: "Alternar Tema Claro / Escuro instantaneamente" },
  { keys: "F1 / Ctrl+/ / ?", desc: "Abrir ou fechar este Guia de Atalhos" },
  { keys: "Esc", desc: "Fechar modal aberto ou sair do campo de texto ativo" },
  { keys: "Tab / Shift+Tab", desc: "Navegar entre campos, checkboxes e botões da tela" },
];

export function ShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { pageShortcuts } = useShortcutContext();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-[1px] flex items-center justify-center p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl bg-white dark:bg-[#111114] border border-slate-300 dark:border-zinc-700 rounded shadow-2xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-[#0c0c0e] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Keyboard className="w-4 h-4 text-slate-700 dark:text-zinc-300" />
            <span className="text-xs font-bold tracking-tight text-slate-900 dark:text-zinc-100">
              MAPA DE ATALHOS // OPERAÇÃO 100% TECLADO
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-slate-500 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-zinc-800 cursor-pointer"
            title="Fechar (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4 max-h-[75vh] overflow-y-auto">
          {pageShortcuts.length > 0 && (
            <section>
              <div className="text-[10px] font-mono font-bold tracking-wider uppercase text-blue-600 dark:text-blue-400 mb-1.5">
                AÇÕES DA TELA ATUAL
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {pageShortcuts.map((sc) => (
                  <div
                    key={sc.id}
                    className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded border border-blue-200/70 dark:border-blue-900/50 bg-blue-50/50 dark:bg-blue-950/20"
                  >
                    <span className="text-xs text-slate-700 dark:text-zinc-200 truncate">{sc.label}</span>
                    <kbd className="shrink-0 text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border border-blue-300 dark:border-blue-800 bg-white dark:bg-zinc-900 text-blue-700 dark:text-blue-300">
                      {sc.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <div className="text-[10px] font-mono font-bold tracking-wider uppercase text-slate-500 dark:text-zinc-400 mb-1.5">
              NAVEGAÇÃO ENTRE ABAS E MÓDULOS
            </div>
            <div className="space-y-1">
              {GLOBAL_NAV.map((item) => (
                <div
                  key={item.keys}
                  className="flex items-center justify-between gap-3 px-2.5 py-1.5 rounded border border-slate-200/80 dark:border-zinc-800 bg-slate-50/60 dark:bg-zinc-900/40"
                >
                  <span className="text-xs text-slate-700 dark:text-zinc-300">{item.desc}</span>
                  <kbd className="shrink-0 text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-700 dark:text-zinc-200">
                    {item.keys}
                  </kbd>
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="text-[10px] font-mono font-bold tracking-wider uppercase text-slate-500 dark:text-zinc-400 mb-1.5">
              TEMA, FOCO E SISTEMA
            </div>
            <div className="space-y-1">
              {GLOBAL_SYS.map((item) => (
                <div
                  key={item.keys}
                  className="flex items-center justify-between gap-3 px-2.5 py-1.5 rounded border border-slate-200/80 dark:border-zinc-800 bg-slate-50/60 dark:bg-zinc-900/40"
                >
                  <span className="text-xs text-slate-700 dark:text-zinc-300">{item.desc}</span>
                  <kbd className="shrink-0 text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-700 dark:text-zinc-200">
                    {item.keys}
                  </kbd>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="px-4 py-2 border-t border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-[#0c0c0e] flex items-center justify-between text-[10px] font-mono text-slate-500 dark:text-zinc-400">
          <span>Pressione [ESC] ou [F1] para fechar</span>
          <span>PCP CENTRAL // KEYBOARD-FIRST</span>
        </div>
      </div>
    </div>
  );
}

