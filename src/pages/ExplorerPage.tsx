import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Calendar,
  Check,
  ChevronRight,
  ClipboardPaste,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  File,
  FileArchive,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Home,
  LayoutGrid,
  List,
  Loader2,
  Monitor,
  PanelRight,
  Pencil,
  Pin,
  PinOff,
  RefreshCw,
  Scissors,
  Search,
  Square,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { PageHeader } from "../components/ui";
import { usePageShortcuts } from "../hooks/useShortcuts";
import { ModuloId } from "../modules/registry";

interface ExplorerConfig {
  favoritos: string[];
  modo_visao: "lista" | "grade";
  mostrar_ocultos: boolean;
  mostrar_preview: boolean;
  ultima_pasta?: string | null;
}

interface ExplorerRaiz {
  nome: string;
  caminho: string;
  grupo: "pcp" | "usuario" | "unidade" | string;
  icone: string;
  existe: boolean;
}

interface BreadcrumbItem {
  nome: string;
  caminho: string;
}

interface ExplorerItem {
  nome: string;
  caminho: string;
  eh_pasta: boolean;
  extensao: string;
  tamanho_bytes: number;
  modificado_ms: number;
  modificado_fmt: string;
  oculto: boolean;
}

interface ExplorerListagem {
  caminho: string;
  pai: string | null;
  breadcrumbs: BreadcrumbItem[];
  itens: ExplorerItem[];
  total_pastas: number;
  total_arquivos: number;
  tamanho_total: number;
}

interface OperacaoResultado {
  ok: number;
  falhas: string[];
}

interface ImagemPreviewInfo {
  largura_px: number;
  altura_px: number;
  dpi_x: number;
  dpi_y: number;
  largura_cm: number;
  altura_cm: number;
  modo_cor: string;
  tem_icc: boolean;
  miniatura_data_url: string | null;
}

interface CortadorSimItem {
  arquivo: string;
  largura_cm: number;
  altura_cm: number;
  dpi: number;
  n_placas: number;
  placas_cm: number[];
  cidade: string | null;
  erro: string | null;
}

interface CortadorSimulacao {
  total_paineis: number;
  total_placas: number;
  itens: CortadorSimItem[];
}

const CUTTABLE_EXTS = new Set(["tif", "tiff", "png", "jpg", "jpeg"]);
const RE_PLACA = / - P(\d+)\.[^.]+$/i;

function extrairTagPlaca(nome: string): string | null {
  const m = nome.match(RE_PLACA);
  return m ? `P${m[1]}` : null;
}

function ehCortavel(item: ExplorerItem): boolean {
  return !item.eh_pasta && CUTTABLE_EXTS.has(item.extensao) && !RE_PLACA.test(item.nome);
}

type SortKey = "nome" | "modificado" | "tipo" | "tamanho";
type SortDir = "asc" | "desc";

