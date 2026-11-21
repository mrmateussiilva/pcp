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
    <div className="p-5 h-full flex flex-col gap-3.5 max-w-7xl mx-auto">
      <PageHeader
        icon={<FolderTree className="w-4 h-4 text-slate-700 dark:text-zinc-300" />}
        title="Estruturação de Diretórios // Pastas do Dia"
        badge="DIR-01"
        subtitle="Cria a árvore de produção diária (Bolsinhas, Painéis, Conf, Aps, Totens) no drive mapeado."
      />

      {mensagem && (
        <div
          className={`px-3.5 py-2 rounded text-xs font-mono border ${
            mensagem.tipo === "ok"
              ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-900/60 text-emerald-700 dark:text-emerald-400"
              : "bg-red-50 dark:bg-red-950/40 border-red-300 dark:border-red-900/60 text-red-700 dark:text-red-400"
          }`}
        >
          {mensagem.tipo === "ok" ? "SUCESSO // " : "FALHA // "}
          {mensagem.texto}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 flex-1 min-h-0">
        {/* Painel de Data e Status de Diretórios */}
        <SurfaceCard className="p-4 flex flex-col min-h-0">
          <div className="flex items-center gap-2 mb-3 pb-3 border-b border-slate-100 dark:border-zinc-800">
            <button
              onClick={() => mudarDia(-1)}
              className="p-1.5 rounded border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-700 dark:text-zinc-200 cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="font-mono text-base font-bold text-slate-900 dark:text-white min-w-36 text-center tabular-nums">
              {formatarBr(dia)}
            </div>
            <button
              onClick={() => mudarDia(1)}
              className="p-1.5 rounded border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-700 dark:text-zinc-200 cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => setDia(new Date())}
              className="ml-auto px-2.5 py-1 rounded border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-xs font-mono font-medium text-slate-700 dark:text-zinc-300 cursor-pointer"
            >
              HOJE
            </button>
          </div>

          <div className="flex-1 overflow-y-auto rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 p-3 font-mono text-xs space-y-2 select-text">
            {lista.map((item) => (
              <div key={item.caminho} className="flex items-center gap-2">
                {item.existe ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                ) : (
                  <CircleDashed className="w-3.5 h-3.5 text-slate-400 dark:text-zinc-600 shrink-0" />
                )}
                <span
                  className={
                    item.existe
                      ? "text-emerald-700 dark:text-emerald-300 font-medium"
                      : "text-slate-600 dark:text-zinc-400"
                  }
                >
                  {item.caminho}
                </span>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100 dark:border-zinc-800">
            <button
              onClick={criarPastas}
              disabled={criando}
              className="flex items-center gap-2 px-4 py-1.5 rounded border border-emerald-600 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-mono text-xs font-bold cursor-pointer shadow-2xs uppercase"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              <span>{criando ? "CRIANDO..." : "CRIAR PASTAS DO DIA"}</span>
            </button>
            <button
              onClick={() => atualizarLista(dia)}
              disabled={carregando}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-700 dark:text-zinc-300 font-mono text-xs cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${carregando ? "animate-spin" : ""}`} />
              <span>VERIFICAR</span>
            </button>
          </div>
        </SurfaceCard>

        {/* Configuração de Base e Subdiretórios */}
        <SurfaceCard className="p-4 flex flex-col gap-3">
          <div className="font-mono text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
            CONFIGURAÇÃO DE ESTRUTURAÇÃO
          </div>

          <div>
            <label className="block font-mono text-[10px] font-semibold text-slate-500 dark:text-zinc-400 mb-1">
              DRIVE BASE / RAIZ
            </label>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={base}
                onChange={(e) => setBase(e.target.value)}
                className="flex-1 rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 px-2.5 py-1 font-mono text-xs text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={selecionarBase}
                className="px-2.5 py-1 rounded border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-700 dark:text-zinc-300 cursor-pointer"
              >
                <FolderOpen className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div>
            <label className="block font-mono text-[10px] font-semibold text-slate-500 dark:text-zinc-400 mb-1">
              DIRETÓRIO DE TOTENS
            </label>
            <input
              type="text"
              value={totens}
              onChange={(e) => setTotens(e.target.value)}
              className="w-full rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 px-2.5 py-1 font-mono text-xs text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block font-mono text-[10px] font-semibold text-slate-500 dark:text-zinc-400 mb-1">
              SUBPASTAS PADRÃO (UMA POR LINHA)
            </label>
            <textarea
              rows={4}
              value={subpastasTxt}
              onChange={(e) => setSubpastasTxt(e.target.value)}
              className="w-full rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 px-2.5 py-1 font-mono text-xs text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block font-mono text-[10px] font-semibold text-slate-500 dark:text-zinc-400 mb-1">
              SUBPASTAS DE TOTENS
            </label>
            <textarea
              rows={2}
              value={totensTxt}
              onChange={(e) => setTotensTxt(e.target.value)}
              className="w-full rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 px-2.5 py-1 font-mono text-xs text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          <label className="flex items-center gap-2 text-xs font-mono text-slate-700 dark:text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={criarAoAbrir}
              onChange={(e) => setCriarAoAbrir(e.target.checked)}
              className="rounded accent-blue-600"
            />
            <span>Criar automaticamente ao inicializar o PCP Central</span>
          </label>

          <button
            onClick={salvarConfig}
            className="flex items-center justify-center gap-2 px-4 py-1.5 rounded border border-blue-600 bg-blue-600 hover:bg-blue-500 text-white font-mono text-xs font-semibold cursor-pointer shadow-2xs uppercase mt-auto"
          >
            <Save className="w-3.5 h-3.5" />
            <span>SALVAR CONFIGURAÇÃO</span>
          </button>
        </SurfaceCard>
      </div>
    </div>
  );
}
