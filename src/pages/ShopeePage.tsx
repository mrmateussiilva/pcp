import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, PackageCheck, Play, RefreshCw, Square, Zap } from "lucide-react";
import { PageHeader, StatCard, StatusBadge, SurfaceCard, TerminalLog } from "../components/ui";

interface ShopeeOpcoes {
  pasta: string;
  tolerancia_min: number;
  pagina: number;
  dpi: number;
  margem: number;
  espaco: number;
  layout: string;
}

interface ShopeeCounters {
  geradas: number;
  refeitas: number;
  erros: number;
  sem_imagem: number;
  sobrando: number;
}

interface ShopeeStatus {
  monitorando: boolean;
  executando: boolean;
}

export function ShopeePage() {
  const [pasta, setPasta] = useState("");
  const [tolerancia, setTolerancia] = useState("2");
  const [pagina, setPagina] = useState("2");
  const [dpi, setDpi] = useState("200");
  const [margem, setMargem] = useState("20");
  const [espaco, setEspaco] = useState("8");
  const [layout, setLayout] = useState<"empilhado" | "lado_a_lado">("empilhado");
  const [refazer, setRefazer] = useState(false);

  const [status, setStatus] = useState<ShopeeStatus>({
    monitorando: false,
    executando: false,
  });
  const [counters, setCounters] = useState<ShopeeCounters>({
    geradas: 0,
    refeitas: 0,
    erros: 0,
    sem_imagem: 0,
    sobrando: 0,
  });
  const [logs, setLogs] = useState<string[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    invoke<ShopeeOpcoes>("shopee_get_config").then((cfg) => {
      setPasta(cfg.pasta || "");
      setTolerancia(String(cfg.tolerancia_min ?? 2));
      setPagina(String(cfg.pagina ?? 2));
      setDpi(String(cfg.dpi ?? 200));
      setMargem(String(cfg.margem ?? 20));
      setEspaco(String(cfg.espaco ?? 8));
      setLayout(cfg.layout === "lado_a_lado" ? "lado_a_lado" : "empilhado");
    });
    invoke<ShopeeStatus>("shopee_status").then(setStatus);
    invoke<ShopeeCounters>("shopee_counters").then(setCounters);

    const unSt = listen<ShopeeStatus>("shopee-status", (e) => setStatus(e.payload));
    const unCnt = listen<ShopeeCounters>("shopee-counters", (e) => setCounters(e.payload));
    const unLog = listen<string>("shopee-log", (e) => {
      const ts = new Date().toLocaleTimeString("pt-BR");
      setLogs((prev) => [...prev.slice(-1500), `[${ts}]  ${e.payload}`]);
    });

    return () => {
      unSt.then((fn) => fn());
      unCnt.then((fn) => fn());
      unLog.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const montarOpcoes = (): ShopeeOpcoes => ({
    pasta,
    tolerancia_min: Math.max(1, Number(tolerancia) || 2),
    pagina: Math.max(1, Number(pagina) || 2),
    dpi: Math.max(72, Number(dpi) || 200),
    margem: Number(margem) || 20,
    espaco: Number(espaco) || 8,
    layout,
  });

  const selecionarPasta = async () => {
    const dir = await open({ directory: true, defaultPath: pasta || undefined });
    if (typeof dir === "string") setPasta(dir);
  };

  const alternarMonitor = async () => {
    setErro(null);
    try {
      if (status.monitorando) {
        await invoke("shopee_parar");
      } else {
        await invoke("shopee_iniciar", { opcoes: montarOpcoes(), refazer });
      }
    } catch (e) {
      setErro(String(e));
    }
  };

  const executarUmaVez = async () => {
    setErro(null);
    try {
      await invoke("shopee_executar_uma_vez", { opcoes: montarOpcoes(), refazer });
    } catch (e) {
      setErro(String(e));
    }
  };

  return (
    <div className="p-5 h-full flex flex-col gap-3.5 max-w-7xl mx-auto">
      <PageHeader
        icon={<PackageCheck className="w-4 h-4 text-slate-700 dark:text-zinc-300" />}
        title="Fichas Shopee // Pareamento e Renderização"
        badge="DOC-05"
        subtitle="Pareia PDFs com fotos do WhatsApp por carimbo de horário, renderiza na Declaração de Conteúdo e gera PRONTOS/."
        right={
          <StatusBadge
            active={status.monitorando || status.executando}
            activeText={status.executando ? "RENDERIZANDO..." : "OBSERVANDO"}
            tone={status.executando ? "amber" : "emerald"}
          />
        }
      />

      {erro && (
        <div className="px-3.5 py-2 rounded text-xs font-mono bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-900/60 text-red-700 dark:text-red-400">
          ERRO // {erro}
        </div>
      )}

      {/* Parâmetros do Scanner */}
      <SurfaceCard className="p-3.5 space-y-2.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] font-semibold text-slate-500 dark:text-zinc-400 w-28 shrink-0">
            DIRETÓRIO:
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

        <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-xs font-mono pt-1">
          <div>
            <label className="block text-[10px] font-semibold text-slate-500 dark:text-zinc-400 mb-1">TOLERÂNCIA</label>
            <div className="relative flex items-center">
              <input
                type="text"
                value={tolerancia}
                disabled={status.monitorando}
                onChange={(e) => setTolerancia(e.target.value)}
                className="w-full rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 px-2 py-1 text-xs text-slate-900 dark:text-white"
              />
              <span className="absolute right-2 text-[10px] text-slate-400">min</span>
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-slate-500 dark:text-zinc-400 mb-1">PÁGINA PDF</label>
            <input
              type="text"
              value={pagina}
              disabled={status.monitorando}
              onChange={(e) => setPagina(e.target.value)}
              className="w-full rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 px-2 py-1 text-xs text-slate-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-slate-500 dark:text-zinc-400 mb-1">RESOLUÇÃO</label>
            <div className="relative flex items-center">
              <input
                type="text"
                value={dpi}
                disabled={status.monitorando}
                onChange={(e) => setDpi(e.target.value)}
                className="w-full rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 px-2 py-1 text-xs text-slate-900 dark:text-white"
              />
              <span className="absolute right-2 text-[10px] text-slate-400">DPI</span>
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-slate-500 dark:text-zinc-400 mb-1">MARGEM</label>
            <div className="relative flex items-center">
              <input
                type="text"
                value={margem}
                disabled={status.monitorando}
                onChange={(e) => setMargem(e.target.value)}
                className="w-full rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 px-2 py-1 text-xs text-slate-900 dark:text-white"
              />
              <span className="absolute right-2 text-[10px] text-slate-400">pt</span>
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-slate-500 dark:text-zinc-400 mb-1">ESPAÇO</label>
            <div className="relative flex items-center">
              <input
                type="text"
                value={espaco}
                disabled={status.monitorando}
                onChange={(e) => setEspaco(e.target.value)}
                className="w-full rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 px-2 py-1 text-xs text-slate-900 dark:text-white"
              />
              <span className="absolute right-2 text-[10px] text-slate-400">pt</span>
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-slate-500 dark:text-zinc-400 mb-1">LAYOUT</label>
            <select
              value={layout}
              disabled={status.monitorando}
              onChange={(e) =>
                setLayout(e.target.value === "lado_a_lado" ? "lado_a_lado" : "empilhado")
              }
              className="w-full rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 px-2 py-1 text-xs text-slate-900 dark:text-white"
            >
              <option value="empilhado" className="bg-white dark:bg-[#111115]">
                EMPILHADO
              </option>
              <option value="lado_a_lado" className="bg-white dark:bg-[#111115]">
                LADO A LADO
              </option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <button
              onClick={alternarMonitor}
              disabled={status.executando}
              className={`flex items-center gap-2 px-4 py-1.5 rounded text-xs font-semibold text-white cursor-pointer transition-all ${
                status.monitorando
                  ? "bg-red-600 hover:bg-red-500 shadow-2xs"
                  : "bg-emerald-600 hover:bg-emerald-500 shadow-2xs"
              }`}
            >
              {status.monitorando ? (
                <Square className="w-3.5 h-3.5" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              <span>{status.monitorando ? "PARAR MONITOR" : "OBSERVAR PASTA"}</span>
            </button>

            <button
              onClick={executarUmaVez}
              disabled={status.monitorando || status.executando}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 disabled:opacity-40 text-xs font-mono font-medium text-slate-700 dark:text-zinc-300 cursor-pointer"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>EXECUTAR LOTE UMA VEZ</span>
            </button>
          </div>

          <label className="flex items-center gap-2 text-xs font-mono text-slate-700 dark:text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={refazer}
              disabled={status.monitorando}
              onChange={(e) => setRefazer(e.target.checked)}
              className="rounded accent-blue-600"
            />
            <span className="inline-flex items-center gap-1">
              <RefreshCw className="w-3 h-3 text-slate-400" />
              Zerar cache de fichas geradas
            </span>
          </label>
        </div>
      </SurfaceCard>

      {/* Telemetria */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
        <StatCard label="GERADAS" value={counters.geradas} tone="emerald" />
        <StatCard label="REFEITAS" value={counters.refeitas} tone="sky" />
        <StatCard label="SEM IMAGEM" value={counters.sem_imagem} tone="amber" />
        <StatCard label="FOTOS SOBRANDO" value={counters.sobrando} tone="zinc" />
        <StatCard label="FALHAS" value={counters.erros} tone="red" />
      </div>

      <TerminalLog
        lines={logs}
        emptyText="Aguardando arquivos Shopee..."
        logRef={logRef}
        onClear={() => setLogs([])}
      />
    </div>
  );
}
