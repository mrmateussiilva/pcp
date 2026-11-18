import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Scissors } from "lucide-react";
import { PageHeader, StatusBadge, SurfaceCard, TerminalLog } from "../components/ui";

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

  return (
    <div className="p-6 h-full flex flex-col gap-4 max-w-7xl mx-auto">
      <PageHeader
        icon={<Scissors className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />}
        title="Cortador de Painéis"
        subtitle="Corta painéis em placas com gabarito, numeração de costura e nome no padding."
        right={
          <StatusBadge
            active={rodando}
            activeText="Cortando..."
            idleText="Pronto"
            tone="amber"
          />
        }
      />

      {erro && (
        <div className="px-4 py-2.5 rounded-xl text-xs bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300">
          {erro}
        </div>
      )}

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[460px_1fr] gap-4">
        <SurfaceCard className="p-4 flex flex-col min-h-0">
          <div className="grid grid-cols-2 gap-1 bg-slate-100 dark:bg-[#0b0b12] p-1 rounded-xl border border-slate-200 dark:border-white/[0.06] mb-3">
            {(["Automático", "Medidas personalizadas"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setModo(m)}
                className={`py-2 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                  modo === m
                    ? "bg-white dark:bg-blue-600 text-slate-900 dark:text-white shadow-xs"
                    : "text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                {m}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 text-xs">
            {modo === "Automático" ? (
              <>
                <CampoCaminho
                  label="Pasta dos painéis"
                  value={aPasta}
                  onChange={setAPasta}
                  onBrowse={() => escolherPasta(aPasta, setAPasta)}
                />
                <CampoCaminho
                  label="Gabarito"
                  value={aGab}
                  onChange={setAGab}
                  onBrowse={() => escolherArquivo(setAGab)}
                />
                <CampoCaminho
                  label="Saída (vazio = mesma)"
                  value={aSaida}
                  onChange={setASaida}
                  onBrowse={() => escolherPasta(aSaida, setASaida)}
                />

                <div className="grid grid-cols-2 gap-2.5 pt-2">
                  <CampoTexto label="Largura da placa (cm)" value={aMedida} onChange={setAMedida} />
                  <CampoTexto label="Sobreposição (cm)" value={aSobra} onChange={setASobra} />
                  <CampoTexto label="Padding (cm)" value={aPad} onChange={setAPad} />
                  <CampoTexto label="Painéis em paralelo" value={aWorkers} onChange={setAWorkers} />
                  <CampoSelect
                    label="Tipo de corte"
                    value={aTipo}
                    onChange={setATipo}
                    options={["horizontal", "vertical"]}
                  />
                  <CampoSelect
                    label="Cor do texto"
                    value={aCor}
                    onChange={setACor}
                    options={["Automática (uma por painel)", ...CORES]}
                  />
                </div>

                <div className="space-y-2 pt-2">
                  <label className="flex items-center gap-2 text-slate-700 dark:text-zinc-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={aInverter}
                      onChange={(e) => setAInverter(e.target.checked)}
                      className="rounded accent-blue-600"
                    />
                    Inverter corte (180°)
                  </label>
                  <label className="flex items-center gap-2 text-slate-700 dark:text-zinc-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={aMover}
                      onChange={(e) => setAMover(e.target.checked)}
                      className="rounded accent-blue-600"
                    />
                    Mover originais para painel_original/
                  </label>
                  <label className="flex items-center gap-2 text-slate-700 dark:text-zinc-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={aCidade}
                      onChange={(e) => setACidade(e.target.checked)}
                      className="rounded accent-blue-600"
                    />
                    Imprimir nome da cidade na última placa
                  </label>
                </div>

                {aCidade && (
                  <div className="grid grid-cols-2 gap-2.5 pt-2 border-t border-slate-200 dark:border-white/10">
                    <CampoSelect
                      label="Cor da cidade"
                      value={aCidadeCor}
                      onChange={setACidadeCor}
                      options={CORES}
                    />
                    <CampoTexto label="Largura máx (cm)" value={aCidadeLarg} onChange={setACidadeLarg} />
                    <CampoTexto label="Altura máx (cm)" value={aCidadeAlt} onChange={setACidadeAlt} />
                    <CampoTexto label="Margem inf. (cm)" value={aCidadeMargem} onChange={setACidadeMargem} />
                  </div>
                )}
              </>
            ) : (
              <>
                <CampoCaminho
                  label="Pasta entrada"
                  value={mEntrada}
                  onChange={setMEntrada}
                  onBrowse={() => escolherPasta(mEntrada, setMEntrada)}
                />
                <CampoCaminho
                  label="Pasta saída"
                  value={mSaida}
                  onChange={setMSaida}
                  onBrowse={() => escolherPasta(mSaida, setMSaida)}
                />
                <CampoCaminho
                  label="Gabarito"
                  value={mGab}
                  onChange={setMGab}
                  onBrowse={() => escolherArquivo(setMGab)}
                />

                <div className="pt-2">
                  <CampoTexto
                    label="Medidas das placas (cm, separadas por vírgula)"
                    value={mMedidas}
                    onChange={setMMedidas}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2.5 pt-1">
                  <CampoTexto label="Sobreposição (cm)" value={mSobra} onChange={setMSobra} />
                  <CampoTexto label="Padding (cm)" value={mPad} onChange={setMPad} />
                  <CampoSelect
                    label="Tipo de corte"
                    value={mTipo}
                    onChange={setMTipo}
                    options={["vertical", "horizontal"]}
                  />
                  <CampoSelect
                    label="Cor do texto"
                    value={mCor}
                    onChange={setMCor}
                    options={CORES}
                  />
                </div>

                <label className="flex items-center gap-2 text-slate-700 dark:text-zinc-200 pt-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={mInverter}
                    onChange={(e) => setMInverter(e.target.checked)}
                    className="rounded accent-blue-600"
                  />
                  Inverter corte (180°)
                </label>
              </>
            )}
          </div>
        </SurfaceCard>

        <div className="flex flex-col gap-3 min-h-0">
          <button
            onClick={executar}
            disabled={rodando}
            className="flex items-center justify-center gap-2 h-12 rounded-2xl bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 disabled:opacity-50 text-white text-sm font-bold tracking-wide cursor-pointer shadow-sm transition-all"
          >
            <Scissors className="w-4 h-4" />
            {rodando ? "CORTANDO..." : "CORTAR PAINÉIS"}
          </button>

          <div className="h-2.5 rounded-full bg-slate-200 dark:bg-[#0b0b12] overflow-hidden border border-slate-200 dark:border-white/[0.06]">
            <div
              className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-300"
              style={{ width: `${progresso}%` }}
            />
          </div>

          <TerminalLog
            lines={logs}
            emptyText="Configure os parâmetros ao lado e clique em CORTAR PAINÉIS."
            logRef={logRef}
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
      <label className="block text-slate-500 dark:text-zinc-400 mb-1">{label}</label>
      <div className="flex gap-1.5">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 rounded-xl bg-slate-50 dark:bg-[#0b0b12] border border-slate-200 dark:border-white/10 px-3 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
        />
        <button
          onClick={onBrowse}
          className="px-2.5 py-1.5 rounded-xl bg-slate-100 dark:bg-white/[0.07] hover:bg-slate-200 dark:hover:bg-white/15 text-slate-700 dark:text-zinc-200 cursor-pointer"
        >
          <FolderOpen className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function CampoTexto({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-slate-500 dark:text-zinc-400 mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl bg-slate-50 dark:bg-[#0b0b12] border border-slate-200 dark:border-white/10 px-3 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
      />
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
      <label className="block text-slate-500 dark:text-zinc-400 mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl bg-slate-50 dark:bg-[#0b0b12] border border-slate-200 dark:border-white/10 px-3 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
      >
        {options.map((o) => (
          <option key={o} value={o} className="bg-white dark:bg-[#151521]">
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}
