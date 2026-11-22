import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  AlertTriangle,
  Clock,
  ExternalLink,
  Eye,
  FileText,
  FolderOpen,
  ImageIcon,
  Loader2,
  PackageCheck,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  Sliders,
  Square,
  Terminal,
  X,
  Zap,
} from "lucide-react";
import { PageHeader, StatCard, StatusBadge, SurfaceCard, TerminalLog } from "../components/ui";
import { usePageShortcuts } from "../hooks/useShortcuts";

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

interface FichaPareamentoInfo {
  pdf_nome: string;
  pdf_hora: string;
  imagens_pareadas: string[];
  status: string;
  destino_jpeg: string | null;
}

interface ShopeeDiagnostico {
  total_pdfs: number;
  total_imagens: number;
  pareados: FichaPareamentoInfo[];
  sem_imagem: string[];
  sobrando: string[];
}

interface ShopeeProntoItem {
  nome_arquivo: string;
  caminho_jpeg: string;
  tamanho_bytes: number;
  modificado_str: string;
  largura: number;
  altura: number;
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

  const [mostrarConfig, setMostrarConfig] = useState(false);
  const [abaAtiva, setAbaAtiva] = useState<"console" | "prontos" | "pareamentos">("console");

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

  // Fichas prontas e miniaturas
  const [prontos, setProntos] = useState<ShopeeProntoItem[]>([]);
  const [carregandoProntos, setCarregandoProntos] = useState(false);
  const [buscaProntos, setBuscaProntos] = useState("");
  const [miniaturasCache, setMiniaturasCache] = useState<Record<string, string>>({});

