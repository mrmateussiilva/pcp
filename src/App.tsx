import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  BarChart3,
  FileText,
  FolderTree,
  Home,
  Info,
  Layers,
  MessageSquare,
  Moon,
  PackageCheck,
  Printer,
  Scissors,
  ShoppingBag,
  Sun,
} from "lucide-react";
import "./App.css";
import { MODULOS, ModuloId } from "./modules/registry";
import { HomePage } from "./pages/HomePage";
import { PastasDiaPage } from "./pages/PastasDiaPage";
import { TiffProcessorPage } from "./pages/TiffProcessorPage";
import { BolsinhasPage } from "./pages/BolsinhasPage";
import { CortadorPage } from "./pages/CortadorPage";
import { ConsumoPage } from "./pages/ConsumoPage";
import { ShopeePage } from "./pages/ShopeePage";
import { NotepadPage } from "./pages/NotepadPage";
import { WhatsappPage } from "./pages/WhatsappPage";
import { AboutPage } from "./pages/AboutPage";

const GRUPOS = ["DIA A DIA", "PRODUÇÃO", "COMUNICAÇÃO"] as const;

export function ModuleIcon({ id, className = "w-4 h-4" }: { id: ModuloId; className?: string }) {
  switch (id) {
    case "inicio":
      return <Home className={className} />;
    case "pastas":
      return <FolderTree className={className} />;
    case "tiff":
      return <Printer className={className} />;
    case "bolsinhas":
      return <ShoppingBag className={className} />;
    case "cortador":
      return <Scissors className={className} />;
    case "consumo":
      return <BarChart3 className={className} />;
    case "shopee":
      return <PackageCheck className={className} />;
    case "notepad":
      return <FileText className={className} />;
    case "whatsapp":
      return <MessageSquare className={className} />;
  }
}

