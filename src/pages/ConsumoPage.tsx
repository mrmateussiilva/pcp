import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  BarChart3,
  Check,
  CheckSquare,
  Copy,
  Download,
  FolderOpen,
  Minus,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Sliders,
  Square,
  X,
} from "lucide-react";
import { PageHeader, StatCard, StatusBadge, SurfaceCard } from "../components/ui";
import { usePageShortcuts } from "../hooks/useShortcuts";

interface ConsumoItem {
  nome: string;
  largura_cm: number;
  altura_cm: number;
  dpi: number;
  quantidade: number;
  consumo_unitario_cm: number;
  consumo_cm: number;
  categoria: string;
  tecido: string;
  obs: string;
}

interface ConsumoResultado {
  arquivos_lidos: number;
  arquivos_erro: number;
  consumo_total_cm: number;
  consumo_com_avaria_cm: number;
  tempo_s: number;
  por_categoria: Record<string, number>;
  por_tecido: Record<string, number>;
  itens: ConsumoItem[];
}

interface ConsumoConfig {
  largura_midia_cm: number;
  limite_emenda_cm: number;
  largura_util_cm: number;
  margem_avaria_pct: number;
  tecidos_extras: string[];
}

interface ConsumoStatus {
  monitorando: boolean;
  pasta: string;
}

const DEFAULT_CONFIG: ConsumoConfig = {
  largura_midia_cm: 160.0,
  limite_emenda_cm: 155.0,
  largura_util_cm: 150.0,
  margem_avaria_pct: 0.0,
  tecidos_extras: [],
};

