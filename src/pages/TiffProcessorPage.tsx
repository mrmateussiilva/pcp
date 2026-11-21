import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Play, Printer, Square } from "lucide-react";
import { PageHeader, StatCard, StatusBadge, SurfaceCard, TerminalLog } from "../components/ui";

interface TiffCounters {
  ok: number;
  skip: number;
  err: number;
  tot: number;
}

interface TiffStatus {
  monitorando: boolean;
  pasta: string;
  add_name: boolean;
}

interface TiffDebugItem {
  name: string;
  client: string;
  mode: string;
  dpi: number;
  icc: boolean;
  rotated: boolean;
  name_added: boolean;
  width_px: number;
  height_px: number;
  width_cm: number;
  height_cm: number;
  output: string;
  thumb_base64: string | null;
}

export function TiffProcessorPage() {
  const [pasta, setPasta] = useState("");
  const [addName, setAddName] = useState(true);
  const [monitorando, setMonitorando] = useState(false);
  const [counters, setCounters] = useState<TiffCounters>({ ok: 0, skip: 0, err: 0, tot: 0 });
  const [logs, setLogs] = useState<string[]>([]);
  const [debugItems, setDebugItems] = useState<TiffDebugItem[]>([]);
  const [aba, setAba] = useState<"monitor" | "grid">("monitor");
  const [erro, setErro] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    invoke<string>("tiff_pasta_inicial").then((p) => {
      if (p) setPasta(p);
    });
    invoke<TiffStatus>("tiff_status").then((st) => {
      setMonitorando(st.monitorando);
      if (st.pasta) setPasta(st.pasta);
      setAddName(st.add_name);
    });
    invoke<TiffCounters>("tiff_counters").then(setCounters);

    const unStatus = listen<TiffStatus>("tiff-status", (e) => {
      setMonitorando(e.payload.monitorando);
    });
    const unCnt = listen<TiffCounters>("tiff-counters", (e) => setCounters(e.payload));
    const unLog = listen<string>("tiff-log", (e) => {
      const ts = new Date().toLocaleTimeString("pt-BR");
      setLogs((prev) => [...prev.slice(-1500), `[${ts}]  ${e.payload}`]);
    });
    const unDbg = listen<TiffDebugItem>("tiff-debug", (e) => {
      setDebugItems((prev) => [e.payload, ...prev.slice(0, 100)]);
    });

    return () => {
      unStatus.then((fn) => fn());
      unCnt.then((fn) => fn());
      unLog.then((fn) => fn());
      unDbg.then((fn) => fn());
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
      if (monitorando) {
        await invoke("tiff_parar");
      } else {
        await invoke("tiff_iniciar", { pasta, addName });
      }
    } catch (e) {
      setErro(String(e));
    }
  };

  const toggleAddName = async (v: boolean) => {
    setAddName(v);
    await invoke("tiff_set_add_name", { addName: v });
  };

  return (
    <div className="p-5 h-full flex flex-col gap-3.5 max-w-7xl mx-auto">
      <PageHeader
        icon={<Printer className="w-4 h-4 text-slate-700 dark:text-zinc-300" />}
        title="TIFF Processor // RIP de Entrada"
        badge="RIP-01"
        subtitle="Monitora pasta: rotação 90° se ~155cm, contorno 1px, padding inferior 1cm e preservação de DPI/ICC."
        right={<StatusBadge active={monitorando} activeText="WATCHER ATIVO" idleText="PARADO" />}
      />

      {erro && (
        <div className="px-3.5 py-2 rounded text-xs font-mono bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-900/60 text-red-700 dark:text-red-400">
          ERRO // {erro}
        </div>
      )}

      {/* Barra de Instrumentação */}
      <SurfaceCard className="p-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="font-mono text-[11px] font-semibold text-slate-500 dark:text-zinc-400">
            PATH:
          </span>
          <input
            type="text"
            value={pasta}
            readOnly
            className="flex-1 min-w-56 rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 px-2.5 py-1.5 font-mono text-xs text-slate-800 dark:text-zinc-200"
          />
          <button
            onClick={selecionarPasta}
            disabled={monitorando}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 disabled:opacity-40 text-xs font-medium text-slate-700 dark:text-zinc-300 cursor-pointer transition-colors"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            <span>SELECIONAR</span>
          </button>

          <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-zinc-300 cursor-pointer px-2 border-l border-slate-200 dark:border-zinc-800">
            <input
              type="checkbox"
              checked={addName}
              onChange={(e) => toggleAddName(e.target.checked)}
              className="rounded accent-blue-600"
            />
            <span className="font-mono text-[11px]">NOME NO PADDING</span>
          </label>

          <button
            onClick={alternar}
            className={`flex items-center gap-2 px-4 py-1.5 rounded text-xs font-semibold text-white cursor-pointer transition-all ${
              monitorando
                ? "bg-red-600 hover:bg-red-500 shadow-2xs"
                : "bg-emerald-600 hover:bg-emerald-500 shadow-2xs"
            }`}
          >
            {monitorando ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span>{monitorando ? "PARAR MONITOR" : "INICIAR MONITOR"}</span>
          </button>
        </div>
      </SurfaceCard>

      {/* Telemetria Numérica */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <StatCard label="PROCESSADOS" value={counters.ok} tone="emerald" />
        <StatCard label="DUPLICADOS" value={counters.skip} tone="amber" />
        <StatCard label="ERROS DE ARTE" value={counters.err} tone="red" />
        <StatCard label="LOTES COMPLETOS" value={counters.tot} tone="sky" />
      </div>

      {/* Tabs */}
      <div className="inline-flex p-0.5 rounded border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-900 self-start gap-1 font-mono text-xs">
        <button
          onClick={() => setAba("monitor")}
          className={`px-3 py-1 rounded cursor-pointer transition-colors ${
            aba === "monitor"
              ? "bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 font-semibold shadow-2xs"
              : "text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white"
          }`}
        >
          LOG DO WATCHER
        </button>
        <button
          onClick={() => setAba("grid")}
          className={`px-3 py-1 rounded cursor-pointer transition-colors ${
            aba === "grid"
              ? "bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 font-semibold shadow-2xs"
              : "text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white"
          }`}
        >
          GRID DE INSPEÇÃO ({debugItems.length})
        </button>
      </div>

      {aba === "monitor" ? (
        <TerminalLog
          lines={logs}
          emptyText="Aguardando inicialização do watcher..."
          logRef={logRef}
          onClear={() => setLogs([])}
        />
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {debugItems.map((it, idx) => (
            <SurfaceCard key={idx} className="p-3 flex flex-col gap-2">
              {it.thumb_base64 && (
                <div className="h-28 w-full rounded border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-950 flex items-center justify-center overflow-hidden">
                  <img
                    src={`data:image/png;base64,${it.thumb_base64}`}
                    alt={it.name}
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
              )}
              <div className="font-mono text-xs font-bold text-slate-900 dark:text-white truncate" title={it.name}>
                {it.name}
              </div>
              <div className="font-mono text-[10px] text-slate-500 dark:text-zinc-400 space-y-0.5">
                <div>CLIENTE: <span className="text-slate-800 dark:text-zinc-200 font-semibold">{it.client || "—"}</span></div>
                <div>
                  {it.width_cm.toFixed(1)} × {it.height_cm.toFixed(1)} cm ({it.dpi.toFixed(0)} DPI)
                </div>
                <div className="flex gap-2">
                  <span>ICC: {it.icc ? "SIM" : "NÃO"}</span>
                  <span>|</span>
                  <span>ROT: {it.rotated ? "90°" : "0°"}</span>
                </div>
              </div>
            </SurfaceCard>
          ))}
        </div>
      )}
    </div>
  );
}