export default function App() {
  const [atual, setAtual] = useState<ModuloId | "about">("inicio");
  const [dark, setDark] = useState<boolean>(() => {
    return localStorage.getItem("pcp-theme") === "dark";
  });
  const [statusMap, setStatusMap] = useState<
    Partial<Record<ModuloId, { text: string; cor: "green" | "amber" }>>
  >({});

  useEffect(() => {
    const root = document.documentElement;
    if (dark) {
      root.classList.add("dark");
      localStorage.setItem("pcp-theme", "dark");
    } else {
      root.classList.remove("dark");
      localStorage.setItem("pcp-theme", "light");
    }
  }, [dark]);

  useEffect(() => {
    invoke<{ rodando: boolean }>("notepad_status").then((st) => {
      setStatusMap((prev) => ({
        ...prev,
        notepad: st.rodando ? { text: "servidor ligado", cor: "green" } : undefined,
      }));
    });
    invoke<{ rodando: boolean; porta: number }>("whatsapp_status").then((st) => {
      setStatusMap((prev) => ({
        ...prev,
        whatsapp: st.rodando
          ? { text: `ouvindo :${st.porta}`, cor: "green" }
          : undefined,
      }));
    });
    invoke<{ monitorando: boolean }>("tiff_status").then((st) => {
      setStatusMap((prev) => ({
        ...prev,
        tiff: st.monitorando ? { text: "monitorando", cor: "green" } : undefined,
      }));
    });
    invoke<{ monitorando: boolean; varrendo: boolean }>("bolsinhas_status").then((st) => {
      setStatusMap((prev) => ({
        ...prev,
        bolsinhas: st.varrendo
          ? { text: "varrendo…", cor: "amber" }
          : st.monitorando
          ? { text: "monitorando", cor: "green" }
          : undefined,
      }));
    });

    const unNote = listen<{ rodando: boolean }>("notepad-estado", (e) => {
      setStatusMap((prev) => ({
        ...prev,
        notepad: e.payload.rodando
          ? { text: "servidor ligado", cor: "green" }
          : undefined,
      }));
    });
    const unZap = listen<{ rodando: boolean; porta: number }>("whatsapp-status", (e) => {
      setStatusMap((prev) => ({
        ...prev,
        whatsapp: e.payload.rodando
          ? { text: `ouvindo :${e.payload.porta}`, cor: "green" }
          : undefined,
      }));
    });
    const unTiff = listen<{ monitorando: boolean }>("tiff-status", (e) => {
      setStatusMap((prev) => ({
        ...prev,
        tiff: e.payload.monitorando
          ? { text: "monitorando", cor: "green" }
          : undefined,
      }));
    });
    const unBol = listen<{ monitorando: boolean; varrendo: boolean }>(
      "bolsinhas-status",
      (e) => {
        setStatusMap((prev) => ({
          ...prev,
          bolsinhas: e.payload.varrendo
            ? { text: "varrendo…", cor: "amber" }
            : e.payload.monitorando
            ? { text: "monitorando", cor: "green" }
            : undefined,
        }));
      }
    );
    const unCort = listen<boolean>("cortador-status", (e) => {
      setStatusMap((prev) => ({
        ...prev,
        cortador: e.payload ? { text: "cortando…", cor: "amber" } : undefined,
      }));
    });
    const unShopee = listen<{ monitorando: boolean; executando: boolean }>(
      "shopee-status",
      (e) => {
        setStatusMap((prev) => ({
          ...prev,
          shopee: e.payload.executando
            ? { text: "gerando…", cor: "amber" }
            : e.payload.monitorando
            ? { text: "observando", cor: "green" }
            : undefined,
        }));
      }
    );

    return () => {
      unNote.then((fn) => fn());
      unZap.then((fn) => fn());
      unTiff.then((fn) => fn());
      unBol.then((fn) => fn());
      unCort.then((fn) => fn());
      unShopee.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.key === "0") {
        e.preventDefault();
        setAtual("inicio");
        return;
      }
      const n = Number(e.key);
      if (n >= 1 && n <= 9 && MODULOS[n - 1]) {
        e.preventDefault();
        setAtual(MODULOS[n - 1].id);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-50 dark:bg-[#0d0d14] text-slate-900 dark:text-zinc-100">
      {/* Sidebar */}
      <aside className="w-[248px] shrink-0 bg-white dark:bg-[#11111b] border-r border-slate-200 dark:border-white/[0.06] flex flex-col">
        <div className="px-4 pt-5 pb-4 flex items-center gap-3 border-b border-slate-100 dark:border-white/[0.05]">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center shadow-md shadow-blue-600/20">
            <Layers className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="text-sm font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
              PCP Central
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-50 dark:bg-white/10 text-blue-700 dark:text-zinc-300 border border-blue-200/70 dark:border-transparent">
                RUST
              </span>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-zinc-500">
              Sublimação & Produção
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-2.5 py-3 space-y-1">
          <button
            onClick={() => setAtual("inicio")}
            className={`group w-full flex items-center justify-between px-3 py-2 rounded-xl text-[13px] text-left transition-all cursor-pointer ${
              atual === "inicio"
                ? "bg-blue-50 dark:bg-blue-600/15 text-blue-700 dark:text-white font-semibold border border-blue-200 dark:border-blue-500/25 shadow-xs"
                : "text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100 hover:bg-slate-100 dark:hover:bg-white/[0.04] border border-transparent"
            }`}
          >
            <span className="flex items-center gap-2.5">
              <ModuleIcon
                id="inicio"
                className={`w-4 h-4 ${
                  atual === "inicio"
                    ? "text-blue-600 dark:text-blue-400"
                    : "text-slate-400 dark:text-zinc-500 group-hover:text-slate-700 dark:group-hover:text-zinc-300"
                }`}
              />
              <span>Início</span>
            </span>
            <kbd className="text-[10px] text-slate-400 dark:text-zinc-600 font-mono">^0</kbd>
          </button>

          {GRUPOS.map((grupo) => {
            const itens = MODULOS.filter((m) => m.grupo === grupo);
            return (
              <div key={grupo} className="pt-3.5">
                <div className="px-3 pb-1.5 text-[10px] font-bold tracking-widest text-slate-400 dark:text-zinc-500/80 uppercase">
                  {grupo}
                </div>
                <div className="space-y-0.5">
                  {itens.map((m) => {
                    const st = statusMap[m.id];
                    const idx = MODULOS.findIndex((x) => x.id === m.id) + 1;
                    const active = atual === m.id;
                    return (
                      <div key={m.id}>
                        <button
                          onClick={() => setAtual(m.id)}
                          className={`group w-full flex items-center justify-between px-3 py-2 rounded-xl text-[13px] text-left transition-all cursor-pointer ${
                            active
                              ? "bg-blue-50 dark:bg-blue-600/15 text-blue-700 dark:text-white font-semibold border border-blue-200 dark:border-blue-500/25 shadow-xs"
                              : "text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100 hover:bg-slate-100 dark:hover:bg-white/[0.04] border border-transparent"
                          }`}
                        >
                          <span className="flex items-center gap-2.5 truncate">
                            <ModuleIcon
                              id={m.id}
                              className={`w-4 h-4 shrink-0 ${
                                active
                                  ? "text-blue-600 dark:text-blue-400"
                                  : "text-slate-400 dark:text-zinc-500 group-hover:text-slate-700 dark:group-hover:text-zinc-300"
                              }`}
                            />
                            <span className="truncate">{m.nome}</span>
                          </span>
                          <kbd className="text-[10px] text-slate-400 dark:text-zinc-600 font-mono ml-1">
                            ^{idx}
                          </kbd>
                        </button>
                        {st && (
                          <div className="pl-9 pr-2 pb-1 pt-0.5 flex items-center gap-1.5 text-[11px]">
                            <span
                              className={`w-1.5 h-1.5 rounded-full animate-pulse ${
                                st.cor === "amber" ? "bg-amber-500" : "bg-emerald-500"
                              }`}
                            />
                            <span
                              className={`truncate font-medium ${
                                st.cor === "amber"
                                  ? "text-amber-600 dark:text-amber-300"
                                  : "text-emerald-600 dark:text-emerald-300"
                              }`}
                            >
                              {st.text}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="px-3 py-2.5 border-t border-slate-100 dark:border-white/[0.05] flex items-center justify-between gap-1">
          <button
            onClick={() => setDark((d) => !d)}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-white/[0.06] cursor-pointer transition-colors"
            title="Alternar tema claro/escuro"
          >
            {dark ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5 text-slate-500" />}
            <span>{dark ? "Claro" : "Escuro"}</span>
          </button>

          <button
            onClick={() => setAtual("about")}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
              atual === "about"
                ? "bg-blue-50 dark:bg-blue-600/15 text-blue-700 dark:text-white"
                : "text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-white/[0.06]"
            }`}
            title="Sobre o PCP Central"
          >
            <Info className="w-3.5 h-3.5" />
            <span>About</span>
          </button>
        </div>
      </aside>

      {/* Área principal */}
      <main className="flex-1 overflow-y-auto bg-[radial-gradient(ellipse_at_top_right,_rgba(59,130,246,0.06),_transparent_50%)]">
        {atual === "inicio" && <HomePage onAbrir={setAtual} />}
        {atual === "pastas" && <PastasDiaPage />}
        {atual === "tiff" && <TiffProcessorPage />}
        {atual === "bolsinhas" && <BolsinhasPage />}
        {atual === "cortador" && <CortadorPage />}
        {atual === "consumo" && <ConsumoPage />}
        {atual === "shopee" && <ShopeePage />}
        {atual === "notepad" && <NotepadPage />}
        {atual === "whatsapp" && <WhatsappPage />}
        {atual === "about" && <AboutPage />}
      </main>
    </div>
  );
}