export function ConsumoPage() {
  const [pasta, setPasta] = useState("");
  const [monitorando, setMonitorando] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [res, setRes] = useState<ConsumoResultado | null>(null);
  const [selecionados, setSelecionados] = useState<Set<string>>(() => new Set());
  const [quantidades, setQuantidades] = useState<Record<string, number>>({});
  const [busca, setBusca] = useState("");
  const [filtroTecido, setFiltroTecido] = useState<string>("TODOS");
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  // Parâmetros de mídia e tecidos
  const [mostrarConfig, setMostrarConfig] = useState(false);
  const [config, setConfig] = useState<ConsumoConfig>(DEFAULT_CONFIG);
  const [configDraft, setConfigDraft] = useState<ConsumoConfig>(DEFAULT_CONFIG);
  const [salvandoConfig, setSalvandoConfig] = useState(false);
  const [tecidosExtrasInput, setTecidosExtrasInput] = useState("");

  const buscaRef = useRef<HTMLInputElement | null>(null);

  // Inicialização e ouvintes IPC
  useEffect(() => {
    invoke<string>("consumo_get_pasta").then((p) => {
      if (p) setPasta(p);
    });

    invoke<ConsumoConfig>("consumo_get_config").then((cfg) => {
      setConfig(cfg);
      setConfigDraft(cfg);
      setTecidosExtrasInput((cfg.tecidos_extras || []).join(", "));
    });

    invoke<ConsumoStatus>("consumo_status").then((st) => {
      setMonitorando(st.monitorando);
      if (st.pasta) setPasta(st.pasta);
    });

    invoke<ConsumoResultado | null>("consumo_resultado_atual").then((r) => {
      if (r) {
        setRes(r);
        sincronizarQuantidades(r.itens);
        setSelecionados(new Set(r.itens.map((i) => i.nome)));
      }
    });

    const unStatus = listen<ConsumoStatus>("consumo-status", (e) => {
      setMonitorando(e.payload.monitorando);
      if (e.payload.pasta) setPasta(e.payload.pasta);
    });

    const unData = listen<ConsumoResultado>("consumo-atualizado", (e) => {
      setRes(e.payload);
      sincronizarQuantidades(e.payload.itens);
      setSelecionados((prev) => {
        if (prev.size === 0) {
          return new Set(e.payload.itens.map((i) => i.nome));
        }
        const existentes = new Set(e.payload.itens.map((i) => i.nome));
        const next = new Set<string>();
        for (const nome of prev) {
          if (existentes.has(nome)) next.add(nome);
        }
        return next;
      });
    });

    return () => {
      unStatus.then((fn) => fn());
      unData.then((fn) => fn());
    };
  }, []);

  const sincronizarQuantidades = (itens: ConsumoItem[]) => {
    setQuantidades((prev) => {
      const next = { ...prev };
      for (const item of itens) {
        if (next[item.nome] === undefined) {
          next[item.nome] = item.quantidade > 0 ? item.quantidade : 1;
        }
      }
      return next;
    });
  };

  const selecionarPasta = async () => {
    const dir = await open({
      directory: true,
      defaultPath: pasta || undefined,
      title: "Selecione a pasta de produção com TIFFs",
    });
    if (typeof dir !== "string") return;
    setPasta(dir);
    setErro(null);
    if (!monitorando) {
      await iniciarMonitor(dir);
    }
  };

  const iniciarMonitor = async (dirAlvo = pasta) => {
    setErro(null);
    try {
      await invoke("consumo_iniciar_monitor", { pasta: dirAlvo });
    } catch (e) {
      setErro(String(e));
    }
  };

  const alternarMonitor = async () => {
    setErro(null);
    try {
      if (monitorando) {
        await invoke("consumo_parar_monitor");
      } else {
        await iniciarMonitor(pasta);
      }
    } catch (e) {
      setErro(String(e));
    }
  };

  const atualizarAgora = async () => {
    if (!pasta.trim()) return;
    setErro(null);
    setCarregando(true);
    try {
      const r = await invoke<ConsumoResultado>("consumo_analisar", { pasta });
      setRes(r);
      sincronizarQuantidades(r.itens);
      if (selecionados.size === 0) {
        setSelecionados(new Set(r.itens.map((i) => i.nome)));
      }
    } catch (e) {
      setErro(String(e));
    } finally {
      setCarregando(false);
    }
  };

  const salvarParametros = async () => {
    setSalvandoConfig(true);
    setErro(null);
    try {
      const extras = tecidosExtrasInput
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);

      const payload: ConsumoConfig = {
        ...configDraft,
        tecidos_extras: extras,
      };

      await invoke("consumo_save_config", { config: payload });
      setConfig(payload);
      setMostrarConfig(false);
    } catch (e) {
      setErro(String(e));
    } finally {
      setSalvandoConfig(false);
    }
  };

  // Atalhos de teclado industriais
  usePageShortcuts([
    {
      id: "cons-toggle",
      combo: "ctrl+enter",
      keys: "Ctrl+Enter",
      label: monitorando ? "Parar Observação" : "Iniciar Observação",
      action: alternarMonitor,
    },
    {
      id: "cons-folder",
      combo: "ctrl+o",
      keys: "Ctrl+O",
      label: "Selecionar Pasta de TIFFs",
      action: selecionarPasta,
    },
    {
      id: "cons-refresh",
      combo: "ctrl+r",
      keys: "Ctrl+R",
      label: "Atualizar Análise Agora",
      action: atualizarAgora,
    },
    {
      id: "cons-search",
      combo: "ctrl+f",
      keys: "Ctrl+F",
      label: "Focar Filtro de Busca",
      action: () => {
        buscaRef.current?.focus();
        buscaRef.current?.select();
      },
    },
    {
      id: "cons-copy",
      combo: "ctrl+shift+c",
      keys: "Ctrl+Shift+C",
      label: "Copiar Relatório Formatado",
      action: () => copiarRelatorio(),
    },
    {
      id: "cons-config",
      combo: "alt+1",
      keys: "Alt+1",
      label: "Alternar Parâmetros de Mídia",
      action: () => setMostrarConfig((v) => !v),
    },
  ]);

  // Alteração de quantidade interativa
  const alterarQtd = (nome: string, delta: number) => {
    setQuantidades((prev) => {
      const atual = prev[nome] ?? 1;
      const nova = Math.max(1, Math.min(999, atual + delta));
      return { ...prev, [nome]: nova };
    });
  };

  const definirQtd = (nome: string, valorStr: string) => {
    const parsed = parseInt(valorStr, 10);
    if (!isNaN(parsed) && parsed > 0 && parsed <= 999) {
      setQuantidades((prev) => ({ ...prev, [nome]: parsed }));
    }
  };

  // Lista de tecidos únicos presentes no lote para badges de filtro
  const listaTecidosPresentes = useMemo(() => {
    const setTec = new Set<string>();
    for (const it of res?.itens ?? []) {
      if (it.categoria !== "Erro") {
        setTec.add(it.tecido);
      }
    }
    return Array.from(setTec).sort();
  }, [res]);

  // Filtragem combinada (tecido + texto de busca)
  const itensFiltrados = useMemo(() => {
    const itens = res?.itens ?? [];
    const termo = busca.trim().toLowerCase();

    return itens.filter((i) => {
      if (filtroTecido !== "TODOS" && i.tecido !== filtroTecido) {
        return false;
      }
      if (!termo) return true;
      return (
        i.nome.toLowerCase().includes(termo) ||
        i.tecido.toLowerCase().includes(termo) ||
        i.categoria.toLowerCase().includes(termo) ||
        i.obs.toLowerCase().includes(termo) ||
        `${i.largura_cm.toFixed(0)}x${i.altura_cm.toFixed(0)}`.includes(termo)
      );
    });
  }, [res, busca, filtroTecido]);

  // Seleção e checkboxes
  const toggleItem = (nome: string) => {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(nome)) next.delete(nome);
      else next.add(nome);
      return next;
    });
  };

  const todosVisiveisMarcados =
    itensFiltrados.length > 0 &&
    itensFiltrados.every((i) => selecionados.has(i.nome));

  const toggleTodosVisiveis = () => {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (todosVisiveisMarcados) {
        for (const i of itensFiltrados) next.delete(i.nome);
      } else {
        for (const i of itensFiltrados) next.add(i.nome);
      }
      return next;
    });
  };

  const marcarApenasTecido = (tecidoAlvo: string) => {
    const next = new Set<string>();
    for (const it of res?.itens ?? []) {
      if (it.tecido === tecidoAlvo && it.categoria !== "Erro") {
        next.add(it.nome);
      }
    }
    setSelecionados(next);
  };

  const desmarcarTodos = () => setSelecionados(new Set());
  const marcarTodosGeral = () => {
    if (res?.itens) {
      setSelecionados(new Set(res.itens.map((i) => i.nome)));
    }
  };

  // Cálculo reativo dos totais selecionados com quantidade multiplicadora e margem
  const resumoSelecionado = useMemo(() => {
    const porCat: Record<string, number> = {
      "Encaixe Normal": 0,
      Girado: 0,
      Fatiado: 0,
    };
    const porTec: Record<string, { cm: number; arquivos: number; pecas: number }> = {};
    let totalCmLiquido = 0;
    let qtdValidos = 0;
    let qtdPecas = 0;
    let qtdErros = 0;

    for (const it of res?.itens ?? []) {
      if (!selecionados.has(it.nome)) continue;

      if (it.categoria === "Erro") {
        qtdErros++;
      } else {
        const qtd = quantidades[it.nome] ?? it.quantidade ?? 1;
        const consumoTotalItem = it.consumo_unitario_cm * qtd;

        qtdValidos++;
        qtdPecas += qtd;
        totalCmLiquido += consumoTotalItem;
        porCat[it.categoria] = (porCat[it.categoria] || 0) + consumoTotalItem;

        if (!porTec[it.tecido]) {
          porTec[it.tecido] = { cm: 0, arquivos: 0, pecas: 0 };
        }
        porTec[it.tecido].cm += consumoTotalItem;
        porTec[it.tecido].arquivos += 1;
        porTec[it.tecido].pecas += qtd;
      }
    }

    const margemPct = config.margem_avaria_pct || 0;
    const totalMetrosLiquido = totalCmLiquido / 100;
    const totalMetrosComAvaria = totalMetrosLiquido * (1 + margemPct / 100);
    const metrosAvariaExtra = totalMetrosComAvaria - totalMetrosLiquido;

    return {
      totalMetrosLiquido,
      totalMetrosComAvaria,
      metrosAvariaExtra,
      qtdValidos,
      qtdPecas,
      qtdErros,
      porCat,
      porTec,
    };
  }, [res, selecionados, quantidades, config.margem_avaria_pct]);

  const categoriasOrdenadas = Object.entries(resumoSelecionado.porCat);
  const maxCat = Math.max(1, ...categoriasOrdenadas.map(([, v]) => v));

  const tecidosOrdenados = Object.entries(resumoSelecionado.porTec).sort(
    (a, b) => b[1].cm - a[1].cm
  );
  const maxTec = Math.max(1, ...tecidosOrdenados.map(([, v]) => v.cm));

  // Copiar relatório resumido e formatado
  const copiarRelatorio = async () => {
    if (!res || resumoSelecionado.qtdValidos === 0) return;

    const dataHora = new Date().toLocaleString("pt-BR");
    const linhas: string[] = [
      `🧵 PCP // RELATÓRIO DE CONSUMO LINEAR & METRAGEM`,
      `Data: ${dataHora}`,
      `Pasta: ${pasta || "Não informada"}`,
      `Seleção: ${resumoSelecionado.qtdValidos} arquivos (${resumoSelecionado.qtdPecas} peças totais)`,
      ``,
      `--- CONSUMO POR TECIDO ---`,
    ];

    for (const [tec, dados] of tecidosOrdenados) {
      linhas.push(
        `• ${tec}: ${(dados.cm / 100).toFixed(2)} m (${dados.arquivos} arq / ${dados.pecas} un)`
      );
    }

    linhas.push(``);
    linhas.push(`--- TOTAIS CONSOLIDADOS ---`);
    linhas.push(`Metragem Líquida: ${resumoSelecionado.totalMetrosLiquido.toFixed(2)} m`);
    if (config.margem_avaria_pct > 0) {
      linhas.push(
        `Com Margem (+${config.margem_avaria_pct}%): ${resumoSelecionado.totalMetrosComAvaria.toFixed(
          2
        )} m (+${resumoSelecionado.metrosAvariaExtra.toFixed(2)} m de segurança)`
      );
    }
    linhas.push(
      `Parâmetros: Mídia ${config.largura_midia_cm}cm (útil: ${config.largura_util_cm}cm / emenda: ${config.limite_emenda_cm}cm)`
    );

    try {
      await navigator.clipboard.writeText(linhas.join("\n"));
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2200);
    } catch {
      // Fallback
    }
  };

  // Exportar dados completos em CSV
  const exportarCSV = () => {
    if (!res || res.itens.length === 0) return;

    const cabecalho = [
      "Arquivo",
      "Largura (cm)",
      "Altura (cm)",
      "DPI",
      "Qtd",
      "Tecido",
      "Consumo Unitario (m)",
      "Consumo Total (m)",
      "Categoria",
      "Diagnostico",
    ];

    const linhas = res.itens.map((it) => {
      const qtd = quantidades[it.nome] ?? it.quantidade ?? 1;
      const unitM = (it.consumo_unitario_cm / 100).toFixed(2);
      const totalM = ((it.consumo_unitario_cm * qtd) / 100).toFixed(2);

      return [
        `"${it.nome.replace(/"/g, '""')}"`,
        it.largura_cm.toFixed(1),
        it.altura_cm.toFixed(1),
        it.dpi.toFixed(0),
        qtd,
        `"${it.tecido}"`,
        unitM,
        totalM,
        `"${it.categoria}"`,
        `"${it.obs.replace(/"/g, '""')}"`,
      ].join(";");
    });

    const csvContent = "\uFEFF" + [cabecalho.join(";"), ...linhas].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const dataIso = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `consumo_pcp_${dataIso}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-5 h-full flex flex-col gap-3.5 max-w-7xl mx-auto select-none">
      <PageHeader
        icon={<BarChart3 className="w-4 h-4 text-slate-700 dark:text-zinc-300" />}
        title="Consumo Linear & Avarias // Metragem"
        badge="MET-04"
        subtitle="Analisa cabeçalhos em lote com Rayon/SIMD sem decodificar pixels. Multiplicador de quantidade e margem de avaria em tempo real."
        right={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMostrarConfig((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded border font-mono text-xs font-semibold cursor-pointer transition-colors ${
                mostrarConfig
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300"
                  : "border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800"
              }`}
              title="Configurações de boca da máquina, margem de avaria e tecidos (Alt+1)"
            >
              <Settings2 className="w-3.5 h-3.5" />
              <span>PARÂMETROS ({config.largura_midia_cm}cm)</span>
            </button>
            <StatusBadge active={monitorando} activeText="OBSERVANDO" idleText="PARADO" />
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
              <span>PARÂMETROS DA PLOTTER / CALANDRA & MARGEM DE REFUGO</span>
            </div>
            <button
              onClick={() => setMostrarConfig(false)}
              className="text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            <div>
              <label className="block font-mono text-[11px] font-semibold text-slate-600 dark:text-zinc-400 mb-1">
                LARGURA DA MÍDIA (BOCA cm)
              </label>
              <input
                type="number"
                step="1"
                min="50"
                max="500"
                value={configDraft.largura_midia_cm}
                onChange={(e) =>
                  setConfigDraft({
                    ...configDraft,
                    largura_midia_cm: parseFloat(e.target.value) || 160,
                  })
                }
                className="w-full rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:text-white"
              />
              <span className="text-[10px] text-slate-500 dark:text-zinc-500 font-mono">
                Ex.: 160 cm, 180 cm ou 320 cm
              </span>
            </div>

            <div>
              <label className="block font-mono text-[11px] font-semibold text-slate-600 dark:text-zinc-400 mb-1">
                LARGURA ÚTIL SEM EMENDA (cm)
              </label>
              <input
                type="number"
                step="1"
                min="50"
                max="500"
                value={configDraft.largura_util_cm}
                onChange={(e) =>
                  setConfigDraft({
                    ...configDraft,
                    largura_util_cm: parseFloat(e.target.value) || 150,
                  })
                }
                className="w-full rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:text-white"
              />
              <span className="text-[10px] text-slate-500 dark:text-zinc-500 font-mono">
                Largura de cada tira ao fatiar painel (padrão 150 cm)
              </span>
            </div>

            <div>
              <label className="block font-mono text-[11px] font-semibold text-slate-600 dark:text-zinc-400 mb-1">
                LIMITE PARA EMENDA (cm)
              </label>
              <input
                type="number"
                step="1"
                min="50"
                max="500"
                value={configDraft.limite_emenda_cm}
                onChange={(e) =>
                  setConfigDraft({
                    ...configDraft,
                    limite_emenda_cm: parseFloat(e.target.value) || 155,
                  })
                }
                className="w-full rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:text-white"
              />
              <span className="text-[10px] text-slate-500 dark:text-zinc-500 font-mono">
                Acima disso em ambas as dimensões, divide em tiras
              </span>
            </div>

            <div>
              <label className="block font-mono text-[11px] font-semibold text-slate-600 dark:text-zinc-400 mb-1">
                MARGEM DE AVARIA / REFUGO (%)
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  max="100"
                  value={configDraft.margem_avaria_pct}
                  onChange={(e) =>
                    setConfigDraft({
                      ...configDraft,
                      margem_avaria_pct: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-20 rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:text-white"
                />
                <div className="inline-flex gap-1 font-mono text-[10px]">
                  {[0, 5, 10, 15].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() =>
                        setConfigDraft({ ...configDraft, margem_avaria_pct: pct })
                      }
                      className={`px-1.5 py-1 rounded border cursor-pointer ${
                        configDraft.margem_avaria_pct === pct
                          ? "border-blue-600 bg-blue-600 text-white font-bold"
                          : "border-slate-300 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-700 dark:text-zinc-300"
                      }`}
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
              </div>
              <span className="text-[10px] text-slate-500 dark:text-zinc-500 font-mono">
                Acréscimo de segurança no total de metros lineares
              </span>
            </div>
          </div>

          <div className="mt-3 pt-3 border-t border-slate-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex-1 min-w-72">
              <label className="block font-mono text-[11px] font-semibold text-slate-600 dark:text-zinc-400 mb-0.5">
                TECIDOS EXTRAS (SEPARADOS POR VÍRGULA):
              </label>
              <input
                type="text"
                value={tecidosExtrasInput}
                onChange={(e) => setTecidosExtrasInput(e.target.value)}
                placeholder="Ex.: DRYFIT, NEOPRENE, CANELADO, BLACKOUT, ADESIVO"
                className="w-full rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1 font-mono text-xs text-slate-900 dark:text-white"
              />
            </div>

            <div className="flex items-center gap-2 self-end">
              <button
                type="button"
                onClick={() => {
                  setConfigDraft(DEFAULT_CONFIG);
                  setTecidosExtrasInput("");
                }}
                className="px-3 py-1.5 rounded border border-slate-300 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-zinc-800 font-mono text-xs text-slate-700 dark:text-zinc-300 cursor-pointer"
              >
                REDEFINIR PADRÃO
              </button>
              <button
                type="button"
                onClick={salvarParametros}
                disabled={salvandoConfig}
                className="px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 font-mono text-xs font-bold text-white cursor-pointer shadow-2xs"
              >
                {salvandoConfig ? "SALVANDO..." : "APLICAR & SALVAR"}
              </button>
            </div>
          </div>
        </SurfaceCard>
      )}

      {/* Barra de controle e ações rápidas */}
      <SurfaceCard className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] font-semibold text-slate-500 dark:text-zinc-400">
            PATH:
          </span>
          <input
            type="text"
            value={pasta}
            disabled={monitorando}
            onChange={(e) => setPasta(e.target.value)}
            placeholder="Caminho da pasta com os TIFFs..."
            className="flex-1 min-w-56 rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:text-white disabled:opacity-50"
          />
          <button
            onClick={selecionarPasta}
            disabled={monitorando}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 disabled:opacity-40 text-xs font-medium text-slate-700 dark:text-zinc-300 cursor-pointer"
            title="Selecionar pasta no disco (Ctrl+O)"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            <span>SELECIONAR</span>
          </button>

          <button
            onClick={alternarMonitor}
            className={`flex items-center gap-2 px-4 py-1.5 rounded text-xs font-semibold text-white cursor-pointer transition-all ${
              monitorando
                ? "bg-red-600 hover:bg-red-500 shadow-2xs"
                : "bg-blue-600 hover:bg-blue-500 shadow-2xs"
            }`}
            title="Iniciar ou parar observação contínua de arquivos (Ctrl+Enter)"
          >
            {monitorando ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span>{monitorando ? "PARAR OBSERVAÇÃO" : "OBSERVAR PASTA"}</span>
          </button>

          <button
            onClick={atualizarAgora}
            disabled={carregando || !pasta.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 disabled:opacity-40 text-xs font-medium text-slate-700 dark:text-zinc-300 cursor-pointer"
            title="Forçar reanálise imediata de todos os arquivos (Ctrl+R)"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${carregando ? "animate-spin" : ""}`} />
            <span>ATUALIZAR</span>
          </button>

          <div className="h-4 w-px bg-slate-200 dark:border-zinc-800 mx-1 hidden sm:block" />

          {/* Exportações */}
          <button
            onClick={copiarRelatorio}
            disabled={!res || resumoSelecionado.qtdValidos === 0}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs font-semibold cursor-pointer transition-all ${
              copiado
                ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300"
                : "border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800 disabled:opacity-40"
            }`}
            title="Copiar resumo limpo formatado para colar no WhatsApp ou ERP (Ctrl+Shift+C)"
          >
            {copiado ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiado ? "COPIADO!" : "COPIAR RESUMO"}</span>
          </button>

          <button
            onClick={exportarCSV}
            disabled={!res || res.itens.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800 disabled:opacity-40 text-xs font-medium cursor-pointer"
            title="Baixar planilha CSV com dimensões, quantidades e diagnósticos"
          >
            <Download className="w-3.5 h-3.5" />
            <span>CSV</span>
          </button>
        </div>
      </SurfaceCard>

      {/* KPIs da seleção com suporte a avaria/margem */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <StatCard
          label={
            config.margem_avaria_pct > 0
              ? `CONSUMO (+${config.margem_avaria_pct}% AVARIA)`
              : "CONSUMO SELECIONADO"
          }
          value={
            config.margem_avaria_pct > 0
              ? resumoSelecionado.totalMetrosComAvaria.toFixed(2)
              : resumoSelecionado.totalMetrosLiquido.toFixed(2)
          }
          unit={
            config.margem_avaria_pct > 0
              ? `m (${resumoSelecionado.totalMetrosLiquido.toFixed(2)}m líq)`
              : "m lineares"
          }
          tone="blue"
        />

        <StatCard
          label="ARQUIVOS MARCADOS"
          value={`${resumoSelecionado.qtdValidos} / ${res?.arquivos_lidos ?? 0}`}
          unit={`(${resumoSelecionado.qtdPecas} peças)`}
          tone="emerald"
        />

        <StatCard
          label="TOTAL NA PASTA"
          value={((res?.consumo_total_cm ?? 0) / 100).toFixed(2)}
          unit={`m (${res?.tempo_s?.toFixed(2) ?? "0.00"}s)`}
          tone="zinc"
        />

        <StatCard
          label="FALHAS / EXCEDENTES"
          value={res?.arquivos_erro ?? 0}
          tone={(res?.arquivos_erro ?? 0) > 0 ? "red" : "zinc"}
        />
      </div>

      {/* Gráficos de telemetria técnica */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
        <SurfaceCard className="p-3.5">
          <div className="text-[10px] font-mono font-bold tracking-wider text-slate-500 dark:text-zinc-400 uppercase mb-3 flex items-center justify-between">
            <span>POR CATEGORIA DE ENCAIXE</span>
            <span>METRAGEM</span>
          </div>
          <div className="space-y-2">
            {categoriasOrdenadas.map(([cat, cm]) => {
              const metros = cm / 100;
              const pct = (cm / maxCat) * 100;
              return (
                <div key={cat}>
                  <div className="flex justify-between font-mono text-xs text-slate-700 dark:text-zinc-300 mb-0.5">
                    <span className="font-semibold">{cat}</span>
                    <span className="tabular-nums font-bold text-slate-900 dark:text-white">
                      {metros.toFixed(2)} m
                    </span>
                  </div>
                  <div className="h-1.5 rounded-xs bg-slate-100 dark:bg-zinc-900 overflow-hidden">
                    <div
                      className="h-full bg-slate-800 dark:bg-zinc-300 transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </SurfaceCard>

        <SurfaceCard className="p-3.5">
          <div className="text-[10px] font-mono font-bold tracking-wider text-slate-500 dark:text-zinc-400 uppercase mb-3 flex items-center justify-between">
            <span>POR TECIDO IDENTIFICADO</span>
            <span>METRAGEM & PEÇAS</span>
          </div>
          {tecidosOrdenados.length === 0 ? (
            <div className="font-mono text-xs text-slate-400 dark:text-zinc-600 py-6 text-center">
              NENHUM ITEM SELECIONADO
            </div>
          ) : (
            <div className="space-y-2 max-h-36 overflow-y-auto pr-1">
              {tecidosOrdenados.map(([tec, dados]) => {
                const metros = dados.cm / 100;
                const pct = (dados.cm / maxTec) * 100;
                return (
                  <div key={tec}>
                    <div className="flex justify-between font-mono text-xs text-slate-700 dark:text-zinc-300 mb-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold">{tec}</span>
                        <span className="text-[10px] text-slate-400">
                          ({dados.arquivos} arq / {dados.pecas} un)
                        </span>
                      </div>
                      <span className="tabular-nums font-bold text-blue-600 dark:text-blue-400">
                        {metros.toFixed(2)} m
                      </span>
                    </div>
                    <div className="h-1.5 rounded-xs bg-slate-100 dark:bg-zinc-900 overflow-hidden">
                      <div
                        className="h-full bg-blue-600 dark:bg-blue-500 transition-all duration-300"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </SurfaceCard>
      </div>

      {/* Tabela de Lote */}
      <SurfaceCard className="flex-1 min-h-0 p-3 flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Controles de marcação em massa */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={toggleTodosVisiveis}
              disabled={itensFiltrados.length === 0}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 disabled:opacity-40 font-mono text-xs text-slate-700 dark:text-zinc-300 cursor-pointer"
            >
              <CheckSquare className="w-3.5 h-3.5" />
              <span>{todosVisiveisMarcados ? "DESMARCAR VISÍVEIS" : "MARCAR VISÍVEIS"}</span>
            </button>

            <button
              onClick={desmarcarTodos}
              disabled={selecionados.size === 0}
              className="px-2.5 py-1 rounded border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 disabled:opacity-40 font-mono text-xs text-slate-600 dark:text-zinc-400 cursor-pointer"
            >
              LIMPAR ({selecionados.size})
            </button>

            <button
              onClick={marcarTodosGeral}
              disabled={!res || res.itens.length === 0 || selecionados.size === res.itens.length}
              className="px-2 py-1 rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 hover:bg-slate-100 dark:hover:bg-zinc-800 font-mono text-xs text-slate-500 dark:text-zinc-400 cursor-pointer"
            >
              MARCAR TODOS ({res?.itens.length ?? 0})
            </button>
          </div>

          {/* Filtro por tecido + busca por texto */}
          <div className="flex flex-wrap items-center gap-2">
            {listaTecidosPresentes.length > 0 && (
              <div className="flex items-center gap-1">
                <span className="font-mono text-[10px] text-slate-400">TECIDO:</span>
                <select
                  value={filtroTecido}
                  onChange={(e) => setFiltroTecido(e.target.value)}
                  className="rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 px-2 py-1 font-mono text-xs text-slate-800 dark:text-zinc-200 focus:outline-none"
                >
                  <option value="TODOS">TODOS OS TECIDOS</option>
                  {listaTecidosPresentes.map((tec) => (
                    <option key={tec} value={tec}>
                      {tec}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="relative flex items-center">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5" />
              <input
                ref={buscaRef}
                type="text"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="FILTRAR LOTE... (Ctrl+F)"
                className="w-56 rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 pl-8 pr-2.5 py-1 font-mono text-xs text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
        </div>

        {/* Tabela técnica */}
        <div className="flex-1 overflow-y-auto rounded border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 font-mono text-xs select-text">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-slate-100 dark:bg-zinc-900 text-slate-600 dark:text-zinc-400 border-b border-slate-200 dark:border-zinc-800 text-[10px] uppercase z-10">
              <tr>
                <th className="py-2 px-3 w-8 text-center">
                  <input
                    type="checkbox"
                    checked={todosVisiveisMarcados}
                    onChange={toggleTodosVisiveis}
                    disabled={itensFiltrados.length === 0}
                    className="rounded accent-blue-600 cursor-pointer"
                  />
                </th>
                <th className="py-2 px-3">ARQUIVO</th>
                <th className="py-2 px-3">DIMENSÃO (L × A)</th>
                <th className="py-2 px-3">DPI</th>
                <th className="py-2 px-3 text-center w-24">QTD</th>
                <th className="py-2 px-3">TECIDO</th>
                <th className="py-2 px-3">CONSUMO</th>
                <th className="py-2 px-3">ENCAIXE / DIAGNÓSTICO</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-zinc-800/60">
              {itensFiltrados.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="py-12 text-center text-slate-400 dark:text-zinc-600 font-mono text-xs"
                  >
                    {res
                      ? "NENHUM ARQUIVO CORRESPONDE AO FILTRO ATIVO."
                      : "SELECIONE UMA PASTA DE PRODUÇÃO E CLIQUE EM ATUALIZAR."}
                  </td>
                </tr>
              ) : (
                itensFiltrados.map((it) => {
                  const marcado = selecionados.has(it.nome);
                  const qtd = quantidades[it.nome] ?? it.quantidade ?? 1;
                  const consumoTotalItem = (it.consumo_unitario_cm * qtd) / 100;

                  return (
                    <tr
                      key={it.nome}
                      onClick={() => toggleItem(it.nome)}
                      className={`cursor-pointer transition-colors ${
                        marcado
                          ? "bg-blue-50/70 dark:bg-blue-950/25 hover:bg-blue-100/60 dark:hover:bg-blue-950/35"
                          : "hover:bg-slate-50 dark:hover:bg-zinc-900/40"
                      }`}
                    >
                      <td
                        className="py-1.5 px-3 text-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={marcado}
                          onChange={() => toggleItem(it.nome)}
                          className="rounded accent-blue-600 cursor-pointer"
                        />
                      </td>

                      <td
                        className="py-1.5 px-3 text-slate-800 dark:text-zinc-200 font-semibold truncate max-w-xs"
                        title={it.nome}
                      >
                        {it.nome}
                      </td>

                      <td className="py-1.5 px-3 tabular-nums text-slate-600 dark:text-zinc-300">
                        {it.categoria === "Erro" ? (
                          <span className="text-red-500">—</span>
                        ) : (
                          `${it.largura_cm.toFixed(1)} × ${it.altura_cm.toFixed(1)} cm`
                        )}
                      </td>

                      <td className="py-1.5 px-3 tabular-nums text-slate-500 dark:text-zinc-400">
                        {it.categoria === "Erro" ? "—" : `${it.dpi.toFixed(0)}`}
                      </td>

                      {/* Controle Interativo de Quantidade */}
                      <td
                        className="py-1.5 px-3 text-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {it.categoria === "Erro" ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          <div className="inline-flex items-center border border-slate-200 dark:border-zinc-800 rounded bg-white dark:bg-zinc-900">
                            <button
                              type="button"
                              onClick={() => alterarQtd(it.nome, -1)}
                              className="px-1.5 py-0.5 hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                              title="Diminuir quantidade"
                            >
                              <Minus className="w-2.5 h-2.5" />
                            </button>
                            <input
                              type="text"
                              value={qtd}
                              onChange={(e) => definirQtd(it.nome, e.target.value)}
                              className="w-8 text-center font-mono font-bold text-xs text-slate-900 dark:text-white bg-transparent focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => alterarQtd(it.nome, 1)}
                              className="px-1.5 py-0.5 hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                              title="Aumentar quantidade"
                            >
                              <Plus className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        )}
                      </td>

                      <td className="py-1.5 px-3">
                        {it.categoria === "Erro" ? (
                          <span className="text-red-600 dark:text-red-400 font-bold">ERRO</span>
                        ) : (
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              marcarApenasTecido(it.tecido);
                            }}
                            className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide border border-blue-200 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 hover:bg-blue-100 cursor-pointer"
                            title={`Clique para selecionar apenas ${it.tecido}`}
                          >
                            {it.tecido}
                          </span>
                        )}
                      </td>

                      <td className="py-1.5 px-3 font-bold tabular-nums">
                        {it.categoria === "Erro" ? (
                          <span className="text-red-600 dark:text-red-400">0.00 m</span>
                        ) : (
                          <span className="text-emerald-700 dark:text-emerald-400">
                            {consumoTotalItem.toFixed(2)} m
                            {qtd > 1 && (
                              <span className="text-[10px] font-normal text-slate-400 ml-1">
                                ({(it.consumo_unitario_cm / 100).toFixed(2)} × {qtd})
                              </span>
                            )}
                          </span>
                        )}
                      </td>

                      <td
                        className={`py-1.5 px-3 ${
                          it.categoria === "Erro"
                            ? "text-red-600 dark:text-red-400 font-bold"
                            : "text-slate-600 dark:text-zinc-400"
                        }`}
                      >
                        {it.obs}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </SurfaceCard>
    </div>
  );
}
