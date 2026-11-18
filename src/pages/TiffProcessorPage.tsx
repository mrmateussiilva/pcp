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
    <div className="p-6 h-full flex flex-col gap-4 max-w-7xl mx-auto">
      <PageHeader
        icon={<Printer className="w-5 h-5 text-sky-500 dark:text-sky-400" />}
        title="TIFF Processor"
        subtitle="Monitora pasta: rotação 90°, contorno 1px, padding 1cm, nome do cliente e log global."
        right={<StatusBadge active={monitorando} activeText="Monitorando" />}
      />

      {erro && (
        <div className="px-4 py-2.5 rounded-xl text-xs bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300">
          {erro}
        </div>
      )}

      <SurfaceCard className="p-4 flex flex-wrap items-center gap-3">
        <span className="text-xs text-slate-500 dark:text-zinc-400">Pasta monitorada</span>
        <input
          type="text"
          value={pasta}
          readOnly
          className="flex-1 min-w-56 rounded-xl bg-slate-50 dark:bg-[#0b0b12] border border-slate-200 dark:border-white/10 px-3 py-2 text-xs text-slate-900 dark:text-white"
        />
        <button
          onClick={selecionarPasta}
          disabled={monitorando}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-white/[0.07] hover:bg-slate-200 dark:hover:bg-white/15 disabled:opacity-50 text-xs font-medium text-slate-700 dark:text-zinc-200 cursor-pointer"
        >
          <FolderOpen className="w-4 h-4" />
          Selecionar
        </button>

        <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-zinc-200 cursor-pointer px-2">
          <input
            type="checkbox"
            checked={addName}
            onChange={(e) => toggleAddName(e.target.checked)}
            className="rounded accent-blue-600"
          />
          Nome do cliente
        </label>

        <button
          onClick={alternar}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-white cursor-pointer transition-all ${
            monitorando
              ? "bg-red-600 hover:bg-red-500 shadow-sm"
              : "bg-emerald-600 hover:bg-emerald-500 shadow-sm"
          }`}
        >
          {monitorando ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          {monitorando ? "Parar Monitor" : "Iniciar Monitor"}
        </button>
      </SurfaceCard>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="✔ Processados" value={counters.ok} tone="emerald" />
        <StatCard label="📦 Duplicados" value={counters.skip} tone="amber" />
        <StatCard label="✘ Erros" value={counters.err} tone="red" />
        <StatCard label="📦 Lotes" value={counters.tot} tone="sky" />
      </div>

      <div className="inline-flex p-1 rounded-xl bg-slate-100 dark:bg-[#151521] border border-slate-200 dark:border-white/[0.06] self-start gap-1">
        <button
          onClick={() => setAba("monitor")}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
            aba === "monitor"
              ? "bg-white dark:bg-blue-600 text-slate-900 dark:text-white shadow-xs"
              : "text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white"
          }`}
        >
          Monitor & Log
        </button>
        <button
          onClick={() => setAba("grid")}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
            aba === "grid"
              ? "bg-white dark:bg-blue-600 text-slate-900 dark:text-white shadow-xs"
              : "text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white"
          }`}
        >
          Grid de Arquivos ({debugItems.length})
        </button>
      </div>

      {aba === "monitor" ? (
        <TerminalLog
          lines={logs}
          emptyText="Aguardando início do monitoramento..."
          logRef={logRef}
        />
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {debugItems.map((it, idx) => (
            <SurfaceCard key={idx} className="p-3.5 flex flex-col gap-2">
              {it.thumb_base64 && (
                <img
                  src={`data:image/png;base64,${it.thumb_base64}`}
                  alt={it.name}
                  className="h-32 w-full object-contain rounded-lg bg-slate-100 dark:bg-[#0b0b12]"
                />
              )}
              <div className="text-xs font-bold text-slate-900 dark:text-white truncate" title={it.name}>
                {it.name}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-zinc-400 space-y-0.5">
                <div>Cliente: {it.client || "—"}</div>
                <div>
                  {it.width_cm.toFixed(1)} × {it.height_cm.toFixed(1)} cm ({it.dpi.toFixed(0)} DPI)
                </div>
                <div>
                  ICC: {it.icc ? "sim" : "não"} | Rot: {it.rotated ? "sim" : "não"}
                </div>
              </div>
            </SurfaceCard>
          ))}
        </div>
      )}
    </div>
  );
}