  // Diagnóstico de pareamento
  const [diagnostico, setDiagnostico] = useState<ShopeeDiagnostico | null>(null);
  const [carregandoDiagnostico, setCarregandoDiagnostico] = useState(false);
  const [buscaPareamentos, setBuscaPareamentos] = useState("");

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
    if (logRef.current && abaAtiva === "console") {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs, abaAtiva]);

  // Carrega lista de fichas prontas ao abrir aba
  useEffect(() => {
    if (abaAtiva === "prontos" && pasta.trim()) {
      carregarProntos();
    } else if (abaAtiva === "pareamentos" && pasta.trim()) {
      carregarDiagnostico();
    }
  }, [abaAtiva, pasta]);

  const montarOpcoes = (): ShopeeOpcoes => ({
    pasta,
    tolerancia_min: Math.max(1, Number(tolerancia) || 2),
    pagina: Math.max(1, Number(pagina) || 2),
    dpi: Math.max(72, Number(dpi) || 200),
    margem: Number(margem) || 20,
    espaco: Number(espaco) || 8,
    layout,
  });

  const carregarProntos = async () => {
    if (!pasta.trim()) return;
    setCarregandoProntos(true);
    try {
      const itens = await invoke<ShopeeProntoItem[]>("shopee_listar_prontos", {
        pasta,
        limite: 64,
      });
      setProntos(itens);
    } catch {
      // Ignora erro
    } finally {
      setCarregandoProntos(false);
    }
  };

  const carregarDiagnostico = async () => {
    if (!pasta.trim()) return;
    setCarregandoDiagnostico(true);
    try {
      const diag = await invoke<ShopeeDiagnostico>("shopee_obter_diagnostico", {
        pasta,
        tolerancia_min: Math.max(1, Number(tolerancia) || 2),
      });
      setDiagnostico(diag);
    } catch {
      // Ignora erro
    } finally {
      setCarregandoDiagnostico(false);
    }
  };

  const carregarMiniaturaItem = async (caminho: string) => {
    if (miniaturasCache[caminho]) return;
    try {
      const b64 = await invoke<string>("shopee_carregar_miniatura", { caminho });
      setMiniaturasCache((prev) => ({ ...prev, [caminho]: b64 }));
    } catch {
      // Falha ao ler miniatura
    }
  };

  const selecionarPasta = async () => {
    const dir = await open({ directory: true, defaultPath: pasta || undefined });
    if (typeof dir === "string") {
      setPasta(dir);
      salvarConfig({ pasta: dir });
    }
  };

  const salvarConfig = async (overrides: Partial<ShopeeOpcoes> = {}) => {
    const payload: ShopeeOpcoes = {
      ...montarOpcoes(),
      ...overrides,
    };
    try {
      await invoke("shopee_save_config", { opcoes: payload });
    } catch (e) {
      setErro(String(e));
    }
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

  const zerarContadores = async () => {
    try {
      await invoke("shopee_reset_counters");
    } catch {
      // Ignora erro
    }
  };

  const abrirNoExplorer = (caminho: string) => {
    if (caminho) openPath(caminho);
  };

  usePageShortcuts([
    {
      id: "shopee-toggle",
      combo: "ctrl+enter",
      keys: "Ctrl+Enter",
      label: status.monitorando ? "Parar Monitoramento" : "Iniciar Monitoramento",
      action: alternarMonitor,
    },
    {
      id: "shopee-once",
      combo: "ctrl+r",
      keys: "Ctrl+R",
      label: "Executar Lote Uma Vez",
      action: executarUmaVez,
    },
    {
      id: "shopee-folder",
      combo: "ctrl+o",
      keys: "Ctrl+O",
      label: "Selecionar Pasta de Fichas",
      action: selecionarPasta,
    },
    {
      id: "shopee-clear",
      combo: "ctrl+l",
      keys: "Ctrl+L",
      label: "Limpar Logs",
      action: () => setLogs([]),
    },
    {
      id: "shopee-config",
      combo: "alt+1",
      keys: "Alt+1",
      label: "Alternar Parâmetros Técnicos",
      action: () => setMostrarConfig((v) => !v),
    },
    {
      id: "shopee-tab-log",
      combo: "alt+2",
      keys: "Alt+2",
      label: "Aba Console de Eventos",
      action: () => setAbaAtiva("console"),
    },
    {
      id: "shopee-tab-prontos",
      combo: "alt+3",
      keys: "Alt+3",
      label: "Aba Fichas Prontas",
      action: () => setAbaAtiva("prontos"),
    },
    {
      id: "shopee-tab-pareamentos",
      combo: "alt+4",
      keys: "Alt+4",
      label: "Aba Pareamento & Diagnóstico",
      action: () => setAbaAtiva("pareamentos"),
    },
  ]);

  const prontosFiltrados = useMemo(() => {
    if (!buscaProntos.trim()) return prontos;
    const t = buscaProntos.toLowerCase();
    return prontos.filter((p) => p.nome_arquivo.toLowerCase().includes(t));
  }, [prontos, buscaProntos]);

  const pareamentosFiltrados = useMemo(() => {
    if (!diagnostico) return [];
    if (!buscaPareamentos.trim()) return diagnostico.pareados;
    const t = buscaPareamentos.toLowerCase();
    return diagnostico.pareados.filter(
      (p) =>
        p.pdf_nome.toLowerCase().includes(t) ||
        p.imagens_pareadas.some((img) => img.toLowerCase().includes(t))
    );
  }, [diagnostico, buscaPareamentos]);

  return (
    <div className="p-5 h-full flex flex-col gap-3.5 max-w-7xl mx-auto select-none">
      <PageHeader
        icon={<PackageCheck className="w-4 h-4 text-slate-700 dark:text-zinc-300" />}
        title="Fichas Shopee // Pareamento e Renderização"
        badge="DOC-05"
        subtitle="Pareia PDFs com fotos do WhatsApp por carimbo de horário, renderiza na Declaração de Conteúdo e gera PRONTOS/."
        right={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMostrarConfig((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded border font-mono text-xs font-semibold cursor-pointer transition-colors ${
                mostrarConfig
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300"
                  : "border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800"
              }`}
              title="Configurações de tolerância de horário, DPI e margem (Alt+1)"
            >
              <Settings2 className="w-3.5 h-3.5" />
              <span>PARÂMETROS ({tolerancia}m / {dpi}DPI)</span>
            </button>

            <StatusBadge
              active={status.monitorando || status.executando}
              activeText={status.executando ? "RENDERIZANDO..." : "OBSERVANDO"}
              tone={status.executando ? "amber" : "emerald"}
            />
          </div>
        }
      />

      {erro && (
        <div className="px-3.5 py-2 rounded text-xs font-mono bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-900/60 text-red-700 dark:text-red-400 flex items-center justify-between">
          <span>ERRO // {erro}</span>
          <button onClick={() => setErro(null)} className="hover:text-red-900 cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Painel de Parâmetros Técnicos (Gaveta retrátil) */}
      {mostrarConfig && (
        <SurfaceCard className="p-4 border-blue-200 dark:border-blue-900/50 bg-blue-50/20 dark:bg-blue-950/10">
          <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-zinc-800 mb-3">
            <div className="flex items-center gap-2 font-mono text-xs font-bold text-slate-900 dark:text-white uppercase">
              <Sliders className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span>PARÂMETROS DE RENDERIZAÇÃO & PAREAMENTO HORÁRIO</span>
            </div>
            <button
              onClick={() => setMostrarConfig(false)}
              className="text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 text-xs font-mono">
            <div>
              <label className="block text-[10px] font-semibold text-slate-600 dark:text-zinc-400 mb-1">
                TOLERÂNCIA (MIN)
              </label>
              <div className="relative flex items-center">
                <input
                  type="number"
                  min="1"
                  max="60"
                  value={tolerancia}
                  disabled={status.monitorando}
                  onChange={(e) => {
                    setTolerancia(e.target.value);
                    salvarConfig({ tolerancia_min: Number(e.target.value) || 2 });
                  }}
                  className="w-full rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs text-slate-900 dark:text-white"
                />
                <span className="absolute right-2 text-[10px] text-slate-400">min</span>
              </div>
              <span className="text-[9px] text-slate-400 mt-0.5 block">
                Janela de tempo para casar PDF com fotos
              </span>
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-slate-600 dark:text-zinc-400 mb-1">
                PÁGINA PDF
              </label>
              <input
                type="number"
                min="1"
                max="10"
                value={pagina}
                disabled={status.monitorando}
                onChange={(e) => {
                  setPagina(e.target.value);
                  salvarConfig({ pagina: Number(e.target.value) || 2 });
                }}
                className="w-full rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs text-slate-900 dark:text-white"
              />
              <span className="text-[9px] text-slate-400 mt-0.5 block">
                Página 2 = Declaração de Conteúdo
              </span>
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-slate-600 dark:text-zinc-400 mb-1">
                RESOLUÇÃO (DPI)
              </label>
              <div className="relative flex items-center">
                <input
                  type="number"
                  min="72"
                  max="600"
                  step="50"
                  value={dpi}
                  disabled={status.monitorando}
                  onChange={(e) => {
                    setDpi(e.target.value);
                    salvarConfig({ dpi: Number(e.target.value) || 200 });
                  }}
                  className="w-full rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs text-slate-900 dark:text-white"
                />
                <span className="absolute right-2 text-[10px] text-slate-400">DPI</span>
              </div>
              <span className="text-[9px] text-slate-400 mt-0.5 block">
                200 DPI = nítido e ultra-rápido
              </span>
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-slate-600 dark:text-zinc-400 mb-1">
                MARGEM (PT)
              </label>
              <input
                type="number"
                min="0"
                max="100"
                value={margem}
                disabled={status.monitorando}
                onChange={(e) => {
                  setMargem(e.target.value);
                  salvarConfig({ margem: Number(e.target.value) || 20 });
                }}
                className="w-full rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs text-slate-900 dark:text-white"
              />
              <span className="text-[9px] text-slate-400 mt-0.5 block">
                Recuo lateral nas bordas da página
              </span>
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-slate-600 dark:text-zinc-400 mb-1">
                ESPAÇAMENTO (PT)
              </label>
              <input
                type="number"
                min="0"
                max="50"
                value={espaco}
                disabled={status.monitorando}
                onChange={(e) => {
                  setEspaco(e.target.value);
                  salvarConfig({ espaco: Number(e.target.value) || 8 });
                }}
                className="w-full rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs text-slate-900 dark:text-white"
              />
              <span className="text-[9px] text-slate-400 mt-0.5 block">
                Espaço entre múltiplas fotos
              </span>
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-slate-600 dark:text-zinc-400 mb-1">
                LAYOUT DE FOTOS
              </label>
              <select
                value={layout}
                disabled={status.monitorando}
                onChange={(e) => {
                  const val = e.target.value === "lado_a_lado" ? "lado_a_lado" : "empilhado";
                  setLayout(val);
                  salvarConfig({ layout: val });
                }}
                className="w-full rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs text-slate-900 dark:text-white"
              >
                <option value="empilhado">EMPILHADO</option>
                <option value="lado_a_lado">LADO A LADO</option>
              </select>
              <span className="text-[9px] text-slate-400 mt-0.5 block">
                Disposição ao parear 2+ fotos
              </span>
            </div>
          </div>
        </SurfaceCard>
      )}

      {/* Painel de Controle de Entrada */}
      <SurfaceCard className="p-3.5 space-y-2.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] font-semibold text-slate-500 dark:text-zinc-400 w-28 shrink-0">
            PASTA DAS FICHAS:
          </span>
          <input
            type="text"
            value={pasta}
            disabled={status.monitorando}
            onChange={(e) => setPasta(e.target.value)}
            placeholder="Caminho da pasta com PDFs e fotos do WhatsApp..."
            className="flex-1 rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 px-2.5 py-1.5 font-mono text-xs text-slate-800 dark:text-zinc-200 disabled:opacity-50"
          />
          <button
            onClick={selecionarPasta}
            disabled={status.monitorando}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 disabled:opacity-40 text-xs font-medium text-slate-700 dark:text-zinc-300 cursor-pointer"
            title="Selecionar pasta no disco (Ctrl+O)"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            <span>SELECIONAR</span>
          </button>
          {pasta && (
            <button
              onClick={() => abrirNoExplorer(pasta)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 hover:bg-slate-100 dark:hover:bg-zinc-800 text-xs font-medium text-slate-600 dark:text-zinc-400 cursor-pointer"
              title="Abrir pasta no Windows Explorer / Gerenciador de Arquivos"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Botões de Ação */}
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
              title="Iniciar ou parar observação contínua da pasta em segundo plano (Ctrl+Enter)"
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
              disabled={status.monitorando || status.executando || !pasta.trim()}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded border border-blue-600 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-xs font-mono font-semibold text-white cursor-pointer shadow-2xs"
              title="Processar todas as fichas pendentes agora sem iniciar o watcher (Ctrl+R)"
            >
              {status.executando ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Zap className="w-3.5 h-3.5" />
              )}
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
              Zerar cache de fichas geradas (refazer todas)
            </span>
          </label>
        </div>
      </SurfaceCard>

      {/* Telemetria */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
        <StatCard label="GERADAS" value={counters.geradas} tone="emerald" />
        <StatCard label="REFEITAS" value={counters.refeitas} tone="sky" />
        <StatCard
          label="SEM IMAGEM"
          value={counters.sem_imagem}
          tone={counters.sem_imagem > 0 ? "amber" : "zinc"}
        />
        <StatCard
          label="FOTOS SOBRANDO"
          value={counters.sobrando}
          tone={counters.sobrando > 0 ? "amber" : "zinc"}
        />
        <StatCard
          label="FALHAS"
          value={counters.erros}
          tone={counters.erros > 0 ? "red" : "zinc"}
        />
      </div>

      {/* Abas Console / Prontos / Pareamentos */}
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-zinc-800 pb-1">
        <div className="inline-flex p-0.5 rounded border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-900 gap-1 font-mono text-xs">
          <button
            onClick={() => setAbaAtiva("console")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded cursor-pointer transition-colors ${
              abaAtiva === "console"
                ? "bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 font-semibold shadow-2xs"
                : "text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>CONSOLE ({logs.length})</span>
          </button>

          <button
            onClick={() => setAbaAtiva("prontos")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded cursor-pointer transition-colors ${
              abaAtiva === "prontos"
                ? "bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 font-semibold shadow-2xs"
                : "text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            <ImageIcon className="w-3.5 h-3.5" />
            <span>FICHAS PRONTAS ({prontos.length})</span>
          </button>

          <button
            onClick={() => setAbaAtiva("pareamentos")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded cursor-pointer transition-colors ${
              abaAtiva === "pareamentos"
                ? "bg-white dark:bg-zinc-800 text-blue-700 dark:text-blue-300 font-semibold shadow-2xs"
                : "text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>PAREAMENTO & PENDÊNCIAS</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={zerarContadores}
            className="flex items-center gap-1 text-[11px] font-mono text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 cursor-pointer"
            title="Zerar contadores numéricos da sessão"
          >
            <RotateCcw className="w-3 h-3" />
            <span>ZERAR CONTADORES</span>
          </button>
        </div>
      </div>

      {/* Conteúdo da Aba Ativa */}
      {abaAtiva === "console" && (
        <TerminalLog
          lines={logs}
          emptyText="Aguardando arquivos Shopee... Coloque os PDFs e fotos do WhatsApp na pasta selecionada."
          logRef={logRef}
          onClear={() => setLogs([])}
        />
      )}

      {abaAtiva === "prontos" && (
        <SurfaceCard className="flex-1 min-h-0 p-3 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100 dark:border-zinc-800/80">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold text-slate-800 dark:text-zinc-200 uppercase">
                Fichas Geradas na Pasta PRONTOS/
              </span>
              <button
                onClick={carregarProntos}
                disabled={carregandoProntos}
                className="p-1 rounded hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-500 cursor-pointer"
                title="Recarregar fichas prontas"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${carregandoProntos ? "animate-spin" : ""}`}
                />
              </button>
              {pasta && (
                <button
                  onClick={() => abrirNoExplorer(`${pasta}/PRONTOS`)}
                  className="flex items-center gap-1 px-2 py-0.5 rounded border border-slate-200 dark:border-zinc-800 text-[10px] font-mono text-slate-600 dark:text-zinc-400 hover:bg-slate-50 dark:hover:bg-zinc-800 cursor-pointer"
                  title="Abrir pasta PRONTOS/ no Explorer"
                >
                  <FolderOpen className="w-3 h-3" />
                  <span>ABRIR PASTA</span>
                </button>
              )}
            </div>

            <div className="relative flex items-center">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5" />
              <input
                type="text"
                value={buscaProntos}
                onChange={(e) => setBuscaProntos(e.target.value)}
                placeholder="FILTRAR FICHAS PRONTAS..."
                className="w-56 rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 pl-8 pr-2.5 py-1 font-mono text-xs text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {prontosFiltrados.length === 0 ? (
              <div className="h-full flex items-center justify-center p-8 font-mono text-xs text-slate-400 dark:text-zinc-600">
                {pasta
                  ? "NENHUMA FICHA PRONTA ENCONTRADA EM PRONTOS/."
                  : "SELECIONE UMA PASTA VÁLIDA."}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 pr-1">
                {prontosFiltrados.map((item) => {
                  const thumbSrc = miniaturasCache[item.caminho_jpeg];
                  return (
                    <div
                      key={item.caminho_jpeg}
                      onMouseEnter={() => carregarMiniaturaItem(item.caminho_jpeg)}
                      className="group rounded border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-2 flex flex-col gap-1.5 hover:border-blue-500 transition-all shadow-2xs"
                    >
                      <div
                        onClick={() => abrirNoExplorer(item.caminho_jpeg)}
                        className="w-full aspect-[1/1.414] rounded bg-slate-100 dark:bg-zinc-950 flex items-center justify-center overflow-hidden cursor-pointer relative"
                        title="Clique para abrir imagem no visualizador"
                      >
                        {thumbSrc ? (
                          <img
                            src={thumbSrc}
                            alt={item.nome_arquivo}
                            className="w-full h-full object-contain"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex flex-col items-center gap-1 text-slate-400">
                            <Eye className="w-5 h-5 opacity-50 group-hover:opacity-100 transition-opacity" />
                            <span className="text-[9px] font-mono">VER FICHA</span>
                          </div>
                        )}
                      </div>

                      <div className="min-w-0">
                        <div
                          className="font-mono text-xs font-semibold text-slate-800 dark:text-zinc-200 truncate"
                          title={item.nome_arquivo}
                        >
                          {item.nome_arquivo}
                        </div>
                        <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 mt-0.5">
                          <span>
                            {item.largura}×{item.altura}
                          </span>
                          <span>{(item.tamanho_bytes / 1024).toFixed(0)} KB</span>
                        </div>
                        <div className="text-[9px] font-mono text-slate-400 mt-0.5">
                          {item.modificado_str}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </SurfaceCard>
      )}

      {abaAtiva === "pareamentos" && (
        <SurfaceCard className="flex-1 min-h-0 p-3.5 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200 dark:border-zinc-800">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold text-slate-900 dark:text-white uppercase flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span>Mapa de Pareamentos & Diagnóstico de Fotos</span>
              </span>
              <button
                onClick={carregarDiagnostico}
                disabled={carregandoDiagnostico}
                className="p-1 rounded hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-500 cursor-pointer"
                title="Recarregar pareamentos"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${carregandoDiagnostico ? "animate-spin" : ""}`}
                />
              </button>
            </div>

            <div className="relative flex items-center">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5" />
              <input
                type="text"
                value={buscaPareamentos}
                onChange={(e) => setBuscaPareamentos(e.target.value)}
                placeholder="FILTRAR PEDIDOS..."
                className="w-56 rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 pl-8 pr-2.5 py-1 font-mono text-xs text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-3 gap-3">
            {/* Coluna 1 & 2: Pedidos Pareados */}
            <div className="lg:col-span-2 flex flex-col gap-2">
              <span className="font-mono text-[11px] font-bold text-slate-600 dark:text-zinc-400 uppercase">
                PEDIDOS PAREADOS COM FOTO ({pareamentosFiltrados.length})
              </span>

              {pareamentosFiltrados.length === 0 ? (
                <div className="p-8 text-center font-mono text-xs text-slate-400 rounded border border-dashed border-slate-200 dark:border-zinc-800">
                  NENHUM PEDIDO PAREADO ENCONTRADO.
                </div>
              ) : (
                <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
                  {pareamentosFiltrados.map((item, idx) => (
                    <div
                      key={idx}
                      className="p-2.5 rounded border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-wrap items-center justify-between gap-2 text-xs font-mono"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <FileText className="w-3.5 h-3.5 text-blue-600" />
                          <span className="font-semibold text-slate-800 dark:text-zinc-200 truncate">
                            {item.pdf_nome}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            ({item.pdf_hora})
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-zinc-400 mt-1 pl-5">
                          {item.imagens_pareadas.length} foto(s) pareada(s):{" "}
                          <span className="text-slate-700 dark:text-zinc-300">
                            {item.imagens_pareadas.join(", ")}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {item.status === "pronto" ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300">
                            PRONTO
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-300">
                            PENDENTE
                          </span>
                        )}

                        {item.destino_jpeg && (
                          <button
                            onClick={() => abrirNoExplorer(item.destino_jpeg!)}
                            className="px-2 py-0.5 rounded border border-slate-200 dark:border-zinc-800 hover:bg-slate-100 dark:hover:bg-zinc-800 text-[10px] cursor-pointer"
                            title="Abrir ficha pronta"
                          >
                            Abrir
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Coluna 3: Pendências & Fotos Órfãs */}
            <div className="flex flex-col gap-3">
              {/* Pedidos sem imagem */}
              <div className="flex flex-col gap-1.5">
                <span className="font-mono text-[11px] font-bold text-amber-600 dark:text-amber-400 uppercase flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>PDFS SEM FOTO ({diagnostico?.sem_imagem.length ?? 0})</span>
                </span>
                <div className="p-2 rounded border border-amber-200 dark:border-amber-900/40 bg-amber-50/30 dark:bg-amber-950/20 max-h-44 overflow-y-auto font-mono text-[11px] space-y-1">
                  {(diagnostico?.sem_imagem.length ?? 0) === 0 ? (
                    <div className="text-slate-400 text-center py-2">
                      Nenhum pedido pendente de foto.
                    </div>
                  ) : (
                    diagnostico?.sem_imagem.map((n, i) => (
                      <div key={i} className="text-slate-700 dark:text-zinc-300 truncate">
                        • {n}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Fotos Órfãs */}
              <div className="flex flex-col gap-1.5">
                <span className="font-mono text-[11px] font-bold text-slate-600 dark:text-zinc-400 uppercase flex items-center gap-1.5">
                  <ImageIcon className="w-3.5 h-3.5" />
                  <span>FOTOS SEM FICHA ({diagnostico?.sobrando.length ?? 0})</span>
                </span>
                <div className="p-2 rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 max-h-44 overflow-y-auto font-mono text-[11px] space-y-1">
                  {(diagnostico?.sobrando.length ?? 0) === 0 ? (
                    <div className="text-slate-400 text-center py-2">
                      Nenhuma foto órfã sobrando.
                    </div>
                  ) : (
                    diagnostico?.sobrando.map((s, i) => (
                      <div key={i} className="text-slate-700 dark:text-zinc-300 truncate">
                        • {s}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </SurfaceCard>
      )}
    </div>
  );
}
