import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Scissors } from "lucide-react";
import { PageHeader, StatusBadge, SurfaceCard, TerminalLog } from "../components/ui";
import { usePageShortcuts } from "../hooks/useShortcuts";

const CORES = ["Preto", "Azul", "Rosa", "Roxo", "Vermelho", "Verde"];

export function CortadorPage() {
  const [modo, setModo] = useState<"Automático" | "Medidas personalizadas">("Automático");
  const [rodando, setRodando] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

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
  const [overrides, setOverrides] = useState<Record<string, string>>({});

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
      if (a.overrides) setOverrides(a.overrides);

      const m = cfg.medidas || {};
      setMEntrada(m.entrada || "");
      setMSaida(m.saida || "");
      setMGab(m.gabarito || "");
      setMMedidas(m.medidas || "140,150,125");
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

    return () => {
      unSt.then((fn) => fn());
      unLog.then((fn) => fn());
      unProg.then((fn) => fn());
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

  const executar = async () => {
    setErro(null);
    setLogs([]);
    setProgresso(0);

    try {
      const autoCfg = {
        pasta: aPasta,
        gabarito: aGab,
        saida: aSaida,
        medida: num(aMedida, "Largura da placa"),
        sobreposicao: num(aSobra, "Sobreposição"),
        pad: num(aPad, "Padding"),
        tipo: aTipo,
        workers: Math.max(1, Math.round(num(aWorkers, "Painéis em paralelo"))),
        cor: aCor,
        inverter: aInverter,
        mover: aMover,
        cidade: aCidade,
        cidade_cor: aCidadeCor,
        cidade_largura: num(aCidadeLarg, "Largura cidade"),
        cidade_altura: num(aCidadeAlt, "Altura cidade"),
        cidade_margem: num(aCidadeMargem, "Margem cidade"),
        overrides,
      };
      const medCfg = {
        entrada: mEntrada,
        saida: mSaida,
        gabarito: mGab,
        medidas: mMedidas,
        sobreposicao: num(mSobra, "Sobreposição"),
        pad: num(mPad, "Padding"),
        tipo: mTipo,
        cor: mCor,
        inverter: mInverter,
      };

      await invoke("cortador_save_config", {
        data: { modo, auto: autoCfg, medidas: medCfg },
      });

      if (modo === "Automático") {
        await invoke("cortador_executar_auto", { payload: autoCfg });
      } else {
        const lista = mMedidas
          .split(",")
          .map((s) => Number(s.trim().replace(",", ".")))
          .filter((n) => !Number.isNaN(n) && n > 0);
        if (lista.length === 0) {
          throw new Error("Informe ao menos uma medida válida (ex: 140,150,125).");
        }
        await invoke("cortador_executar_medidas", {
          payload: { ...medCfg, medidas: lista },
        });
      }
    } catch (e) {
      setErro(String(e));
    }
  };

  usePageShortcuts([
    { id: "cut-run", combo: "ctrl+enter", keys: "Ctrl+Enter", label: `Executar Corte (${modo})`, action: () => { if (!rodando) executar(); } },
    { id: "cut-mode1", combo: "alt+1", keys: "Alt+1", label: "Modo Automático", action: () => setModo("Automático") },
    { id: "cut-mode2", combo: "alt+2", keys: "Alt+2", label: "Modo Medidas Personalizadas", action: () => setModo("Medidas personalizadas") },
    { id: "cut-clear", combo: "ctrl+l", keys: "Ctrl+L", label: "Limpar Logs", action: () => setLogs([]) },
  ]);

  return (
    <div className="p-5 h-full flex flex-col gap-3.5 max-w-7xl mx-auto">
      <PageHeader
        icon={<Scissors className="w-4 h-4 text-slate-700 dark:text-zinc-300" />}
        title="Cortador de Painéis // Fatiamento Industrial"
        badge="CUT-03"
        subtitle="Corta painéis em placas com gabarito de costura, numeração automática e rótulo de cidade no padding."
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
                <CampoCaminho
                  label="PASTA DOS PAINÉIS"
                  value={aPasta}
                  onChange={setAPasta}
                  onBrowse={() => escolherPasta(aPasta, setAPasta)}
                />
                <CampoCaminho
                  label="ARQUIVO DE GABARITO (RGBA)"
                  value={aGab}
                  onChange={setAGab}
                  onBrowse={() => escolherArquivo(setAGab)}
                />
                <CampoCaminho
                  label="DIRETÓRIO DE SAÍDA (VAZIO = MESMO)"
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
                  <label className="flex items-center gap-2 text-slate-700 dark:text-zinc-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={aMover}
                      onChange={(e) => setAMover(e.target.checked)}
                      className="rounded accent-blue-600"
                    />
                    <span>Mover originais para painel_original/</span>
                  </label>
                  <label className="flex items-center gap-2 text-slate-700 dark:text-zinc-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={aCidade}
                      onChange={(e) => setACidade(e.target.checked)}
                      className="rounded accent-blue-600"
                    />
                    <span>Imprimir rótulo de cidade na última placa</span>
                  </label>
                </div>

                {aCidade && (
                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 dark:border-zinc-800">
                    <CampoSelect
                      label="COR CIDADE"
                      value={aCidadeCor}
                      onChange={setACidadeCor}
                      options={CORES}
                    />
                    <CampoTexto label="LARGURA MÁX" value={aCidadeLarg} onChange={setACidadeLarg} unit="cm" />
                    <CampoTexto label="ALTURA MÁX" value={aCidadeAlt} onChange={setACidadeAlt} unit="cm" />
                    <CampoTexto label="MARGEM INF" value={aCidadeMargem} onChange={setACidadeMargem} unit="cm" />
                  </div>
                )}
              </>
            ) : (
              <>
                <CampoCaminho
                  label="PASTA ENTRADA"
                  value={mEntrada}
                  onChange={setMEntrada}
                  onBrowse={() => escolherPasta(mEntrada, setMEntrada)}
                />
                <CampoCaminho
                  label="PASTA SAÍDA"
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

                <label className="flex items-center gap-2 text-slate-700 dark:text-zinc-300 pt-2 cursor-pointer font-mono text-[11px]">
                  <input
                    type="checkbox"
                    checked={mInverter}
                    onChange={(e) => setMInverter(e.target.checked)}
                    className="rounded accent-blue-600"
                  />
                  <span>Inverter corte (180°)</span>
                </label>
              </>
            )}
          </div>
        </SurfaceCard>

        {/* Console de Saída e Execução */}
        <div className="flex flex-col gap-2.5 min-h-0">
          <div className="flex items-center gap-3">
            <button
              onClick={executar}
              disabled={rodando}
              className="flex-1 flex items-center justify-center gap-2 h-10 rounded border border-emerald-600 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-mono text-xs font-bold tracking-wider cursor-pointer shadow-2xs transition-all uppercase"
            >
              <Scissors className="w-3.5 h-3.5" />
              <span>{rodando ? "PROCESSANDO CORTE..." : "EXECUTAR CORTE DE PAINÉIS"}</span>
            </button>
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

          <TerminalLog
            lines={logs}
            emptyText="Aguardando comando de corte..."
            logRef={logRef}
            onClear={() => setLogs([])}
          />
        </div>
      </div>
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
      <label className="block font-mono text-[10px] font-semibold text-slate-500 dark:text-zinc-400 mb-1">{label}</label>
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
      <label className="block font-mono text-[10px] font-semibold text-slate-500 dark:text-zinc-400 mb-1">{label}</label>
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
      <label className="block font-mono text-[10px] font-semibold text-slate-500 dark:text-zinc-400 mb-1">{label}</label>
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