const IMAGE_EXTS = new Set(["tif", "tiff", "jpg", "jpeg", "png", "webp", "bmp", "gif"]);
const DOC_EXTS = new Set(["pdf", "doc", "docx", "txt", "md", "rtf", "log"]);
const SHEET_EXTS = new Set(["csv", "tsv", "xls", "xlsx"]);
const CODE_EXTS = new Set(["json", "xml", "html", "htm", "css", "js", "ts", "tsx", "rs", "py", "yml", "yaml"]);
const ARCHIVE_EXTS = new Set(["zip", "rar", "7z", "tar", "gz"]);

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`;
}

function tipoLabel(item: ExplorerItem): string {
  if (item.eh_pasta) return "Pasta de arquivos";
  if (!item.extensao) return "Arquivo";
  if (item.extensao === "tif" || item.extensao === "tiff") return "Imagem TIFF";
  if (item.extensao === "jpg" || item.extensao === "jpeg") return "Imagem JPEG";
  if (item.extensao === "png") return "Imagem PNG";
  if (item.extensao === "pdf") return "Documento PDF";
  return `Arquivo ${item.extensao.toUpperCase()}`;
}

function ItemIcon({ item, className = "w-4 h-4" }: { item: ExplorerItem; className?: string }) {
  if (item.eh_pasta) {
    return <Folder className={`${className} text-amber-500 dark:text-amber-400 fill-amber-500/20`} />;
  }
  const ext = item.extensao;
  if (IMAGE_EXTS.has(ext)) {
    return <FileImage className={`${className} text-blue-600 dark:text-blue-400`} />;
  }
  if (ext === "pdf") {
    return <FileText className={`${className} text-red-600 dark:text-red-400`} />;
  }
  if (SHEET_EXTS.has(ext)) {
    return <FileSpreadsheet className={`${className} text-emerald-600 dark:text-emerald-400`} />;
  }
  if (CODE_EXTS.has(ext)) {
    return <FileCode className={`${className} text-violet-600 dark:text-violet-400`} />;
  }
  if (ARCHIVE_EXTS.has(ext)) {
    return <FileArchive className={`${className} text-amber-600 dark:text-amber-400`} />;
  }
  if (DOC_EXTS.has(ext)) {
    return <FileText className={`${className} text-slate-600 dark:text-zinc-400`} />;
  }
  return <File className={`${className} text-slate-400 dark:text-zinc-500`} />;
}

function RaizIcon({ icone, className = "w-3.5 h-3.5" }: { icone: string; className?: string }) {
  switch (icone) {
    case "calendar":
      return <Calendar className={`${className} text-blue-600 dark:text-blue-400`} />;
    case "desktop":
      return <Monitor className={`${className} text-slate-500 dark:text-zinc-400`} />;
    case "download":
      return <Download className={`${className} text-emerald-600 dark:text-emerald-400`} />;
    case "home":
      return <Home className={`${className} text-slate-500 dark:text-zinc-400`} />;
    case "image":
      return <FileImage className={`${className} text-blue-500 dark:text-blue-400`} />;
    case "harddrive":
      return <HardDrive className={`${className} text-slate-600 dark:text-zinc-400`} />;
    default:
      return <Folder className={`${className} text-amber-500 dark:text-amber-400`} />;
  }
}

function nomeDaPasta(caminho: string): string {
  const limpo = caminho.replace(/[\\/]+$/, "");
  if (!limpo) return caminho;
  const partes = limpo.split(/[\\/]/);
  return partes[partes.length - 1] || caminho;
}

export function ExplorerPage({ onNavigate }: { onNavigate?: (id: ModuloId) => void }) {
  const [config, setConfig] = useState<ExplorerConfig>({
    favoritos: [],
    modo_visao: "grade",
    mostrar_ocultos: false,
    mostrar_preview: true,
    ultima_pasta: null,
  });
  const [raizes, setRaizes] = useState<ExplorerRaiz[]>([]);
  const [listagem, setListagem] = useState<ExplorerListagem | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [toast, setToast] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  // Cache de miniaturas e metadados RIP por caminho
  const [thumbMap, setThumbMap] = useState<Record<string, ImagemPreviewInfo>>({});
  const thumbMapRef = useRef<Record<string, ImagemPreviewInfo>>({});
  useEffect(() => {
    thumbMapRef.current = thumbMap;
  }, [thumbMap]);

  // Histórico de navegação (Voltar / Avançar)
  const [historico, setHistorico] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);

  // Barra de endereço editável
  const [editandoEndereco, setEditandoEndereco] = useState(false);
  const [enderecoInput, setEnderecoInput] = useState("");
  const enderecoRef = useRef<HTMLInputElement>(null);

  // Busca e ordenação
  const [busca, setBusca] = useState("");
  const buscaRef = useRef<HTMLInputElement>(null);
  const [sortKey, setSortKey] = useState<SortKey>("nome");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Seleção e área de transferência
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [ultimoAnchor, setUltimoAnchor] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<{ caminhos: string[]; mover: boolean } | null>(null);
  const [operando, setOperando] = useState(false);

  // Pré-visualização de imagem / RIP
  const [previewInfo, setPreviewInfo] = useState<ImagemPreviewInfo | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewErro, setPreviewErro] = useState<string | null>(null);
  const [copiadoCaminho, setCopiadoCaminho] = useState(false);

  // Menu de contexto
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; item: ExplorerItem | null } | null>(null);

  // Modais (Nova pasta / Renomear / Confirmar exclusão / Cortar painéis)
  const [modalNovaPasta, setModalNovaPasta] = useState(false);
  const [novaPastaNome, setNovaPastaNome] = useState("");
  const [modalRenomear, setModalRenomear] = useState<ExplorerItem | null>(null);
  const [renomearNome, setRenomearNome] = useState("");
  const [modalExcluir, setModalExcluir] = useState<ExplorerItem[] | null>(null);

  // Modal de Corte Direto de Painéis no Explorer
  const [modalCortar, setModalCortar] = useState<ExplorerItem[] | null>(null);
  const [cutModo, setCutModo] = useState<"Automático" | "Medidas personalizadas">("Automático");
  const [cutGabarito, setCutGabarito] = useState("");
  const [cutMedida, setCutMedida] = useState("150");
  const [cutMedidasLista, setCutMedidasLista] = useState("140,150,125");
  const [cutSobra, setCutSobra] = useState("0.5");
  const [cutPad, setCutPad] = useState("1.0");
  const [cutTipo, setCutTipo] = useState<"horizontal" | "vertical">("horizontal");
  const [cutCor, setCutCor] = useState("Automática (uma por painel)");
  const [cutInverter, setCutInverter] = useState(false);
  const [cutCidade, setCutCidade] = useState(false);
  const [cutCidadeCor, setCutCidadeCor] = useState("Preto");
  const [cutCidadeLarg, setCutCidadeLarg] = useState("4.0");
  const [cutCidadeAlt, setCutCidadeAlt] = useState("1.0");
  const [cutCidadeMargem, setCutCidadeMargem] = useState("1.0");
  const [cutOverrides, setCutOverrides] = useState<Record<string, string>>({});
  const [cutSimulacao, setCutSimulacao] = useState<CortadorSimulacao | null>(null);
  const [cutSimulando, setCutSimulando] = useState(false);
  const [cutRodando, setCutRodando] = useState(false);
  const [cutProgresso, setCutProgresso] = useState(0);
  const [cutLogs, setCutLogs] = useState<string[]>([]);
  const [cutErro, setCutErro] = useState<string | null>(null);

  const mostrarToast = useCallback((tipo: "ok" | "erro", texto: string) => {
    setToast({ tipo, texto });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(t);
  }, [toast]);

  const salvarConfig = useCallback((proximo: ExplorerConfig) => {
    setConfig(proximo);
    invoke("explorer_save_config", { config: proximo }).catch(() => {});
  }, []);

  const carregarDiretorio = useCallback(
    async (caminho: string, opts?: { pushHistory?: boolean; mostrarOcultos?: boolean }) => {
      const pushHistory = opts?.pushHistory ?? true;
      const ocultarFlag = opts?.mostrarOcultos ?? config.mostrar_ocultos;
      setCarregando(true);
      setErro(null);
      try {
        const res = await invoke<ExplorerListagem>("explorer_listar_dir", {
          caminho,
          mostrarOcultos: ocultarFlag,
        });
        setListagem(res);
        setSelecionados([]);
        setUltimoAnchor(null);
        setBusca("");
        setEditandoEndereco(false);

        if (pushHistory) {
          setHistorico((prev) => {
            const cortado = prev.slice(0, histIdx + 1);
            if (cortado[cortado.length - 1] === res.caminho) {
              return cortado;
            }
            const novo = [...cortado, res.caminho];
            setHistIdx(novo.length - 1);
            return novo;
          });
        }

        setConfig((prev) => {
          if (prev.ultima_pasta === res.caminho) return prev;
          const atualizado = { ...prev, ultima_pasta: res.caminho };
          invoke("explorer_save_config", { config: atualizado }).catch(() => {});
          return atualizado;
        });
      } catch (e) {
        setErro(String(e));
      } finally {
        setCarregando(false);
      }
    },
    [config.mostrar_ocultos, histIdx]
  );

  // Inicialização: carrega config + raízes + abre pasta inicial válida
  useEffect(() => {
    let ativo = true;
    (async () => {
      try {
        const [cfg, rzs] = await Promise.all([
          invoke<ExplorerConfig>("explorer_get_config"),
          invoke<ExplorerRaiz[]>("explorer_listar_raizes"),
        ]);
        if (!ativo) return;
        const cfgNorm: ExplorerConfig = {
          favoritos: cfg.favoritos ?? [],
          modo_visao: cfg.modo_visao === "lista" ? "lista" : "grade",
          mostrar_ocultos: !!cfg.mostrar_ocultos,
          mostrar_preview: cfg.mostrar_preview ?? true,
          ultima_pasta: cfg.ultima_pasta ?? null,
        };
        setConfig(cfgNorm);
        setRaizes(rzs);

        // Escolhe primeira pasta existente: ultima_pasta -> Pasta do Dia -> Base -> Home -> 1ª raiz existente
        const candidatos: string[] = [];
        if (cfgNorm.ultima_pasta) candidatos.push(cfgNorm.ultima_pasta);
        for (const r of rzs) {
          if (r.existe) candidatos.push(r.caminho);
        }

        for (const c of candidatos) {
          try {
            const res = await invoke<ExplorerListagem>("explorer_listar_dir", {
              caminho: c,
              mostrarOcultos: cfgNorm.mostrar_ocultos,
            });
            if (!ativo) return;
            setListagem(res);
            setHistorico([res.caminho]);
            setHistIdx(0);
            return;
          } catch {
            // tenta próximo candidato
          }
        }
        if (ativo) setErro("Nenhum diretório inicial acessível.");
      } catch (e) {
        if (ativo) setErro(String(e));
      }
    })();
    return () => {
      ativo = false;
    };
  }, []);

  // Lista filtrada e ordenada (pastas sempre primeiro, estilo Windows Explorer)
  const itensVisiveis = useMemo(() => {
    if (!listagem) return [];
    const q = busca.trim().toLowerCase();
    const filtrados = q
      ? listagem.itens.filter(
          (i) => i.nome.toLowerCase().includes(q) || i.extensao.toLowerCase().includes(q)
        )
      : [...listagem.itens];

    const mult = sortDir === "asc" ? 1 : -1;
    filtrados.sort((a, b) => {
      if (a.eh_pasta !== b.eh_pasta) return a.eh_pasta ? -1 : 1;
      switch (sortKey) {
        case "nome":
          return a.nome.localeCompare(b.nome, "pt-BR", { numeric: true, sensitivity: "base" }) * mult;
        case "modificado":
          return (a.modificado_ms - b.modificado_ms) * mult;
        case "tipo":
          return tipoLabel(a).localeCompare(tipoLabel(b), "pt-BR") * mult || a.nome.localeCompare(b.nome, "pt-BR");
        case "tamanho":
          return (a.tamanho_bytes - b.tamanho_bytes) * mult;
      }
    });
    return filtrados;
  }, [listagem, busca, sortKey, sortDir]);

  const itensSelecionadosObj = useMemo(() => {
    const set = new Set(selecionados);
    return itensVisiveis.filter((i) => set.has(i.caminho));
  }, [itensVisiveis, selecionados]);

  const paineisSelecionados = useMemo(
    () => itensSelecionadosObj.filter(ehCortavel),
    [itensSelecionadosObj]
  );

  const itemUnico = itensSelecionadosObj.length === 1 ? itensSelecionadosObj[0] : null;

  // Fila concorrente controlada com BATCHING de atualizações para evitar re-renders excessivos
  // e podar o cache de memória da WebView quando ultrapassar 350 itens
  useEffect(() => {
    const imagensParaCarregar = itensVisiveis.filter(
      (it) => !it.eh_pasta && IMAGE_EXTS.has(it.extensao) && !thumbMapRef.current[it.caminho]
    );
    if (imagensParaCarregar.length === 0) return;

    let cancelado = false;
    let cursor = 0;
    const CONCORRENCIA = 2;

    let pendingBatch: Record<string, ImagemPreviewInfo> = {};
    let batchTimer: number | null = null;

    const flushBatch = () => {
      if (Object.keys(pendingBatch).length === 0) return;
      const snapshot = { ...pendingBatch };
      pendingBatch = {};
      setThumbMap((prev) => {
        let atual = { ...prev, ...snapshot };
        // Poda preventiva: se o cache de miniaturas na RAM do WebView ultrapassar 350 itens, poda os mais antigos
        const chaves = Object.keys(atual);
        if (chaves.length > 350) {
          const podado: Record<string, ImagemPreviewInfo> = {};
          const manter = chaves.slice(chaves.length - 200);
          for (const k of manter) {
            podado[k] = atual[k];
          }
          atual = podado;
        }
        return atual;
      });
    };

    const worker = async () => {
      while (!cancelado) {
        const idx = cursor++;
        if (idx >= imagensParaCarregar.length) break;
        const alvo = imagensParaCarregar[idx];
        if (thumbMapRef.current[alvo.caminho]) continue;
        try {
          const info = await invoke<ImagemPreviewInfo>("explorer_inspecionar_imagem", {
            caminho: alvo.caminho,
          });
          if (cancelado) break;
          thumbMapRef.current[alvo.caminho] = info;
          pendingBatch[alvo.caminho] = info;

          if (Object.keys(pendingBatch).length >= 4) {
            if (batchTimer) {
              window.clearTimeout(batchTimer);
              batchTimer = null;
            }
            flushBatch();
          } else if (!batchTimer) {
            batchTimer = window.setTimeout(() => {
              batchTimer = null;
              flushBatch();
            }, 120);
          }
        } catch {
          // ignora arquivo corrompido ou inacessível
        }
      }
      flushBatch();
    };

    const workers = Array.from(
      { length: Math.min(CONCORRENCIA, imagensParaCarregar.length) },
      () => worker()
    );
    Promise.all(workers).catch(() => {});

    return () => {
      cancelado = true;
      if (batchTimer) {
        window.clearTimeout(batchTimer);
        batchTimer = null;
      }
      flushBatch();
    };
  }, [itensVisiveis]);

  // Carrega pré-visualização e telemetria RIP quando 1 imagem está selecionada
  useEffect(() => {
    if (!config.mostrar_preview || !itemUnico || itemUnico.eh_pasta || !IMAGE_EXTS.has(itemUnico.extensao)) {
      setPreviewInfo(null);
      setPreviewErro(null);
      setPreviewLoading(false);
      return;
    }

    const cached = thumbMap[itemUnico.caminho];
    if (cached) {
      setPreviewInfo(cached);
      setPreviewErro(null);
      setPreviewLoading(false);
      return;
    }

    let cancelado = false;
    setPreviewLoading(true);
    setPreviewErro(null);
    setPreviewInfo(null);

    invoke<ImagemPreviewInfo>("explorer_inspecionar_imagem", { caminho: itemUnico.caminho })
      .then((info) => {
        if (!cancelado) {
          setPreviewInfo(info);
          setThumbMap((prev) => ({ ...prev, [itemUnico.caminho]: info }));
        }
      })
      .catch((e) => {
        if (!cancelado) setPreviewErro(String(e));
      })
      .finally(() => {
        if (!cancelado) setPreviewLoading(false);
      });

    return () => {
      cancelado = true;
    };
  }, [config.mostrar_preview, itemUnico, thumbMap]);

  // Fecha menu de contexto ao clicar fora
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, [ctxMenu]);

  // Navegação
  const podeVoltar = histIdx > 0;
  const podeAvancar = histIdx >= 0 && histIdx < historico.length - 1;

  const irVoltar = useCallback(() => {
    if (!podeVoltar) return;
    const novoIdx = histIdx - 1;
    setHistIdx(novoIdx);
    carregarDiretorio(historico[novoIdx], { pushHistory: false });
  }, [podeVoltar, histIdx, historico, carregarDiretorio]);

  const irAvancar = useCallback(() => {
    if (!podeAvancar) return;
    const novoIdx = histIdx + 1;
    setHistIdx(novoIdx);
    carregarDiretorio(historico[novoIdx], { pushHistory: false });
  }, [podeAvancar, histIdx, historico, carregarDiretorio]);

  const irAcima = useCallback(() => {
    if (listagem?.pai) {
      carregarDiretorio(listagem.pai);
    }
  }, [listagem, carregarDiretorio]);

  const atualizar = useCallback(() => {
    if (listagem?.caminho) {
      carregarDiretorio(listagem.caminho, { pushHistory: false });
    }
    invoke<ExplorerRaiz[]>("explorer_listar_raizes").then(setRaizes).catch(() => {});
  }, [listagem, carregarDiretorio]);

  // Ouvintes do Cortador para execução de corte direto no Explorer
  useEffect(() => {
    const unSt = listen<boolean>("cortador-status", (e) => setCutRodando(e.payload));
    const unProg = listen<{ current: number; total: number }>("cortador-progress", (e) => {
      setCutProgresso(e.payload.total > 0 ? (e.payload.current / e.payload.total) * 100 : 0);
    });
    const unLog = listen<string>("cortador-log", (e) => {
      setCutLogs((prev) => [...prev.slice(-300), e.payload]);
    });
    const unDone = listen<{ ok: number; err: number; cancelled: boolean }>("cortador-done", (e) => {
      if (e.payload.ok > 0) {
        mostrarToast("ok", `Corte finalizado: ${e.payload.ok} painel(is) fatiado(s) com sucesso!`);
        atualizar();
      } else if (e.payload.err > 0) {
        mostrarToast("erro", `Corte concluído com ${e.payload.err} erro(s).`);
      }
    });
    return () => {
      unSt.then((fn) => fn());
      unProg.then((fn) => fn());
      unLog.then((fn) => fn());
      unDone.then((fn) => fn());
    };
  }, [atualizar, mostrarToast]);

  const abrirModalCorte = useCallback(
    async (alvos?: ExplorerItem[]) => {
      const lista = (alvos ?? paineisSelecionados).filter(ehCortavel);
      if (lista.length === 0) {
        mostrarToast("erro", "Selecione ao menos um painel (imagem ainda não cortada) para fatiar.");
        return;
      }
      setCutErro(null);
      setCutLogs([]);
      setCutProgresso(0);
      setModalCortar(lista);

      try {
        const cfg = await invoke<Record<string, any>>("cortador_get_config");
        if (cfg.modo === "Medidas personalizadas" || cfg.modo === "Automático") {
          setCutModo(cfg.modo);
        }
        const a = cfg.auto || {};
        setCutGabarito(a.gabarito || cfg.medidas?.gabarito || "");
        setCutMedida(String(a.medida ?? 150));
        setCutSobra(String(a.sobreposicao ?? 0.5));
        setCutPad(String(a.pad ?? 1.0));
        setCutTipo(a.tipo === "vertical" ? "vertical" : "horizontal");
        setCutCor(a.cor || "Automática (uma por painel)");
        setCutInverter(Boolean(a.inverter));
        setCutCidade(Boolean(a.cidade));
        setCutCidadeCor(a.cidade_cor || "Preto");
        setCutCidadeLarg(String(a.cidade_largura ?? 4.0));
        setCutCidadeAlt(String(a.cidade_altura ?? 1.0));
        setCutCidadeMargem(String(a.cidade_margem ?? 1.0));
        setCutOverrides(a.overrides || {});
        const m = cfg.medidas || {};
        if (m.medidas) {
          setCutMedidasLista(Array.isArray(m.medidas) ? m.medidas.join(",") : String(m.medidas));
        }
      } catch {
        // usa padrões
      }
    },
    [paineisSelecionados, mostrarToast]
  );

  // Simula automaticamente sempre que abrir o modal ou alterar parâmetros de corte
  useEffect(() => {
    if (!modalCortar || modalCortar.length === 0) {
      setCutSimulacao(null);
      return;
    }
    let cancelado = false;
    setCutSimulando(true);
    const pastaAtual = listagem?.caminho || "";
    const arquivos = modalCortar.map((i) => i.caminho);

    const runSim = async () => {
      try {
        if (cutModo === "Automático") {
          const res = await invoke<CortadorSimulacao>("cortador_simular_auto", {
            payload: {
              pasta: pastaAtual,
              arquivos,
              gabarito: cutGabarito,
              saida: "",
              medida: Math.max(1, Number(cutMedida.replace(",", ".")) || 150),
              sobreposicao: Math.max(0, Number(cutSobra.replace(",", ".")) || 0.5),
              pad: Math.max(0, Number(cutPad.replace(",", ".")) || 1.0),
              tipo: cutTipo,
              workers: 4,
              cor: cutCor,
              inverter: cutInverter,
              mover: false,
              cidade: cutCidade,
              cidade_cor: cutCidadeCor,
              cidade_largura: Number(cutCidadeLarg.replace(",", ".")) || 4.0,
              cidade_altura: Number(cutCidadeAlt.replace(",", ".")) || 1.0,
              cidade_margem: Number(cutCidadeMargem.replace(",", ".")) || 1.0,
              overrides: cutOverrides,
            },
          });
          if (!cancelado) setCutSimulacao(res);
        } else {
          const lista = cutMedidasLista
            .split(",")
            .map((s) => Number(s.trim().replace(",", ".")))
            .filter((n) => !Number.isNaN(n) && n > 0);
          if (lista.length === 0) {
            if (!cancelado) setCutSimulacao(null);
            return;
          }
          const res = await invoke<CortadorSimulacao>("cortador_simular_medidas", {
            payload: {
              entrada: pastaAtual,
              arquivos,
              saida: "",
              gabarito: cutGabarito,
              medidas: lista,
              sobreposicao: Math.max(0, Number(cutSobra.replace(",", ".")) || 0.5),
              pad: Math.max(0, Number(cutPad.replace(",", ".")) || 1.0),
              tipo: cutTipo,
              cor: cutCor.startsWith("Automática") ? "Preto" : cutCor,
              inverter: cutInverter,
              mover: false,
            },
          });
          if (!cancelado) setCutSimulacao(res);
        }
      } catch (e) {
        if (!cancelado) setCutErro(String(e));
      } finally {
        if (!cancelado) setCutSimulando(false);
      }
    };
    runSim();
    return () => {
      cancelado = true;
    };
  }, [
    modalCortar,
    listagem?.caminho,
    cutModo,
    cutGabarito,
    cutMedida,
    cutMedidasLista,
    cutSobra,
    cutPad,
    cutTipo,
    cutCor,
    cutInverter,
    cutCidade,
    cutCidadeCor,
    cutCidadeLarg,
    cutCidadeAlt,
    cutCidadeMargem,
    cutOverrides,
  ]);

  const selecionarGabaritoCorte = async () => {
    const f = await open({
      multiple: false,
      defaultPath: cutGabarito || listagem?.caminho || undefined,
      filters: [{ name: "Imagens", extensions: ["png", "tif", "tiff", "jpg", "jpeg"] }],
    });
    if (typeof f === "string") setCutGabarito(f);
  };

  const executarCorteDireto = async () => {
    if (!modalCortar || modalCortar.length === 0 || cutRodando) return;
    if (!cutGabarito.trim()) {
      setCutErro("Selecione o arquivo de Gabarito antes de cortar.");
      return;
    }
    setCutErro(null);
    setCutLogs([]);
    setCutProgresso(0);

    const pastaAtual = listagem?.caminho || "";
    const arquivos = modalCortar.map((i) => i.caminho);

    try {
      if (cutModo === "Automático") {
        const autoPayload = {
          pasta: pastaAtual,
          arquivos,
          gabarito: cutGabarito.trim(),
          saida: "",
          medida: Math.max(1, Number(cutMedida.replace(",", ".")) || 150),
          sobreposicao: Math.max(0, Number(cutSobra.replace(",", ".")) || 0.5),
          pad: Math.max(0, Number(cutPad.replace(",", ".")) || 1.0),
          tipo: cutTipo,
          workers: 4,
          cor: cutCor,
          inverter: cutInverter,
          mover: false,
          cidade: cutCidade,
          cidade_cor: cutCidadeCor,
          cidade_largura: Number(cutCidadeLarg.replace(",", ".")) || 4.0,
          cidade_altura: Number(cutCidadeAlt.replace(",", ".")) || 1.0,
          cidade_margem: Number(cutCidadeMargem.replace(",", ".")) || 1.0,
          overrides: cutOverrides,
        };
        await invoke("cortador_executar_auto", { payload: autoPayload });
      } else {
        const lista = cutMedidasLista
          .split(",")
          .map((s) => Number(s.trim().replace(",", ".")))
          .filter((n) => !Number.isNaN(n) && n > 0);
        if (lista.length === 0) {
          setCutErro("Informe ao menos uma medida válida separada por vírgula (ex: 140,150,125).");
          return;
        }
        await invoke("cortador_executar_medidas", {
          payload: {
            entrada: pastaAtual,
            arquivos,
            saida: "",
            gabarito: cutGabarito.trim(),
            medidas: lista,
            sobreposicao: Math.max(0, Number(cutSobra.replace(",", ".")) || 0.5),
            pad: Math.max(0, Number(cutPad.replace(",", ".")) || 1.0),
            tipo: cutTipo,
            cor: cutCor.startsWith("Automática") ? "Preto" : cutCor,
            inverter: cutInverter,
            mover: false,
          },
        });
      }
    } catch (e) {
      setCutErro(String(e));
    }
  };

  const abrirNaAbaCortador = (alvos?: ExplorerItem[]) => {
    const lista = (alvos ?? modalCortar ?? paineisSelecionados).filter(ehCortavel);
    if (lista.length === 0) return;
    sessionStorage.setItem(
      "pcp-cortador-preselecionados",
      JSON.stringify({
        arquivos: lista.map((i) => i.caminho),
        pasta: listagem?.caminho || "",
      })
    );
    setModalCortar(null);
    onNavigate?.("cortador");
  };

  const abrirItem = useCallback(
    async (item: ExplorerItem) => {
      if (item.eh_pasta) {
        carregarDiretorio(item.caminho);
      } else {
        try {
          await openPath(item.caminho);
        } catch (e) {
          mostrarToast("erro", `Erro ao abrir arquivo: ${e}`);
        }
      }
    },
    [carregarDiretorio, mostrarToast]
  );

  const revelarNoSistema = useCallback(
    async (caminho: string) => {
      try {
        await invoke("explorer_revelar_no_sistema", { caminho });
      } catch (e) {
        mostrarToast("erro", String(e));
      }
    },
    [mostrarToast]
  );

  const copiarCaminho = useCallback(
    async (caminho: string) => {
      try {
        await navigator.clipboard.writeText(caminho);
        setCopiadoCaminho(true);
        mostrarToast("ok", "Caminho copiado para a área de transferência");
        window.setTimeout(() => setCopiadoCaminho(false), 1800);
      } catch {
        mostrarToast("erro", "Não foi possível copiar o caminho");
      }
    },
    [mostrarToast]
  );

  // Operações de arquivo
  const acaoCopiar = useCallback(
    (mover: boolean, alvoEspecifico?: ExplorerItem[]) => {
      const lista = alvoEspecifico ?? itensSelecionadosObj;
      if (lista.length === 0) return;
      setClipboard({ caminhos: lista.map((i) => i.caminho), mover });
      mostrarToast(
        "ok",
        `${lista.length} item(ns) ${mover ? "recortado(s)" : "copiado(s)"} — pressione Ctrl+V para colar`
      );
    },
    [itensSelecionadosObj, mostrarToast]
  );

  const acaoColar = useCallback(async () => {
    if (!clipboard || !listagem?.caminho || operando) return;
    setOperando(true);
    try {
      const res = await invoke<OperacaoResultado>("explorer_copiar_ou_mover", {
        origens: clipboard.caminhos,
        destinoDir: listagem.caminho,
        mover: clipboard.mover,
      });
      if (clipboard.mover) setClipboard(null);
      if (res.falhas.length > 0) {
        mostrarToast("erro", `${res.ok} concluído(s), ${res.falhas.length} falha(s): ${res.falhas[0]}`);
      } else {
        mostrarToast(
          "ok",
          `${res.ok} item(ns) ${clipboard.mover ? "movido(s)" : "colado(s)"} com sucesso`
        );
      }
      await carregarDiretorio(listagem.caminho, { pushHistory: false });
    } catch (e) {
      mostrarToast("erro", String(e));
    } finally {
      setOperando(false);
    }
  }, [clipboard, listagem, operando, carregarDiretorio, mostrarToast]);

  const confirmarNovaPasta = useCallback(async () => {
    if (!listagem?.caminho || !novaPastaNome.trim()) return;
    setOperando(true);
    try {
      const criado = await invoke<string>("explorer_criar_pasta", {
        pai: listagem.caminho,
        nome: novaPastaNome.trim(),
      });
      setModalNovaPasta(false);
      setNovaPastaNome("");
      await carregarDiretorio(listagem.caminho, { pushHistory: false });
      setSelecionados([criado]);
      mostrarToast("ok", "Pasta criada com sucesso");
    } catch (e) {
      mostrarToast("erro", String(e));
    } finally {
      setOperando(false);
    }
  }, [listagem, novaPastaNome, carregarDiretorio, mostrarToast]);

  const confirmarRenomear = useCallback(async () => {
    if (!modalRenomear || !listagem?.caminho || !renomearNome.trim()) return;
    setOperando(true);
    try {
      const novoCaminho = await invoke<string>("explorer_renomear", {
        caminho: modalRenomear.caminho,
        novoNome: renomearNome.trim(),
      });
      setModalRenomear(null);
      setRenomearNome("");
      await carregarDiretorio(listagem.caminho, { pushHistory: false });
      setSelecionados([novoCaminho]);
      mostrarToast("ok", "Item renomeado");
    } catch (e) {
      mostrarToast("erro", String(e));
    } finally {
      setOperando(false);
    }
  }, [modalRenomear, listagem, renomearNome, carregarDiretorio, mostrarToast]);

  const confirmarExcluir = useCallback(async () => {
    if (!modalExcluir || !listagem?.caminho) return;
    setOperando(true);
    try {
      const res = await invoke<OperacaoResultado>("explorer_excluir", {
        caminhos: modalExcluir.map((i) => i.caminho),
      });
      setModalExcluir(null);
      if (res.falhas.length > 0) {
        mostrarToast("erro", `${res.ok} excluído(s), ${res.falhas.length} falha(s): ${res.falhas[0]}`);
      } else {
        mostrarToast("ok", `${res.ok} item(ns) excluído(s)`);
      }
      await carregarDiretorio(listagem.caminho, { pushHistory: false });
    } catch (e) {
      mostrarToast("erro", String(e));
    } finally {
      setOperando(false);
    }
  }, [modalExcluir, listagem, carregarDiretorio, mostrarToast]);

  const toggleFavorito = useCallback(
    (caminho: string) => {
      const jaTem = config.favoritos.includes(caminho);
      const favoritos = jaTem
        ? config.favoritos.filter((f) => f !== caminho)
        : [...config.favoritos, caminho];
      salvarConfig({ ...config, favoritos });
      mostrarToast("ok", jaTem ? "Removido do Acesso Rápido" : "Fixado no Acesso Rápido");
    },
    [config, salvarConfig, mostrarToast]
  );

  const toggleOcultos = useCallback(() => {
    const proximo = !config.mostrar_ocultos;
    salvarConfig({ ...config, mostrar_ocultos: proximo });
    if (listagem?.caminho) {
      carregarDiretorio(listagem.caminho, { pushHistory: false, mostrarOcultos: proximo });
    }
  }, [config, salvarConfig, listagem, carregarDiretorio]);

  const togglePreview = useCallback(() => {
    salvarConfig({ ...config, mostrar_preview: !config.mostrar_preview });
  }, [config, salvarConfig]);

  const setModoVisao = useCallback(
    (modo: "lista" | "grade") => {
      salvarConfig({ ...config, modo_visao: modo });
    },
    [config, salvarConfig]
  );

  const alternarOrdem = (col: SortKey) => {
    if (sortKey === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(col);
      setSortDir("asc");
    }
  };

  // Seleção estilo Windows Explorer (Clique / Ctrl+Clique / Shift+Clique)
  const selecionarItem = (item: ExplorerItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (e.shiftKey && ultimoAnchor) {
      const idxA = itensVisiveis.findIndex((x) => x.caminho === ultimoAnchor);
      const idxB = itensVisiveis.findIndex((x) => x.caminho === item.caminho);
      if (idxA >= 0 && idxB >= 0) {
        const [ini, fim] = idxA < idxB ? [idxA, idxB] : [idxB, idxA];
        setSelecionados(itensVisiveis.slice(ini, fim + 1).map((x) => x.caminho));
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) {
      setSelecionados((prev) =>
        prev.includes(item.caminho) ? prev.filter((c) => c !== item.caminho) : [...prev, item.caminho]
      );
      setUltimoAnchor(item.caminho);
      return;
    }
    setSelecionados([item.caminho]);
    setUltimoAnchor(item.caminho);
  };

  // Atalhos de teclado da tela via usePageShortcuts
  usePageShortcuts([
    {
      id: "exp-refresh",
      combo: "ctrl+r",
      keys: "Ctrl+R",
      label: "Atualizar pasta atual",
      action: atualizar,
    },
    {
      id: "exp-search",
      combo: "ctrl+f",
      keys: "Ctrl+F",
      label: "Filtrar itens na pasta atual",
      action: () => {
        buscaRef.current?.focus();
        buscaRef.current?.select();
      },
    },
    {
      id: "exp-address",
      combo: "alt+d",
      keys: "Alt+D",
      label: "Editar barra de endereço",
      action: () => {
        if (!listagem) return;
        setEnderecoInput(listagem.caminho);
        setEditandoEndereco(true);
        requestAnimationFrame(() => {
          enderecoRef.current?.focus();
          enderecoRef.current?.select();
        });
      },
    },
    {
      id: "exp-newfolder",
      combo: "ctrl+shift+n",
      keys: "Ctrl+Shift+N",
      label: "Criar nova pasta",
      action: () => {
        if (!listagem) return;
        setNovaPastaNome("Nova pasta");
        setModalNovaPasta(true);
      },
    },
    {
      id: "exp-preview",
      combo: "alt+p",
      keys: "Alt+P",
      label: "Mostrar/ocultar painel de pré-visualização",
      action: togglePreview,
    },
    {
      id: "exp-selectall",
      combo: "ctrl+a",
      keys: "Ctrl+A",
      label: "Selecionar todos os itens",
      action: () => setSelecionados(itensVisiveis.map((i) => i.caminho)),
      allowInInput: false,
    },
    {
      id: "exp-copy",
      combo: "ctrl+c",
      keys: "Ctrl+C",
      label: "Copiar selecionados",
      action: () => acaoCopiar(false),
      allowInInput: false,
    },
    {
      id: "exp-cut",
      combo: "ctrl+x",
      keys: "Ctrl+X",
      label: "Recortar selecionados",
      action: () => acaoCopiar(true),
      allowInInput: false,
    },
    {
      id: "exp-paste",
      combo: "ctrl+v",
      keys: "Ctrl+V",
      label: "Colar na pasta atual",
      action: () => {
        acaoColar();
      },
      allowInInput: false,
    },
    {
      id: "exp-rename",
      combo: "f2",
      keys: "F2",
      label: "Renomear item selecionado",
      action: () => {
        if (itemUnico) {
          setModalRenomear(itemUnico);
          setRenomearNome(itemUnico.nome);
        }
      },
      allowInInput: false,
    },
    {
      id: "exp-delete",
      combo: "delete",
      keys: "Del",
      label: "Excluir selecionado(s)",
      action: () => {
        if (itensSelecionadosObj.length > 0) {
          setModalExcluir(itensSelecionadosObj);
        }
      },
      allowInInput: false,
    },
    {
      id: "exp-up",
      combo: "backspace",
      keys: "Backspace",
      label: "Subir para a pasta pai",
      action: irAcima,
      allowInInput: false,
    },
    {
      id: "exp-cut-panel",
      combo: "ctrl+e",
      keys: "Ctrl+E",
      label: "Cortar Painel(is) Selecionado(s)",
      action: () => {
        if (paineisSelecionados.length > 0) abrirModalCorte(paineisSelecionados);
      },
      allowInInput: false,
    },
  ]);

  // Navegação por setas (↑/↓) e Enter na lista de arquivos
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (modalNovaPasta || modalRenomear || modalExcluir || editandoEndereco) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (itensVisiveis.length === 0) return;
        e.preventDefault();
        const curIdx = selecionados.length > 0
          ? itensVisiveis.findIndex((i) => i.caminho === selecionados[selecionados.length - 1])
          : -1;
        const nextIdx =
          e.key === "ArrowDown"
            ? Math.min(itensVisiveis.length - 1, curIdx + 1)
            : Math.max(0, curIdx <= 0 ? 0 : curIdx - 1);
        const alvo = itensVisiveis[nextIdx];
        if (alvo) {
          setSelecionados([alvo.caminho]);
          setUltimoAnchor(alvo.caminho);
        }
      } else if (e.key === "Enter" && itemUnico) {
        e.preventDefault();
        abrirItem(itemUnico);
      } else if (e.key === "F5") {
        e.preventDefault();
        atualizar();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    itensVisiveis,
    selecionados,
    itemUnico,
    abrirItem,
    atualizar,
    modalNovaPasta,
    modalRenomear,
    modalExcluir,
    editandoEndereco,
  ]);

  const tamanhoSelecionados = useMemo(
    () => itensSelecionadosObj.reduce((acc, i) => acc + i.tamanho_bytes, 0),
    [itensSelecionadosObj]
  );

  const pastaAtualFavorita = listagem ? config.favoritos.includes(listagem.caminho) : false;

  const raizesPcp = raizes.filter((r) => r.grupo === "pcp");
  const raizesUsuario = raizes.filter((r) => r.grupo === "usuario");
  const raizesUnidade = raizes.filter((r) => r.grupo === "unidade");

  return (
    <div className="h-full flex flex-col bg-[#f8f9fa] dark:bg-[#09090b] overflow-hidden">
      {/* Cabeçalho compacto */}
      <div className="px-4 pt-3 pb-2 bg-white dark:bg-[#0e0e11] border-b border-slate-200 dark:border-zinc-800 shrink-0">
        <PageHeader
          icon={<FolderOpen className="w-4 h-4 text-slate-700 dark:text-zinc-300" />}
          title="Explorer de Arquivos"
          badge="EXP-02"
          subtitle="Navegação local e rede (Z:\) com operações estilo Windows Explorer e inspeção RIP"
          right={
            listagem && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => toggleFavorito(listagem.caminho)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-[11px] font-mono font-semibold cursor-pointer transition-colors ${
                    pastaAtualFavorita
                      ? "border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400"
                      : "border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800"
                  }`}
                  title={pastaAtualFavorita ? "Desafixar pasta atual do Acesso Rápido" : "Fixar pasta atual no Acesso Rápido"}
                >
                  {pastaAtualFavorita ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                  <span>{pastaAtualFavorita ? "DESAFIXAR" : "FIXAR"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => revelarNoSistema(listagem.caminho)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800 text-[11px] font-mono font-semibold cursor-pointer transition-colors"
                  title="Abrir pasta atual no gerenciador de arquivos do sistema"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>EXPLORER SO</span>
                </button>
              </div>
            )
          }
        />

        {/* Barra de Navegação + Endereço (Breadcrumbs / Input) + Busca */}
        <div className="mt-2.5 flex items-center gap-2">
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              onClick={irVoltar}
              disabled={!podeVoltar}
              className="p-1.5 rounded border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-slate-700 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
              title="Voltar"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={irAvancar}
              disabled={!podeAvancar}
              className="p-1.5 rounded border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-slate-700 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
              title="Avançar"
            >
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={irAcima}
              disabled={!listagem?.pai}
              className="p-1.5 rounded border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-slate-700 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
              title="Subir um nível (Backspace)"
            >
              <ArrowUp className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={atualizar}
              className="p-1.5 rounded border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-slate-700 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 cursor-pointer"
              title="Atualizar (F5 / Ctrl+R)"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${carregando ? "animate-spin" : ""}`} />
            </button>
          </div>

          {/* Barra de Endereço estilo Windows */}
          <div
            className="flex-1 min-w-0 h-8 rounded border border-slate-300 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-950 flex items-center px-2 overflow-hidden cursor-text"
            onClick={() => {
              if (!editandoEndereco && listagem) {
                setEnderecoInput(listagem.caminho);
                setEditandoEndereco(true);
                requestAnimationFrame(() => {
                  enderecoRef.current?.focus();
                  enderecoRef.current?.select();
                });
              }
            }}
            title="Clique ou pressione Alt+D para digitar um caminho"
          >
            {editandoEndereco ? (
              <form
                className="w-full flex items-center gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (enderecoInput.trim()) carregarDiretorio(enderecoInput.trim());
                }}
              >
                <input
                  ref={enderecoRef}
                  type="text"
                  value={enderecoInput}
                  onChange={(e) => setEnderecoInput(e.target.value)}
                  onBlur={() => setEditandoEndereco(false)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      setEditandoEndereco(false);
                    }
                  }}
                  className="w-full bg-transparent text-xs font-mono text-slate-900 dark:text-zinc-100 outline-none select-text"
                />
              </form>
            ) : (
              <div className="flex items-center gap-0.5 overflow-x-auto no-scrollbar w-full">
                {listagem?.breadcrumbs.map((b, idx) => (
                  <div key={b.caminho} className="flex items-center shrink-0">
                    {idx > 0 && <ChevronRight className="w-3 h-3 text-slate-400 dark:text-zinc-600 mx-0.5" />}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        carregarDiretorio(b.caminho);
                      }}
                      className="px-1.5 py-0.5 rounded text-xs font-mono text-slate-700 dark:text-zinc-300 hover:bg-slate-200 dark:hover:bg-zinc-800 hover:text-slate-900 dark:hover:text-white cursor-pointer transition-colors"
                    >
                      {b.nome}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Busca na pasta */}
          <div className="relative w-56 shrink-0">
            <Search className="w-3.5 h-3.5 text-slate-400 dark:text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              ref={buscaRef}
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Filtrar pasta (Ctrl+F)"
              className="w-full h-8 pl-8 pr-7 rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono text-slate-800 dark:text-zinc-200 placeholder:text-slate-400 dark:placeholder:text-zinc-500 focus:outline-none focus:border-blue-500"
            />
            {busca && (
              <button
                type="button"
                onClick={() => setBusca("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Barra de Comandos (Ribbon compacto) */}
        <div className="mt-2 pt-2 border-t border-slate-100 dark:border-zinc-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => {
                setNovaPastaNome("Nova pasta");
                setModalNovaPasta(true);
              }}
              disabled={!listagem || operando}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-800 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 disabled:opacity-40 cursor-pointer"
              title="Nova pasta (Ctrl+Shift+N)"
            >
              <FolderPlus className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
              <span>NOVA PASTA</span>
            </button>

            <span className="h-4 w-px bg-slate-200 dark:bg-zinc-800 mx-0.5" />

            <button
              type="button"
              onClick={() => acaoCopiar(false)}
              disabled={itensSelecionadosObj.length === 0 || operando}
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-transparent hover:border-slate-300 dark:hover:border-zinc-700 hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-700 dark:text-zinc-300 disabled:opacity-35 cursor-pointer"
              title="Copiar (Ctrl+C)"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>COPIAR</span>
            </button>
            <button
              type="button"
              onClick={() => acaoCopiar(true)}
              disabled={itensSelecionadosObj.length === 0 || operando}
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-transparent hover:border-slate-300 dark:hover:border-zinc-700 hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-700 dark:text-zinc-300 disabled:opacity-35 cursor-pointer"
              title="Recortar (Ctrl+X)"
            >
              <Scissors className="w-3.5 h-3.5" />
              <span>RECORTAR</span>
            </button>
            <button
              type="button"
              onClick={acaoColar}
              disabled={!clipboard || !listagem || operando}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded border transition-colors disabled:opacity-35 cursor-pointer ${
                clipboard
                  ? "border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 hover:bg-blue-100"
                  : "border-transparent text-slate-700 dark:text-zinc-300"
              }`}
              title="Colar na pasta atual (Ctrl+V)"
            >
              <ClipboardPaste className="w-3.5 h-3.5" />
              <span>
                COLAR{clipboard ? ` (${clipboard.caminhos.length})` : ""}
              </span>
            </button>

            <span className="h-4 w-px bg-slate-200 dark:bg-zinc-800 mx-0.5" />

            <button
              type="button"
              onClick={() => {
                if (itemUnico) {
                  setModalRenomear(itemUnico);
                  setRenomearNome(itemUnico.nome);
                }
              }}
              disabled={!itemUnico || operando}
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-transparent hover:border-slate-300 dark:hover:border-zinc-700 hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-700 dark:text-zinc-300 disabled:opacity-35 cursor-pointer"
              title="Renomear (F2)"
            >
              <Pencil className="w-3.5 h-3.5" />
              <span>RENOMEAR</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (itensSelecionadosObj.length > 0) setModalExcluir(itensSelecionadosObj);
              }}
              disabled={itensSelecionadosObj.length === 0 || operando}
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-transparent hover:border-red-300 dark:hover:border-red-900 hover:bg-red-50 dark:hover:bg-red-950/30 text-red-600 dark:text-red-400 disabled:opacity-35 cursor-pointer"
              title="Excluir (Del)"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>EXCLUIR</span>
            </button>

            <span className="h-4 w-px bg-slate-200 dark:bg-zinc-800 mx-0.5" />

            {/* Ação de Produção: Cortar Painéis direto pelo Explorer */}
            <button
              type="button"
              onClick={() => abrirModalCorte(paineisSelecionados)}
              disabled={paineisSelecionados.length === 0 || operando}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded border font-bold transition-all cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed ${
                paineisSelecionados.length > 0
                  ? "border-emerald-600 bg-emerald-600 hover:bg-emerald-500 text-white shadow-2xs"
                  : "border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-600 dark:text-zinc-400"
              }`}
              title="Cortar painel(is) selecionado(s) direto nesta pasta sem mover arquivos (Ctrl+E)"
            >
              <Scissors className="w-3.5 h-3.5" />
              <span>
                CORTAR PAINEL{paineisSelecionados.length > 0 ? ` (${paineisSelecionados.length})` : ""}
              </span>
            </button>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={toggleOcultos}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded border cursor-pointer ${
                config.mostrar_ocultos
                  ? "border-slate-400 dark:border-zinc-600 bg-slate-200/70 dark:bg-zinc-800 text-slate-900 dark:text-zinc-100"
                  : "border-transparent text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800"
              }`}
              title="Mostrar/ocultar arquivos ocultos"
            >
              {config.mostrar_ocultos ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              <span>OCULTOS</span>
            </button>

            <div className="flex items-center rounded border border-slate-200 dark:border-zinc-800 overflow-hidden">
              <button
                type="button"
                onClick={() => setModoVisao("lista")}
                className={`p-1 cursor-pointer ${
                  config.modo_visao === "lista"
                    ? "bg-slate-900 dark:bg-zinc-100 text-white dark:text-slate-900"
                    : "bg-white dark:bg-zinc-900 text-slate-500 hover:text-slate-900 dark:hover:text-zinc-100"
                }`}
                title="Visualização em Lista Detalhada"
              >
                <List className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setModoVisao("grade")}
                className={`p-1 cursor-pointer ${
                  config.modo_visao === "grade"
                    ? "bg-slate-900 dark:bg-zinc-100 text-white dark:text-slate-900"
                    : "bg-white dark:bg-zinc-900 text-slate-500 hover:text-slate-900 dark:hover:text-zinc-100"
                }`}
                title="Visualização em Grade de Ícones"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
            </div>

            <button
              type="button"
              onClick={togglePreview}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded border cursor-pointer ${
                config.mostrar_preview
                  ? "border-slate-400 dark:border-zinc-600 bg-slate-200/70 dark:bg-zinc-800 text-slate-900 dark:text-zinc-100"
                  : "border-transparent text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800"
              }`}
              title="Alternar painel de pré-visualização e inspeção RIP (Alt+P)"
            >
              <PanelRight className="w-3.5 h-3.5" />
              <span>DETALHES</span>
            </button>
          </div>
        </div>
      </div>

      {/* Notificação / Toast operacional */}
      {toast && (
        <div
          className={`px-4 py-1.5 text-xs font-mono border-b flex items-center justify-between shrink-0 ${
            toast.tipo === "erro"
              ? "bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900 text-red-700 dark:text-red-300"
              : "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300"
          }`}
        >
          <span>{toast.texto}</span>
          <button type="button" onClick={() => setToast(null)} className="cursor-pointer opacity-70 hover:opacity-100">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Corpo principal em 3 painéis (Árvore lateral | Conteúdo | Pré-visualização) */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Painel Esquerdo: Acesso Rápido & Unidades */}
        <aside className="w-52 shrink-0 border-r border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#0e0e11] overflow-y-auto p-2 space-y-3">
          {/* Atalhos PCP */}
          <div>
            <div className="px-2 pb-1 text-[9px] font-mono font-bold tracking-wider text-slate-400 dark:text-zinc-500 uppercase">
              PRODUÇÃO PCP
            </div>
            <div className="space-y-0.5">
              {raizesPcp.map((r) => {
                const ativo = listagem?.caminho === r.caminho;
                return (
                  <button
                    key={r.caminho}
                    type="button"
                    disabled={!r.existe}
                    onClick={() => carregarDiretorio(r.caminho)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                      ativo
                        ? "bg-slate-900 dark:bg-zinc-100 text-white dark:text-slate-900 font-semibold"
                        : "text-slate-700 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800/70"
                    }`}
                    title={r.existe ? r.caminho : `${r.caminho} (não encontrado)`}
                  >
                    <RaizIcon icone={r.icone} />
                    <span className="truncate">{r.nome}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Favoritos Fixados */}
          {config.favoritos.length > 0 && (
            <div>
              <div className="px-2 pb-1 text-[9px] font-mono font-bold tracking-wider text-slate-400 dark:text-zinc-500 uppercase flex items-center gap-1">
                <Star className="w-2.5 h-2.5 text-amber-500" />
                <span>FAVORITOS</span>
              </div>
              <div className="space-y-0.5">
                {config.favoritos.map((fav) => {
                  const ativo = listagem?.caminho === fav;
                  return (
                    <div key={fav} className="group flex items-center">
                      <button
                        type="button"
                        onClick={() => carregarDiretorio(fav)}
                        className={`flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left cursor-pointer transition-colors ${
                          ativo
                            ? "bg-slate-900 dark:bg-zinc-100 text-white dark:text-slate-900 font-semibold"
                            : "text-slate-700 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800/70"
                        }`}
                        title={fav}
                      >
                        <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        <span className="truncate">{nomeDaPasta(fav)}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleFavorito(fav)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-500 cursor-pointer"
                        title="Desafixar"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Pastas do Usuário */}
          {raizesUsuario.length > 0 && (
            <div>
              <div className="px-2 pb-1 text-[9px] font-mono font-bold tracking-wider text-slate-400 dark:text-zinc-500 uppercase">
                ACESSO RÁPIDO
              </div>
              <div className="space-y-0.5">
                {raizesUsuario.map((r) => {
                  const ativo = listagem?.caminho === r.caminho;
                  return (
                    <button
                      key={r.caminho}
                      type="button"
                      disabled={!r.existe}
                      onClick={() => carregarDiretorio(r.caminho)}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left cursor-pointer transition-colors disabled:opacity-40 ${
                        ativo
                          ? "bg-slate-900 dark:bg-zinc-100 text-white dark:text-slate-900 font-semibold"
                          : "text-slate-700 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800/70"
                      }`}
                      title={r.caminho}
                    >
                      <RaizIcon icone={r.icone} />
                      <span className="truncate">{r.nome}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Unidades / Discos */}
          {raizesUnidade.length > 0 && (
            <div>
              <div className="px-2 pb-1 text-[9px] font-mono font-bold tracking-wider text-slate-400 dark:text-zinc-500 uppercase">
                ESTE COMPUTADOR
              </div>
              <div className="space-y-0.5">
                {raizesUnidade.map((r) => {
                  const ativo = listagem?.caminho === r.caminho;
                  return (
                    <button
                      key={r.caminho}
                      type="button"
                      onClick={() => carregarDiretorio(r.caminho)}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left cursor-pointer transition-colors ${
                        ativo
                          ? "bg-slate-900 dark:bg-zinc-100 text-white dark:text-slate-900 font-semibold"
                          : "text-slate-700 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800/70"
                      }`}
                      title={r.caminho}
                    >
                      <HardDrive className="w-3.5 h-3.5 text-slate-500 dark:text-zinc-400 shrink-0" />
                      <span className="truncate font-mono">{r.nome}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </aside>

        {/* Painel Central: Lista Detalhada ou Grade */}
        <section
          className="flex-1 min-w-0 flex flex-col bg-white dark:bg-[#111115] overflow-hidden"
          onClick={() => setSelecionados([])}
          onContextMenu={(e) => {
            e.preventDefault();
            setCtxMenu({ x: e.clientX, y: e.clientY, item: null });
          }}
        >
          {erro ? (
            <div className="m-4 p-4 rounded border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 text-xs font-mono flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{erro}</span>
            </div>
          ) : config.modo_visao === "lista" ? (
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-[#0e0e11] border-b border-slate-200 dark:border-zinc-800 text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                  <tr>
                    <th className="py-2 pl-3 pr-2 font-semibold">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          alternarOrdem("nome");
                        }}
                        className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-zinc-100 cursor-pointer"
                      >
                        NOME
                        {sortKey === "nome" &&
                          (sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                      </button>
                    </th>
                    <th className="py-2 px-2 font-semibold w-36">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          alternarOrdem("modificado");
                        }}
                        className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-zinc-100 cursor-pointer"
                      >
                        MODIFICADO
                        {sortKey === "modificado" &&
                          (sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                      </button>
                    </th>
                    <th className="py-2 px-2 font-semibold w-36">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          alternarOrdem("tipo");
                        }}
                        className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-zinc-100 cursor-pointer"
                      >
                        TIPO
                        {sortKey === "tipo" &&
                          (sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                      </button>
                    </th>
                    <th className="py-2 pl-2 pr-3 font-semibold text-right w-28">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          alternarOrdem("tamanho");
                        }}
                        className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-zinc-100 cursor-pointer"
                      >
                        TAMANHO
                        {sortKey === "tamanho" &&
                          (sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-zinc-800/50 text-xs">
                  {itensVisiveis.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-12 text-center font-mono text-xs text-slate-400 dark:text-zinc-500">
                        {carregando ? "Carregando diretório..." : busca ? "Nenhum item corresponde ao filtro." : "Esta pasta está vazia."}
                      </td>
                    </tr>
                  ) : (
                    itensVisiveis.map((item) => {
                      const sel = selecionados.includes(item.caminho);
                      const recortado = clipboard?.mover && clipboard.caminhos.includes(item.caminho);
                      const thumbInfo = thumbMap[item.caminho];
                      const tagPlaca = extrairTagPlaca(item.nome);
                      return (
                        <tr
                          key={item.caminho}
                          onClick={(e) => selecionarItem(item, e)}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            abrirItem(item);
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (!selecionados.includes(item.caminho)) {
                              setSelecionados([item.caminho]);
                              setUltimoAnchor(item.caminho);
                            }
                            setCtxMenu({ x: e.clientX, y: e.clientY, item });
                          }}
                          className={`cursor-pointer transition-colors ${
                            sel
                              ? "bg-blue-50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-100"
                              : "hover:bg-slate-50 dark:hover:bg-zinc-800/40 text-slate-800 dark:text-zinc-200"
                          } ${recortado || item.oculto ? "opacity-55" : ""}`}
                        >
                          <td className="py-1.5 pl-3 pr-2">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <input
                                type="checkbox"
                                checked={sel}
                                onChange={() => {}}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelecionados((prev) =>
                                    prev.includes(item.caminho)
                                      ? prev.filter((c) => c !== item.caminho)
                                      : [...prev, item.caminho]
                                  );
                                  setUltimoAnchor(item.caminho);
                                }}
                                className="rounded accent-blue-600 cursor-pointer shrink-0"
                              />
                              {thumbInfo?.miniatura_data_url ? (
                                <img
                                  src={thumbInfo.miniatura_data_url}
                                  alt={item.nome}
                                  className="w-7 h-7 object-contain rounded-xs bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 shrink-0"
                                />
                              ) : (
                                <ItemIcon item={item} className="w-4 h-4 shrink-0" />
                              )}
                              <span className="truncate font-medium">{item.nome}</span>
                              {tagPlaca && (
                                <span className="px-1.5 py-0.2 rounded bg-amber-100 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 text-[9px] font-mono font-bold text-amber-800 dark:text-amber-300 shrink-0">
                                  {tagPlaca}
                                </span>
                              )}
                              {thumbInfo && (
                                <span className="text-[10px] font-mono tabular-nums text-blue-600 dark:text-blue-400 shrink-0">
                                  {thumbInfo.largura_cm.toFixed(0)}×{thumbInfo.altura_cm.toFixed(0)}cm
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-1.5 px-2 font-mono text-[11px] tabular-nums text-slate-500 dark:text-zinc-400 whitespace-nowrap">
                            {item.modificado_fmt}
                          </td>
                          <td className="py-1.5 px-2 text-[11px] text-slate-500 dark:text-zinc-400 truncate">
                            {tipoLabel(item)}
                          </td>
                          <td className="py-1.5 pl-2 pr-3 font-mono text-[11px] tabular-nums text-right text-slate-600 dark:text-zinc-400 whitespace-nowrap">
                            {item.eh_pasta ? "—" : formatBytes(item.tamanho_bytes)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            /* Modo Grade de Miniaturas (Estilo Windows Explorer) */
            <div className="flex-1 overflow-y-auto p-3">
              {itensVisiveis.length === 0 ? (
                <div className="py-12 text-center font-mono text-xs text-slate-400 dark:text-zinc-500">
                  {carregando ? "Carregando diretório..." : busca ? "Nenhum item corresponde ao filtro." : "Esta pasta está vazia."}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-3">
                  {itensVisiveis.map((item) => {
                    const sel = selecionados.includes(item.caminho);
                    const recortado = clipboard?.mover && clipboard.caminhos.includes(item.caminho);
                    const thumbInfo = thumbMap[item.caminho];
                    const tagPlaca = extrairTagPlaca(item.nome);
                    const cortavel = ehCortavel(item);
                    const isImg = !item.eh_pasta && IMAGE_EXTS.has(item.extensao);

                    return (
                      <div
                        key={item.caminho}
                        onClick={(e) => selecionarItem(item, e)}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          abrirItem(item);
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (!selecionados.includes(item.caminho)) {
                            setSelecionados([item.caminho]);
                            setUltimoAnchor(item.caminho);
                          }
                          setCtxMenu({ x: e.clientX, y: e.clientY, item });
                        }}
                        className={`group relative p-2 rounded-md border flex flex-col items-center text-center gap-1.5 cursor-pointer transition-all ${
                          sel
                            ? "border-blue-500 dark:border-blue-500 bg-blue-50/80 dark:bg-blue-950/50 ring-1 ring-blue-500/40 shadow-xs"
                            : "border-slate-200/80 dark:border-zinc-800/80 bg-white dark:bg-zinc-900/40 hover:border-slate-300 dark:hover:border-zinc-700 hover:bg-slate-50/80 dark:hover:bg-zinc-900"
                        } ${recortado || item.oculto ? "opacity-55" : ""}`}
                        title={
                          thumbInfo
                            ? `${item.nome}\n${thumbInfo.largura_cm.toFixed(1)} × ${thumbInfo.altura_cm.toFixed(1)} cm (${thumbInfo.dpi_x} DPI)`
                            : item.nome
                        }
                      >
                        {/* Checkbox de seleção rápida (estilo Windows Explorer) */}
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelecionados((prev) =>
                              prev.includes(item.caminho)
                                ? prev.filter((c) => c !== item.caminho)
                                : [...prev, item.caminho]
                            );
                            setUltimoAnchor(item.caminho);
                          }}
                          className={`absolute top-2 left-2 z-10 w-5 h-5 rounded flex items-center justify-center border transition-opacity ${
                            sel
                              ? "opacity-100 bg-blue-600 border-blue-600 text-white"
                              : "opacity-0 group-hover:opacity-100 bg-white/90 dark:bg-zinc-900/90 border-slate-300 dark:border-zinc-600 text-transparent hover:border-blue-500"
                          }`}
                          title="Selecionar item"
                        >
                          <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                        </div>

                        {/* Badge de Placa já cortada (P01, P02...) ou botão rápido de cortar no hover */}
                        {tagPlaca ? (
                          <span className="absolute top-2 right-2 z-10 px-1.5 py-0.5 rounded bg-amber-500/90 text-white font-mono text-[9px] font-bold shadow-xs">
                            {tagPlaca}
                          </span>
                        ) : cortavel ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelecionados([item.caminho]);
                              abrirModalCorte([item]);
                            }}
                            className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 px-1.5 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-[9px] font-bold flex items-center gap-1 shadow-sm cursor-pointer transition-opacity"
                            title="Cortar este painel agora"
                          >
                            <Scissors className="w-2.5 h-2.5" />
                            <span>CORTAR</span>
                          </button>
                        ) : null}

                        {/* Quadro da Miniatura Proporcional */}
                        <div className="w-full h-28 rounded bg-slate-100/70 dark:bg-zinc-950/70 border border-slate-100 dark:border-zinc-800/60 flex items-center justify-center p-1.5 overflow-hidden">
                          {isImg && thumbInfo?.miniatura_data_url ? (
                            <img
                              src={thumbInfo.miniatura_data_url}
                              alt={item.nome}
                              className="max-w-full max-h-full object-contain drop-shadow-xs select-none"
                              loading="lazy"
                            />
                          ) : isImg && !thumbInfo ? (
                            <div className="flex flex-col items-center justify-center gap-1 text-slate-400 dark:text-zinc-600">
                              <ItemIcon item={item} className="w-8 h-8 opacity-60 animate-pulse" />
                              <span className="text-[9px] font-mono">...</span>
                            </div>
                          ) : (
                            <ItemIcon item={item} className="w-12 h-12" />
                          )}
                        </div>

                        {/* Nome do Arquivo */}
                        <span className="w-full text-[11px] font-medium text-slate-800 dark:text-zinc-200 line-clamp-2 break-words leading-tight px-0.5">
                          {item.nome}
                        </span>

                        {/* Rodapé com Dimensões em cm (se imagem) e Tamanho */}
                        {!item.eh_pasta && (
                          <div className="flex items-center justify-center gap-1.5 text-[10px] font-mono tabular-nums text-slate-500 dark:text-zinc-400 mt-auto">
                            {thumbInfo && (
                              <span className="font-semibold text-blue-700 dark:text-blue-400">
                                {thumbInfo.largura_cm.toFixed(0)}×{thumbInfo.altura_cm.toFixed(0)}cm
                              </span>
                            )}
                            {thumbInfo && <span>•</span>}
                            <span>{formatBytes(item.tamanho_bytes)}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </section>

        {/* Painel Direito: Pré-visualização e Inspeção Técnica RIP */}
        {config.mostrar_preview && (
          <aside className="w-72 shrink-0 border-l border-slate-200 dark:border-zinc-800 bg-slate-50/70 dark:bg-[#0e0e11] overflow-y-auto p-3 flex flex-col gap-3">
            <div className="text-[10px] font-mono font-bold tracking-wider text-slate-400 dark:text-zinc-500 uppercase">
              DETALHES & INSPEÇÃO RIP
            </div>

            {itensSelecionadosObj.length === 0 ? (
              <div className="text-xs font-mono text-slate-400 dark:text-zinc-500 py-8 text-center">
                Selecione um arquivo ou pasta para inspecionar.
              </div>
            ) : itensSelecionadosObj.length > 1 ? (
              <div className="space-y-2.5 text-xs font-mono">
                <div className="p-3 rounded border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/60 space-y-1.5">
                  <div className="font-bold text-slate-900 dark:text-zinc-100">
                    {itensSelecionadosObj.length} itens selecionados
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-zinc-400 tabular-nums">
                    Pastas: {itensSelecionadosObj.filter((i) => i.eh_pasta).length} • Arquivos:{" "}
                    {itensSelecionadosObj.filter((i) => !i.eh_pasta).length}
                  </div>
                  <div className="text-[11px] text-slate-700 dark:text-zinc-300 tabular-nums">
                    Tamanho somado: <b>{formatBytes(tamanhoSelecionados)}</b>
                  </div>
                </div>

                {paineisSelecionados.length > 0 && (
                  <button
                    type="button"
                    onClick={() => abrirModalCorte(paineisSelecionados)}
                    className="w-full py-2 px-3 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-xs font-bold flex items-center justify-center gap-2 cursor-pointer shadow-2xs transition-colors"
                  >
                    <Scissors className="w-3.5 h-3.5" />
                    <span>CORTAR {paineisSelecionados.length} PAINEL(IS)</span>
                  </button>
                )}
              </div>
            ) : itemUnico ? (
              <div className="space-y-3">
                {/* Preview visual */}
                <div className="rounded border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-3 flex flex-col items-center justify-center min-h-[140px]">
                  {IMAGE_EXTS.has(itemUnico.extensao) && !itemUnico.eh_pasta ? (
                    previewLoading ? (
                      <div className="flex flex-col items-center gap-2 text-xs font-mono text-slate-400">
                        <RefreshCw className="w-5 h-5 animate-spin" />
                        <span>Lendo cabeçalho...</span>
                      </div>
                    ) : previewInfo?.miniatura_data_url ? (
                      <img
                        src={previewInfo.miniatura_data_url}
                        alt={itemUnico.nome}
                        className="max-h-44 max-w-full object-contain rounded-xs border border-slate-200 dark:border-zinc-800"
                      />
                    ) : (
                      <div className="flex flex-col items-center gap-1.5 text-center">
                        <ItemIcon item={itemUnico} className="w-10 h-10" />
                        <span className="text-[10px] font-mono text-slate-400">
                          {previewErro ? "Prévia indisponível" : "Arquivo grande (>180 MB) — cabeçalho lido"}
                        </span>
                      </div>
                    )
                  ) : (
                    <ItemIcon item={itemUnico} className="w-12 h-12" />
                  )}
                </div>

                {/* Nome e ações rápidas */}
                <div>
                  <div className="text-xs font-bold text-slate-900 dark:text-zinc-100 break-all leading-snug">
                    {itemUnico.nome}
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 dark:text-zinc-400 mt-0.5">
                    {tipoLabel(itemUnico)}
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => abrirItem(itemUnico)}
                    className="flex-1 px-2.5 py-1.5 rounded border border-slate-900 dark:border-zinc-100 bg-slate-900 dark:bg-zinc-100 text-white dark:text-slate-900 text-[11px] font-mono font-semibold cursor-pointer hover:opacity-90"
                  >
                    ABRIR
                  </button>
                  <button
                    type="button"
                    onClick={() => copiarCaminho(itemUnico.caminho)}
                    className="p-1.5 rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-700 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 cursor-pointer"
                    title="Copiar caminho completo"
                  >
                    {copiadoCaminho ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => revelarNoSistema(itemUnico.caminho)}
                    className="p-1.5 rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-700 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 cursor-pointer"
                    title="Revelar no Explorer do sistema"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                </div>

                {ehCortavel(itemUnico) && (
                  <button
                    type="button"
                    onClick={() => abrirModalCorte([itemUnico])}
                    className="w-full py-2 px-3 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-xs font-bold flex items-center justify-center gap-2 cursor-pointer shadow-2xs transition-colors"
                  >
                    <Scissors className="w-3.5 h-3.5" />
                    <span>CORTAR ESTE PAINEL</span>
                  </button>
                )}

                {/* Metadados RIP (para imagens) */}
                {previewInfo && (
                  <div className="rounded border border-blue-200 dark:border-blue-900/60 bg-blue-50/60 dark:bg-blue-950/20 p-2.5 space-y-1.5 font-mono text-[11px]">
                    <div className="text-[10px] font-bold text-blue-700 dark:text-blue-400 uppercase tracking-wider">
                      TELEMETRIA DE IMPRESSÃO
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500 dark:text-zinc-400">MEDIDA:</span>
                      <span className="font-bold tabular-nums text-slate-900 dark:text-zinc-100">
                        {previewInfo.largura_cm.toFixed(1)} × {previewInfo.altura_cm.toFixed(1)} cm
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500 dark:text-zinc-400">PIXELS:</span>
                      <span className="tabular-nums text-slate-800 dark:text-zinc-200">
                        {previewInfo.largura_px} × {previewInfo.altura_px}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500 dark:text-zinc-400">DPI:</span>
                      <span className="tabular-nums text-slate-800 dark:text-zinc-200">
                        {previewInfo.dpi_x} × {previewInfo.dpi_y}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500 dark:text-zinc-400">COR / ICC:</span>
                      <span className="text-slate-800 dark:text-zinc-200">
                        {previewInfo.modo_cor} ·{" "}
                        <b className={previewInfo.tem_icc ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400"}>
                          {previewInfo.tem_icc ? "ICC" : "—"}
                        </b>
                      </span>
                    </div>
                  </div>
                )}

                {/* Propriedades padrão */}
                <div className="rounded border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/60 divide-y divide-slate-100 dark:divide-zinc-800/60 font-mono text-[11px]">
                  {!itemUnico.eh_pasta && (
                    <div className="px-2.5 py-1.5 flex justify-between">
                      <span className="text-slate-400 dark:text-zinc-500">TAMANHO</span>
                      <span className="tabular-nums font-semibold text-slate-800 dark:text-zinc-200">
                        {formatBytes(itemUnico.tamanho_bytes)}
                      </span>
                    </div>
                  )}
                  <div className="px-2.5 py-1.5 flex justify-between">
                    <span className="text-slate-400 dark:text-zinc-500">MODIFICADO</span>
                    <span className="tabular-nums text-slate-700 dark:text-zinc-300">{itemUnico.modificado_fmt}</span>
                  </div>
                  <div className="px-2.5 py-1.5 space-y-0.5">
                    <div className="text-slate-400 dark:text-zinc-500">CAMINHO</div>
                    <div className="text-[10px] text-slate-600 dark:text-zinc-400 break-all select-text">
                      {itemUnico.caminho}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </aside>
        )}
      </div>

      {/* Barra de Status do Explorer */}
      <div className="h-6 shrink-0 px-3 border-t border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-[#0c0c0e] flex items-center justify-between text-[10px] font-mono tabular-nums text-slate-500 dark:text-zinc-400">
        <div className="flex items-center gap-3">
          <span>
            {itensVisiveis.length} item(ns)
            {listagem && !busca && ` (${listagem.total_pastas} pastas, ${listagem.total_arquivos} arquivos)`}
          </span>
          {itensSelecionadosObj.length > 0 && (
            <>
              <span className="text-slate-300 dark:text-zinc-700">|</span>
              <span className="text-slate-800 dark:text-zinc-200 font-semibold">
                {itensSelecionadosObj.length} selecionado(s)
                {tamanhoSelecionados > 0 && ` (${formatBytes(tamanhoSelecionados)})`}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          {clipboard && (
            <span className="text-blue-600 dark:text-blue-400 font-semibold">
              {clipboard.mover ? "RECORTADO" : "COPIADO"}: {clipboard.caminhos.length} item(ns)
            </span>
          )}
          {listagem && <span>TOTAL PASTA: {formatBytes(listagem.tamanho_total)}</span>}
        </div>
      </div>

      {/* Menu de Contexto (Botão Direito) */}
      {ctxMenu && (
        <div
          style={{
            left: Math.min(ctxMenu.x, window.innerWidth - 220),
            top: Math.min(ctxMenu.y, window.innerHeight - 280),
          }}
          className="fixed z-50 w-52 rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-[#141418] shadow-xl py-1 text-xs font-mono"
          onClick={(e) => e.stopPropagation()}
        >
          {ctxMenu.item ? (
            <>
              <button
                type="button"
                onClick={() => {
                  const it = ctxMenu.item!;
                  setCtxMenu(null);
                  abrirItem(it);
                }}
                className="w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800 flex items-center justify-between font-semibold cursor-pointer"
              >
                <span>Abrir</span>
                <span className="text-[10px] text-slate-400">Enter</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const it = ctxMenu.item!;
                  setCtxMenu(null);
                  revelarNoSistema(it.caminho);
                }}
                className="w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                Abrir no Explorer do SO
              </button>
              {(paineisSelecionados.length > 0 || ehCortavel(ctxMenu.item)) && (
                <>
                  <div className="my-1 border-t border-slate-100 dark:border-zinc-800" />
                  <button
                    type="button"
                    onClick={() => {
                      const alvos =
                        paineisSelecionados.length > 0
                          ? paineisSelecionados
                          : ehCortavel(ctxMenu.item!)
                          ? [ctxMenu.item!]
                          : [];
                      setCtxMenu(null);
                      abrirModalCorte(alvos);
                    }}
                    className="w-full px-3 py-1.5 text-left bg-emerald-50/70 dark:bg-emerald-950/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 font-bold flex items-center justify-between cursor-pointer"
                  >
                    <span className="flex items-center gap-1.5">
                      <Scissors className="w-3.5 h-3.5" />
                      <span>
                        Cortar Painel{paineisSelecionados.length > 1 ? ` (${paineisSelecionados.length})` : ""}
                      </span>
                    </span>
                    <span className="text-[10px] opacity-75">Ctrl+E</span>
                  </button>
                </>
              )}
              <div className="my-1 border-t border-slate-100 dark:border-zinc-800" />
              <button
                type="button"
                onClick={() => {
                  setCtxMenu(null);
                  acaoCopiar(false);
                }}
                className="w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800 flex items-center justify-between cursor-pointer"
              >
                <span>Copiar</span>
                <span className="text-[10px] text-slate-400">Ctrl+C</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setCtxMenu(null);
                  acaoCopiar(true);
                }}
                className="w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800 flex items-center justify-between cursor-pointer"
              >
                <span>Recortar</span>
                <span className="text-[10px] text-slate-400">Ctrl+X</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const it = ctxMenu.item!;
                  setCtxMenu(null);
                  copiarCaminho(it.caminho);
                }}
                className="w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                Copiar caminho
              </button>
              {ctxMenu.item.eh_pasta && (
                <button
                  type="button"
                  onClick={() => {
                    const it = ctxMenu.item!;
                    setCtxMenu(null);
                    toggleFavorito(it.caminho);
                  }}
                  className="w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800 cursor-pointer"
                >
                  {config.favoritos.includes(ctxMenu.item.caminho)
                    ? "Remover dos Favoritos"
                    : "Fixar nos Favoritos"}
                </button>
              )}
              <div className="my-1 border-t border-slate-100 dark:border-zinc-800" />
              <button
                type="button"
                onClick={() => {
                  const it = ctxMenu.item!;
                  setCtxMenu(null);
                  setModalRenomear(it);
                  setRenomearNome(it.nome);
                }}
                className="w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800 flex items-center justify-between cursor-pointer"
              >
                <span>Renomear</span>
                <span className="text-[10px] text-slate-400">F2</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setCtxMenu(null);
                  setModalExcluir(itensSelecionadosObj.length > 0 ? itensSelecionadosObj : [ctxMenu.item!]);
                }}
                className="w-full px-3 py-1.5 text-left hover:bg-red-50 dark:hover:bg-red-950/40 text-red-600 dark:text-red-400 flex items-center justify-between cursor-pointer"
              >
                <span>Excluir</span>
                <span className="text-[10px] opacity-70">Del</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  setCtxMenu(null);
                  setNovaPastaNome("Nova pasta");
                  setModalNovaPasta(true);
                }}
                className="w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800 flex items-center justify-between cursor-pointer"
              >
                <span>Nova pasta</span>
                <span className="text-[10px] text-slate-400">Ctrl+Shift+N</span>
              </button>
              <button
                type="button"
                disabled={!clipboard}
                onClick={() => {
                  setCtxMenu(null);
                  acaoColar();
                }}
                className="w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800 disabled:opacity-40 flex items-center justify-between cursor-pointer"
              >
                <span>Colar</span>
                <span className="text-[10px] text-slate-400">Ctrl+V</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setCtxMenu(null);
                  atualizar();
                }}
                className="w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800 flex items-center justify-between cursor-pointer"
              >
                <span>Atualizar</span>
                <span className="text-[10px] text-slate-400">F5</span>
              </button>
            </>
          )}
        </div>
      )}

      {/* Modal: Nova Pasta */}
      {modalNovaPasta && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModalNovaPasta(false);
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              confirmarNovaPasta();
            }}
            className="w-full max-w-sm rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-[#111114] shadow-2xl overflow-hidden"
          >
            <div className="px-4 py-2.5 border-b border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-[#0c0c0e] text-xs font-mono font-bold">
              NOVA PASTA
            </div>
            <div className="p-4">
              <input
                type="text"
                autoFocus
                value={novaPastaNome}
                onChange={(e) => setNovaPastaNome(e.target.value)}
                onFocus={(e) => e.target.select()}
                className="w-full px-3 py-2 rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono text-slate-900 dark:text-zinc-100 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="px-4 py-2.5 border-t border-slate-200 dark:border-zinc-800 flex justify-end gap-2 text-xs font-mono">
              <button
                type="button"
                onClick={() => setModalNovaPasta(false)}
                className="px-3 py-1.5 rounded border border-slate-300 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                CANCELAR
              </button>
              <button
                type="submit"
                disabled={operando || !novaPastaNome.trim()}
                className="px-3 py-1.5 rounded bg-slate-900 dark:bg-zinc-100 text-white dark:text-slate-900 font-semibold cursor-pointer disabled:opacity-40"
              >
                CRIAR
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Renomear */}
      {modalRenomear && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModalRenomear(null);
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              confirmarRenomear();
            }}
            className="w-full max-w-sm rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-[#111114] shadow-2xl overflow-hidden"
          >
            <div className="px-4 py-2.5 border-b border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-[#0c0c0e] text-xs font-mono font-bold">
              RENOMEAR ITEM
            </div>
            <div className="p-4">
              <input
                type="text"
                autoFocus
                value={renomearNome}
                onChange={(e) => setRenomearNome(e.target.value)}
                onFocus={(e) => {
                  const dot = e.target.value.lastIndexOf(".");
                  if (!modalRenomear.eh_pasta && dot > 0) {
                    e.target.setSelectionRange(0, dot);
                  } else {
                    e.target.select();
                  }
                }}
                className="w-full px-3 py-2 rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono text-slate-900 dark:text-zinc-100 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="px-4 py-2.5 border-t border-slate-200 dark:border-zinc-800 flex justify-end gap-2 text-xs font-mono">
              <button
                type="button"
                onClick={() => setModalRenomear(null)}
                className="px-3 py-1.5 rounded border border-slate-300 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                CANCELAR
              </button>
              <button
                type="submit"
                disabled={operando || !renomearNome.trim()}
                className="px-3 py-1.5 rounded bg-slate-900 dark:bg-zinc-100 text-white dark:text-slate-900 font-semibold cursor-pointer disabled:opacity-40"
              >
                SALVAR
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Confirmar Exclusão */}
      {modalExcluir && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModalExcluir(null);
          }}
        >
          <div className="w-full max-w-md rounded border border-red-300 dark:border-red-900 bg-white dark:bg-[#111114] shadow-2xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 text-xs font-mono font-bold text-red-700 dark:text-red-300">
              CONFIRMAR EXCLUSÃO PERMANENTE
            </div>
            <div className="p-4 space-y-2 text-xs">
              <p className="text-slate-700 dark:text-zinc-300">
                Tem certeza que deseja excluir permanentemente{" "}
                <b className="font-mono">{modalExcluir.length} item(ns)</b>? Esta ação não envia para a Lixeira.
              </p>
              <div className="max-h-32 overflow-y-auto rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 p-2 font-mono text-[11px] space-y-0.5">
                {modalExcluir.map((i) => (
                  <div key={i.caminho} className="truncate text-slate-600 dark:text-zinc-400">
                    {i.eh_pasta ? "[PASTA] " : ""}
                    {i.nome}
                  </div>
                ))}
              </div>
            </div>
            <div className="px-4 py-2.5 border-t border-slate-200 dark:border-zinc-800 flex justify-end gap-2 text-xs font-mono">
              <button
                type="button"
                onClick={() => setModalExcluir(null)}
                className="px-3 py-1.5 rounded border border-slate-300 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                CANCELAR
              </button>
              <button
                type="button"
                autoFocus
                disabled={operando}
                onClick={confirmarExcluir}
                className="px-3 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white font-semibold cursor-pointer disabled:opacity-40"
              >
                EXCLUIR AGORA
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Cortar Painel(is) Direto pelo Explorer */}
      {modalCortar && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !cutRodando) setModalCortar(null);
          }}
        >
          <div className="w-full max-w-2xl rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-[#111114] shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
            <div className="px-4 py-2.5 border-b border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-[#0c0c0e] flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-mono font-bold text-slate-900 dark:text-zinc-100">
                <Scissors className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span>CORTAR PAINÉIS SELECIONADOS ({modalCortar.length})</span>
              </div>
              <button
                type="button"
                disabled={cutRodando}
                onClick={() => setModalCortar(null)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 cursor-pointer disabled:opacity-40"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-3.5 text-xs">
              {cutErro && (
                <div className="px-3 py-2 rounded border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 font-mono text-[11px]">
                  ERRO // {cutErro}
                </div>
              )}

              {/* Seletor de Modo: Automático vs Medidas Personalizadas */}
              <div className="grid grid-cols-2 gap-1 bg-slate-100 dark:bg-zinc-900 p-0.5 rounded border border-slate-200 dark:border-zinc-800 font-mono">
                {(["Automático", "Medidas personalizadas"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    disabled={cutRodando}
                    onClick={() => setCutModo(m)}
                    className={`py-1.5 rounded text-xs cursor-pointer transition-colors ${
                      cutModo === m
                        ? "bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 font-bold shadow-2xs"
                        : "text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white"
                    }`}
                  >
                    {m.toUpperCase()}
                  </button>
                ))}
              </div>

              {/* Gabarito */}
              <div className="space-y-1">
                <label className="block font-mono text-[10px] font-semibold text-slate-500 dark:text-zinc-400">
                  ARQUIVO DE GABARITO (COSTURA / MARCAÇÃO)
                </label>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={cutGabarito}
                    disabled={cutRodando}
                    onChange={(e) => setCutGabarito(e.target.value)}
                    placeholder="Selecione o arquivo gabarito.tif / gabarito.png..."
                    className="flex-1 rounded border border-slate-300 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-950 px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:text-zinc-100"
                  />
                  <button
                    type="button"
                    disabled={cutRodando}
                    onClick={selecionarGabaritoCorte}
                    className="px-3 py-1.5 rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-slate-100 dark:hover:bg-zinc-800 font-mono text-xs cursor-pointer"
                  >
                    PROCURAR
                  </button>
                </div>
              </div>

              {/* Parâmetros de Corte */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono">
                {cutModo === "Automático" ? (
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 dark:text-zinc-400 mb-1">
                      LARGURA PLACA (cm)
                    </label>
                    <input
                      type="text"
                      value={cutMedida}
                      disabled={cutRodando}
                      onChange={(e) => setCutMedida(e.target.value)}
                      className="w-full rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2.5 py-1.5 text-xs text-slate-900 dark:text-zinc-100"
                    />
                  </div>
                ) : (
                  <div className="col-span-2">
                    <label className="block text-[10px] font-semibold text-slate-500 dark:text-zinc-400 mb-1">
                      MEDIDAS DAS PLACAS (cm, sep. por vírgula)
                    </label>
                    <input
                      type="text"
                      value={cutMedidasLista}
                      disabled={cutRodando}
                      onChange={(e) => setCutMedidasLista(e.target.value)}
                      placeholder="Ex: 140, 150, 125"
                      className="w-full rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2.5 py-1.5 text-xs text-slate-900 dark:text-zinc-100"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 dark:text-zinc-400 mb-1">
                    ORIENTAÇÃO
                  </label>
                  <select
                    value={cutTipo}
                    disabled={cutRodando}
                    onChange={(e) => setCutTipo(e.target.value === "vertical" ? "vertical" : "horizontal")}
                    className="w-full rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1.5 text-xs text-slate-900 dark:text-zinc-100"
                  >
                    <option value="horizontal">horizontal</option>
                    <option value="vertical">vertical</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 dark:text-zinc-400 mb-1">
                    SOBREPOSIÇÃO (cm)
                  </label>
                  <input
                    type="text"
                    value={cutSobra}
                    disabled={cutRodando}
                    onChange={(e) => setCutSobra(e.target.value)}
                    className="w-full rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2.5 py-1.5 text-xs text-slate-900 dark:text-zinc-100"
                  />
                </div>

                {cutModo === "Automático" && (
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 dark:text-zinc-400 mb-1">
                      PADDING (cm)
                    </label>
                    <input
                      type="text"
                      value={cutPad}
                      disabled={cutRodando}
                      onChange={(e) => setCutPad(e.target.value)}
                      className="w-full rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2.5 py-1.5 text-xs text-slate-900 dark:text-zinc-100"
                    />
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-4 pt-1 font-mono text-[11px]">
                <label className="flex items-center gap-2 cursor-pointer text-slate-700 dark:text-zinc-300">
                  <input
                    type="checkbox"
                    checked={cutInverter}
                    disabled={cutRodando}
                    onChange={(e) => setCutInverter(e.target.checked)}
                    className="rounded accent-blue-600"
                  />
                  <span>Inverter corte (180°)</span>
                </label>

                {cutModo === "Automático" && (
                  <label className="flex items-center gap-2 cursor-pointer text-slate-700 dark:text-zinc-300">
                    <input
                      type="checkbox"
                      checked={cutCidade}
                      disabled={cutRodando}
                      onChange={(e) => setCutCidade(e.target.checked)}
                      className="rounded accent-blue-600"
                    />
                    <span>Escrever cidade na última placa</span>
                  </label>
                )}
              </div>

              {/* Simulação das Placas que serão geradas */}
              <div className="rounded border border-slate-200 dark:border-zinc-800 overflow-hidden">
                <div className="px-3 py-1.5 bg-slate-50 dark:bg-zinc-900 border-b border-slate-200 dark:border-zinc-800 flex items-center justify-between font-mono text-[10px] font-bold text-slate-600 dark:text-zinc-400">
                  <span>
                    SIMULAÇÃO DE FATIAMENTO (AS PLACAS - P01, - P02 SERÃO SALVAS NESTA MESMA PASTA)
                  </span>
                  {cutSimulando && <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />}
                </div>
                <div className="max-h-44 overflow-y-auto">
                  <table className="w-full text-left border-collapse font-mono text-[11px]">
                    <thead className="bg-slate-50/60 dark:bg-zinc-900/50 border-b border-slate-100 dark:border-zinc-800 text-[10px] text-slate-500">
                      <tr>
                        <th className="py-1.5 px-3">PAINEL</th>
                        <th className="py-1.5 px-2">DIMENSÃO (CORTE)</th>
                        <th className="py-1.5 px-2">DPI</th>
                        <th className="py-1.5 px-3">PLACAS GERADAS</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-zinc-800/60">
                      {(cutSimulacao?.itens || []).map((it, idx) => (
                        <tr key={idx}>
                          <td className="py-1.5 px-3 font-semibold text-slate-800 dark:text-zinc-200 truncate max-w-52">
                            {it.arquivo}
                          </td>
                          {it.erro ? (
                            <td colSpan={3} className="py-1.5 px-2 text-red-600 dark:text-red-400">
                              {it.erro}
                            </td>
                          ) : (
                            <>
                              <td className="py-1.5 px-2 tabular-nums text-slate-600 dark:text-zinc-300">
                                {it.largura_cm.toFixed(1)} × {it.altura_cm.toFixed(1)} cm
                              </td>
                              <td className="py-1.5 px-2 tabular-nums text-slate-500">{it.dpi}</td>
                              <td className="py-1.5 px-3 tabular-nums text-emerald-700 dark:text-emerald-400 font-semibold">
                                {it.n_placas}x ({it.placas_cm.join(" + ")} cm)
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Progresso e Logs quando estiver executando */}
              {(cutRodando || cutLogs.length > 0) && (
                <div className="space-y-2">
                  <div className="h-1.5 rounded bg-slate-200 dark:bg-zinc-800 overflow-hidden">
                    <div
                      className="h-full bg-emerald-600 transition-all duration-200"
                      style={{ width: `${cutProgresso}%` }}
                    />
                  </div>
                  <div className="max-h-28 overflow-y-auto rounded bg-slate-950 text-slate-200 p-2 font-mono text-[11px] space-y-0.5">
                    {cutLogs.map((l, idx) => (
                      <div key={idx}>{l}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="px-4 py-2.5 border-t border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-[#0c0c0e] flex items-center justify-between gap-2 text-xs font-mono">
              <button
                type="button"
                disabled={cutRodando}
                onClick={() => abrirNaAbaCortador(modalCortar)}
                className="px-3 py-1.5 rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-700 dark:text-zinc-300 cursor-pointer disabled:opacity-40"
                title="Abrir estes arquivos na aba completa do Cortador de Painéis"
              >
                ABRIR NA ABA CORTADOR
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={cutRodando}
                  onClick={() => setModalCortar(null)}
                  className="px-3 py-1.5 rounded border border-slate-300 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-zinc-800 cursor-pointer disabled:opacity-40"
                >
                  FECHAR
                </button>
                {cutRodando ? (
                  <button
                    type="button"
                    onClick={() => invoke("cortador_cancelar")}
                    className="px-4 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Square className="w-3.5 h-3.5" />
                    <span>CANCELAR</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={executarCorteDireto}
                    className="px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center gap-1.5 cursor-pointer shadow-2xs"
                  >
                    <Scissors className="w-3.5 h-3.5" />
                    <span>EXECUTAR CORTE NESTA PASTA</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
