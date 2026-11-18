import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Play, Search, ShoppingBag, Square, Trash2 } from "lucide-react";
import { PageHeader, StatCard, StatusBadge, SurfaceCard, TerminalLog } from "../components/ui";

interface BolsinhasOpcoes {
  pasta: string;
  extras: string[];
  apagar_repetido: boolean;
  som: boolean;
  usar_pai: boolean;
}

interface BolsinhasCounters {
  novas: number;
  atualizadas: number;
  repetidas: number;
  ja_feitas: number;
  erros: number;
}

interface BolsinhasStatus {
  monitorando: boolean;
  varrendo: boolean;
}

export function BolsinhasPage() {
  const [pasta, setPasta] = useState("");
  const [extrasTxt, setExtrasTxt] = useState("");
  const [usarPai, setUsarPai] = useState(true);
  const [apagarRepetido, setApagarRepetido] = useState(false);
  const [som, setSom] = useState(true);
  const [status, setStatus] = useState<BolsinhasStatus>({
    monitorando: false,
    varrendo: false,
  });
  const [counters, setCounters] = useState<BolsinhasCounters>({
    novas: 0,
    atualizadas: 0,
    repetidas: 0,
    ja_feitas: 0,
    erros: 0,
  });
  const [logs, setLogs] = useState<string[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    invoke<BolsinhasOpcoes>("bolsinhas_get_config").then((cfg) => {
      setPasta(cfg.pasta || "");
      setExtrasTxt((cfg.extras || []).join("\n"));
      setUsarPai(cfg.usar_pai);
      setApagarRepetido(cfg.apagar_repetido);
      setSom(cfg.som);
    });
    invoke<BolsinhasStatus>("bolsinhas_status").then(setStatus);
    invoke<BolsinhasCounters>("bolsinhas_counters").then(setCounters);

    const unStatus = listen<BolsinhasStatus>("bolsinhas-status", (e) => setStatus(e.payload));
    const unCnt = listen<BolsinhasCounters>("bolsinhas-counters", (e) => setCounters(e.payload));
    const unLog = listen<string>("bolsinhas-log", (e) => {
      setLogs((prev) => [...prev.slice(-1500), e.payload]);
    });

    return () => {
      unStatus.then((fn) => fn());
      unCnt.then((fn) => fn());
      unLog.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const selecionarPasta = async () => {
    const dir = await open({ directory: true, defaultPath: pasta || undefined });
    if (typeof dir === "string") setPasta(dir);
  };

  const alternar = async () => {
    setErro(null);
    try {
      if (status.monitorando) {
        await invoke("bolsinhas_parar");
      } else {
        const extras = extrasTxt
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);
        await invoke("bolsinhas_iniciar", {
          opcoes: {
            pasta,
            extras,
            apagar_repetido: apagarRepetido,
            som,
            usar_pai: usarPai,
          },
        });
      }
    } catch (e) {
      setErro(String(e));
    }
  };

  const executarVarredura = async (mover: boolean) => {
    setErro(null);
    try {
      await invoke("bolsinhas_varredura", { pasta, mover });
    } catch (e) {
      setErro(String(e));
    }
  };

  return (
    <div className="p-6 h-full flex flex-col gap-4 max-w-7xl mx-auto">
      <PageHeader
        icon={<ShoppingBag className="w-5 h-5 text-violet-500 dark:text-violet-400" />}
        title="Gerador de Bolsinhas"
        subtitle="Monitora a pasta PARA FAZER e gera bolsinhas JPEG (10%) em paralelo com verificação de arte repetida."
        right={
          <StatusBadge
            active={status.monitorando || status.varrendo}
            activeText={status.varrendo ? "Varrendo..." : "Monitorando"}
            tone={status.varrendo ? "amber" : "emerald"}
          />
        }
      />

      {erro && (
        <div className="px-4 py-2.5 rounded-xl text-xs bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300">
          {erro}
        </div>
      )}

      <SurfaceCard className="p-4 space-y-3">
        <div className="flex items-center gap-2.5">
          <span className="text-xs text-slate-500 dark:text-zinc-400 w-32 shrink-0">
            Pasta PARA FAZER
          </span>
          <input
            type="text"
            value={pasta}
            disabled={status.monitorando}
            onChange={(e) => setPasta(e.target.value)}
            className="flex-1 rounded-xl bg-slate-50 dark:bg-[#0b0b12] border border-slate-200 dark:border-white/10 px-3 py-2 text-xs text-slate-900 dark:text-white disabled:opacity-50 focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={selecionarPasta}
            disabled={status.monitorando}
            className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-white/[0.07] hover:bg-slate-200 dark:hover:bg-white/15 disabled:opacity-50 text-slate-700 dark:text-zinc-200 cursor-pointer"
          >
            <FolderOpen className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-wrap gap-5 text-xs text-slate-700 dark:text-zinc-200">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={usarPai}
              onChange={(e) => setUsarPai(e.target.checked)}
              className="rounded accent-blue-600"
            />
            Usar pasta de cima (BOLSINHAS) como 'já feitas'
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={apagarRepetido}
              onChange={(e) => setApagarRepetido(e.target.checked)}
              className="rounded accent-blue-600"
            />
            Apagar TIFF repetido (em vez de mover p/ REPETIDAS)
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={som}
              onChange={(e) => setSom(e.target.checked)}
              className="rounded accent-blue-600"
            />
            Som de alerta
          </label>
        </div>

        <div>
          <label className="block text-[11px] text-slate-500 dark:text-zinc-400 mb-1">
            Pastas extras de bolsinhas já feitas (uma por linha, opcional):
          </label>
          <textarea
            rows={2}
            value={extrasTxt}
            onChange={(e) => setExtrasTxt(e.target.value)}
            className="w-full rounded-xl bg-slate-50 dark:bg-[#0b0b12] border border-slate-200 dark:border-white/10 px-3 py-2 font-mono text-xs text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            onClick={alternar}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-white cursor-pointer transition-all ${status.monitorando
                ? "bg-red-600 hover:bg-red-500 shadow-sm"
                : "bg-emerald-600 hover:bg-emerald-500 shadow-sm"
              }`}
          >
            {status.monitorando ? (
              <Square className="w-3.5 h-3.5" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            {status.monitorando ? "Parar Monitor" : "Iniciar Monitor"}
          </button>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => executarVarredura(false)}
              disabled={status.varrendo}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-white/[0.07] hover:bg-slate-200 dark:hover:bg-white/15 disabled:opacity-50 text-xs font-medium text-slate-700 dark:text-white cursor-pointer"
            >
              <Search className="w-3.5 h-3.5" />
              Varredura (relatório)
            </button>
            <button
              onClick={() => executarVarredura(true)}
              disabled={status.varrendo}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-xs font-semibold text-white cursor-pointer shadow-sm"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Varredura + mover duplicadas
            </button>
          </div>
        </div>
      </SurfaceCard>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
        <StatCard label="✔ Novas" value={counters.novas} tone="emerald" />
        <StatCard label="↻ Arte nova" value={counters.atualizadas} tone="sky" />
        <StatCard label="⛔ Repetidas" value={counters.repetidas} tone="amber" />
        <StatCard label="🗑 Já feitas" value={counters.ja_feitas} tone="zinc" />
        <StatCard label="✘ Erros" value={counters.erros} tone="red" />
      </div>

      <TerminalLog lines={logs} emptyText="Aguardando arquivos..." logRef={logRef} />
    </div>
  );
}
