import { useEffect } from "react";
import { AlertTriangle, ArrowUpCircle, CheckCircle2, Download, RefreshCw, X } from "lucide-react";
import { formatBytes, useUpdater } from "../hooks/useUpdater";

/**
 * Modal de atualização (UPD-00). Teclado:
 *  Ctrl+Enter → baixar, instalar e reiniciar
 *  Ctrl+R     → verificar novamente
 *  Esc        → fechar (exceto durante a instalação)
 */
export function UpdateModal({ busyJobs }: { busyJobs: string[] }) {
  const {
    modalOpen,
    closeModal,
    phase,
    currentVersion,
    update,
    progress,
    error,
    lastCheck,
    checkNow,
    install,
  } = useUpdater();

  const instalando = phase === "downloading" || phase === "installing";
  const podeInstalar = !!update && !instalando && phase !== "checking";

  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (!instalando) closeModal();
      } else if (e.ctrlKey && e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        if (podeInstalar) install();
      } else if (e.ctrlKey && !e.shiftKey && key === "r") {
        e.preventDefault();
        e.stopPropagation();
        if (!instalando) checkNow(true);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [modalOpen, instalando, podeInstalar, closeModal, install, checkNow]);

  if (!modalOpen) return null;

  const pct =
    progress.total > 0 ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100)) : null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-[1px] flex items-center justify-center p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !instalando) closeModal();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="upd-title"
        className="w-full max-w-xl bg-white dark:bg-[#111114] border border-slate-300 dark:border-zinc-700 rounded shadow-2xl overflow-hidden"
      >
        {/* Cabeçalho */}
        <div className="px-4 py-2.5 border-b border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-[#0c0c0e] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ArrowUpCircle className="w-4 h-4 text-slate-700 dark:text-zinc-300" />
            <span id="upd-title" className="text-xs font-bold tracking-tight text-slate-900 dark:text-zinc-100">
              ATUALIZAÇÃO DO SISTEMA
            </span>
            <span className="font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded border border-slate-300 dark:border-zinc-700 text-slate-600 dark:text-zinc-400">
              UPD-00
            </span>
          </div>
          <button
            type="button"
            onClick={closeModal}
            disabled={instalando}
            className="p-1 rounded text-slate-500 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-zinc-800 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-blue-500"
            title="Fechar (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {/* Versões */}
          <div className="grid grid-cols-2 border border-slate-200 dark:border-zinc-800 rounded divide-x divide-slate-200 dark:divide-zinc-800 font-mono">
            <div className="px-3 py-2">
              <div className="text-[10px] font-semibold text-slate-400 dark:text-zinc-500">INSTALADA</div>
              <div className="text-sm font-bold tabular-nums text-slate-800 dark:text-zinc-200">v{currentVersion}</div>
            </div>
            <div className="px-3 py-2">
              <div className="text-[10px] font-semibold text-slate-400 dark:text-zinc-500">DISPONÍVEL</div>
              <div
                className={`text-sm font-bold tabular-nums ${
                  update ? "text-amber-600 dark:text-amber-400" : "text-slate-500 dark:text-zinc-500"
                }`}
              >
                {update ? `v${update.version}` : phase === "checking" ? "verificando…" : "—"}
              </div>
            </div>
          </div>

          {/* Estado */}
          {phase === "checking" && (
            <Linha icon={<RefreshCw className="w-3.5 h-3.5 animate-spin" />} tone="slate">
              Consultando GitHub Releases…
            </Linha>
          )}
          {phase === "uptodate" && (
            <Linha icon={<CheckCircle2 className="w-3.5 h-3.5" />} tone="emerald">
              Você já está na versão mais recente.
            </Linha>
          )}
          {phase === "error" && (
            <Linha icon={<AlertTriangle className="w-3.5 h-3.5" />} tone="red">
              <span className="break-all">Falha: {error}</span>
            </Linha>
          )}

          {/* Notas da versão */}
          {update?.notes && (
            <div>
              <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500 mb-1">
                NOTAS DA VERSÃO{update.date ? ` // ${update.date.slice(0, 10)}` : ""}
              </div>
              <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed font-mono px-3 py-2 rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950/60 text-slate-700 dark:text-zinc-300 select-text">
                {update.notes}
              </pre>
            </div>
          )}

          {/* Aviso de tarefas em andamento */}
          {update && busyJobs.length > 0 && !instalando && (
            <Linha icon={<AlertTriangle className="w-3.5 h-3.5" />} tone="amber">
              Em andamento: <b className="font-mono">{busyJobs.join(", ")}</b>. A instalação fecha o app e
              interrompe essas tarefas — aguarde terminar.
            </Linha>
          )}

          {/* Progresso */}
          {instalando && (
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] font-mono tabular-nums text-slate-500 dark:text-zinc-400">
                <span>{phase === "installing" ? "INSTALANDO — o app será reiniciado" : "BAIXANDO PACOTE"}</span>
                <span>
                  {formatBytes(progress.downloaded)}
                  {progress.total > 0 && ` / ${formatBytes(progress.total)}`}
                  {pct !== null && ` · ${pct}%`}
                </span>
              </div>
              <div className="h-1.5 rounded-sm bg-slate-200 dark:bg-zinc-800 overflow-hidden">
                <div
                  className={`h-full bg-amber-500 transition-[width] duration-200 ${pct === null ? "animate-pulse w-full" : ""}`}
                  style={pct !== null ? { width: `${pct}%` } : undefined}
                />
              </div>
            </div>
          )}
        </div>

        {/* Rodapé */}
        <div className="px-4 py-2.5 border-t border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-[#0c0c0e] flex items-center justify-between gap-2">
          <span className="text-[10px] font-mono tabular-nums text-slate-400 dark:text-zinc-500">
            {lastCheck ? `ÚLTIMA VERIFICAÇÃO ${lastCheck.toLocaleTimeString("pt-BR")}` : "AUTO: A CADA 30 MIN"}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => checkNow(true)}
              disabled={instalando || phase === "checking"}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-800 dark:text-zinc-100 hover:bg-slate-50 dark:hover:bg-zinc-700 text-[11px] font-mono font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-blue-500"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              VERIFICAR <kbd className="text-[9px] text-slate-400 dark:text-zinc-500">Ctrl+R</kbd>
            </button>
            <button
              type="button"
              onClick={install}
              disabled={!podeInstalar}
              autoFocus
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-900 dark:border-zinc-100 bg-slate-900 dark:bg-zinc-100 text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white text-[11px] font-mono font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
            >
              <Download className="w-3.5 h-3.5" />
              ATUALIZAR E REINICIAR <kbd className="text-[9px] opacity-60">Ctrl+Enter</kbd>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Linha({
  icon,
  tone,
  children,
}: {
  icon: React.ReactNode;
  tone: "slate" | "emerald" | "amber" | "red";
  children: React.ReactNode;
}) {
  const cls = {
    slate: "border-slate-200 dark:border-zinc-800 text-slate-600 dark:text-zinc-400",
    emerald: "border-emerald-300 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400",
    amber: "border-amber-300 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-400",
    red: "border-red-300 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400",
  }[tone];
  return (
    <div className={`flex items-start gap-2 px-3 py-2 rounded border text-[11px] ${cls}`}>
      <span className="mt-px shrink-0">{icon}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

