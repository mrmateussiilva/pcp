import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  AlertCircle,
  Calendar,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  Copy,
  ExternalLink,
  FolderOpen,
  FolderPlus,
  FolderTree,
  HardDrive,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
} from "lucide-react";
import {
  PageHeader,
  StatCard,
  StatusBadge,
  SurfaceCard,
  TerminalLog,
} from "../components/ui";
import { usePageShortcuts } from "../hooks/useShortcuts";

interface AppConfig {
  base: string;
  totens: string;
  subpastas: string[];
  subpastas_totens: string[];
  criar_ao_abrir: boolean;
}

interface PastaStatus {
  caminho: string;
  nome_relativo: string;
  categoria: string;
  existe: boolean;
  qtd_arquivos: number;
  tamanho_bytes: number;
}

interface BaseDriveStatus {
  caminho: string;
  existe: boolean;
  gravavel: boolean;
  erro?: string | null;
}

interface PastasDiaResumo {
  base: string;
  base_status: BaseDriveStatus;
  data_formatada: string;
  pasta_raiz_dia: string;
  pasta_totens_dia: string;
  pastas: PastaStatus[];
  total_pastas: number;
  total_criadas: number;
  total_arquivos: number;
  total_bytes: number;
}

interface CriarResultado {
  ok: string[];
  falhas: [string, string][];
}

function formatarIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatarBr(d: Date): string {
  const day = String(d.getDate()).padStart(2, "0");
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const y = d.getFullYear();
  return `${day} / ${m} / ${y}`;
}

function formatarBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`;
}

export function PastasDiaPage() {
  const [dia, setDia] = useState<Date>(() => new Date());
  const [resumo, setResumo] = useState<PastasDiaResumo | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [criando, setCriando] = useState(false);
  const [mensagem, setMensagem] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [copiadoId, setCopiadoId] = useState<string | null>(null);

  // Filtros da tabela
  const [filtroTipo, setFiltroTipo] = useState<"todas" | "pendentes" | "com_arquivos">("todas");
  const [busca, setBusca] = useState("");

  // Configuração
  const [base, setBase] = useState("Z:\\");
  const [totens, setTotens] = useState("IMPRESSÃO DE TOTENS");
  const [subpastasTxt, setSubpastasTxt] = useState("");
  const [totensTxt, setTotensTxt] = useState("");
  const [criarAoAbrir, setCriarAoAbrir] = useState(true);
  const [salvando, setSalvando] = useState(false);

  // Terminal Logs
  const [logs, setLogs] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  const adicionarLog = useCallback((msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev.slice(-150), `[${timestamp}] ${msg}`]);
  }, []);

  const atualizarLista = useCallback(async (dataAlvo: Date) => {
    setCarregando(true);
    try {
      const res = await invoke<PastasDiaResumo>("pastas_obter_resumo", {
        dataIso: formatarIso(dataAlvo),
      });
      setResumo(res);
      adicionarLog(
        `[SCAN] ${res.total_criadas}/${res.total_pastas} pastas prontas, ${res.total_arquivos} arquivos (${formatarBytes(
          res.total_bytes
        )}) em ${res.data_formatada}`
      );
    } catch (e) {
      setMensagem({ tipo: "erro", texto: String(e) });
      adicionarLog(`[ERRO] Falha ao verificar pastas: ${String(e)}`);
    } finally {
      setCarregando(false);
    }
  }, [adicionarLog]);

  useEffect(() => {
    invoke<AppConfig>("get_config")
      .then((cfg) => {
        setBase(cfg.base);
        setTotens(cfg.totens);
        setSubpastasTxt(cfg.subpastas.join("\n"));
        setTotensTxt(cfg.subpastas_totens.join("\n"));
        setCriarAoAbrir(cfg.criar_ao_abrir);
        adicionarLog(`[INIT] Configuração carregada. Drive base: ${cfg.base}`);
      })
      .catch((e) => setMensagem({ tipo: "erro", texto: String(e) }));
  }, [adicionarLog]);

  useEffect(() => {
    atualizarLista(dia);
  }, [dia, atualizarLista]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  const mudarDia = (delta: number) => {
    setDia((prev) => {
      const next = new Date(prev);
      next.setDate(next.getDate() + delta);
      return next;
    });
  };

  const selecionarBase = async () => {
    const dir = await open({ directory: true, defaultPath: base || undefined });
    if (typeof dir === "string") {
      setBase(dir);
      adicionarLog(`[CONFIG] Novo drive base selecionado: ${dir}`);
    }
  };

  const salvarConfig = async () => {
    setSalvando(true);
    setMensagem(null);
    try {
      await invoke("save_pastas_config", {
        payload: {
          base,
          totens,
          subpastas: subpastasTxt.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
          subpastas_totens: totensTxt.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
          criar_ao_abrir: criarAoAbrir,
        },
      });
      setMensagem({ tipo: "ok", texto: "Estrutura de diretórios e drive salvos com sucesso." });
      adicionarLog("[CONFIG] Configuração salva no config.json");
      await atualizarLista(dia);
    } catch (e) {
      setMensagem({ tipo: "erro", texto: String(e) });
      adicionarLog(`[ERRO] Erro ao salvar config: ${String(e)}`);
    } finally {
      setSalvando(false);
    }
  };

  const aplicarPresetSublimacao = () => {
    setSubpastasTxt("BOLSINHAS/PARA FAZER\nPAINEL_CUT\nCONF\nAPS\nTEX");
    setTotensTxt("otimizacoes");
    setTotens("IMPRESSÃO DE TOTENS");
    adicionarLog("[PRESET] Preset Padrão PCP Sublimação aplicado nos campos (clique em Salvar)");
  };

  const criarPastas = async () => {
    setCriando(true);
    setMensagem(null);
    try {
      const res = await invoke<CriarResultado>("criar_pastas_dia", {
        dataIso: formatarIso(dia),
      });
      if (res.falhas.length > 0) {
        setMensagem({
          tipo: "erro",
          texto: `${res.ok.length} pastas criadas, mas ${res.falhas.length} falharam: ${res.falhas[0][1]}`,
        });
        adicionarLog(`[WARN] ${res.ok.length} criadas, ${res.falhas.length} falhas`);
      } else {
        setMensagem({
          tipo: "ok",
          texto: `Todas as ${res.ok.length} pastas diárias foram criadas com sucesso para ${formatarBr(dia)}.`,
        });
        adicionarLog(`[SUCESSO] ${res.ok.length} pastas criadas para o dia ${formatarBr(dia)}`);
      }
      await atualizarLista(dia);
    } catch (e) {
      setMensagem({ tipo: "erro", texto: String(e) });
      adicionarLog(`[ERRO] Falha ao criar diretórios: ${String(e)}`);
    } finally {
      setCriando(false);
    }
  };

  const criarIndividual = async (caminho: string) => {
    try {
      await invoke("criar_pasta_individual", { caminho });
      adicionarLog(`[MKDIR] Diretório criado individualmente: ${caminho}`);
      setMensagem({ tipo: "ok", texto: `Pasta criada: ${caminho}` });
      await atualizarLista(dia);
    } catch (e) {
      setMensagem({ tipo: "erro", texto: String(e) });
      adicionarLog(`[ERRO] Falha ao criar pasta '${caminho}': ${String(e)}`);
    }
  };

  const abrirDiretorio = async (caminho: string, tentarCriar = false) => {
    try {
      if (tentarCriar) {
        await invoke("criar_pasta_individual", { caminho });
      }
      await openPath(caminho);
      adicionarLog(`[OPEN] Pasta aberta no explorador: ${caminho}`);
    } catch (e) {
      setMensagem({ tipo: "erro", texto: `Erro ao abrir '${caminho}': ${String(e)}` });
      adicionarLog(`[ERRO] Falha ao abrir diretório '${caminho}': ${String(e)}`);
    }
  };

  const copiarCaminho = (caminho: string) => {
    navigator.clipboard.writeText(caminho);
    setCopiadoId(caminho);
    setTimeout(() => setCopiadoId(null), 1500);
  };

  const abrirRaizDia = () => {
    if (resumo?.pasta_raiz_dia) {
      abrirDiretorio(resumo.pasta_raiz_dia, true);
    }
  };

  usePageShortcuts([
    { id: "pastas-criar", combo: "ctrl+enter", keys: "Ctrl+Enter", label: "Criar Pastas do Dia", action: criarPastas },
    { id: "pastas-refresh", combo: "ctrl+r", keys: "Ctrl+R", label: "Atualizar Status das Pastas", action: () => atualizarLista(dia) },
    { id: "pastas-open-raiz", combo: "ctrl+e", keys: "Ctrl+E", label: "Abrir Raiz do Dia", action: abrirRaizDia },
    { id: "pastas-base", combo: "ctrl+o", keys: "Ctrl+O", label: "Selecionar Pasta Base", action: selecionarBase },
    { id: "pastas-save", combo: "ctrl+s", keys: "Ctrl+S", label: "Salvar Configuração", action: salvarConfig },
    { id: "pastas-prev", combo: "[", keys: "[", label: "Dia Anterior", action: () => mudarDia(-1), allowInInput: false },
    { id: "pastas-next", combo: "]", keys: "]", label: "Próximo Dia", action: () => mudarDia(1), allowInInput: false },
    { id: "pastas-hoje", combo: "alt+d", keys: "Alt+D", label: "Ir para Hoje", action: () => setDia(new Date()) },
    { id: "pastas-clear-log", combo: "ctrl+l", keys: "Ctrl+L", label: "Limpar Logs", action: () => setLogs([]) },
  ]);

  // Lista filtrada
  const pastasFiltradas = (resumo?.pastas || []).filter((item) => {
    if (filtroTipo === "pendentes" && item.existe) return false;
    if (filtroTipo === "com_arquivos" && item.qtd_arquivos === 0) return false;
    if (busca.trim()) {
      const q = busca.toLowerCase();
      return (
        item.nome_relativo.toLowerCase().includes(q) ||
        item.caminho.toLowerCase().includes(q) ||
        item.categoria.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const baseStatus = resumo?.base_status;
  const driveOnline = baseStatus?.existe && baseStatus?.gravavel;

  return (
    <div className="p-5 h-full flex flex-col gap-3.5 max-w-7xl mx-auto overflow-y-auto">
      {/* Cabeçalho */}
      <PageHeader
        icon={<FolderTree className="w-4 h-4 text-slate-700 dark:text-zinc-300" />}
        title="Estruturação de Diretórios // Pastas do Dia"
        badge="DIR-01"
        subtitle="Cria e inspeciona a árvore diária de arquivos no drive de produção (Bolsinhas, Painéis, Conf, Aps, Totens)."
        right={
          <div className="flex items-center gap-2">
            <StatusBadge
              active={Boolean(driveOnline)}
              activeText={`DRIVE ${resumo?.base || base} ON`}
              idleText={baseStatus?.existe ? "DRIVE SÓ-LEITURA" : "DRIVE OFFLINE"}
              tone={driveOnline ? "emerald" : "amber"}
            />
          </div>
        }
      />

      {/* Alerta de status / erro */}
      {mensagem && (
        <div
          className={`px-3.5 py-2.5 rounded text-xs font-mono border flex items-center justify-between ${
            mensagem.tipo === "ok"
              ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-900/60 text-emerald-700 dark:text-emerald-400"
              : "bg-red-50 dark:bg-red-950/40 border-red-300 dark:border-red-900/60 text-red-700 dark:text-red-400"
          }`}
        >
          <div className="flex items-center gap-2">
            {mensagem.tipo === "ok" ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
            )}
            <span>
              <strong>{mensagem.tipo === "ok" ? "SUCESSO // " : "FALHA // "}</strong>
              {mensagem.texto}
            </span>
          </div>
          <button
            onClick={() => setMensagem(null)}
            className="text-[10px] uppercase font-bold hover:underline cursor-pointer"
          >
            Fechar
          </button>
        </div>
      )}

      {/* Barra de KPIs Técnicos */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SurfaceCard className="p-3 border-l-3 border-l-blue-600 dark:border-l-blue-500">
          <div className="text-[10px] font-semibold text-slate-500 dark:text-zinc-400 uppercase tracking-wider flex items-center justify-between">
            <span>DATA SELECIONADA</span>
            <Calendar className="w-3.5 h-3.5 text-blue-500" />
          </div>
          <div className="text-base font-bold font-mono text-slate-900 dark:text-zinc-100 tabular-nums mt-1">
            {formatarBr(dia)}
          </div>
          <div className="text-[10px] font-mono text-slate-400 dark:text-zinc-500 mt-0.5">
            Pasta: {resumo?.data_formatada || "--"}
          </div>
        </SurfaceCard>

        <StatCard
          label="Estrutura de Pastas"
          value={resumo ? `${resumo.total_criadas} / ${resumo.total_pastas}` : "--"}
          unit={resumo && resumo.total_criadas === resumo.total_pastas ? "100% OK" : "pendente"}
          tone={resumo && resumo.total_criadas === resumo.total_pastas ? "emerald" : "amber"}
        />

        <StatCard
          label="Arquivos no Dia"
          value={resumo ? resumo.total_arquivos : 0}
          unit="itens na árvore"
          tone="sky"
        />

        <StatCard
          label="Volume Total"
          value={resumo ? formatarBytes(resumo.total_bytes) : "0 B"}
          unit="em disco"
          tone="zinc"
        />
      </div>

      {/* Barra de Ações Rápidas de Produção */}
      <SurfaceCard className="p-3 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2">
          {/* Navegador de Data */}
          <div className="flex items-center rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 p-0.5">
            <button
              onClick={() => mudarDia(-1)}
              title="Dia anterior (tecla [)"
              className="p-1 hover:bg-slate-200 dark:hover:bg-zinc-800 text-slate-700 dark:text-zinc-300 rounded cursor-pointer transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="font-mono text-xs font-bold text-slate-800 dark:text-zinc-200 px-2 tabular-nums">
              {formatarBr(dia)}
            </span>
            <button
              onClick={() => mudarDia(1)}
              title="Próximo dia (tecla ])"
              className="p-1 hover:bg-slate-200 dark:hover:bg-zinc-800 text-slate-700 dark:text-zinc-300 rounded cursor-pointer transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <button
            onClick={() => setDia(new Date())}
            className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-xs font-mono font-medium text-slate-700 dark:text-zinc-300 cursor-pointer"
          >
            HOJE (Alt+D)
          </button>

          <button
            onClick={() => atualizarLista(dia)}
            disabled={carregando}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-700 dark:text-zinc-300 font-mono text-xs cursor-pointer shadow-2xs"
            title="Recarregar e inspecionar integridade de arquivos (Ctrl+R)"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${carregando ? "animate-spin text-blue-600" : ""}`} />
            <span>SCAN (Ctrl+R)</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          {resumo?.pasta_raiz_dia && (
            <button
              onClick={abrirRaizDia}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-800 dark:text-zinc-200 font-mono text-xs font-medium cursor-pointer shadow-2xs"
              title="Abrir pasta raiz do dia no Windows Explorer (Ctrl+E)"
            >
              <FolderOpen className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>ABRIR RAIZ DO DIA</span>
            </button>
          )}

          {base && (
            <button
              onClick={() => abrirDiretorio(base)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-600 dark:text-zinc-400 font-mono text-xs cursor-pointer"
              title="Abrir drive raiz base"
            >
              <HardDrive className="w-3.5 h-3.5" />
              <span>DRIVE {base}</span>
            </button>
          )}

          <button
            onClick={criarPastas}
            disabled={criando}
            className="flex items-center gap-2 px-4 py-1.5 rounded border border-emerald-600 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-mono text-xs font-bold cursor-pointer shadow-2xs uppercase tracking-wide"
            title="Criar estrutura completa do dia (Ctrl+Enter)"
          >
            <FolderPlus className="w-3.5 h-3.5" />
            <span>{criando ? "CRIANDO ESTRUTURA..." : "CRIAR PASTAS DO DIA"}</span>
          </button>
        </div>
      </SurfaceCard>

      {/* Painel Central: Tabela de Diretórios + Painel de Configurações */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 flex-1 min-h-[460px]">
        {/* Coluna 1: Lista Técnica de Pastas (7 colunas) */}
        <SurfaceCard className="p-4 flex flex-col min-h-0 lg:col-span-7">
          {/* Cabeçalho da Tabela com Busca e Filtros */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-3 border-b border-slate-100 dark:border-zinc-800">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold text-slate-900 dark:text-white uppercase">
                DIRETÓRIOS ESTRUTURADOS
              </span>
              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400">
                {pastasFiltradas.length} de {resumo?.total_pastas || 0}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {/* Filtro por status */}
              <div className="flex rounded border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-900 p-0.5 text-[10px] font-mono">
                <button
                  onClick={() => setFiltroTipo("todas")}
                  className={`px-2 py-0.5 rounded cursor-pointer ${
                    filtroTipo === "todas"
                      ? "bg-white dark:bg-zinc-800 text-slate-900 dark:text-white font-bold shadow-2xs"
                      : "text-slate-500 dark:text-zinc-400 hover:text-slate-800"
                  }`}
                >
                  TODAS
                </button>
                <button
                  onClick={() => setFiltroTipo("pendentes")}
                  className={`px-2 py-0.5 rounded cursor-pointer ${
                    filtroTipo === "pendentes"
                      ? "bg-white dark:bg-zinc-800 text-amber-700 dark:text-amber-400 font-bold shadow-2xs"
                      : "text-slate-500 dark:text-zinc-400 hover:text-slate-800"
                  }`}
                >
                  PENDENTES
                </button>
                <button
                  onClick={() => setFiltroTipo("com_arquivos")}
                  className={`px-2 py-0.5 rounded cursor-pointer ${
                    filtroTipo === "com_arquivos"
                      ? "bg-white dark:bg-zinc-800 text-blue-700 dark:text-blue-400 font-bold shadow-2xs"
                      : "text-slate-500 dark:text-zinc-400 hover:text-slate-800"
                  }`}
                >
                  COM ARQUIVOS
                </button>
              </div>

              {/* Busca rápida */}
              <div className="relative">
                <Search className="w-3 h-3 absolute left-2 top-2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filtrar..."
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  className="pl-6 pr-2 py-1 text-[11px] font-mono rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 text-slate-800 dark:text-zinc-200 w-28 focus:w-40 transition-all focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Lista com scroll */}
          <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-[300px]">
            {pastasFiltradas.length === 0 ? (
              <div className="text-center py-12 text-slate-400 dark:text-zinc-500 font-mono text-xs">
                Nenhum diretório encontrado com os filtros atuais.
              </div>
            ) : (
              pastasFiltradas.map((item) => {
                const copiado = copiadoId === item.caminho;
                return (
                  <div
                    key={item.caminho}
                    className={`rounded border p-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 transition-all ${
                      item.existe
                        ? "border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/40 hover:border-slate-300 dark:hover:border-zinc-700"
                        : "border-dashed border-amber-300/80 dark:border-amber-900/60 bg-amber-50/40 dark:bg-amber-950/10"
                    }`}
                  >
                    <div className="flex items-start gap-2.5 min-w-0 flex-1">
                      {item.existe ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                      ) : (
                        <CircleDashed className="w-4 h-4 text-amber-500 dark:text-amber-400 shrink-0 mt-0.5 animate-pulse" />
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-slate-900 dark:text-zinc-100 truncate">
                            {item.nome_relativo}
                          </span>
                          <span
                            className={`font-mono text-[9px] uppercase px-1 py-0.2 rounded border ${
                              item.categoria === "TOTENS"
                                ? "bg-purple-50 dark:bg-purple-950/40 border-purple-200 dark:border-purple-900 text-purple-700 dark:text-purple-300"
                                : "bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-900 text-blue-700 dark:text-blue-300"
                            }`}
                          >
                            {item.categoria}
                          </span>
                          {item.existe ? (
                            <span className="font-mono text-[9px] px-1 py-0.2 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 font-semibold">
                              CRIADA
                            </span>
                          ) : (
                            <span className="font-mono text-[9px] px-1 py-0.2 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-semibold">
                              PENDENTE
                            </span>
                          )}
                        </div>

                        <div className="text-[11px] font-mono text-slate-500 dark:text-zinc-400 truncate flex items-center gap-1.5 mt-0.5">
                          <span className="truncate select-all">{item.caminho}</span>
                          <button
                            onClick={() => copiarCaminho(item.caminho)}
                            title="Copiar caminho completo"
                            className="text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 cursor-pointer p-0.5 shrink-0"
                          >
                            {copiado ? (
                              <Check className="w-3 h-3 text-emerald-500" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Métricas e Ações */}
                    <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                      <div className="text-right font-mono text-[11px]">
                        <div className="font-semibold text-slate-800 dark:text-zinc-200 tabular-nums">
                          {item.qtd_arquivos} arq{item.qtd_arquivos === 1 ? "" : "s"}
                        </div>
                        <div className="text-[10px] text-slate-400 dark:text-zinc-500 tabular-nums">
                          {formatarBytes(item.tamanho_bytes)}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 border-l border-slate-200 dark:border-zinc-800 pl-2">
                        {item.existe ? (
                          <button
                            onClick={() => abrirDiretorio(item.caminho)}
                            className="p-1.5 rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-700 dark:text-zinc-200 cursor-pointer"
                            title="Abrir no Explorer"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button
                            onClick={() => criarIndividual(item.caminho)}
                            className="flex items-center gap-1 px-2 py-1 rounded border border-emerald-600 bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-[10px] font-bold cursor-pointer uppercase"
                            title="Criar apenas esta pasta"
                          >
                            <FolderPlus className="w-3 h-3" />
                            <span>Criar</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </SurfaceCard>

        {/* Coluna 2: Configuração e Presets Industriais (5 colunas) */}
        <SurfaceCard className="p-4 flex flex-col gap-3 min-h-0 lg:col-span-5">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-zinc-800">
            <span className="font-mono text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
              CONFIGURAÇÃO DO DRIVE & SUBPASTAS
            </span>
            <button
              onClick={aplicarPresetSublimacao}
              className="text-[10px] font-mono text-blue-600 dark:text-blue-400 hover:underline cursor-pointer flex items-center gap-1"
              title="Carregar pastas recomendadas de corte, bolsas e totens"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Preset PCP</span>
            </button>
          </div>

          <div>
            <label className="block font-mono text-[10px] font-semibold text-slate-500 dark:text-zinc-400 mb-1">
              DRIVE BASE / RAIZ DA REDE
            </label>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={base}
                onChange={(e) => setBase(e.target.value)}
                placeholder="Ex: Z:\ ou /mnt/producao"
                className="flex-1 rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={selecionarBase}
                title="Procurar pasta (Ctrl+O)"
                className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-700 dark:text-zinc-300 cursor-pointer"
              >
                <FolderOpen className="w-3.5 h-3.5" />
              </button>
            </div>
            {baseStatus?.erro && (
              <p className="text-[10px] font-mono text-red-600 dark:text-red-400 mt-1">
                Aviso: {baseStatus.erro}
              </p>
            )}
          </div>

          <div>
            <label className="block font-mono text-[10px] font-semibold text-slate-500 dark:text-zinc-400 mb-1">
              PASTA BASE DE TOTENS
            </label>
            <input
              type="text"
              value={totens}
              onChange={(e) => setTotens(e.target.value)}
              className="w-full rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="font-mono text-[10px] font-semibold text-slate-500 dark:text-zinc-400">
                SUBPASTAS DE PRODUÇÃO DIÁRIA (1 POR LINHA)
              </label>
              <span className="font-mono text-[9px] text-slate-400">
                {subpastasTxt.split(/\r?\n/).filter((s) => s.trim()).length} pastas
              </span>
            </div>
            <textarea
              rows={4}
              value={subpastasTxt}
              onChange={(e) => setSubpastasTxt(e.target.value)}
              className="w-full rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 p-2 font-mono text-xs text-slate-900 dark:text-white focus:outline-none focus:border-blue-500 resize-y leading-relaxed"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="font-mono text-[10px] font-semibold text-slate-500 dark:text-zinc-400">
                SUBPASTAS DE TOTENS
              </label>
              <span className="font-mono text-[9px] text-slate-400">
                {totensTxt.split(/\r?\n/).filter((s) => s.trim()).length} pastas
              </span>
            </div>
            <textarea
              rows={2}
              value={totensTxt}
              onChange={(e) => setTotensTxt(e.target.value)}
              className="w-full rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 p-2 font-mono text-xs text-slate-900 dark:text-white focus:outline-none focus:border-blue-500 resize-y leading-relaxed"
            />
          </div>

          <label className="flex items-center gap-2 text-xs font-mono text-slate-700 dark:text-zinc-300 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={criarAoAbrir}
              onChange={(e) => setCriarAoAbrir(e.target.checked)}
              className="rounded accent-blue-600 w-3.5 h-3.5"
            />
            <span>Criar automaticamente ao inicializar o PCP Central</span>
          </label>

          <button
            onClick={salvarConfig}
            disabled={salvando}
            className="flex items-center justify-center gap-2 px-4 py-2 rounded border border-blue-600 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-mono text-xs font-bold cursor-pointer shadow-2xs uppercase mt-auto"
            title="Salvar configuração no config.json (Ctrl+S)"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{salvando ? "SALVANDO..." : "SALVAR CONFIGURAÇÃO (Ctrl+S)"}</span>
          </button>
        </SurfaceCard>
      </div>

      {/* Terminal de Eventos Inferior */}
      <div className="h-40 min-h-36">
        <TerminalLog
          lines={logs}
          logRef={logRef}
          onClear={() => setLogs([])}
          emptyText="Nenhum evento registrado nesta sessão. Use Scan (Ctrl+R) ou Criar Pastas (Ctrl+Enter)."
        />
      </div>
    </div>
  );
}
