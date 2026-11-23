import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { Eye, FilePlus2, FolderOpen, Loader2, Plus, Scissors, Square, X } from "lucide-react";
import { PageHeader, StatCard, StatusBadge, SurfaceCard, TerminalLog } from "../components/ui";
import { usePageShortcuts } from "../hooks/useShortcuts";

const CORES = ["Preto", "Azul", "Rosa", "Roxo", "Vermelho", "Verde"];

const DEFAULT_OVERRIDES: Record<string, string> = {
  "EU AMO LINHARES": "LINHARES",
  "LINHARES 02": "LINHARES",
  "SOORETAMA - FAIXA": "SOORETAMA",
};

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
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

interface CortadorDoneSummary {
  ok: number;
  err: number;
  cancelled: boolean;
}

export function CortadorPage() {
  const [modo, setModo] = useState<"Automático" | "Medidas personalizadas">("Automático");
  const [abaSaida, setAbaSaida] = useState<"logs" | "preview">("logs");
  const [rodando, setRodando] = useState(false);
  const [simulando, setSimulando] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [simulacao, setSimulacao] = useState<CortadorSimulacao | null>(null);
  const [doneStats, setDoneStats] = useState<CortadorDoneSummary>({ ok: 0, err: 0, cancelled: false });
  const [erro, setErro] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  // Automático
  const [aOrigem, setAOrigem] = useState<"pasta" | "arquivos">("pasta");
  const [aArquivos, setAArquivos] = useState<string[]>([]);
  const [aPasta, setAPasta] = useState("");
  const [aGab, setAGab] = useState("");
  const [aSaida, setASaida] = useState("");
  const [aMedida, setAMedida] = useState("150");
  const [aSobra, setASobra] = useState("0.5");
  const [aPad, setAPad] = useState("1.0");
  const [aTipo, setATipo] = useState("horizontal");
  const [aWorkers, setAWorkers] = useState("4");
  const [aCor, setACor] = useState("Automática (uma por painel)");
  const [aInverter, setAInverter] = useState(false);
  const [aMover, setAMover] = useState(true);
  const [aCidade, setACidade] = useState(false);
  const [aCidadeCor, setACidadeCor] = useState("Preto");
  const [aCidadeLarg, setACidadeLarg] = useState("4.0");
  const [aCidadeAlt, setACidadeAlt] = useState("1.0");
  const [aCidadeMargem, setACidadeMargem] = useState("1.0");
  const [overrides, setOverrides] = useState<Record<string, string>>(DEFAULT_OVERRIDES);
  const [ovKey, setOvKey] = useState("");
  const [ovVal, setOvVal] = useState("");

  // Medidas personalizadas
  const [mOrigem, setMOrigem] = useState<"pasta" | "arquivos">("pasta");
  const [mArquivos, setMArquivos] = useState<string[]>([]);
  const [mEntrada, setMEntrada] = useState("");
  const [mSaida, setMSaida] = useState("");
  const [mGab, setMGab] = useState("");
  const [mMedidas, setMMedidas] = useState("140,150,125");
  const [mSobra, setMSobra] = useState("0.5");
  const [mPad, setMPad] = useState("1.0");
  const [mTipo, setMTipo] = useState("vertical");
  const [mCor, setMCor] = useState("Preto");
  const [mInverter, setMInverter] = useState(false);

  useEffect(() => {
    invoke<Record<string, any>>("cortador_get_config").then((cfg) => {
      if (cfg.modo === "Medidas personalizadas" || cfg.modo === "Automático") {
        setModo(cfg.modo);
      }
      const a = cfg.auto || {};
      setAPasta(a.pasta || "");
      setAGab(a.gabarito || "");
      setASaida(a.saida || "");
      setAMedida(String(a.medida ?? 150));
      setASobra(String(a.sobreposicao ?? 0.5));
      setAPad(String(a.pad ?? 1.0));
      setATipo(a.tipo || "horizontal");
      setAWorkers(String(a.workers ?? 4));
      setACor(a.cor || "Automática (uma por painel)");
      setAInverter(Boolean(a.inverter));
      setAMover(a.mover !== undefined ? Boolean(a.mover) : true);
      setACidade(Boolean(a.cidade));
      setACidadeCor(a.cidade_cor || "Preto");
      setACidadeLarg(String(a.cidade_largura ?? 4.0));
      setACidadeAlt(String(a.cidade_altura ?? 1.0));
      setACidadeMargem(String(a.cidade_margem ?? 1.0));
      if (a.overrides && typeof a.overrides === "object" && Object.keys(a.overrides).length > 0) {
        setOverrides(a.overrides);
      }

      const m = cfg.medidas || {};
      setMEntrada(m.entrada || "");
      setMSaida(m.saida || "");
      setMGab(m.gabarito || "");
      setMMedidas(
        typeof m.medidas === "string"
          ? m.medidas
          : Array.isArray(m.medidas)
          ? m.medidas.join(",")
          : "140,150,125"
      );
      setMSobra(String(m.sobreposicao ?? 0.5));
      setMPad(String(m.pad ?? 1.0));
      setMTipo(m.tipo || "vertical");
      setMCor(m.cor || "Preto");
      setMInverter(Boolean(m.inverter));
    });

    invoke<boolean>("cortador_rodando").then(setRodando);

    const unSt = listen<boolean>("cortador-status", (e) => setRodando(e.payload));
    const unLog = listen<string>("cortador-log", (e) => {
      setLogs((prev) => [...prev.slice(-1500), e.payload]);
    });
    const unProg = listen<{ current: number; total: number }>("cortador-progress", (e) => {
      setProgresso(e.payload.total > 0 ? (e.payload.current / e.payload.total) * 100 : 0);
    });
    const unDone = listen<CortadorDoneSummary>("cortador-done", (e) => {
      setDoneStats(e.payload);
    });

    return () => {
      unSt.then((fn) => fn());
      unLog.then((fn) => fn());
      unProg.then((fn) => fn());
      unDone.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const num = (v: string, nome: string) => {
    const n = Number(v.replace(",", "."));
    if (Number.isNaN(n)) throw new Error(`'${nome}' precisa ser um número.`);
    return n;
  };

  const escolherPasta = async (atual: string, setter: (v: string) => void) => {
    const d = await open({ directory: true, defaultPath: atual || undefined });
    if (typeof d === "string") setter(d);
  };

  const escolherArquivo = async (setter: (v: string) => void) => {
    const f = await open({
      multiple: false,
      filters: [{ name: "Imagens", extensions: ["png", "tif", "tiff", "jpg", "jpeg"] }],
    });
    if (typeof f === "string") setter(f);
  };

  const adicionarArquivos = async (
    defaultPath: string,
    setter: React.Dispatch<React.SetStateAction<string[]>>
  ) => {
    const sel = await open({
      multiple: true,
      defaultPath: defaultPath || undefined,
      filters: [{ name: "Imagens", extensions: ["tif", "tiff", "png", "jpg", "jpeg"] }],
    });
    if (!sel) return;
    const novos = Array.isArray(sel) ? sel : [sel];
    setter((prev) => {
      const set = new Set(prev);
      for (const n of novos) set.add(n);
      return Array.from(set);
    });
  };

  const montarConfigs = () => {
    const autoCfg = {
      pasta: aPasta,
      arquivos: aOrigem === "arquivos" ? aArquivos : undefined,
      gabarito: aGab,
      saida: aSaida,
      medida: num(aMedida, "Largura da placa"),
      sobreposicao: num(aSobra, "Sobreposição"),
      pad: num(aPad, "Padding"),
      tipo: aTipo,
      workers: Math.max(1, Math.round(num(aWorkers, "Painéis em paralelo"))),
      cor: aCor,
      inverter: aInverter,
      mover: aOrigem === "arquivos" ? false : aMover,
      cidade: aCidade,
      cidade_cor: aCidadeCor,
      cidade_largura: num(aCidadeLarg, "Largura cidade"),
      cidade_altura: num(aCidadeAlt, "Altura cidade"),
      cidade_margem: num(aCidadeMargem, "Margem cidade"),
      overrides,
    };
    const medCfg = {
      entrada: mEntrada,
      arquivos: mOrigem === "arquivos" ? mArquivos : undefined,
      saida: mSaida,
      gabarito: mGab,
      medidas: mMedidas,
      sobreposicao: num(mSobra, "Sobreposição"),
      pad: num(mPad, "Padding"),
      tipo: mTipo,
      cor: mCor,
      inverter: mInverter,
      mover: false,
    };
    return { autoCfg, medCfg };
  };

  const parseListaMedidas = () => {
    const lista = mMedidas
      .split(",")
      .map((s) => Number(s.trim().replace(",", ".")))
      .filter((n) => !Number.isNaN(n) && n > 0);
    if (lista.length === 0) {
      throw new Error("Informe ao menos uma medida válida (ex: 140,150,125).");
    }
    return lista;
  };

  const simular = async () => {
    if (simulando || rodando) return;
    setErro(null);
    setSimulando(true);
    try {
      const { autoCfg, medCfg } = montarConfigs();
      await invoke("cortador_save_config", {
        data: {
          modo,
          auto: { ...autoCfg, arquivos: undefined, mover: aMover },
          medidas: { ...medCfg, arquivos: undefined },
        },
      });
      const res =
        modo === "Automático"
          ? await invoke<CortadorSimulacao>("cortador_simular_auto", { payload: autoCfg })
          : await invoke<CortadorSimulacao>("cortador_simular_medidas", {
              payload: { ...medCfg, medidas: parseListaMedidas() },
            });
      setSimulacao(res);
      setAbaSaida("preview");
    } catch (e) {
      setErro(String(e));
    } finally {
      setSimulando(false);
    }
  };

  const executar = async () => {
    setErro(null);
    setLogs([]);
    setProgresso(0);
    setDoneStats({ ok: 0, err: 0, cancelled: false });
    setAbaSaida("logs");

    try {
      if (modo === "Automático" && aOrigem === "arquivos" && aArquivos.length === 0) {
        throw new Error("Selecione ao menos um arquivo para cortar.");
      }
      if (modo === "Medidas personalizadas" && mOrigem === "arquivos" && mArquivos.length === 0) {
        throw new Error("Selecione ao menos um arquivo para cortar.");
      }

      const { autoCfg, medCfg } = montarConfigs();

      await invoke("cortador_save_config", {
        data: {
          modo,
          auto: { ...autoCfg, arquivos: undefined, mover: aMover },
          medidas: { ...medCfg, arquivos: undefined },
        },
      });

      if (modo === "Automático") {
        await invoke("cortador_executar_auto", { payload: autoCfg });
      } else {
        await invoke("cortador_executar_medidas", {
          payload: { ...medCfg, medidas: parseListaMedidas() },
        });
      }
    } catch (e) {
      setErro(String(e));
    }
  };

  const cancelar = async () => {
    await invoke("cortador_cancelar");
  };

  const adicionarOverride = () => {
    const k = ovKey.trim().toUpperCase();
    const v = ovVal.trim().toUpperCase();
    if (!k || !v) return;
    setOverrides((prev) => ({ ...prev, [k]: v }));
    setOvKey("");
    setOvVal("");
  };

  const removerOverride = (k: string) => {
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[k];
      return next;
    });
  };

  usePageShortcuts([
    {
      id: "cut-run",
      combo: "ctrl+enter",
      keys: "Ctrl+Enter",
      label: `Executar Corte (${modo})`,
      action: () => {
        if (!rodando) executar();
      },
    },
    {
      id: "cut-sim",
      combo: "ctrl+r",
      keys: "Ctrl+R",
      label: "Simular / Preview de Corte",
      action: simular,
    },
    {
      id: "cut-mode1",
      combo: "alt+1",
      keys: "Alt+1",
      label: "Modo Automático",
      action: () => setModo("Automático"),
    },
    {
      id: "cut-mode2",
      combo: "alt+2",
      keys: "Alt+2",
      label: "Modo Medidas Personalizadas",
      action: () => setModo("Medidas personalizadas"),
    },
    {
      id: "cut-tab-logs",
      combo: "alt+3",
      keys: "Alt+3",
      label: "Aba Console de Saída",
      action: () => setAbaSaida("logs"),
    },
    {
      id: "cut-tab-prev",
      combo: "alt+4",
      keys: "Alt+4",
      label: "Aba Preview de Corte",
      action: () => setAbaSaida("preview"),
    },
    {
      id: "cut-clear",
      combo: "ctrl+l",
      keys: "Ctrl+L",
      label: "Limpar Logs",
      action: () => setLogs([]),
    },
  ]);

  return (
    <div className="p-5 h-full flex flex-col gap-3.5 max-w-7xl mx-auto">
      <PageHeader
        icon={<Scissors className="w-4 h-4 text-slate-700 dark:text-zinc-300" />}
        title="Cortador de Painéis // Fatiamento Industrial"
        badge="CUT-03"
        subtitle="Corte uma pasta inteira ou selecione arquivos específicos direto, com simulação pré-corte e rótulo de cidade."
        right={
          <StatusBadge
            active={rodando}
            activeText="CORTANDO..."
            idleText="PRONTO"
            tone="amber"
          />
        }
      />

      {erro && (
        <div className="px-3.5 py-2 rounded text-xs font-mono bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-900/60 text-red-700 dark:text-red-400">
          ERRO // {erro}
        </div>
      )}

      {/* Telemetria Numérica */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <StatCard label="PAINÉIS NA FILA" value={simulacao?.total_paineis ?? "—"} tone="zinc" />
        <StatCard label="PLACAS ESTIMADAS" value={simulacao?.total_placas ?? "—"} tone="sky" />
        <StatCard label="CONCLUÍDOS" value={doneStats.ok} tone="emerald" />
        <StatCard label="ERROS" value={doneStats.err} tone="red" />
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[450px_1fr] gap-3.5">
        <SurfaceCard className="p-3.5 flex flex-col min-h-0">
          {/* Seletor de Modo */}
          <div className="grid grid-cols-2 gap-1 bg-slate-100 dark:bg-zinc-900 p-0.5 rounded border border-slate-200 dark:border-zinc-800 mb-3">
            {(["Automático", "Medidas personalizadas"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setModo(m)}
                className={`py-1.5 rounded text-xs font-mono font-medium cursor-pointer transition-colors ${
                  modo === m
                    ? "bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 font-bold shadow-2xs"
                    : "text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                {m.toUpperCase()}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 text-xs">
            {modo === "Automático" ? (
              <>
                <SeletorOrigem origem={aOrigem} onChange={setAOrigem} />

                {aOrigem === "pasta" ? (
                  <CampoCaminho
                    label="PASTA DOS PAINÉIS"
                    value={aPasta}
                    onChange={setAPasta}
                    onBrowse={() => escolherPasta(aPasta, setAPasta)}
                  />
                ) : (
                  <SeletorArquivos
                    arquivos={aArquivos}
                    onAdicionar={() => adicionarArquivos(aPasta, setAArquivos)}
                    onRemover={(p) => setAArquivos((prev) => prev.filter((x) => x !== p))}
                    onLimpar={() => setAArquivos([])}
                  />
                )}

                <CampoCaminho
                  label="ARQUIVO DE GABARITO (RGBA)"
                  value={aGab}
                  onChange={setAGab}
                  onBrowse={() => escolherArquivo(setAGab)}
                />
                <CampoCaminho
                  label={
                    aOrigem === "arquivos"
                      ? "DIRETÓRIO DE SAÍDA (VAZIO = MESMA DO ARQUIVO)"
                      : "DIRETÓRIO DE SAÍDA (VAZIO = MESMO)"
                  }
                  value={aSaida}
                  onChange={setASaida}
                  onBrowse={() => escolherPasta(aSaida, setASaida)}
                />

                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 dark:border-zinc-800">
                  <CampoTexto label="LARGURA PLACA" value={aMedida} onChange={setAMedida} unit="cm" />
                  <CampoTexto label="SOBREPOSIÇÃO" value={aSobra} onChange={setASobra} unit="cm" />
                  <CampoTexto label="PADDING" value={aPad} onChange={setAPad} unit="cm" />
                  <CampoTexto label="THREADS RAYON" value={aWorkers} onChange={setAWorkers} unit="th" />
                  <CampoSelect
                    label="ORIENTAÇÃO"
                    value={aTipo}
                    onChange={setATipo}
                    options={["horizontal", "vertical"]}
                  />
                  <CampoSelect
                    label="COR DO TEXTO"
                    value={aCor}
                    onChange={setACor}
                    options={["Automática (uma por painel)", ...CORES]}
                  />
                </div>

                <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-zinc-800 font-mono text-[11px]">
                  <label className="flex items-center gap-2 text-slate-700 dark:text-zinc-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={aInverter}
                      onChange={(e) => setAInverter(e.target.checked)}
                      className="rounded accent-blue-600"
                    />
                    <span>Inverter corte (180°)</span>
                  </label>
                  <label
                    className={`flex items-center gap-2 ${
                      aOrigem === "arquivos"
                        ? "text-slate-400 dark:text-zinc-500 cursor-not-allowed"
                        : "text-slate-700 dark:text-zinc-300 cursor-pointer"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={aOrigem === "arquivos" ? false : aMover}
                      disabled={aOrigem === "arquivos"}
                      onChange={(e) => setAMover(e.target.checked)}
                      className="rounded accent-blue-600"
                    />
                    <span>Mover originais e placas um nível acima ao terminar</span>
                  </label>
                  <label className="flex items-center gap-2 text-slate-700 dark:text-zinc-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={aCidade}
                      onChange={(e) => setACidade(e.target.checked)}
                      className="rounded accent-blue-600"
                    />
                    <span>Escrever a cidade na última placa</span>
                  </label>
                </div>

                {aCidade && (
                  <div className="space-y-2.5 pt-2 border-t border-slate-100 dark:border-zinc-800">
                    <div className="grid grid-cols-2 gap-2">
                      <CampoSelect
                        label="COR CIDADE"
                        value={aCidadeCor}
                        onChange={setACidadeCor}
                        options={CORES}
                      />
                      <CampoTexto label="LARGURA MÁX" value={aCidadeLarg} onChange={setACidadeLarg} unit="cm" />
                      <CampoTexto label="ALTURA MÁX" value={aCidadeAlt} onChange={setACidadeAlt} unit="cm" />
                      <CampoTexto label="MARGEM BORDA" value={aCidadeMargem} onChange={setACidadeMargem} unit="cm" />
                    </div>

                    {/* Overrides de Cidade */}
                    <div className="p-2 rounded border border-slate-200 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900/40 space-y-1.5">
                      <div className="font-mono text-[10px] font-semibold text-slate-500 dark:text-zinc-400">
                        APELIDOS / OVERRIDES DE CIDADE
                      </div>
                      <div className="flex gap-1">
                        <input
                          type="text"
                          value={ovKey}
                          onChange={(e) => setOvKey(e.target.value)}
                          placeholder="Original (ex: EU AMO LINHARES)"
                          className="flex-1 min-w-0 rounded border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 py-1 font-mono text-[11px] text-slate-900 dark:text-white"
                        />
                        <input
                          type="text"
                          value={ovVal}
                          onChange={(e) => setOvVal(e.target.value)}
                          placeholder="Rótulo (ex: LINHARES)"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              adicionarOverride();
                            }
                          }}
                          className="flex-1 min-w-0 rounded border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 py-1 font-mono text-[11px] text-slate-900 dark:text-white"
                        />
                        <button
                          type="button"
                          onClick={adicionarOverride}
                          className="px-2 py-1 rounded border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-800 hover:bg-slate-100 dark:hover:bg-zinc-700 text-slate-700 dark:text-zinc-200 cursor-pointer"
                          title="Adicionar substituição"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {Object.keys(overrides).length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-1">
                          {Object.entries(overrides).map(([k, v]) => (
                            <span
                              key={k}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 font-mono text-[10px] text-slate-700 dark:text-zinc-300"
                            >
                              <span>
                                {k} → {v}
                              </span>
                              <button
                                type="button"
                                onClick={() => removerOverride(k)}
                                className="text-slate-400 hover:text-red-500 cursor-pointer"
                              >
                                <X className="w-2.5 h-2.5" />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <SeletorOrigem origem={mOrigem} onChange={setMOrigem} />

                {mOrigem === "pasta" ? (
                  <CampoCaminho
                    label="PASTA ENTRADA"
                    value={mEntrada}
                    onChange={setMEntrada}
                    onBrowse={() => escolherPasta(mEntrada, setMEntrada)}
                  />
                ) : (
                  <SeletorArquivos
                    arquivos={mArquivos}
                    onAdicionar={() => adicionarArquivos(mEntrada, setMArquivos)}
                    onRemover={(p) => setMArquivos((prev) => prev.filter((x) => x !== p))}
                    onLimpar={() => setMArquivos([])}
                  />
                )}

                <CampoCaminho
                  label={
                    mOrigem === "arquivos"
                      ? "PASTA SAÍDA (VAZIO = MESMA DO ARQUIVO)"
                      : "PASTA SAÍDA"
                  }
                  value={mSaida}
                  onChange={setMSaida}
                  onBrowse={() => escolherPasta(mSaida, setMSaida)}
                />
                <CampoCaminho
                  label="GABARITO"
                  value={mGab}
                  onChange={setMGab}
                  onBrowse={() => escolherArquivo(setMGab)}
                />

                <div className="pt-2 border-t border-slate-100 dark:border-zinc-800">
                  <CampoTexto
                    label="MEDIDAS DAS PLACAS (SEPARADAS POR VÍRGULA)"
                    value={mMedidas}
                    onChange={setMMedidas}
                    unit="cm"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 dark:border-zinc-800">
                  <CampoTexto label="SOBREPOSIÇÃO" value={mSobra} onChange={setMSobra} unit="cm" />
                  <CampoTexto label="PADDING" value={mPad} onChange={setMPad} unit="cm" />
                  <CampoSelect
                    label="ORIENTAÇÃO"
                    value={mTipo}
                    onChange={setMTipo}
                    options={["vertical", "horizontal"]}
                  />
                  <CampoSelect
                    label="COR DO TEXTO"
                    value={mCor}
                    onChange={setMCor}
                    options={CORES}
                  />
                </div>

                <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-zinc-800 font-mono text-[11px]">
                  <label className="flex items-center gap-2 text-slate-700 dark:text-zinc-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={mInverter}
                      onChange={(e) => setMInverter(e.target.checked)}
                      className="rounded accent-blue-600"
                    />
                    <span>Inverter corte (180°)</span>
                  </label>
                </div>
              </>
            )}
          </div>
        </SurfaceCard>

        {/* Console de Saída, Simulação e Execução */}
        <div className="flex flex-col gap-2.5 min-h-0">
          <div className="flex items-center gap-2">
            <button
              onClick={simular}
              disabled={simulando || rodando}
              className="flex items-center justify-center gap-1.5 h-10 px-3.5 rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-slate-50 dark:hover:bg-zinc-800 disabled:opacity-40 text-slate-800 dark:text-zinc-200 font-mono text-xs font-semibold cursor-pointer shadow-2xs transition-all"
              title="Lê apenas cabeçalhos para prever quantidade e largura das placas (Ctrl+R)"
            >
              {simulando ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Eye className="w-3.5 h-3.5" />
              )}
              <span>SIMULAR</span>
            </button>

            {rodando ? (
              <button
                onClick={cancelar}
                className="flex-1 flex items-center justify-center gap-2 h-10 rounded border border-red-600 bg-red-600 hover:bg-red-500 text-white font-mono text-xs font-bold tracking-wider cursor-pointer shadow-2xs transition-all uppercase"
              >
                <Square className="w-3.5 h-3.5" />
                <span>CANCELAR CORTE</span>
              </button>
            ) : (
              <button
                onClick={executar}
                className="flex-1 flex items-center justify-center gap-2 h-10 rounded border border-emerald-600 bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-xs font-bold tracking-wider cursor-pointer shadow-2xs transition-all uppercase"
              >
                <Scissors className="w-3.5 h-3.5" />
                <span>EXECUTAR CORTE DE PAINÉIS</span>
              </button>
            )}

            <div className="font-mono text-xs font-semibold px-3 py-2 rounded border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111115] tabular-nums">
              {progresso.toFixed(0)}%
            </div>
          </div>

          <div className="h-1.5 rounded-xs bg-slate-200 dark:bg-zinc-800 overflow-hidden">
            <div
              className="h-full bg-emerald-600 dark:bg-emerald-500 transition-all duration-200"
              style={{ width: `${progresso}%` }}
            />
          </div>

          {/* Abas Saída / Preview */}
          <div className="inline-flex p-0.5 rounded border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-900 self-start gap-1 font-mono text-xs">
            <button
              onClick={() => setAbaSaida("logs")}
              className={`px-3 py-1 rounded cursor-pointer transition-colors ${
                abaSaida === "logs"
                  ? "bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 font-semibold shadow-2xs"
                  : "text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              CONSOLE DE SAÍDA
            </button>
            <button
              onClick={() => setAbaSaida("preview")}
              className={`px-3 py-1 rounded cursor-pointer transition-colors ${
                abaSaida === "preview"
                  ? "bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 font-semibold shadow-2xs"
                  : "text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              PREVIEW DE CORTE ({simulacao?.total_paineis ?? 0})
            </button>
          </div>

          {abaSaida === "logs" ? (
            <TerminalLog
              lines={logs}
              emptyText="Aguardando comando de corte ou simulação (Ctrl+R)..."
              logRef={logRef}
              onClear={() => setLogs([])}
            />
          ) : (
            <SurfaceCard className="flex-1 min-h-0 overflow-auto">
              {!simulacao ? (
                <div className="h-full flex items-center justify-center p-8 font-mono text-xs text-slate-500 dark:text-zinc-400">
                  CLIQUE EM 'SIMULAR' (Ctrl+R) PARA INSPECIONAR AS PLACAS ANTES DO CORTE
                </div>
              ) : simulacao.itens.length === 0 ? (
                <div className="h-full flex items-center justify-center p-8 font-mono text-xs text-slate-500 dark:text-zinc-400">
                  NENHUM PAINEL ELEGÍVEL ENCONTRADO
                </div>
              ) : (
                <table className="w-full text-left border-collapse font-mono text-xs">
                  <thead className="sticky top-0 bg-slate-50 dark:bg-zinc-900 border-b border-slate-200 dark:border-zinc-800 text-[10px] text-slate-500 dark:text-zinc-400">
                    <tr>
                      <th className="py-2 px-3">ARQUIVO</th>
                      <th className="py-2 px-3">DIMENSÃO (CORTE)</th>
                      <th className="py-2 px-3">DPI</th>
                      <th className="py-2 px-3">PLACAS</th>
                      <th className="py-2 px-3">CIDADE</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-zinc-800/70">
                    {simulacao.itens.map((it, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/70 dark:hover:bg-zinc-900/40">
                        <td
                          className="py-2 px-3 font-semibold text-slate-800 dark:text-zinc-200 max-w-56 truncate"
                          title={it.arquivo}
                        >
                          {it.arquivo}
                        </td>
                        {it.erro ? (
                          <td colSpan={4} className="py-2 px-3 text-red-600 dark:text-red-400">
                            {it.erro}
                          </td>
                        ) : (
                          <>
                            <td className="py-2 px-3 tabular-nums text-slate-600 dark:text-zinc-300">
                              {it.largura_cm.toFixed(1)} × {it.altura_cm.toFixed(1)} cm
                            </td>
                            <td className="py-2 px-3 tabular-nums text-slate-500 dark:text-zinc-400">
                              {it.dpi}
                            </td>
                            <td className="py-2 px-3 tabular-nums">
                              <span className="font-bold text-blue-600 dark:text-blue-400">
                                {it.n_placas}×
                              </span>{" "}
                              <span className="text-slate-500 dark:text-zinc-400 text-[11px]">
                                ({it.placas_cm.map((p) => `${p.toFixed(1)}`).join(" / ")} cm)
                              </span>
                            </td>
                            <td className="py-2 px-3">
                              {it.cidade ? (
                                <span className="px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300 text-[10px]">
                                  {it.cidade}
                                </span>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </SurfaceCard>
          )}
        </div>
      </div>
    </div>
  );
}

function SeletorOrigem({
  origem,
  onChange,
}: {
  origem: "pasta" | "arquivos";
  onChange: (v: "pasta" | "arquivos") => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 pb-1">
      <span className="font-mono text-[10px] font-semibold text-slate-500 dark:text-zinc-400">
        ORIGEM DOS PAINÉIS
      </span>
      <div className="inline-flex rounded bg-slate-100 dark:bg-zinc-900 p-0.5 border border-slate-200 dark:border-zinc-800 font-mono">
        <button
          type="button"
          onClick={() => onChange("pasta")}
          className={`px-2.5 py-1 rounded text-[10px] font-semibold cursor-pointer transition-colors ${
            origem === "pasta"
              ? "bg-white dark:bg-zinc-800 text-slate-900 dark:text-white shadow-2xs"
              : "text-slate-500 dark:text-zinc-400"
          }`}
        >
          PASTA INTEIRA
        </button>
        <button
          type="button"
          onClick={() => onChange("arquivos")}
          className={`px-2.5 py-1 rounded text-[10px] font-semibold cursor-pointer transition-colors ${
            origem === "arquivos"
              ? "bg-white dark:bg-zinc-800 text-slate-900 dark:text-white shadow-2xs"
              : "text-slate-500 dark:text-zinc-400"
          }`}
        >
          ARQUIVOS
        </button>
      </div>
    </div>
  );
}

function SeletorArquivos({
  arquivos,
  onAdicionar,
  onRemover,
  onLimpar,
}: {
  arquivos: string[];
  onAdicionar: () => void;
  onRemover: (p: string) => void;
  onLimpar: () => void;
}) {
  return (
    <div className="rounded border border-slate-200 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900/40 p-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onAdicionar}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-mono text-[11px] font-semibold cursor-pointer"
        >
          <FilePlus2 className="w-3.5 h-3.5" />
          ESCOLHER ARQUIVOS ({arquivos.length})
        </button>
        {arquivos.length > 0 && (
          <button
            type="button"
            onClick={onLimpar}
            className="font-mono text-[10px] text-slate-500 hover:text-red-500 cursor-pointer"
          >
            LIMPAR
          </button>
        )}
      </div>

      {arquivos.length === 0 ? (
        <div className="font-mono text-[10px] text-slate-400 dark:text-zinc-500 py-1.5 text-center">
          Nenhum arquivo selecionado.
        </div>
      ) : (
        <div className="max-h-28 overflow-y-auto space-y-1">
          {arquivos.map((arq) => (
            <div
              key={arq}
              className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
            >
              <span
                className="truncate font-mono text-[11px] text-slate-700 dark:text-zinc-200"
                title={arq}
              >
                {basename(arq)}
              </span>
              <button
                type="button"
                onClick={() => onRemover(arq)}
                className="text-slate-400 hover:text-red-500 cursor-pointer shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CampoCaminho({
  label,
  value,
  onChange,
  onBrowse,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBrowse: () => void;
}) {
  return (
    <div>
      <label className="block font-mono text-[10px] font-semibold text-slate-500 dark:text-zinc-400 mb-1">
        {label}
      </label>
      <div className="flex gap-1.5">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 px-2.5 py-1 font-mono text-xs text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
        />
        <button
          onClick={onBrowse}
          className="px-2.5 py-1 rounded border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-700 dark:text-zinc-300 cursor-pointer"
        >
          <FolderOpen className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

function CampoTexto({
  label,
  value,
  onChange,
  unit,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  unit?: string;
}) {
  return (
    <div>
      <label className="block font-mono text-[10px] font-semibold text-slate-500 dark:text-zinc-400 mb-1">
        {label}
      </label>
      <div className="relative flex items-center">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 px-2.5 py-1 font-mono text-xs text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
        />
        {unit && (
          <span className="absolute right-2 font-mono text-[10px] text-slate-400 dark:text-zinc-500 pointer-events-none">
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}

function CampoSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <div>
      <label className="block font-mono text-[10px] font-semibold text-slate-500 dark:text-zinc-400 mb-1">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 px-2.5 py-1 font-mono text-xs text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
      >
        {options.map((o) => (
          <option key={o} value={o} className="bg-white dark:bg-[#111115]">
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}
