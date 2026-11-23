import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  Copy,
  ExternalLink,
  Eye,
  FolderOpen,
  ImageIcon,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  ShoppingBag,
  Sliders,
  Square,
  Terminal,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { PageHeader, StatCard, StatusBadge, SurfaceCard, TerminalLog } from "../components/ui";
import { usePageShortcuts } from "../hooks/useShortcuts";

interface BolsinhasOpcoes {
  pasta: string;
  extras: string[];
  apagar_repetido: boolean;
  som: boolean;
  usar_pai: boolean;
  escala_pct: number;
  qualidade_jpeg: number;
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
  processando_lote: boolean;
}

interface ParDuplicado {
  original: string;
  duplicada: string;
  caminho_original: string;
  caminho_duplicada: string;
}

interface VarreduraResultado {
  total_analisados: number;
  duplicadas: ParDuplicado[];
  tempo_s: number;
  movidas: boolean;
}

interface BolsinhaItemInfo {
  stem: string;
  nome_arquivo: string;
  caminho_jpeg: string;
  tamanho_bytes: number;
  modificado_str: string;
  largura: number;
  altura: number;
}

export function BolsinhasPage() {
  const [pasta, setPasta] = useState("");
  const [extras, setExtras] = useState<string[]>([]);
  const [usarPai, setUsarPai] = useState(true);
  const [apagarRepetido, setApagarRepetido] = useState(false);
  const [som, setSom] = useState(true);
  const [escalaPct, setEscalaPct] = useState(10);
  const [qualidadeJpeg, setQualidadeJpeg] = useState(85);

  const [mostrarConfig, setMostrarConfig] = useState(false);
  const [abaAtiva, setAbaAtiva] = useState<"console" | "galeria" | "duplicadas">("console");

  const [status, setStatus] = useState<BolsinhasStatus>({
    monitorando: false,
    varrendo: false,
    processando_lote: false,
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
  const [varreduraRes, setVarreduraRes] = useState<VarreduraResultado | null>(null);

  // Galeria de recentes
  const [recentes, setRecentes] = useState<BolsinhaItemInfo[]>([]);
  const [carregandoRecentes, setCarregandoRecentes] = useState(false);
  const [buscaGaleria, setBuscaGaleria] = useState("");
  const [miniaturasCache, setMiniaturasCache] = useState<Record<string, string>>({});

  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    invoke<BolsinhasOpcoes>("bolsinhas_get_config").then((cfg) => {
      setPasta(cfg.pasta || "");
      setExtras(cfg.extras || []);
      setUsarPai(cfg.usar_pai);
      setApagarRepetido(cfg.apagar_repetido);
      setSom(cfg.som);
      if (cfg.escala_pct) setEscalaPct(cfg.escala_pct);
      if (cfg.qualidade_jpeg) setQualidadeJpeg(cfg.qualidade_jpeg);
    });

    invoke<BolsinhasStatus>("bolsinhas_status").then(setStatus);
    invoke<BolsinhasCounters>("bolsinhas_counters").then(setCounters);

    const unStatus = listen<BolsinhasStatus>("bolsinhas-status", (e) => setStatus(e.payload));
    const unCnt = listen<BolsinhasCounters>("bolsinhas-counters", (e) => setCounters(e.payload));
    const unLog = listen<string>("bolsinhas-log", (e) => {
      setLogs((prev) => [...prev.slice(-1500), e.payload]);
    });
    const unVarredura = listen<VarreduraResultado>("bolsinhas-varredura", (e) => {
      setVarreduraRes(e.payload);
      if (e.payload.duplicadas.length > 0) {
        setAbaAtiva("duplicadas");
      }
    });

    return () => {
      unStatus.then((fn) => fn());
      unCnt.then((fn) => fn());
      unLog.then((fn) => fn());
      unVarredura.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (logRef.current && abaAtiva === "console") {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs, abaAtiva]);

  // Carrega lista de recentes quando abrir a aba de galeria
  useEffect(() => {
    if (abaAtiva === "galeria" && pasta.trim()) {
      carregarRecentes();
    }
  }, [abaAtiva, pasta]);

  const carregarRecentes = async () => {
    if (!pasta.trim()) return;
    setCarregandoRecentes(true);
    try {
      const itens = await invoke<BolsinhaItemInfo[]>("bolsinhas_listar_recentes", {
        pasta,
        limite: 64,
      });
      setRecentes(itens);
    } catch {
      // Ignora erro
    } finally {
      setCarregandoRecentes(false);
    }
  };

  const carregarMiniaturaItem = async (caminho: string) => {
    if (miniaturasCache[caminho]) return;
    try {
      const b64 = await invoke<string>("bolsinhas_carregar_miniatura", { caminho });
      setMiniaturasCache((prev) => ({ ...prev, [caminho]: b64 }));
    } catch {
      // Falha ao carregar miniatura
    }
  };

  const selecionarPasta = async () => {
    const dir = await open({
      directory: true,
      defaultPath: pasta || undefined,
      title: "Selecione a pasta BOLSINHAS/PARA FAZER",
    });
    if (typeof dir === "string") {
      setPasta(dir);
      salvarConfig({ pasta: dir });
    }
  };

  const adicionarPastaExtra = async () => {
    const dir = await open({
      directory: true,
      title: "Adicionar pasta de referência de bolsinhas",
    });
    if (typeof dir === "string" && !extras.includes(dir)) {
      const novoExtras = [...extras, dir];
      setExtras(novoExtras);
      salvarConfig({ extras: novoExtras });
    }
  };

  const removerPastaExtra = (index: number) => {
    const novoExtras = extras.filter((_, i) => i !== index);
    setExtras(novoExtras);
    salvarConfig({ extras: novoExtras });
  };

  const salvarConfig = async (overrides: Partial<BolsinhasOpcoes> = {}) => {
    const payload: BolsinhasOpcoes = {
      pasta: overrides.pasta ?? pasta,
      extras: overrides.extras ?? extras,
      apagar_repetido: overrides.apagar_repetido ?? apagarRepetido,
      som: overrides.som ?? som,
      usar_pai: overrides.usar_pai ?? usarPai,
      escala_pct: overrides.escala_pct ?? escalaPct,
      qualidade_jpeg: overrides.qualidade_jpeg ?? qualidadeJpeg,
    };
    try {
      await invoke("bolsinhas_save_config", { opcoes: payload });
    } catch (e) {
      setErro(String(e));
    }
  };

  const alternarMonitor = async () => {
    setErro(null);
    try {
      if (status.monitorando) {
        await invoke("bolsinhas_parar");
      } else {
        await invoke("bolsinhas_iniciar", {
          opcoes: {
            pasta,
            extras,
            apagar_repetido: apagarRepetido,
            som,
            usar_pai: usarPai,
            escala_pct: escalaPct,
            qualidade_jpeg: qualidadeJpeg,
          },
        });
      }
    } catch (e) {
      setErro(String(e));
    }
  };

  const processarLoteAgora = async () => {
    if (!pasta.trim()) return;
    setErro(null);
    try {
      await invoke("bolsinhas_processar_lote", {
        opcoes: {
          pasta,
          extras,
          apagar_repetido: apagarRepetido,
          som,
          usar_pai: usarPai,
          escala_pct: escalaPct,
          qualidade_jpeg: qualidadeJpeg,
        },
      });
    } catch (e) {
      setErro(String(e));
    }
  };

  const executarVarredura = async (mover: boolean) => {
    if (!pasta.trim()) return;
    setErro(null);
    try {
      await invoke("bolsinhas_varredura", { pasta, mover });
    } catch (e) {
      setErro(String(e));
    }
  };

  const zerarContadores = async () => {
    try {
      await invoke("bolsinhas_reset_counters");
    } catch {
      // Ignora erro
    }
  };

  const abrirNoExplorer = (caminho: string) => {
    if (caminho) openPath(caminho);
  };

  usePageShortcuts([
    {
      id: "bol-toggle",
      combo: "ctrl+enter",
      keys: "Ctrl+Enter",
      label: status.monitorando ? "Parar Monitoramento" : "Iniciar Monitoramento",
      action: alternarMonitor,
    },
    {
      id: "bol-folder",
      combo: "ctrl+o",
      keys: "Ctrl+O",
      label: "Selecionar Pasta PARA FAZER",
      action: selecionarPasta,
    },
    {
      id: "bol-batch",
      combo: "ctrl+r",
      keys: "Ctrl+R",
      label: "Processar Lote Agora",
      action: processarLoteAgora,
    },
    {
      id: "bol-scan",
      combo: "ctrl+shift+r",
      keys: "Ctrl+Shift+R",
      label: "Varrer Duplicadas (Simulação)",
      action: () => executarVarredura(false),
    },
    {
      id: "bol-clear",
      combo: "ctrl+l",
      keys: "Ctrl+L",
      label: "Limpar Logs",
      action: () => setLogs([]),
    },
    {
      id: "bol-config",
      combo: "alt+1",
      keys: "Alt+1",
      label: "Alternar Parâmetros Técnicos",
      action: () => setMostrarConfig((v) => !v),
    },
    {
      id: "bol-tab-log",
      combo: "alt+2",
      keys: "Alt+2",
      label: "Aba Console de Eventos",
      action: () => setAbaAtiva("console"),
    },
    {
      id: "bol-tab-gal",
      combo: "alt+3",
      keys: "Alt+3",
      label: "Aba Galeria de Mockups",
      action: () => setAbaAtiva("galeria"),
    },
  ]);

  const recentesFiltrados = useMemo(() => {
    if (!buscaGaleria.trim()) return recentes;
    const termo = buscaGaleria.toLowerCase();
    return recentes.filter((r) => r.nome_arquivo.toLowerCase().includes(termo));
  }, [recentes, buscaGaleria]);

  return (
    <div className="p-5 h-full flex flex-col gap-3.5 max-w-7xl mx-auto select-none">
      <PageHeader
        icon={<ShoppingBag className="w-4 h-4 text-slate-700 dark:text-zinc-300" />}
        title="Gerador de Bolsinhas // JPEG 10%"
        badge="IMG-02"
        subtitle="Monitora PARA FAZER reativamente via Notify, gera bolsinhas JPEG em SIMD e cataloga miniaturas para detectar artes repetidas."
        right={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMostrarConfig((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded border font-mono text-xs font-semibold cursor-pointer transition-colors ${
                mostrarConfig
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300"
                  : "border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800"
              }`}
              title="Configurações de escala, qualidade JPEG e pastas de referência (Alt+1)"
            >
              <Settings2 className="w-3.5 h-3.5" />
              <span>PARÂMETROS ({escalaPct}% / Q{qualidadeJpeg})</span>
            </button>

            <StatusBadge
              active={status.monitorando || status.varrendo || status.processando_lote}
              activeText={
                status.varrendo
                  ? "VARRENDO..."
                  : status.processando_lote
                  ? "PROCESSANDO..."
                  : "WATCHER ATIVO"
              }
              tone={
                status.varrendo
                  ? "amber"
                  : status.processando_lote
                  ? "blue"
                  : "emerald"
              }
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
              <span>PARÂMETROS DE CONVERSÃO & PASTAS DE REFERÊNCIA</span>
            </div>
            <button
              onClick={() => setMostrarConfig(false)}
              className="text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 mb-3.5">
            <div>
              <label className="block font-mono text-[11px] font-semibold text-slate-600 dark:text-zinc-400 mb-1">
                ESCALA DA BOLSINHA (%)
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  step="1"
                  min="5"
                  max="50"
                  value={escalaPct}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value) || 10;
                    setEscalaPct(v);
                    salvarConfig({ escala_pct: v });
                  }}
                  className="w-20 rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:text-white"
                />
                <div className="inline-flex gap-1 font-mono text-[10px]">
                  {[5, 10, 15, 20].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => {
                        setEscalaPct(v);
                        salvarConfig({ escala_pct: v });
                      }}
                      className={`px-1.5 py-1 rounded border cursor-pointer ${
                        escalaPct === v
                          ? "border-blue-600 bg-blue-600 text-white font-bold"
                          : "border-slate-300 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-700 dark:text-zinc-300"
                      }`}
                    >
                      {v}%
                    </button>
                  ))}
                </div>
              </div>
              <span className="text-[10px] text-slate-500 dark:text-zinc-500 font-mono">
                Padrão 10% da dimensão original do TIFF
              </span>
            </div>

            <div>
              <label className="block font-mono text-[11px] font-semibold text-slate-600 dark:text-zinc-400 mb-1">
                QUALIDADE JPEG (30-100)
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  step="5"
                  min="30"
                  max="100"
                  value={qualidadeJpeg}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10) || 85;
                    setQualidadeJpeg(v);
                    salvarConfig({ qualidade_jpeg: v });
                  }}
                  className="w-20 rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:text-white"
                />
                <div className="inline-flex gap-1 font-mono text-[10px]">
                  {[75, 85, 90].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => {
                        setQualidadeJpeg(v);
                        salvarConfig({ qualidade_jpeg: v });
                      }}
                      className={`px-1.5 py-1 rounded border cursor-pointer ${
                        qualidadeJpeg === v
                          ? "border-blue-600 bg-blue-600 text-white font-bold"
                          : "border-slate-300 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-700 dark:text-zinc-300"
                      }`}
                    >
                      Q{v}
                    </button>
                  ))}
                </div>
              </div>
              <span className="text-[10px] text-slate-500 dark:text-zinc-500 font-mono">
                Compressão balanceada para visualização rápida (Q85)
              </span>
            </div>

            <div className="sm:col-span-2">
              <label className="block font-mono text-[11px] font-semibold text-slate-600 dark:text-zinc-400 mb-1">
                COMPORTAMENTOS ADICIONAIS:
              </label>
              <div className="flex flex-col gap-1.5 text-xs font-mono text-slate-700 dark:text-zinc-300">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={usarPai}
                    onChange={(e) => {
                      setUsarPai(e.target.checked);
                      salvarConfig({ usar_pai: e.target.checked });
                    }}
                    className="rounded accent-blue-600"
                  />
                  <span>Usar pasta pai (BOLSINHAS) como histórico de 'já feitas'</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={apagarRepetido}
                    onChange={(e) => {
                      setApagarRepetido(e.target.checked);
                      salvarConfig({ apagar_repetido: e.target.checked });
                    }}
                    className="rounded accent-blue-600"
                  />
                  <span>Apagar TIFF repetido (em vez de mover para REPETIDAS/)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={som}
                    onChange={(e) => {
                      setSom(e.target.checked);
                      salvarConfig({ som: e.target.checked });
                    }}
                    className="rounded accent-blue-600"
                  />
                  <span>Emitir notificação / som em caso de arte repetida</span>
                </label>
              </div>
            </div>
          </div>

          {/* Pastas extras de referência */}
          <div className="pt-3 border-t border-slate-200 dark:border-zinc-800">
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono text-[11px] font-semibold text-slate-600 dark:text-zinc-400">
                PASTAS EXTRAS DE CONSULTA (onde buscar bolsinhas antigas já prontas):
              </span>
              <button
                type="button"
                onClick={adicionarPastaExtra}
                className="flex items-center gap-1 px-2 py-0.5 rounded border border-slate-300 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-zinc-800 font-mono text-[11px] text-slate-700 dark:text-zinc-300 cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                <span>ADICIONAR PASTA</span>
              </button>
            </div>

            {extras.length === 0 ? (
              <div className="font-mono text-[11px] text-slate-400 py-1">
                Nenhuma pasta extra cadastrada. Busca apenas na pasta atual e na pasta pai.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-24 overflow-y-auto pr-1">
                {extras.map((ex, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between px-2.5 py-1 rounded bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 font-mono text-xs text-slate-700 dark:text-zinc-300"
                  >
                    <span className="truncate">{ex}</span>
                    <button
                      type="button"
                      onClick={() => removerPastaExtra(idx)}
                      className="text-red-500 hover:text-red-700 ml-2 cursor-pointer"
                      title="Remover pasta"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </SurfaceCard>
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
            placeholder="Caminho da pasta BOLSINHAS/PARA FAZER..."
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
              className={`flex items-center gap-2 px-4 py-1.5 rounded text-xs font-semibold text-white cursor-pointer transition-all ${
                status.monitorando
                  ? "bg-red-600 hover:bg-red-500 shadow-2xs"
                  : "bg-emerald-600 hover:bg-emerald-500 shadow-2xs"
              }`}
              title="Iniciar ou parar monitoramento contínuo em segundo plano (Ctrl+Enter)"
            >
              {status.monitorando ? (
                <Square className="w-3.5 h-3.5" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              <span>{status.monitorando ? "PARAR MONITOR" : "INICIAR MONITOR"}</span>
            </button>

            <button
              onClick={processarLoteAgora}
              disabled={status.processando_lote || !pasta.trim()}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded border border-blue-600 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-xs font-mono font-semibold text-white cursor-pointer shadow-2xs"
              title="Processar todos os TIFFs presentes na pasta agora sem iniciar o watcher (Ctrl+R)"
            >
              {status.processando_lote ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Zap className="w-3.5 h-3.5" />
              )}
              <span>PROCESSAR LOTE AGORA</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => executarVarredura(false)}
              disabled={status.varrendo || !pasta.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 disabled:opacity-40 text-xs font-mono font-medium text-slate-700 dark:text-zinc-300 cursor-pointer"
              title="Identificar bolsinhas idênticas com nomes diferentes (Ctrl+Shift+R)"
            >
              <Search className="w-3.5 h-3.5" />
              <span>VARRER DUPLICADAS</span>
            </button>

            <button
              onClick={() => executarVarredura(true)}
              disabled={status.varrendo || !pasta.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-amber-600 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-xs font-mono font-semibold text-white cursor-pointer shadow-2xs"
              title="Identificar bolsinhas idênticas e mover para pasta DUPLICADAS/"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>VARRER + MOVER</span>
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
        <StatCard
          label="FALHAS"
          value={counters.erros}
          tone={counters.erros > 0 ? "red" : "zinc"}
        />
      </div>

      {/* Abas Console / Galeria / Duplicadas */}
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
            onClick={() => setAbaAtiva("galeria")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded cursor-pointer transition-colors ${
              abaAtiva === "galeria"
                ? "bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 font-semibold shadow-2xs"
                : "text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            <ImageIcon className="w-3.5 h-3.5" />
            <span>GALERIA DE MOCKUPS ({recentes.length})</span>
          </button>

          {varreduraRes && (
            <button
              onClick={() => setAbaAtiva("duplicadas")}
              className={`flex items-center gap-1.5 px-3 py-1 rounded cursor-pointer transition-colors ${
                abaAtiva === "duplicadas"
                  ? "bg-white dark:bg-zinc-800 text-amber-700 dark:text-amber-300 font-semibold shadow-2xs"
                  : "text-amber-600 dark:text-amber-400 hover:text-amber-800"
              }`}
            >
              <Copy className="w-3.5 h-3.5" />
              <span>DUPLICADAS ({varreduraRes.duplicadas.length})</span>
            </button>
          )}
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

      {/* Conteúdo da Aba */}
      {abaAtiva === "console" && (
        <TerminalLog
          lines={logs}
          emptyText="Aguardando eventos do monitor de bolsinhas... Solte arquivos TIFF na pasta PARA FAZER."
          logRef={logRef}
          onClear={() => setLogs([])}
        />
      )}

      {abaAtiva === "galeria" && (
        <SurfaceCard className="flex-1 min-h-0 p-3 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100 dark:border-zinc-800/80">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold text-slate-800 dark:text-zinc-200 uppercase">
                Bolsinhas Geradas Recentemente
              </span>
              <button
                onClick={carregarRecentes}
                disabled={carregandoRecentes}
                className="p-1 rounded hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-500 cursor-pointer"
                title="Recarregar galeria"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${carregandoRecentes ? "animate-spin" : ""}`}
                />
              </button>
            </div>

            <div className="relative flex items-center">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5" />
              <input
                type="text"
                value={buscaGaleria}
                onChange={(e) => setBuscaGaleria(e.target.value)}
                placeholder="FILTRAR MOCKUPS..."
                className="w-56 rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 pl-8 pr-2.5 py-1 font-mono text-xs text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {recentesFiltrados.length === 0 ? (
              <div className="h-full flex items-center justify-center p-8 font-mono text-xs text-slate-400 dark:text-zinc-600">
                {pasta
                  ? "NENHUMA BOLSINHA JPEG ENCONTRADA NA PASTA ALVO."
                  : "SELECIONE UMA PASTA VÁLIDA."}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 pr-1">
                {recentesFiltrados.map((item) => {
                  const thumbSrc = miniaturasCache[item.caminho_jpeg];
                  return (
                    <div
                      key={item.caminho_jpeg}
                      onMouseEnter={() => carregarMiniaturaItem(item.caminho_jpeg)}
                      className="group rounded border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-2 flex flex-col gap-1.5 hover:border-blue-500 transition-all shadow-2xs"
                    >
                      <div
                        onClick={() => abrirNoExplorer(item.caminho_jpeg)}
                        className="w-full aspect-square rounded bg-slate-100 dark:bg-zinc-950 flex items-center justify-center overflow-hidden cursor-pointer relative"
                      >
                        {thumbSrc ? (
                          <img
                            src={thumbSrc}
                            alt={item.stem}
                            className="w-full h-full object-contain"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex flex-col items-center gap-1 text-slate-400">
                            <Eye className="w-5 h-5 opacity-50 group-hover:opacity-100 transition-opacity" />
                            <span className="text-[9px] font-mono">VER</span>
                          </div>
                        )}
                      </div>

                      <div className="min-w-0">
                        <div
                          className="font-mono text-xs font-semibold text-slate-800 dark:text-zinc-200 truncate"
                          title={item.nome_arquivo}
                        >
                          {item.stem}
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

      {abaAtiva === "duplicadas" && varreduraRes && (
        <SurfaceCard className="flex-1 min-h-0 p-3.5 flex flex-col gap-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-zinc-800">
            <div>
              <div className="font-mono text-xs font-bold text-slate-900 dark:text-zinc-100 uppercase flex items-center gap-2">
                <Copy className="w-4 h-4 text-amber-600" />
                <span>
                  Resultado da Varredura // {varreduraRes.duplicadas.length} Par(es)
                  Duplicado(s)
                </span>
              </div>
              <div className="text-[11px] font-mono text-slate-500 dark:text-zinc-400 mt-0.5">
                Total analisado: {varreduraRes.total_analisados} bolsinhas em{" "}
                {varreduraRes.tempo_s.toFixed(2)}s.
                {varreduraRes.movidas
                  ? " Arquivos duplicados já foram movidos para DUPLICADAS/."
                  : " Simulação (nenhum arquivo foi alterado)."}
              </div>
            </div>

            {!varreduraRes.movidas && varreduraRes.duplicadas.length > 0 && (
              <button
                onClick={() => executarVarredura(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-500 font-mono text-xs font-bold text-white cursor-pointer shadow-2xs"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>MOVER TODAS PARA DUPLICADAS/</span>
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {varreduraRes.duplicadas.length === 0 ? (
              <div className="h-full flex items-center justify-center font-mono text-xs text-emerald-600 dark:text-emerald-400">
                ✔ NENHUMA BOLSINHA DUPLICADA ENCONTRADA.
              </div>
            ) : (
              <table className="w-full text-left border-collapse font-mono text-xs">
                <thead className="sticky top-0 bg-slate-50 dark:bg-zinc-900 border-b border-slate-200 dark:border-zinc-800 text-[10px] text-slate-500">
                  <tr>
                    <th className="py-2 px-3">ARTE ORIGINAL (PRIMEIRA DETECTADA)</th>
                    <th className="py-2 px-3">CÓPIA DUPLICADA (IDÊNTICA)</th>
                    <th className="py-2 px-3 text-right">AÇÕES</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-zinc-800/70">
                  {varreduraRes.duplicadas.map((par, i) => (
                    <tr key={i} className="hover:bg-slate-50 dark:hover:bg-zinc-900/40">
                      <td className="py-2.5 px-3 font-semibold text-slate-800 dark:text-zinc-200">
                        {par.original}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-amber-700 dark:text-amber-400">
                        {par.duplicada}
                      </td>
                      <td className="py-2.5 px-3 text-right space-x-2">
                        <button
                          onClick={() => abrirNoExplorer(par.caminho_original)}
                          className="px-2 py-1 rounded border border-slate-200 dark:border-zinc-800 text-[10px] text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 cursor-pointer"
                        >
                          Abrir Original
                        </button>
                        <button
                          onClick={() => abrirNoExplorer(par.caminho_duplicada)}
                          className="px-2 py-1 rounded border border-slate-200 dark:border-zinc-800 text-[10px] text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 cursor-pointer"
                        >
                          Abrir Cópia
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </SurfaceCard>
      )}
    </div>
  );
}
