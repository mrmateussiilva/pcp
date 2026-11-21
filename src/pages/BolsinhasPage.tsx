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
    <div className="p-5 h-full flex flex-col gap-3.5 max-w-7xl mx-auto">
      <PageHeader
        icon={<ShoppingBag className="w-4 h-4 text-slate-700 dark:text-zinc-300" />}
        title="Gerador de Bolsinhas // JPEG 10%"
        badge="IMG-02"
        subtitle="Monitora PARA FAZER, gera bolsinhas JPEG a 10% da dimensão em SIMD e cataloga miniaturas para detectar artes repetidas."
        right={
          <StatusBadge
            active={status.monitorando || status.varrendo}
            activeText={status.varrendo ? "VARRENDO..." : "WATCHER ATIVO"}
            tone={status.varrendo ? "amber" : "emerald"}
          />
        }
      />

      {erro && (
        <div className="px-3.5 py-2 rounded text-xs font-mono bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-900/60 text-red-700 dark:text-red-400">
          ERRO // {erro}
        </div>
      )}

      {/* Painel de Controle de Entrada */}
      <SurfaceCard className="p-3.5 space-y-2.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] font-semibold text-slate-500 dark:text-zinc-400 w-28 shrink-0">
            DIRETÓRIO ALVO:
          </span>
          <input
            type="text"
            value={pasta}
            disabled={status.monitorando}
            onChange={(e) => setPasta(e.target.value)}
            className="flex-1 rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 px-2.5 py-1.5 font-mono text-xs text-slate-800 dark:text-zinc-200 disabled:opacity-50"
          />
          <button
            onClick={selecionarPasta}
            disabled={status.monitorando}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 disabled:opacity-40 text-xs font-medium text-slate-700 dark:text-zinc-300 cursor-pointer"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            <span>SELECIONAR</span>
          </button>
        </div>

        <div className="flex flex-wrap gap-4 text-xs font-mono text-slate-700 dark:text-zinc-300 pt-1">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={usarPai}
              onChange={(e) => setUsarPai(e.target.checked)}
              className="rounded accent-blue-600"
            />
            <span>Usar pasta pai (BOLSINHAS) como 'já feitas'</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={apagarRepetido}
              onChange={(e) => setApagarRepetido(e.target.checked)}
              className="rounded accent-blue-600"
            />
            <span>Apagar TIFF repetido (em vez de mover p/ REPETIDAS)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={som}
              onChange={(e) => setSom(e.target.checked)}
              className="rounded accent-blue-600"
            />
            <span>Alerta sonoro</span>
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-zinc-800">
          <button
            onClick={alternar}
            className={`flex items-center gap-2 px-4 py-1.5 rounded text-xs font-semibold text-white cursor-pointer transition-all ${
              status.monitorando
                ? "bg-red-600 hover:bg-red-500 shadow-2xs"
                : "bg-emerald-600 hover:bg-emerald-500 shadow-2xs"
            }`}
          >
            {status.monitorando ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span>{status.monitorando ? "PARAR MONITOR" : "INICIAR MONITOR"}</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={() => executarVarredura(false)}
              disabled={status.varrendo}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 disabled:opacity-40 text-xs font-mono font-medium text-slate-700 dark:text-zinc-300 cursor-pointer"
            >
              <Search className="w-3.5 h-3.5" />
              <span>VARREDURA (RELATÓRIO)</span>
            </button>
            <button
              onClick={() => executarVarredura(true)}
              disabled={status.varrendo}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-amber-600 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-xs font-mono font-semibold text-white cursor-pointer shadow-2xs"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>VARREDURA + MOVER</span>
            </button>
          </div>
        </div>
      </SurfaceCard>

      {/* Telemetria */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
        <StatCard label="NOVAS (10%)" value={counters.novas} tone="emerald" />
        <StatCard label="ARTE ATUALIZADA" value={counters.atualizadas} tone="sky" />
        <StatCard label="REPETIDAS" value={counters.repetidas} tone="amber" />
        <StatCard label="JÁ FEITAS" value={counters.ja_feitas} tone="zinc" />
        <StatCard label="FALHAS" value={counters.erros} tone="red" />
      </div>

      <TerminalLog lines={logs} emptyText="Aguardando eventos de bolsinhas..." logRef={logRef} onClear={() => setLogs([])} />
    </div>
  );
}
