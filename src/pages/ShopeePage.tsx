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
    <div className="p-6 h-full flex flex-col gap-4 max-w-7xl mx-auto">
      <PageHeader
        icon={<PackageCheck className="w-5 h-5 text-orange-500 dark:text-orange-400" />}
        title="Fichas Shopee"
        subtitle="Pareia PDFs da Shopee com fotos do WhatsApp por horário, monta na Declaração de Conteúdo e salva em PRONTOS/."
        right={
          <StatusBadge
            active={status.monitorando || status.executando}
            activeText={status.executando ? "Gerando..." : "Observando"}
            tone={status.executando ? "amber" : "emerald"}
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
          <span className="text-xs text-slate-500 dark:text-zinc-400 w-28 shrink-0">
            Pasta das fichas
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

        <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5 text-xs">
          <div>
            <label className="block text-slate-500 dark:text-zinc-400 mb-1">Tolerância (min)</label>
            <input
              type="text"
              value={tolerancia}
              disabled={status.monitorando}
              onChange={(e) => setTolerancia(e.target.value)}
              className="w-full rounded-xl bg-slate-50 dark:bg-[#0b0b12] border border-slate-200 dark:border-white/10 px-2.5 py-1.5 text-slate-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-slate-500 dark:text-zinc-400 mb-1">Página PDF</label>
            <input
              type="text"
              value={pagina}
              disabled={status.monitorando}
              onChange={(e) => setPagina(e.target.value)}
              className="w-full rounded-xl bg-slate-50 dark:bg-[#0b0b12] border border-slate-200 dark:border-white/10 px-2.5 py-1.5 text-slate-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-slate-500 dark:text-zinc-400 mb-1">DPI JPEG</label>
            <input
              type="text"
              value={dpi}
              disabled={status.monitorando}
              onChange={(e) => setDpi(e.target.value)}
              className="w-full rounded-xl bg-slate-50 dark:bg-[#0b0b12] border border-slate-200 dark:border-white/10 px-2.5 py-1.5 text-slate-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-slate-500 dark:text-zinc-400 mb-1">Margem (pt)</label>
            <input
              type="text"
              value={margem}
              disabled={status.monitorando}
              onChange={(e) => setMargem(e.target.value)}
              className="w-full rounded-xl bg-slate-50 dark:bg-[#0b0b12] border border-slate-200 dark:border-white/10 px-2.5 py-1.5 text-slate-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-slate-500 dark:text-zinc-400 mb-1">Espaço (pt)</label>
            <input
              type="text"
              value={espaco}
              disabled={status.monitorando}
              onChange={(e) => setEspaco(e.target.value)}
              className="w-full rounded-xl bg-slate-50 dark:bg-[#0b0b12] border border-slate-200 dark:border-white/10 px-2.5 py-1.5 text-slate-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-slate-500 dark:text-zinc-400 mb-1">Layout</label>
            <select
              value={layout}
              disabled={status.monitorando}
              onChange={(e) =>
                setLayout(e.target.value === "lado_a_lado" ? "lado_a_lado" : "empilhado")
              }
              className="w-full rounded-xl bg-slate-50 dark:bg-[#0b0b12] border border-slate-200 dark:border-white/10 px-2.5 py-1.5 text-slate-900 dark:text-white"
            >
              <option value="empilhado" className="bg-white dark:bg-[#151521]">
                Empilhado
              </option>
              <option value="lado_a_lado" className="bg-white dark:bg-[#151521]">
                Lado a lado
              </option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            onClick={alternarMonitor}
            disabled={status.executando}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-white cursor-pointer transition-all ${
              status.monitorando
                ? "bg-red-600 hover:bg-red-500 shadow-sm"
                : "bg-emerald-600 hover:bg-emerald-500 shadow-sm"
            }`}
          >
            {status.monitorando ? (
              <Square className="w-3.5 h-3.5" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            {status.monitorando ? "Parar Monitor" : "Observar Pasta"}
          </button>

          <button
            onClick={executarUmaVez}
            disabled={status.monitorando || status.executando}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer shadow-sm"
          >
            <Zap className="w-3.5 h-3.5" />
            Executar uma vez
          </button>

          <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-zinc-200 cursor-pointer ml-2">
            <input
              type="checkbox"
              checked={refazer}
              disabled={status.monitorando}
              onChange={(e) => setRefazer(e.target.checked)}
              className="rounded accent-orange-600"
            />
            <span className="inline-flex items-center gap-1">
              <RefreshCw className="w-3 h-3 text-slate-400" />
              Gerar todas novamente (zerar registro)
            </span>
          </label>
        </div>
      </SurfaceCard>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
        <StatCard label="✔ Geradas" value={counters.geradas} tone="emerald" />
        <StatCard label="↻ Refeitas" value={counters.refeitas} tone="sky" />
        <StatCard label="⚠ Sem imagem" value={counters.sem_imagem} tone="amber" />
        <StatCard label="🖼 Sobrando" value={counters.sobrando} tone="zinc" />
        <StatCard label="✘ Erros" value={counters.erros} tone="red" />
      </div>

      <TerminalLog
        lines={logs}
        emptyText="Selecione a pasta com os PDFs e fotos da Shopee e clique em Observar ou Executar uma vez."
        logRef={logRef}
      />
    </div>
  );
}
