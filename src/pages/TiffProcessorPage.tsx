import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Check,
  FolderOpen,
  Loader2,
  Play,
  Printer,
  Sliders,
  Square,
  Zap,
} from "lucide-react";
import {
  PageHeader,
  StatCard,
  StatusBadge,
  SurfaceCard,
  TerminalLog,
} from "../components/ui";
import { usePageShortcuts } from "../hooks/useShortcuts";

interface TiffCounters {
  ok: number;
  skip: number;
  err: number;
  tot: number;
}

interface TiffConfig {
  pasta: string;
  pasta_saida: string;
  target_width_cm: number;
  tolerancia_cm: number;
  pad_cm: number;
  borda_px: number;
  add_name: boolean;
}

interface TiffStatus {
  monitorando: boolean;
  pasta: string;
  config: TiffConfig;
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

interface TiffLoteSummary {
  processados: usize;
  duplicados: usize;
  erros: usize;
  total: usize;
}
type usize = number;

export function TiffProcessorPage() {
  const [config, setConfig] = useState<TiffConfig>({
    pasta: "",
    pasta_saida: "",
    target_width_cm: 155.0,
    tolerancia_cm: 1.5,
    pad_cm: 1.0,
    borda_px: 1,
    add_name: true,
  });

  const [monitorando, setMonitorando] = useState(false);
  const [processandoLote, setProcessandoLote] = useState(false);
  const [counters, setCounters] = useState<TiffCounters>({
    ok: 0,
    skip: 0,
    err: 0,
    tot: 0,
  });
  const [logs, setLogs] = useState<string[]>([]);
  const [debugItems, setDebugItems] = useState<TiffDebugItem[]>([]);
  const [aba, setAba] = useState<"monitor" | "grid">("monitor");
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    invoke<TiffConfig>("tiff_get_config").then((cfg) => {
      setConfig((prev) => ({ ...prev, ...cfg }));
    });

    invoke<TiffStatus>("tiff_status").then((st) => {
      setMonitorando(st.monitorando);
      if (st.config) {
        setConfig((prev) => ({ ...prev, ...st.config }));
      }
    });

    invoke<TiffCounters>("tiff_counters").then(setCounters);

    const unStatus = listen<TiffStatus>("tiff-status", (e) => {
      setMonitorando(e.payload.monitorando);
    });
    const unCnt = listen<TiffCounters>("tiff-counters", (e) =>
      setCounters(e.payload)
    );
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

  const atualizarConfig = (patch: Partial<TiffConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...patch };
      invoke("tiff_save_config", { config: next }).then(() => {
        setSalvo(true);
        setTimeout(() => setSalvo(false), 1200);
      });
      return next;
    });
  };

  const selecionarPastaEntrada = async () => {
    const dir = await open({
      directory: true,
      defaultPath: config.pasta || undefined,
    });
    if (typeof dir === "string") {
      atualizarConfig({ pasta: dir });
    }
  };

  const selecionarPastaSaida = async () => {
    const dir = await open({
      directory: true,
      defaultPath: config.pasta_saida || undefined,
    });
    if (typeof dir === "string") {
      atualizarConfig({ pasta_saida: dir });
    }
  };

  const alternarWatcher = async () => {
    setErro(null);
    try {
      if (monitorando) {
        await invoke("tiff_parar");
      } else {
        if (!config.pasta) {
          setErro("Selecione a pasta de entrada antes de iniciar o watcher.");
          return;
        }
        await invoke("tiff_iniciar", { config });
      }
    } catch (e) {
      setErro(String(e));
    }
  };

  const executarLoteAgora = async () => {
    if (processandoLote) return;
    if (!config.pasta) {
      setErro("Selecione a pasta de entrada para processar.");
      return;
    }
    setErro(null);
    setProcessandoLote(true);
    try {
      const res = await invoke<TiffLoteSummary>("tiff_processar_lote", {
        config,
      });
      const ts = new Date().toLocaleTimeString("pt-BR");
      setLogs((prev) => [
        ...prev,
        `[${ts}]  ✔ Lote concluído: ${res.processados} processados, ${res.duplicados} duplicados, ${res.erros} falhas.`,
      ]);
    } catch (e) {
      setErro(String(e));
    } finally {
      setProcessandoLote(false);
    }
  };

  usePageShortcuts([
    {
      id: "tiff-toggle",
      combo: "ctrl+enter",
      keys: "Ctrl+Enter",
      label: monitorando ? "Parar Watcher" : "Iniciar Watcher",
      action: alternarWatcher,
    },
    {
      id: "tiff-batch",
      combo: "ctrl+shift+enter",
      keys: "Ctrl+Shift+Enter",
      label: "Processar Lote Agora (Batch)",
      action: executarLoteAgora,
    },
    {
      id: "tiff-in-folder",
      combo: "ctrl+o",
      keys: "Ctrl+O",
      label: "Selecionar Pasta de Entrada",
      action: selecionarPastaEntrada,
    },
    {
      id: "tiff-out-folder",
      combo: "ctrl+shift+o",
      keys: "Ctrl+Shift+O",
      label: "Selecionar Pasta de Saída",
      action: selecionarPastaSaida,
    },
    {
      id: "tiff-clear",
      combo: "ctrl+l",
      keys: "Ctrl+L",
      label: "Limpar Terminal de Logs",
      action: () => setLogs([]),
    },
    {
      id: "tiff-tab1",
      combo: "alt+1",
      keys: "Alt+1",
      label: "Aba Terminal / Logs",
      action: () => setAba("monitor"),
    },
    {
      id: "tiff-tab2",
      combo: "alt+2",
      keys: "Alt+2",
      label: "Aba Grid de Inspeção",
      action: () => setAba("grid"),
    },
  ]);

  return (
    <div className="p-5 h-full flex flex-col gap-3.5 max-w-7xl mx-auto">
      <PageHeader
        icon={<Printer className="w-4 h-4 text-slate-700 dark:text-zinc-300" />}
        title="TIFF Processor // RIP de Entrada"
        badge="RIP-01"
        subtitle="Processamento e RIP: auto-rotação por largura alvo configurável, contorno 1px, padding inferior com nome e preservação de DPI/ICC."
        right={
          <div className="flex items-center gap-2">
            {processandoLote && (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded font-mono text-[11px] font-semibold bg-blue-100 dark:bg-blue-950/60 border border-blue-300 dark:border-blue-800 text-blue-700 dark:text-blue-300">
                <Loader2 className="w-3 h-3 animate-spin" />
                LOTE EM EXECUÇÃO
              </span>
            )}
            <StatusBadge
              active={monitorando}
              activeText="WATCHER ATIVO"
              idleText="WATCHER PARADO"
            />
          </div>
        }
      />

      {erro && (
        <div className="px-3.5 py-2 rounded text-xs font-mono bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-900/60 text-red-700 dark:text-red-400">
          ERRO // {erro}
        </div>
      )}

      {/* Painel Principal de Configuração e Instrumentação */}
      <SurfaceCard className="p-3.5 flex flex-col gap-3">
        {/* Linha 1: Pastas de Entrada e Saída */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {/* Pasta Entrada */}
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[10.5px] font-semibold text-slate-500 dark:text-zinc-400 flex items-center justify-between">
              <span>PASTA DE ENTRADA (WATCHER / LOTE):</span>
              <kbd className="text-[9px] text-slate-400 dark:text-zinc-500">Ctrl+O</kbd>
            </span>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={config.pasta}
                readOnly
                placeholder="Selecione a pasta de entrada..."
                className="flex-1 rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 px-2.5 py-1 font-mono text-xs text-slate-800 dark:text-zinc-200 truncate"
              />
              <button
                onClick={selecionarPastaEntrada}
                disabled={monitorando || processandoLote}
                className="flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 disabled:opacity-40 text-xs font-medium text-slate-700 dark:text-zinc-300 cursor-pointer"
                title="Selecionar pasta de entrada"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>BUSCAR</span>
              </button>
            </div>
          </div>

          {/* Pasta Saída */}
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[10.5px] font-semibold text-slate-500 dark:text-zinc-400 flex items-center justify-between">
              <span>PASTA DE SAÍDA (DESTINO):</span>
              <span className="text-[9px] text-slate-400 dark:text-zinc-500">
                {config.pasta_saida ? "Pasta Personalizada" : "Automático (../)"}
              </span>
            </span>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={config.pasta_saida}
                readOnly
                placeholder="Automático: salva na pasta pai da entrada (../)"
                className="flex-1 rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 px-2.5 py-1 font-mono text-xs text-slate-800 dark:text-zinc-200 truncate placeholder:text-slate-400 placeholder:italic"
              />
              {config.pasta_saida && (
                <button
                  onClick={() => atualizarConfig({ pasta_saida: "" })}
                  className="px-2 py-1 rounded border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-800 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 text-xs font-mono text-slate-500 cursor-pointer"
                  title="Restaurar para pasta pai automática"
                >
                  AUTO
                </button>
              )}
              <button
                onClick={selecionarPastaSaida}
                disabled={monitorando || processandoLote}
                className="flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 disabled:opacity-40 text-xs font-medium text-slate-700 dark:text-zinc-300 cursor-pointer"
                title="Selecionar pasta de saída específica"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>DESTINO</span>
              </button>
            </div>
          </div>
        </div>

        {/* Linha 2: Parâmetros Flexíveis do Algoritmo */}
        <div className="p-2.5 rounded bg-slate-50/70 dark:bg-zinc-900/40 border border-slate-200/80 dark:border-zinc-800/80 flex flex-wrap items-center gap-4 text-xs font-mono">
          <div className="flex items-center gap-1 text-slate-700 dark:text-zinc-300">
            <Sliders className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            <span className="font-bold text-[11px] text-slate-900 dark:text-zinc-100">SETUP:</span>
          </div>

          {/* Largura Alvo */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-slate-600 dark:text-zinc-400">LARGURA ALVO:</span>
            <input
              type="number"
              step="0.5"
              min="50"
              max="500"
              value={config.target_width_cm}
              onChange={(e) =>
                atualizarConfig({ target_width_cm: parseFloat(e.target.value) || 155.0 })
              }
              className="w-16 rounded border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 py-0.5 text-xs text-slate-900 dark:text-white"
            />
            <span className="text-[11px] text-slate-500">cm</span>
            <div className="flex gap-1 ml-1">
              {[155, 160, 180].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => atualizarConfig({ target_width_cm: v })}
                  className={`px-1.5 py-0.5 rounded text-[10px] cursor-pointer transition-colors ${
                    config.target_width_cm === v
                      ? "bg-blue-600 text-white font-bold"
                      : "bg-slate-200 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 hover:bg-slate-300"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* Tolerância de rotação */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-slate-600 dark:text-zinc-400" title="Margem de aceitação para disparar a rotação">
              TOLERÂNCIA (±):
            </span>
            <input
              type="number"
              step="0.1"
              min="0.1"
              max="15.0"
              value={config.tolerancia_cm}
              onChange={(e) =>
                atualizarConfig({ tolerancia_cm: parseFloat(e.target.value) || 1.5 })
              }
              className="w-14 rounded border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 py-0.5 text-xs text-slate-900 dark:text-white"
            />
            <span className="text-[11px] text-slate-500">cm</span>
          </div>

          {/* Padding Inferior */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-slate-600 dark:text-zinc-400">PADDING:</span>
            <input
              type="number"
              step="0.5"
              min="0"
              max="20"
              value={config.pad_cm}
              onChange={(e) =>
                atualizarConfig({ pad_cm: parseFloat(e.target.value) || 0 })
              }
              className="w-14 rounded border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 py-0.5 text-xs text-slate-900 dark:text-white"
            />
            <span className="text-[11px] text-slate-500">cm</span>
          </div>

          {/* Borda da Arte */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-slate-600 dark:text-zinc-400">BORDA:</span>
            <select
              value={config.borda_px}
              onChange={(e) =>
                atualizarConfig({ borda_px: parseInt(e.target.value, 10) || 0 })
              }
              className="rounded border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 py-0.5 text-xs text-slate-900 dark:text-white"
            >
              <option value="1">1 px preto</option>
              <option value="2">2 px preto</option>
              <option value="0">Sem borda</option>
            </select>
          </div>

          {/* Nome no Padding */}
          <label className="flex items-center gap-1.5 text-[11px] text-slate-700 dark:text-zinc-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={config.add_name}
              onChange={(e) => atualizarConfig({ add_name: e.target.checked })}
              className="rounded accent-blue-600"
            />
            <span>NOME DO CLIENTE</span>
          </label>

          {salvo && (
            <span className="ml-auto text-[10px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
              <Check className="w-3 h-3" /> Salvo
            </span>
          )}
        </div>

        {/* Linha 3: Barra de Ações Operacionais */}
        <div className="flex flex-wrap items-center gap-2.5 pt-1">
          {/* Botão Watcher */}
          <button
            onClick={alternarWatcher}
            disabled={processandoLote}
            className={`flex items-center gap-2 px-4 py-1.5 rounded text-xs font-semibold text-white cursor-pointer transition-all ${
              monitorando
                ? "bg-red-600 hover:bg-red-500 shadow-2xs"
                : "bg-emerald-600 hover:bg-emerald-500 shadow-2xs"
            } disabled:opacity-40`}
          >
            {monitorando ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span>{monitorando ? "PARAR WATCHER" : "INICIAR WATCHER"}</span>
          </button>

          {/* Botão Batch / Processar Agora */}
          <button
            onClick={executarLoteAgora}
            disabled={processandoLote || !config.pasta}
            className="flex items-center gap-2 px-4 py-1.5 rounded text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-40 cursor-pointer shadow-2xs transition-all"
            title="Processa todos os TIFFs existentes na pasta de uma vez só (Ctrl+Shift+Enter)"
          >
            {processandoLote ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Zap className="w-3.5 h-3.5" />
            )}
            <span>{processandoLote ? "PROCESSANDO..." : "PROCESSAR AGORA (LOTE)"}</span>
          </button>

          <div className="ml-auto flex items-center gap-2 text-xs font-mono text-slate-500 dark:text-zinc-400">
            <span>
              Faixa de rotação:{" "}
              <strong className="text-slate-800 dark:text-zinc-200">
                {(config.target_width_cm - config.tolerancia_cm).toFixed(1)} ~{" "}
                {(config.target_width_cm + config.tolerancia_cm).toFixed(1)} cm
              </strong>
            </span>
          </div>
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
          LOG DO TERMINAL
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
          emptyText="Aguardando inicialização do watcher ou execução de lote manual..."
          logRef={logRef}
          onClear={() => setLogs([])}
        />
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {debugItems.length === 0 ? (
            <div className="col-span-full py-12 text-center font-mono text-xs text-slate-500 dark:text-zinc-400">
              NENHUM ARQUIVO PROCESSADO NESTA SESSÃO // INICIE O WATCHER OU CLIQUE EM 'PROCESSAR AGORA'
            </div>
          ) : (
            debugItems.map((it, idx) => (
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
                <div
                  className="font-mono text-xs font-bold text-slate-900 dark:text-white truncate"
                  title={it.name}
                >
                  {it.name}
                </div>
                <div className="font-mono text-[10px] text-slate-500 dark:text-zinc-400 space-y-0.5">
                  <div>
                    CLIENTE:{" "}
                    <span className="text-slate-800 dark:text-zinc-200 font-semibold">
                      {it.client || "—"}
                    </span>
                  </div>
                  <div>
                    {it.width_cm.toFixed(1)} × {it.height_cm.toFixed(1)} cm (
                    {it.dpi.toFixed(0)} DPI)
                  </div>
                  <div className="flex gap-2">
                    <span>ICC: {it.icc ? "SIM" : "NÃO"}</span>
                    <span>|</span>
                    <span className={it.rotated ? "text-blue-600 dark:text-blue-400 font-semibold" : ""}>
                      ROT: {it.rotated ? "90°" : "0°"}
                    </span>
                  </div>
                  <div className="truncate text-[9px] text-slate-400 dark:text-zinc-500" title={it.output}>
                    {it.output}
                  </div>
                </div>
              </SurfaceCard>
            ))
          )}
        </div>
      )}
    </div>
  );
}
