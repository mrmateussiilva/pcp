import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { FilePlus2, FolderOpen, Scissors, X } from "lucide-react";
import { PageHeader, StatusBadge, SurfaceCard, TerminalLog } from "../components/ui";

const CORES = ["Preto", "Azul", "Rosa", "Roxo", "Vermelho", "Verde"];

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export function CortadorPage() {
  const [modo, setModo] = useState<"Automático" | "Medidas personalizadas">("Automático");
  const [rodando, setRodando] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
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
  const [overridesTxt, setOverridesTxt] = useState(
    "EU AMO LINHARES = LINHARES\nLINHARES 02 = LINHARES\nSOORETAMA - FAIXA = SOORETAMA"
  );

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
      if (a.overrides && typeof a.overrides === "object") {
        const lines = Object.entries(a.overrides).map(([k, v]) => `${k} = ${v}`);
        if (lines.length > 0) setOverridesTxt(lines.join("\n"));
      }

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

  const executar = async () => {
    setErro(null);
    setLogs([]);
    setProgresso(0);

    try {
      const parsedOverrides: Record<string, string> = {};
      for (const line of overridesTxt.split(/\r?\n/)) {
        const idx = line.indexOf("=");
        if (idx > 0) {
          const k = line.slice(0, idx).trim();
          const v = line.slice(idx + 1).trim();
          if (k && v) parsedOverrides[k] = v;
        }
      }

      if (modo === "Automático" && aOrigem === "arquivos" && aArquivos.length === 0) {
        throw new Error("Selecione ao menos um arquivo para cortar.");
      }
      if (modo === "Medidas personalizadas" && mOrigem === "arquivos" && mArquivos.length === 0) {
        throw new Error("Selecione ao menos um arquivo para cortar.");
      }

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
        overrides: parsedOverrides,
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
      };

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
        subtitle="Corte uma pasta inteira ou selecione arquivos específicos direto sem precisar movê-los."
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

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[470px_1fr] gap-4">
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
                <SeletorOrigem origem={aOrigem} onChange={setAOrigem} />

                {aOrigem === "pasta" ? (
                  <CampoCaminho
                    label="Pasta dos painéis"
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
                  label="Gabarito"
                  value={aGab}
                  onChange={setAGab}
                  onBrowse={() => escolherArquivo(setAGab)}
                />
                <CampoCaminho
                  label={
                    aOrigem === "arquivos"
                      ? "Saída (vazio = mesma pasta do arquivo)"
                      : "Saída (vazio = mesma pasta dos painéis)"
                  }
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
                  <label
                    className={`flex items-center gap-2 ${
                      aOrigem === "arquivos"
                        ? "text-slate-400 dark:text-zinc-500 cursor-not-allowed"
                        : "text-slate-700 dark:text-zinc-200 cursor-pointer"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={aOrigem === "arquivos" ? false : aMover}
                      disabled={aOrigem === "arquivos"}
                      onChange={(e) => setAMover(e.target.checked)}
                      className="rounded accent-blue-600"
                    />
                    Mover originais e placas um nível acima ao terminar
                  </label>
                  <label className="flex items-center gap-2 text-slate-700 dark:text-zinc-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={aCidade}
                      onChange={(e) => setACidade(e.target.checked)}
                      className="rounded accent-blue-600"
                    />
                    Escrever a cidade na última placa
                  </label>
                </div>

                {aCidade && (
                  <div className="space-y-2.5 pt-2 border-t border-slate-200 dark:border-white/10">
                    <div className="grid grid-cols-2 gap-2.5">
                      <CampoSelect
                        label="Cor da cidade"
                        value={aCidadeCor}
                        onChange={setACidadeCor}
                        options={CORES}
                      />
                      <CampoTexto label="Largura máx (cm)" value={aCidadeLarg} onChange={setACidadeLarg} />
                      <CampoTexto label="Altura máx (cm)" value={aCidadeAlt} onChange={setACidadeAlt} />
                      <CampoTexto label="Margem borda (cm)" value={aCidadeMargem} onChange={setACidadeMargem} />
                    </div>
                    <div>
                      <label className="block text-slate-500 dark:text-zinc-400 mb-1">
                        Correções de nome (ARQUIVO = TEXTO), uma por linha:
                      </label>
                      <textarea
                        rows={3}
                        value={overridesTxt}
                        onChange={(e) => setOverridesTxt(e.target.value)}
                        className="w-full rounded-xl bg-slate-50 dark:bg-[#0b0b12] border border-slate-200 dark:border-white/10 px-3 py-1.5 font-mono text-[11px] text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <SeletorOrigem origem={mOrigem} onChange={setMOrigem} />

                {mOrigem === "pasta" ? (
                  <CampoCaminho
                    label="Pasta entrada"
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
                      ? "Saída (vazio = mesma pasta do arquivo)"
                      : "Pasta saída"
                  }
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

function SeletorOrigem({
  origem,
  onChange,
}: {
  origem: "pasta" | "arquivos";
  onChange: (v: "pasta" | "arquivos") => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 pb-1">
      <span className="text-[11px] font-medium text-slate-500 dark:text-zinc-400">Origem</span>
      <div className="inline-flex rounded-lg bg-slate-100 dark:bg-[#0b0b12] p-0.5 border border-slate-200 dark:border-white/10">
        <button
          type="button"
          onClick={() => onChange("pasta")}
          className={`px-2.5 py-1 rounded-md text-[11px] font-medium cursor-pointer transition-colors ${
            origem === "pasta"
              ? "bg-white dark:bg-blue-600 text-slate-900 dark:text-white shadow-xs"
              : "text-slate-500 dark:text-zinc-400"
          }`}
        >
          Pasta inteira
        </button>
        <button
          type="button"
          onClick={() => onChange("arquivos")}
          className={`px-2.5 py-1 rounded-md text-[11px] font-medium cursor-pointer transition-colors ${
            origem === "arquivos"
              ? "bg-white dark:bg-blue-600 text-slate-900 dark:text-white shadow-xs"
              : "text-slate-500 dark:text-zinc-400"
          }`}
        >
          Selecionar arquivos
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
    <div className="rounded-xl bg-slate-50 dark:bg-[#0b0b12] border border-slate-200 dark:border-white/10 p-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onAdicionar}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-semibold cursor-pointer"
        >
          <FilePlus2 className="w-3.5 h-3.5" />
          Escolher arquivos ({arquivos.length})
        </button>
        {arquivos.length > 0 && (
          <button
            type="button"
            onClick={onLimpar}
            className="text-[11px] text-slate-500 hover:text-red-500 cursor-pointer"
          >
            Limpar
          </button>
        )}
      </div>

      {arquivos.length === 0 ? (
        <div className="text-[11px] text-slate-400 dark:text-zinc-500 py-2 text-center">
          Nenhum arquivo selecionado. Clique acima para escolher 1 ou mais painéis.
        </div>
      ) : (
        <div className="max-h-28 overflow-y-auto space-y-1">
          {arquivos.map((arq) => (
            <div
              key={arq}
              className="flex items-center justify-between gap-2 px-2 py-1 rounded-lg bg-white dark:bg-white/[0.04] border border-slate-200/70 dark:border-white/[0.06]"
            >
              <span className="truncate font-mono text-[11px] text-slate-700 dark:text-zinc-200" title={arq}>
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
