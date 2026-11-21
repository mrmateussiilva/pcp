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
    if (texto.length > 0 && !window.confirm("Limpar o bloco para todos os PCs conectados?")) return;
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
    <div className="p-5 h-full flex flex-col gap-3 max-w-7xl mx-auto">
      <PageHeader
        icon={<FileText className="w-4 h-4 text-slate-700 dark:text-zinc-300" />}
        title="Notepad Colaborativo // Axum Sockets"
        badge="SRV-02"
        subtitle="Servidor Axum WebSocket + HTTP servindo editor em tempo real na rede local com persistência atômica."
        right={
          <StatusBadge
            active={status.rodando}
            activeText={`ONLINE :${status.http_port || 8766}`}
            idleText="OFFLINE"
          />
        }
      />

      {erro && (
        <div className="px-3.5 py-2 rounded text-xs font-mono bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-900/60 text-red-700 dark:text-red-400">
          ERRO // {erro}
        </div>
      )}

      {/* Toolbar do Servidor */}
      <SurfaceCard className="p-3 space-y-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] font-semibold text-slate-500 dark:text-zinc-400 w-28 shrink-0">
            STATE FILE:
          </span>
          <input
            type="text"
            value={arquivo}
            disabled={status.rodando}
            onChange={(e) => setArquivo(e.target.value)}
            className="flex-1 rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:text-white disabled:opacity-50"
          />
          <button
            onClick={selecionarArquivo}
            disabled={status.rodando}
            className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 disabled:opacity-40 text-slate-700 dark:text-zinc-300 cursor-pointer"
          >
            <FolderOpen className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-slate-100 dark:border-zinc-800 font-mono text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold text-slate-500 dark:text-zinc-400">HTTP:</span>
              <input
                type="text"
                value={httpPort}
                disabled={status.rodando}
                onChange={(e) => setHttpPort(e.target.value)}
                className="w-16 rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 px-2 py-1 text-xs text-slate-900 dark:text-white disabled:opacity-50"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold text-slate-500 dark:text-zinc-400">WS:</span>
              <input
                type="text"
                value={wsPort}
                disabled={status.rodando}
                onChange={(e) => setWsPort(e.target.value)}
                className="w-16 rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 px-2 py-1 text-xs text-slate-900 dark:text-white disabled:opacity-50"
              />
            </div>

            <button
              onClick={alternarServidor}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded text-xs font-semibold text-white cursor-pointer transition-all ${
                status.rodando
                  ? "bg-red-600 hover:bg-red-500 shadow-2xs"
                  : "bg-emerald-600 hover:bg-emerald-500 shadow-2xs"
              }`}
            >
              {status.rodando ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              <span>{status.rodando ? "DESLIGAR" : "INICIAR SERVIÇO"}</span>
            </button>

            <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={autoIniciar}
                onChange={(e) => {
                  setAutoIniciar(e.target.checked);
                  salvarConfig(e.target.checked);
                }}
                className="rounded accent-blue-600"
              />
              <span>Auto-start</span>
            </label>
          </div>

          {status.rodando && status.link && (
            <div className="flex items-center gap-2 bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded px-2.5 py-1">
              <span className="text-blue-700 dark:text-blue-400 select-text">
                {status.link}
              </span>
              <button
                onClick={copiarLink}
                className="text-slate-500 hover:text-slate-800 dark:hover:text-white cursor-pointer"
                title="Copiar URL"
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

      {/* Barra de metadados do documento */}
      <div className="flex items-center justify-between font-mono text-[11px] text-slate-500 dark:text-zinc-400 px-1">
        <span>
          ÚLTIMA MODIFICAÇÃO:{" "}
          <span className="text-slate-800 dark:text-zinc-200 font-semibold">
            {status.author ? `${status.author} às ${formatarHora(status.updated_at)}` : "—"}
          </span>
        </span>
        <span className="font-semibold text-emerald-600 dark:text-emerald-400">
          {status.rodando ? `${status.clients} NÓS CONECTADOS` : "STANDBY"}
        </span>
      </div>

      {/* Editor Monospace Industrial */}
      <textarea
        value={texto}
        disabled={!status.rodando}
        onChange={(e) => onDigitar(e.target.value)}
        placeholder={
          status.rodando
            ? "Digite aqui... Todos os terminais conectados na rede sincronizam em tempo real."
            : "Ligue o serviço acima para iniciar o editor compartilhado..."
        }
        className="flex-1 w-full resize-none rounded border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] p-4 font-mono text-sm text-slate-900 dark:text-zinc-100 leading-relaxed focus:outline-none focus:border-blue-500 disabled:opacity-40 select-text shadow-2xs"
      />

      <div className="flex items-center justify-between font-mono text-xs">
        <span className="text-slate-500 dark:text-zinc-500 tabular-nums">
          TAMANHO BUFFER: {texto.length} BYTES
        </span>
        <button
          onClick={limparParaTodos}
          disabled={!status.rodando}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-red-300 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 disabled:opacity-40 cursor-pointer font-semibold transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>LIMPAR BUFFER GERAL</span>
        </button>
      </div>
    </div>
  );
}
