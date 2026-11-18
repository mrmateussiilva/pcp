import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { Check, Copy, FileText, FolderOpen, Play, Square, Trash2 } from "lucide-react";
import { PageHeader, StatusBadge, SurfaceCard } from "../components/ui";

interface NotepadConfig {
  arquivo: string;
  auto_iniciar: boolean;
  ws_port: number;
  http_port: number;
}

interface NotepadStatus {
  rodando: boolean;
  http_ativo: boolean;
  ws_port: number;
  http_port: number;
  link: string;
  text: string;
  author: string | null;
  updated_at: string | null;
  clients: number;
}

export function NotepadPage() {
  const [arquivo, setArquivo] = useState("");
  const [wsPort, setWsPort] = useState("8765");
  const [httpPort, setHttpPort] = useState("8766");
  const [autoIniciar, setAutoIniciar] = useState(true);
  const [status, setStatus] = useState<NotepadStatus>({
    rodando: false,
    http_ativo: false,
    ws_port: 8765,
    http_port: 8766,
    link: "",
    text: "",
    author: null,
    updated_at: null,
    clients: 0,
  });
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  const debounceRef = useRef<number | null>(null);
  const ultimoTextoRemotoRef = useRef("");

  const aplicarEstado = (st: NotepadStatus) => {
    setStatus(st);
    if (st.rodando && st.text !== ultimoTextoRemotoRef.current) {
      ultimoTextoRemotoRef.current = st.text;
      setTexto(st.text);
    }
  };

  useEffect(() => {
    invoke<NotepadConfig>("notepad_get_config").then((cfg) => {
      setArquivo(cfg.arquivo);
      setAutoIniciar(cfg.auto_iniciar);
      setWsPort(String(cfg.ws_port || 8765));
      setHttpPort(String(cfg.http_port || 8766));
    });

    invoke<NotepadStatus>("notepad_status").then(aplicarEstado);

    const unlisten = listen<NotepadStatus>("notepad-estado", (e) => {
      aplicarEstado(e.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const selecionarArquivo = async () => {
    const file = await open({
      multiple: false,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (typeof file === "string") setArquivo(file);
  };

  const salvarConfig = async (novoAuto = autoIniciar) => {
    await invoke("notepad_save_config", {
      payload: {
        arquivo,
        auto_iniciar: novoAuto,
        ws_port: Number(wsPort) || 8765,
        http_port: Number(httpPort) || 8766,
      },
    });
  };

  const alternarServidor = async () => {
    setErro(null);
    try {
      if (status.rodando) {
        const st = await invoke<NotepadStatus>("notepad_parar");
        setStatus(st);
      } else {
        const ws = Number(wsPort) || 8765;
        const http = Number(httpPort) || 8766;
        const st = await invoke<NotepadStatus>("notepad_iniciar", {
          arquivo,
          autoIniciar,
          wsPort: ws,
          httpPort: http,
        });
        aplicarEstado(st);
      }
    } catch (e) {
      setErro(String(e));
    }
  };

  const onDigitar = (novoTexto: string) => {
    setTexto(novoTexto);
    ultimoTextoRemotoRef.current = novoTexto;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      invoke("notepad_set_texto", { text: novoTexto });
    }, 150);
  };

  const limparParaTodos = () => {
    if (texto.length > 0 && !window.confirm("Limpar o texto para todos?")) return;
    onDigitar("");
    invoke("notepad_set_texto", { text: "" });
  };

  const copiarLink = async () => {
    if (!status.link) return;
    await navigator.clipboard.writeText(status.link);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 1800);
  };

  const formatarHora = (iso: string | null) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString("pt-BR");
  };

  return (
    <div className="p-6 h-full flex flex-col gap-3.5 max-w-7xl mx-auto">
      <PageHeader
        icon={<FileText className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />}
        title="Notepad compartilhado"
        subtitle="O PCP Central vira o servidor. Os outros PCs abrem o link no navegador e editam juntos."
        right={
          <StatusBadge
            active={status.rodando}
            activeText="Servidor ligado"
            idleText="Desligado"
          />
        }
      />

      {erro && (
        <div className="px-4 py-2.5 rounded-xl text-xs bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300">
          {erro}
        </div>
      )}

      <SurfaceCard className="p-4 space-y-3">
        <div className="flex items-center gap-2.5">
          <span className="text-xs text-slate-500 dark:text-zinc-400 w-28 shrink-0">
            Arquivo de estado
          </span>
          <input
            type="text"
            value={arquivo}
            disabled={status.rodando}
            onChange={(e) => setArquivo(e.target.value)}
            className="flex-1 rounded-xl bg-slate-50 dark:bg-[#0b0b12] border border-slate-200 dark:border-white/10 px-3 py-2 text-xs text-slate-900 dark:text-white disabled:opacity-50 focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={selecionarArquivo}
            disabled={status.rodando}
            className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-white/[0.07] hover:bg-slate-200 dark:hover:bg-white/15 disabled:opacity-50 text-slate-700 dark:text-zinc-200 cursor-pointer"
          >
            <FolderOpen className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500 dark:text-zinc-400">HTTP</span>
              <input
                type="text"
                value={httpPort}
                disabled={status.rodando}
                onChange={(e) => setHttpPort(e.target.value)}
                className="w-20 rounded-xl bg-slate-50 dark:bg-[#0b0b12] border border-slate-200 dark:border-white/10 px-2.5 py-1.5 text-xs text-slate-900 dark:text-white disabled:opacity-50"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500 dark:text-zinc-400">WS</span>
              <input
                type="text"
                value={wsPort}
                disabled={status.rodando}
                onChange={(e) => setWsPort(e.target.value)}
                className="w-20 rounded-xl bg-slate-50 dark:bg-[#0b0b12] border border-slate-200 dark:border-white/10 px-2.5 py-1.5 text-xs text-slate-900 dark:text-white disabled:opacity-50"
              />
            </div>

            <button
              onClick={alternarServidor}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-xl text-xs font-semibold text-white cursor-pointer transition-all ${
                status.rodando
                  ? "bg-red-600 hover:bg-red-500 shadow-sm"
                  : "bg-emerald-600 hover:bg-emerald-500 shadow-sm"
              }`}
            >
              {status.rodando ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {status.rodando ? "Desligar" : "Ligar servidor"}
            </button>

            <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-zinc-200 cursor-pointer">
              <input
                type="checkbox"
                checked={autoIniciar}
                onChange={(e) => {
                  setAutoIniciar(e.target.checked);
                  salvarConfig(e.target.checked);
                }}
                className="rounded accent-blue-600"
              />
              Ligar ao abrir
            </label>
          </div>

          {status.rodando && status.link && (
            <div className="flex items-center gap-2 bg-blue-50 dark:bg-[#0b0b12] border border-blue-200 dark:border-white/10 rounded-xl px-3 py-1.5">
              <span className="text-xs text-blue-700 dark:text-blue-400 font-mono select-text">
                {status.link}
              </span>
              <button
                onClick={copiarLink}
                className="text-blue-600 dark:text-zinc-400 hover:text-blue-800 dark:hover:text-white cursor-pointer"
                title="Copiar link"
              >
                {copiado ? (
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          )}
        </div>
      </SurfaceCard>

      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-zinc-400 px-1">
        <span>
          Última alteração:{" "}
          {status.author ? `${status.author} às ${formatarHora(status.updated_at)}` : "—"}
        </span>
        <span>
          {status.rodando ? `${status.clients} outro(s) PC(s) conectado(s)` : ""}
        </span>
      </div>

      <textarea
        value={texto}
        disabled={!status.rodando}
        onChange={(e) => onDigitar(e.target.value)}
        placeholder={
          status.rodando
            ? "Digite aqui... Todos os PCs conectados veem em tempo real."
            : "Ligue o servidor para editar..."
        }
        className="flex-1 w-full resize-none rounded-2xl bg-white dark:bg-[#0b0b12] border border-slate-200 dark:border-white/[0.08] p-5 font-mono text-base text-slate-900 dark:text-zinc-100 leading-relaxed focus:outline-none focus:border-blue-500 disabled:opacity-40 select-text shadow-sm dark:shadow-inner"
      />

      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500 dark:text-zinc-500 tabular-nums">
          {texto.length} caracteres
        </span>
        <button
          onClick={limparParaTodos}
          disabled={!status.rodando}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white text-xs font-semibold cursor-pointer transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Limpar para todos
        </button>
      </div>
    </div>
  );
}
