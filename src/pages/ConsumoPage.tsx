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
      // Mantém selecionados apenas arquivos que continuam existindo na pasta
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

  // Soma e gráficos calculados APENAS com base nos arquivos marcados no checkbox
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
    <div className="p-6 h-full flex flex-col gap-4 max-w-7xl mx-auto">
      <PageHeader
        icon={<BarChart3 className="w-5 h-5 text-rose-500 dark:text-rose-400" />}
        title="Consumo / Avarias"
        subtitle="Observe uma pasta de produção e marque nos checkboxes apenas os arquivos que deseja somar."
        right={<StatusBadge active={monitorando} activeText="Observando" />}
      />

      {erro && (
        <div className="px-4 py-2.5 rounded-xl text-xs bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300">
          {erro}
        </div>
      )}

      {/* Barra de controle da pasta */}
      <SurfaceCard className="p-4 flex flex-wrap items-center gap-2.5">
        <span className="text-xs text-slate-500 dark:text-zinc-400">Pasta</span>
        <input
          type="text"
          value={pasta}
          disabled={monitorando}
          onChange={(e) => setPasta(e.target.value)}
          placeholder="Selecione uma pasta com os TIFFs..."
          className="flex-1 min-w-56 rounded-xl bg-slate-50 dark:bg-[#0b0b12] border border-slate-200 dark:border-white/10 px-3 py-2 text-xs text-slate-900 dark:text-white disabled:opacity-50 focus:outline-none focus:border-blue-500"
        />
        <button
          onClick={selecionarPasta}
          disabled={monitorando}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-white/[0.07] hover:bg-slate-200 dark:hover:bg-white/15 disabled:opacity-50 text-xs font-medium text-slate-700 dark:text-zinc-200 cursor-pointer"
        >
          <FolderOpen className="w-4 h-4" />
          Selecionar
        </button>

        <button
          onClick={alternarMonitor}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-white cursor-pointer transition-all ${
            monitorando
              ? "bg-red-600 hover:bg-red-500 shadow-sm"
              : "bg-rose-600 hover:bg-rose-500 shadow-sm"
          }`}
        >
          {monitorando ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          {monitorando ? "Parar" : "Observar Pasta"}
        </button>

        <button
          onClick={atualizarAgora}
          disabled={carregando || !pasta.trim()}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 dark:bg-white/[0.07] hover:bg-slate-200 dark:hover:bg-white/15 disabled:opacity-50 text-xs font-medium text-slate-700 dark:text-zinc-200 cursor-pointer"
          title="Reanalisar pasta agora"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${carregando ? "animate-spin" : ""}`} />
          Atualizar
        </button>
      </SurfaceCard>

      {/* KPIs baseados nos selecionados */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Consumo Selecionado"
          value={`${resumoSelecionado.totalMetros.toFixed(2)} m`}
          tone="rose"
        />
        <StatCard
          label="Marcados para Soma"
          value={`${resumoSelecionado.qtdValidos} / ${res?.arquivos_lidos ?? 0}`}
          tone="emerald"
        />
        <StatCard
          label="Total na Pasta"
          value={`${((res?.consumo_total_cm ?? 0) / 100).toFixed(2)} m`}
          tone="sky"
        />
        <StatCard label="Erros" value={res?.arquivos_erro ?? 0} tone="red" />
      </div>

      {/* Gráficos dinâmicos dos selecionados */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SurfaceCard className="p-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 mb-3">
            Consumo por Categoria (selecionados)
          </h2>
          <div className="space-y-2.5">
            {categoriasOrdenadas.map(([cat, cm]) => {
              const metros = cm / 100;
              const pct = (cm / maxCat) * 100;
              return (
                <div key={cat}>
                  <div className="flex justify-between text-xs text-slate-700 dark:text-zinc-300 mb-1">
                    <span className="font-medium">{cat}</span>
                    <span className="font-mono text-rose-600 dark:text-rose-300">
                      {metros.toFixed(2)} m
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 dark:bg-[#0b0b12] overflow-hidden border border-slate-200 dark:border-white/5">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-rose-600 to-rose-400 transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </SurfaceCard>

        <SurfaceCard className="p-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 mb-3">
            Consumo por Tecido (selecionados)
          </h2>
          {tecidosOrdenados.length === 0 ? (
            <div className="text-xs text-slate-400 dark:text-zinc-500 py-6 text-center">
              Marque arquivos na tabela abaixo para calcular por tecido.
            </div>
          ) : (
            <div className="space-y-2.5 max-h-36 overflow-y-auto pr-1">
              {tecidosOrdenados.map(([tec, cm]) => {
                const metros = cm / 100;
                const pct = (cm / maxTec) * 100;
                return (
                  <div key={tec}>
                    <div className="flex justify-between text-xs text-slate-700 dark:text-zinc-300 mb-1">
                      <span className="font-medium">{tec}</span>
                      <span className="font-mono text-sky-600 dark:text-sky-300">
                        {metros.toFixed(2)} m
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 dark:bg-[#0b0b12] overflow-hidden border border-slate-200 dark:border-white/5">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-sky-600 to-sky-400 transition-all duration-300"
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

      {/* Tabela com Checkboxes */}
      <SurfaceCard className="flex-1 min-h-0 p-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={toggleTodosVisiveis}
              disabled={itensFiltrados.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-white/[0.07] hover:bg-slate-200 dark:hover:bg-white/15 disabled:opacity-40 text-xs font-medium text-slate-700 dark:text-zinc-200 cursor-pointer"
            >
              <CheckSquare className="w-3.5 h-3.5 text-rose-500" />
              {todosVisiveisMarcados ? "Desmarcar visíveis" : "Marcar visíveis"}
            </button>

            <button
              onClick={desmarcarTodos}
              disabled={selecionados.size === 0}
              className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-white/[0.07] hover:bg-slate-200 dark:hover:bg-white/15 disabled:opacity-40 text-xs text-slate-600 dark:text-zinc-300 cursor-pointer"
            >
              Limpar seleção ({selecionados.size})
            </button>
          </div>

          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 text-slate-400 dark:text-zinc-400 absolute left-3" />
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Filtrar arquivo ou tecido..."
              className="w-60 rounded-xl bg-slate-50 dark:bg-[#0b0b12] border border-slate-200 dark:border-white/10 pl-8 pr-3 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto rounded-xl bg-slate-50 dark:bg-[#0b0b12] border border-slate-200 dark:border-white/[0.06] font-mono text-xs select-text">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-slate-100 dark:bg-[#141420] text-slate-600 dark:text-zinc-400 border-b border-slate-200 dark:border-white/10">
              <tr>
                <th className="py-2.5 px-3 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={todosVisiveisMarcados}
                    onChange={toggleTodosVisiveis}
                    disabled={itensFiltrados.length === 0}
                    className="rounded accent-rose-600 cursor-pointer"
                  />
                </th>
                <th className="py-2.5 px-3">Arquivo</th>
                <th className="py-2.5 px-3">Tecido</th>
                <th className="py-2.5 px-3">Consumo</th>
                <th className="py-2.5 px-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/70 dark:divide-white/[0.04]">
              {itensFiltrados.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="py-10 text-center text-slate-400 dark:text-zinc-500 font-sans"
                  >
                    {res
                      ? "Nenhum arquivo corresponde ao filtro."
                      : "Selecione uma pasta e clique em Observar Pasta."}
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
                          ? "bg-rose-50/80 dark:bg-rose-500/10 hover:bg-rose-100/70 dark:hover:bg-rose-500/15"
                          : "hover:bg-slate-100/70 dark:hover:bg-white/[0.03]"
                      }`}
                    >
                      <td
                        className="py-2 px-3 text-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={marcado}
                          onChange={() => toggleItem(it.nome)}
                          className="rounded accent-rose-600 cursor-pointer"
                        />
                      </td>
                      <td className="py-2 px-3 text-slate-800 dark:text-zinc-200 font-medium">
                        {it.nome}
                      </td>
                      <td className="py-2 px-3 text-sky-600 dark:text-sky-300">
                        {it.tecido}
                      </td>
                      <td className="py-2 px-3 text-emerald-600 dark:text-emerald-300">
                        {it.categoria === "Erro"
                          ? "ERRO"
                          : `${(it.consumo_cm / 100).toFixed(2)} m`}
                      </td>
                      <td
                        className={`py-2 px-3 ${
                          it.categoria === "Erro"
                            ? "text-red-600 dark:text-red-400"
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
