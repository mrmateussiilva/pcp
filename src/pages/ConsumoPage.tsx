import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { BarChart3, FolderOpen } from "lucide-react";
import { PageHeader, StatCard, SurfaceCard } from "../components/ui";

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

export function ConsumoPage() {
  const [rodando, setRodando] = useState(false);
  const [res, setRes] = useState<ConsumoResultado | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const selecionarEAnalisar = async () => {
    const dir = await open({ directory: true, title: "Selecione a pasta com os TIFFs" });
    if (typeof dir !== "string") return;
    setErro(null);
    setRodando(true);
    try {
      const r = await invoke<ConsumoResultado>("consumo_analisar", { pasta: dir });
      setRes(r);
    } catch (e) {
      setErro(String(e));
    } finally {
      setRodando(false);
    }
  };

  const totalMetros = res ? res.consumo_total_cm / 100 : 0;
  const categoriasOrdenadas = res
    ? Object.entries(res.por_categoria)
    : [
      ["Encaixe Normal", 0],
      ["Girado", 0],
      ["Fatiado", 0],
    ];
  const maxCat = Math.max(1, ...categoriasOrdenadas.map(([, v]) => Number(v)));

  const tecidosOrdenados = res
    ? Object.entries(res.por_tecido).sort((a, b) => b[1] - a[1])
    : [];
  const maxTec = Math.max(1, ...tecidosOrdenados.map(([, v]) => Number(v)));

  return (
    <div className="p-6 h-full flex flex-col gap-4 max-w-7xl mx-auto">
      <PageHeader
        icon={<BarChart3 className="w-5 h-5 text-rose-500 dark:text-rose-400" />}
        title="Consumo / Avarias"
        subtitle="Leitura paralela de cabeçalhos TIFF com cálculo linear de tecido (160cm mídia / 150cm útil)."
        right={
          <button
            onClick={selecionarEAnalisar}
            disabled={rodando}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer shadow-sm transition-all"
          >
            <FolderOpen className="w-4 h-4" />
            {rodando ? "Analisando..." : "Selecionar Pasta"}
          </button>
        }
      />

      {erro && (
        <div className="px-4 py-2.5 rounded-xl text-xs bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300">
          {erro}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Consumo Total" value={`${totalMetros.toFixed(2)} m`} tone="rose" />
        <StatCard label="Arquivos Lidos" value={res?.arquivos_lidos ?? 0} tone="emerald" />
        <StatCard label="Erros" value={res?.arquivos_erro ?? 0} tone="red" />
        <StatCard
          label="Tempo de Análise"
          value={`${res ? res.tempo_s.toFixed(2) : "0.00"} s`}
          tone="sky"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SurfaceCard className="p-5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 mb-4">
            Consumo por Categoria
          </h2>
          <div className="space-y-3.5">
            {categoriasOrdenadas.map(([cat, cm]) => {
              const metros = Number(cm) / 100;
              const pct = (Number(cm) / maxCat) * 100;
              return (
                <div key={cat}>
                  <div className="flex justify-between text-xs text-slate-700 dark:text-zinc-300 mb-1.5">
                    <span className="font-medium">{cat}</span>
                    <span className="font-mono text-rose-600 dark:text-rose-300">
                      {metros.toFixed(2)} m
                    </span>
                  </div>
                  <div className="h-2.5 rounded-full bg-slate-100 dark:bg-[#0b0b12] overflow-hidden border border-slate-200 dark:border-white/5">
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

        <SurfaceCard className="p-5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 mb-4">
            Consumo por Tecido
          </h2>
          {tecidosOrdenados.length === 0 ? (
            <div className="text-xs text-slate-400 dark:text-zinc-500 py-8 text-center">
              Selecione uma pasta com arquivos TIFF para visualizar.
            </div>
          ) : (
            <div className="space-y-3 max-h-48 overflow-y-auto pr-1">
              {tecidosOrdenados.map(([tec, cm]) => {
                const metros = Number(cm) / 100;
                const pct = (Number(cm) / maxTec) * 100;
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

      <SurfaceCard className="flex-1 min-h-0 p-4 flex flex-col">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 mb-3">
          Arquivos Analisados
        </h2>
        <div className="flex-1 overflow-y-auto rounded-xl bg-slate-50 dark:bg-[#0b0b12] border border-slate-200 dark:border-white/[0.06] font-mono text-xs select-text">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-slate-100 dark:bg-[#141420] text-slate-600 dark:text-zinc-400 border-b border-slate-200 dark:border-white/10">
              <tr>
                <th className="py-2.5 px-3.5">Arquivo</th>
                <th className="py-2.5 px-3.5">Tecido</th>
                <th className="py-2.5 px-3.5">Consumo</th>
                <th className="py-2.5 px-3.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/70 dark:divide-white/[0.04]">
              {res?.itens.map((it, i) => (
                <tr key={i} className="hover:bg-slate-100/70 dark:hover:bg-white/[0.03] transition-colors">
                  <td className="py-2 px-3.5 text-slate-800 dark:text-zinc-200">{it.nome}</td>
                  <td className="py-2 px-3.5 text-sky-600 dark:text-sky-300">{it.tecido}</td>
                  <td className="py-2 px-3.5 text-emerald-600 dark:text-emerald-300">
                    {it.categoria === "Erro" ? "ERRO" : `${(it.consumo_cm / 100).toFixed(2)} m`}
                  </td>
                  <td
                    className={`py-2 px-3.5 ${it.categoria === "Erro"
                        ? "text-red-600 dark:text-red-400"
                        : "text-slate-500 dark:text-zinc-400"
                      }`}
                  >
                    {it.obs}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SurfaceCard>
    </div>
  );
}
