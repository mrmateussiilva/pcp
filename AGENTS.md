# AGENTS.md — Guia para Agentes de Código (`pcp-tauri`)

Este arquivo orienta agentes de IA que trabalham no repositório **`pcp-tauri/`** (migração do **PCP Central** para Rust + Tauri v2).

---

## 1. Stack e Tecnologias

- **Desktop Shell / IPC:** Tauri v2 (`tauri = "2"`, `tauri-plugin-dialog`, `tauri-plugin-notification`, `tauri-plugin-opener`)
- **Backend (Rust):**
  - Async & HTTP/WebSocket: `tokio`, `axum` (com feature `ws`), `futures-util`
  - Serialização & Config: `serde`, `serde_json`, `chrono`, `csv`, `regex`, `dirs`
  - Imagem & Paralelismo: `tiff`, `image`, `fast_image_resize` (SIMD), `imageproc`, `ab_glyph`, `rayon`
  - Monitoramento de Arquivos: `notify`
- **Frontend:**
  - **React 19 + TypeScript + Vite**
  - **Tailwind CSS v4** (`@tailwindcss/vite` + `@custom-variant dark (&:where(.dark, .dark *));`)
  - **Lucide React** (`lucide-react`) para ícones vetoriais

---

## 2. Arquitetura e Convenções

```text
pcp-tauri/
├── src/
│   ├── components/ui.tsx       # Primitivas compartilhadas (PageHeader, SurfaceCard, StatusBadge, StatCard, TerminalLog)
│   ├── modules/registry.ts     # Metadados, grupos e atalhos dos módulos
│   ├── pages/*.tsx             # Telas (uma por módulo + HomePage)
│   └── App.tsx                 # Sidebar, tema Claro/Escuro, atalhos Ctrl+0..7 e listeners globais
└── src-tauri/
    ├── assets/notepad.html     # HTML servido na rede pelo Notepad (__WS_PORT__ injetado em runtime)
    └── src/
        ├── lib.rs              # Registro de plugins, estado global (State), auto-start e commands
        ├── commands/*.rs       # Camada fina IPC (#[tauri::command]) — valida entrada e delega para core/
        └── core/*.rs           # Lógica de negócio pura, sem acoplamento com UI
```

### Regras do Projeto
1. **Separação `core/` × `commands/`:** Toda regra de negócio, I/O de arquivos e processamento pesado deve ficar em `src-tauri/src/core/`. Os arquivos em `commands/` apenas expõem comandos Tauri e chamam `core/`.
2. **Não bloquear a thread principal:** Operações pesadas (análise de pasta, corte de painéis, I/O em rede `Z:\`) devem rodar em `tokio::task::spawn_blocking` ou `std::thread::spawn` + eventos (`app.emit`).
3. **Persistência atômica:** Arquivos JSON (`config.json`, `notes_state.json`) devem sempre ser gravados em `.json.tmp` seguido de `fs::rename` para evitar corrupção.
4. **Processamento de imagem:**
   - Use `core/imaging.rs` (`load_image_with_meta`, `save_image_with_meta`, `blit_rgb_fast`, `resize_rgb_simd`, `resize_rgba_simd`).
   - **Nunca descarte DPI ou perfil ICC (`Tag::Unknown(34675)`)** ao salvar TIFFs de produção.
5. **Tema e UI:**
   - **Modo Claro é o padrão** (`slate-50` / `white`), com suporte a **Modo Escuro** via classes `dark:...` controladas por `.dark` no `<html>`.
   - Reaproveite as primitivas de `src/components/ui.tsx` em novas telas.
6. **Portas configuráveis:** Serviços de rede (Notepad HTTP/WS e WhatsApp Webhook) devem sempre ler/salvar suas portas em `config.json`.
7. **Referência legada:** A pasta irmã `../hub/` (Python) é apenas referência histórica — **não a altere** salvo pedido explícito.

---

## 3. Comandos de Verificação (Windows / PowerShell)

> **Atenção no Windows:** se a ExecutionPolicy do PowerShell bloquear `npm.ps1`, use **`npm.cmd`**.

```powershell
# Build e type-check do frontend
cd pcp-tauri
npm.cmd run build

# Verificação do backend Rust (sem warnings)
cd pcp-tauri\src-tauri
cargo check

# Rodar aplicação em modo desenvolvimento
cd pcp-tauri
npm.cmd run tauri dev
```

Sempre rode `npm.cmd run build` (após mudanças em `src/`) e `cargo check` (após mudanças em `src-tauri/`) antes de concluir uma tarefa.

---

## 4. Padrão de Commits

Use **Conventional Commits** em inglês ou português claro:
- `feat(escopo): ...` — nova funcionalidade ou módulo
- `fix(escopo): ...` — correção de bug
- `perf(escopo): ...` — melhoria de performance
- `style(escopo): ...` — ajustes visuais / Tailwind
- `refactor(escopo): ...` — refatoração sem mudança de comportamento
- `docs: ...` — documentação (`README.md`, `AGENTS.md`)
- `chore: ...` — dependências e configuração
