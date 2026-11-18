import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  FolderOpen,
  FolderPlus,
  FolderTree,
  RefreshCw,
  Save,
} from "lucide-react";
import { PageHeader, SurfaceCard } from "../components/ui";

interface AppConfig {
  base: string;
  totens: string;
  subpastas: string[];
  subpastas_totens: string[];
  criar_ao_abrir: boolean;
}

interface PastaStatus {
  caminho: string;
  existe: boolean;
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

export function PastasDiaPage() {
  const [dia, setDia] = useState<Date>(() => new Date());
  const [lista, setLista] = useState<PastaStatus[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [criando, setCriando] = useState(false);
  const [mensagem, setMensagem] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  const [base, setBase] = useState("Z:\\");
  const [totens, setTotens] = useState("IMPRESSÃO DE TOTENS");
  const [subpastasTxt, setSubpastasTxt] = useState("");
  const [totensTxt, setTotensTxt] = useState("");
  const [criarAoAbrir, setCriarAoAbrir] = useState(true);

  const atualizarLista = useCallback(async (dataAlvo: Date) => {
    setCarregando(true);
    try {
      const res = await invoke<PastaStatus[]>("listar_pastas_dia", {
        dataIso: formatarIso(dataAlvo),
      });
      setLista(res);
    } catch (e) {
      setMensagem({ tipo: "erro", texto: String(e) });
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    invoke<AppConfig>("get_config")
      .then((cfg) => {
        setBase(cfg.base);
        setTotens(cfg.totens);
        setSubpastasTxt(cfg.subpastas.join("\n"));
        setTotensTxt(cfg.subpastas_totens.join("\n"));
        setCriarAoAbrir(cfg.criar_ao_abrir);
      })
      .catch((e) => setMensagem({ tipo: "erro", texto: String(e) }));
  }, []);

  useEffect(() => {
    atualizarLista(dia);
  }, [dia, atualizarLista]);

  const mudarDia = (delta: number) => {
    setDia((prev) => {
      const next = new Date(prev);
      next.setDate(next.getDate() + delta);
      return next;
    });
  };

  const selecionarBase = async () => {
    const dir = await open({ directory: true, defaultPath: base || undefined });
    if (typeof dir === "string") setBase(dir);
  };

  const salvarConfig = async () => {
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
      setMensagem({ tipo: "ok", texto: "Configuração salva com sucesso." });
      await atualizarLista(dia);
    } catch (e) {
      setMensagem({ tipo: "erro", texto: String(e) });
    }
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
          texto: `${res.ok.length} criadas, ${res.falhas.length} falharam: ${res.falhas[0][1]}`,
        });
      } else {
        setMensagem({
          tipo: "ok",
          texto: `${res.ok.length} pasta(s) pronta(s) para ${formatarBr(dia)}.`,
        });
      }
      await atualizarLista(dia);
    } catch (e) {
      setMensagem({ tipo: "erro", texto: String(e) });
    } finally {
      setCriando(false);
    }
  };

  return (
    <div className="p-6 h-full flex flex-col gap-4 max-w-7xl mx-auto">
      <PageHeader
        icon={<FolderTree className="w-5 h-5 text-amber-500 dark:text-amber-400" />}
        title="Pastas do Dia"
        subtitle="Cria a estrutura do dia no drive. As outras abas já abrem apontando para estas pastas."
      />

      {mensagem && (
        <div
          className={`px-4 py-2.5 rounded-xl text-xs font-medium border ${mensagem.tipo === "ok"
              ? "bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-300"
              : "bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300"
            }`}
        >
          {mensagem.texto}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1 min-h-0">
        <SurfaceCard className="p-5 flex flex-col min-h-0">
          <div className="flex items-center gap-2 mb-4">
            <button
              onClick={() => mudarDia(-1)}
              className="p-2 rounded-xl bg-slate-100 dark:bg-white/[0.06] hover:bg-slate-200 dark:hover:bg-white/10 text-slate-700 dark:text-zinc-200 cursor-pointer transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="text-lg font-bold text-slate-900 dark:text-white min-w-40 text-center tabular-nums">
              {formatarBr(dia)}
            </div>
            <button
              onClick={() => mudarDia(1)}
              className="p-2 rounded-xl bg-slate-100 dark:bg-white/[0.06] hover:bg-slate-200 dark:hover:bg-white/10 text-slate-700 dark:text-zinc-200 cursor-pointer transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => setDia(new Date())}
              className="ml-auto px-3.5 py-1.5 rounded-xl bg-slate-100 dark:bg-white/[0.07] hover:bg-slate-200 dark:hover:bg-white/15 text-xs font-medium text-slate-700 dark:text-white cursor-pointer transition-colors"
            >
              Hoje
            </button>
          </div>

          <span className="text-xs font-medium text-slate-500 dark:text-zinc-400 mb-2">
            Destinos do dia:
          </span>

          <div className="flex-1 overflow-y-auto rounded-xl bg-slate-50 dark:bg-[#0b0b12] border border-slate-200 dark:border-white/[0.06] p-3.5 font-mono text-xs space-y-2 select-text">
            {lista.map((item) => (
              <div key={item.caminho} className="flex items-center gap-2.5">
                {item.existe ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 dark:text-emerald-400 shrink-0" />
                ) : (
                  <CircleDashed className="w-4 h-4 text-slate-400 dark:text-zinc-600 shrink-0" />
                )}
                <span
                  className={
                    item.existe
                      ? "text-emerald-700 dark:text-emerald-300"
                      : "text-slate-700 dark:text-zinc-300"
                  }
                >
                  {item.caminho}
                </span>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3 mt-4 pt-2">
            <button
              onClick={criarPastas}
              disabled={criando}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer shadow-sm transition-all"
            >
              <FolderPlus className="w-4 h-4" />
              {criando ? "Criando..." : "Criar pastas"}
            </button>
            <button
              onClick={() => atualizarLista(dia)}
              disabled={carregando}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-white/[0.07] hover:bg-slate-200 dark:hover:bg-white/15 text-slate-700 dark:text-white text-xs font-medium cursor-pointer transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${carregando ? "animate-spin" : ""}`} />
              Atualizar
            </button>
          </div>
        </SurfaceCard>

        <SurfaceCard className="p-5 flex flex-col gap-3.5">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">Configuração</h2>

          <div>
            <label className="block text-xs text-slate-500 dark:text-zinc-400 mb-1.5">
              Drive / pasta base
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={base}
                onChange={(e) => setBase(e.target.value)}
                className="flex-1 rounded-xl bg-slate-50 dark:bg-[#0b0b12] border border-slate-200 dark:border-white/10 px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={selecionarBase}
                className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-white/[0.07] hover:bg-slate-200 dark:hover:bg-white/15 text-slate-700 dark:text-zinc-200 cursor-pointer"
              >
                <FolderOpen className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-500 dark:text-zinc-400 mb-1.5">
              Pasta de totens
            </label>
            <input
              type="text"
              value={totens}
              onChange={(e) => setTotens(e.target.value)}
              className="w-full rounded-xl bg-slate-50 dark:bg-[#0b0b12] border border-slate-200 dark:border-white/10 px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-500 dark:text-zinc-400 mb-1.5">
              Subpastas do dia (uma por linha, use / para subníveis)
            </label>
            <textarea
              rows={5}
              value={subpastasTxt}
              onChange={(e) => setSubpastasTxt(e.target.value)}
              className="w-full rounded-xl bg-slate-50 dark:bg-[#0b0b12] border border-slate-200 dark:border-white/10 px-3 py-2 font-mono text-xs text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-500 dark:text-zinc-400 mb-1.5">
              Subpastas de totens (uma por linha)
            </label>
            <textarea
              rows={2}
              value={totensTxt}
              onChange={(e) => setTotensTxt(e.target.value)}
              className="w-full rounded-xl bg-slate-50 dark:bg-[#0b0b12] border border-slate-200 dark:border-white/10 px-3 py-2 font-mono text-xs text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-zinc-200 cursor-pointer">
            <input
              type="checkbox"
              checked={criarAoAbrir}
              onChange={(e) => setCriarAoAbrir(e.target.checked)}
              className="rounded accent-blue-600"
            />
            Criar automaticamente ao abrir o PCP Central
          </label>

          <div className="pt-1">
            <button
              onClick={salvarConfig}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold cursor-pointer shadow-sm transition-all"
            >
              <Save className="w-4 h-4" />
              Salvar configuração
            </button>
          </div>
        </SurfaceCard>
      </div>
    </div>
  );
}
