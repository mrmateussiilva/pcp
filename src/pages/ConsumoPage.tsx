import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  BarChart3,
  CheckSquare,
  FolderOpen,
  Play,
  RefreshCw,
  Search,
  Square,
} from "lucide-react";
import { PageHeader, StatCard, StatusBadge, SurfaceCard } from "../components/ui";

interface ConsumoItem {
  nome: string;
  consumo_cm: number;
  categoria: string;
  tecido: string;
  obs: string;
}

interface ConsumoResultado {
  arquivos_lidos: number;
  arquivos_erro: number;
  consumo_total_cm: number;
  tempo_s: number;
  por_categoria: Record<string, number>;
  por_tecido: Record<string, number>;
  itens: ConsumoItem[];
}

interface ConsumoStatus {
  monitorando: boolean;
  pasta: string;
}

export function ConsumoPage() {
  const [pasta, setPasta] = useState("");
  const [monitorando, setMonitorando] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [res, setRes] = useState<ConsumoResultado | null>(null);
  const [selecionados, setSelecionados] = useState<Set<string>>(() => new Set());
  const [busca, setBusca] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    invoke<string>("consumo_get_pasta").then((p) => {
      if (p) setPasta(p);
    });
    invoke<ConsumoStatus>("consumo_status").then((st) => {
      setMonitorando(st.monitorando);
      if (st.pasta) setPasta(st.pasta);
    });
    invoke<ConsumoResultado | null>("consumo_resultado_atual").then((r) => {
      if (r) setRes(r);
    });

    const unStatus = listen<ConsumoStatus>("consumo-status", (e) => {
      setMonitorando(e.payload.monitorando);
    });
    const unData = listen<ConsumoResultado>("consumo-atualizado", (e) => {
      setRes(e.payload);
      const existentes = new Set(e.payload.itens.map((i) => i.nome));
      setSelecionados((prev) => {
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

  const selecionarPasta = async () => {
    const dir = await open({
      directory: true,
      defaultPath: pasta || undefined,
      title: "Selecione a pasta com os TIFFs",
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
    } catch (e) {
      setErro(String(e));
    } finally {
      setCarregando(false);
    }
  };

  const itensFiltrados = useMemo(() => {
    const itens = res?.itens ?? [];
    const termo = busca.trim().toLowerCase();
    if (!termo) return itens;
    return itens.filter(
      (i) =>
        i.nome.toLowerCase().includes(termo) ||
        i.tecido.toLowerCase().includes(termo) ||
        i.categoria.toLowerCase().includes(termo)
    );
  }, [res, busca]);

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

  const desmarcarTodos = () => setSelecionados(new Set());

  const resumoSelecionado = useMemo(() => {
    const porCat: Record<string, number> = {
      "Encaixe Normal": 0,
      Girado: 0,
      Fatiado: 0,
    };
    const porTec: Record<string, number> = {};
    let totalCm = 0;
    let qtdValidos = 0;
    let qtdErros = 0;

    for (const it of res?.itens ?? []) {
      if (!selecionados.has(it.nome)) continue;
      if (it.categoria === "Erro") {
        qtdErros++;
      } else {
        qtdValidos++;
        totalCm += it.consumo_cm;
        porCat[it.categoria] = (porCat[it.categoria] || 0) + it.consumo_cm;
        porTec[it.tecido] = (porTec[it.tecido] || 0) + it.consumo_cm;
      }
    }

    return {
      totalMetros: totalCm / 100,
      qtdValidos,
      qtdErros,
      porCat,
      porTec,
    };
  }, [res, selecionados]);

  const categoriasOrdenadas = Object.entries(resumoSelecionado.porCat);
  const maxCat = Math.max(1, ...categoriasOrdenadas.map(([, v]) => v));

  const tecidosOrdenados = Object.entries(resumoSelecionado.porTec).sort(
    (a, b) => b[1] - a[1]
  );
  const maxTec = Math.max(1, ...tecidosOrdenados.map(([, v]) => v));

  return (
    <div className="p-5 h-full flex flex-col gap-3.5 max-w-7xl mx-auto">
      <PageHeader
        icon={<BarChart3 className="w-4 h-4 text-slate-700 dark:text-zinc-300" />}
        title="Consumo Linear & Avarias // Metragem"
        badge="MET-04"
        subtitle="Analisa cabeçalhos TIFF em lote (160cm mídia / 150cm útil / 155cm emenda). Marque os checkboxes para somar."
        right={<StatusBadge active={monitorando} activeText="OBSERVANDO" idleText="PARADO" />}
      />

      {erro && (
        <div className="px-3.5 py-2 rounded text-xs font-mono bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-900/60 text-red-700 dark:text-red-400">
          ERRO // {erro}
        </div>
      )}

      {/* Barra de controle */}
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
            placeholder="Caminho do lote de TIFFs..."
            className="flex-1 min-w-56 rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:text-white disabled:opacity-50"
          />
          <button
            onClick={selecionarPasta}
            disabled={monitorando}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 disabled:opacity-40 text-xs font-medium text-slate-700 dark:text-zinc-300 cursor-pointer"
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
          >
            {monitorando ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span>{monitorando ? "PARAR OBSERVAÇÃO" : "OBSERVAR PASTA"}</span>
          </button>

          <button
            onClick={atualizarAgora}
            disabled={carregando || !pasta.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 disabled:opacity-40 text-xs font-medium text-slate-700 dark:text-zinc-300 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${carregando ? "animate-spin" : ""}`} />
            <span>ATUALIZAR</span>
          </button>
        </div>
      </SurfaceCard>

      {/* KPIs da seleção */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <StatCard
          label="CONSUMO SELECIONADO"
          value={resumoSelecionado.totalMetros.toFixed(2)}
          unit="m lineares"
          tone="blue"
        />
        <StatCard
          label="ARQUIVOS MARCADOS"
          value={`${resumoSelecionado.qtdValidos} / ${res?.arquivos_lidos ?? 0}`}
          tone="emerald"
        />
        <StatCard
          label="TOTAL NA PASTA"
          value={((res?.consumo_total_cm ?? 0) / 100).toFixed(2)}
          unit="m"
          tone="zinc"
        />
        <StatCard label="FALHAS DE LEITURA" value={res?.arquivos_erro ?? 0} tone="red" />
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
            <span>METRAGEM</span>
          </div>
          {tecidosOrdenados.length === 0 ? (
            <div className="font-mono text-xs text-slate-400 dark:text-zinc-600 py-6 text-center">
              NENHUM ITEM SELECIONADO
            </div>
          ) : (
            <div className="space-y-2 max-h-36 overflow-y-auto pr-1">
              {tecidosOrdenados.map(([tec, cm]) => {
                const metros = cm / 100;
                const pct = (cm / maxTec) * 100;
                return (
                  <div key={tec}>
                    <div className="flex justify-between font-mono text-xs text-slate-700 dark:text-zinc-300 mb-0.5">
                      <span className="font-semibold">{tec}</span>
                      <span className="tabular-nums font-bold text-slate-900 dark:text-white">
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
          <div className="flex items-center gap-2">
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
              LIMPAR SELEÇÃO ({selecionados.size})
            </button>
          </div>

          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5" />
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="FILTRAR LOTE..."
              className="w-56 rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 pl-8 pr-2.5 py-1 font-mono text-xs text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto rounded border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 font-mono text-xs select-text">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-slate-100 dark:bg-zinc-900 text-slate-600 dark:text-zinc-400 border-b border-slate-200 dark:border-zinc-800 text-[10px] uppercase">
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
                <th className="py-2 px-3">ARQUIVO TIFF</th>
                <th className="py-2 px-3">TECIDO</th>
                <th className="py-2 px-3">CONSUMO</th>
                <th className="py-2 px-3">ENCAIXE / DIAGNÓSTICO</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-zinc-800/60">
              {itensFiltrados.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="py-10 text-center text-slate-400 dark:text-zinc-600 font-mono text-xs"
                  >
                    {res ? "NENHUM ARQUIVO CORRESPONDE AO FILTRO." : "SELECIONE UMA PASTA E INICIE A LEITURA."}
                  </td>
                </tr>
              ) : (
                itensFiltrados.map((it) => {
                  const marcado = selecionados.has(it.nome);
                  return (
                    <tr
                      key={it.nome}
                      onClick={() => toggleItem(it.nome)}
                      className={`cursor-pointer transition-colors ${
                        marcado
                          ? "bg-blue-50/80 dark:bg-blue-950/25 hover:bg-blue-100/60 dark:hover:bg-blue-950/35"
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
                      <td className="py-1.5 px-3 text-slate-800 dark:text-zinc-200 font-semibold truncate max-w-sm">
                        {it.nome}
                      </td>
                      <td className="py-1.5 px-3 text-blue-600 dark:text-blue-400 font-semibold">
                        {it.tecido}
                      </td>
                      <td className="py-1.5 px-3 text-emerald-700 dark:text-emerald-400 font-bold tabular-nums">
                        {it.categoria === "Erro"
                          ? "ERRO"
                          : `${(it.consumo_cm / 100).toFixed(2)} m`}
                      </td>
                      <td
                        className={`py-1.5 px-3 ${
                          it.categoria === "Erro"
                            ? "text-red-600 dark:text-red-400 font-bold"
                            : "text-slate-500 dark:text-zinc-400"
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
