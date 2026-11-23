# AGENTS.md — Guia para Agentes de Código (`pcp-tauri`)

Este arquivo orienta agentes de IA que trabalham no repositório **`pcp-tauri/`** (sistema **PCP Central** em Rust + Tauri v2).

---

## 1. Stack e Tecnologias

- **Desktop Shell / IPC:** Tauri v2 (`tauri = "2"`, `tauri-plugin-dialog`, `tauri-plugin-notification`, `tauri-plugin-opener`, `tauri-plugin-fs`)
- **Backend (Rust):**
  - Async & HTTP/WebSocket: `tokio`, `axum` (com feature `ws`), `futures-util`
  - Serialização & Config: `serde`, `serde_json`, `chrono`, `csv`, `regex`, `dirs`
  - Imagem & Paralelismo: `tiff`, `image`, `fast_image_resize` (SIMD), `imageproc`, `ab_glyph`, `rayon`
  - Monitoramento de Arquivos: `notify`
  - APIs Nativas Windows (condicional): `windows` sob `[target.'cfg(windows)'.dependencies]`
- **Frontend:**
  - **React 19 + TypeScript + Vite**
  - **Tailwind CSS v4** (`@tailwindcss/vite` + `@custom-variant dark (&:where(.dark, .dark *));`)
  - **Lucide React** (`lucide-react`) para ícones vetoriais

---

## 2. Arquitetura e Convenções

```text
pcp-tauri/
├── src/
│   ├── components/
│   │   ├── ui.tsx              # Primitivas industriais (PageHeader, SurfaceCard, StatusBadge, StatCard, TerminalLog)
│   │   ├── CommandPalette.tsx  # Paleta de comandos industrial (Ctrl+K / Ctrl+P)
│   │   └── ShortcutsModal.tsx  # Mapa de atalhos globais e da tela ativa (F1 / Ctrl+/ / ?)
│   ├── hooks/useShortcuts.tsx  # Contexto e hook usePageShortcuts para operação 100% teclado
│   ├── modules/registry.ts     # Metadados, códigos técnicos (RIP-01, CUT-03...), bancadas e atalhos
│   ├── pages/*.tsx             # Telas técnicas (uma por módulo + HomePage Command Center)
│   └── App.tsx                 # Sidebar recolhível (224px/54px, Ctrl+B), status bar, tema (Alt+T) e atalhos globais
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
4. **Processamento de imagem e performance Rust (obrigatório):**
   - Use sempre as primitivas otimizadas de `core/imaging.rs`: `load_image_with_meta`, `save_image_with_meta`, `blit_rgb_fast`, `resize_rgb_simd`, `resize_rgba_simd`, `rotate90_rgb_fast`, `rotate270_rgb_fast` e `add_1px_black_border_inside_inplace`.
   - **Evite clones de imagens grandes (300 DPI):** prefira operações *in-place* (`add_1px_black_border_inside_inplace`, `image::imageops::rotate180_in_place`) e alocação única do buffer de saída.
   - **Rotação paralela:** nunca use `DynamicImage::rotate90()` ou `rotate270()` em imagens de produção; use `rotate90_rgb_fast` / `rotate270_rgb_fast` (tiling 64×64 com Rayon).
   - **I/O em rede (`Z:\`):** mantenha escrita em buffer grande (`BufWriter::with_capacity(8 * 1024 * 1024)`) nos encoders TIFF.
   - **Nunca descarte DPI ou perfil ICC (`Tag::Unknown(34675)`)** ao salvar TIFFs de produção.
   - **Regex & Watchers:** cacheie toda `Regex` em `OnceLock<Regex>` (nunca compile dentro de loops). Em watchers de pasta com `notify`, use `rx.recv_timeout(...)` no canal MPSC em vez de `thread::sleep` fixo para reação imediata (<10 ms).
   - **Dev Profile:** mantenha `[profile.dev.package."*"] opt-level = 3` em `src-tauri/Cargo.toml` para que crates de imagem/compressão rodem em velocidade de release durante o desenvolvimento.
5. **Compatibilidade Multiplataforma (Linux + Windows):**
   - O app é desenvolvido em Linux e distribuído para Windows.
   - Crates específicos de SO (ex.: `windows`) **devem** ficar em `[target.'cfg(windows)'.dependencies]` no `Cargo.toml` e protegidos por `#[cfg(windows)]` no código Rust, oferecendo fallback funcional em Linux (ex.: `pdftoppm` em `core/shopee.rs`).
6. **Identidade Visual & Padrões de UI (Workstation Industrial / RIP):**
   - **Proibido estética genérica de SaaS/IA ("estilo Lovable"):** não use cards `rounded-2xl` pastel, arco-íris de cores, degradês decorativos ou emojis em KPIs/títulos de cards.
   - **Alta densidade técnica:** use `font-mono` e `tabular-nums` para medidas, dimensões, DPI, contadores, portas e timestamps.
   - **Identificadores padronizados:** todo módulo deve possuir código técnico (`PRE-00`, `RIP-01`, `BAGS-02`, `CUT-03`, `LOG-04`, `CALC-05`, `CAL-06`, `NOTE-01`, `WPP-02`) e badge de modo (`WATCHER`, `BATCH`, `CALC`, `SERVICE`) registrados em `src/modules/registry.ts`.
   - **Modo Claro é o padrão** (`slate-50` / `white`), com suporte a **Modo Escuro** técnico via classes `dark:...` controladas por `.dark` no `<html>`.
   - Reaproveite sempre as primitivas de `src/components/ui.tsx` (`PageHeader`, `SurfaceCard`, `StatusBadge`, `StatCard`, `TerminalLog`).
   - **Operação Keyboard-First obrigatória:** toda tela nova ou editada deve registrar suas ações principais via `usePageShortcuts` (`src/hooks/useShortcuts.tsx`) seguindo o padrão `Ctrl+Enter` (ação principal), `Ctrl+O` (selecionar pasta/arquivo), `Ctrl+R` (atualizar/executar), `Ctrl+L` (limpar logs), `Ctrl+F` (focar busca) e `Alt+1/2` (sub-abas). Mantenha todos os controles interativos navegáveis por `Tab` com `:focus-visible` nítido.
7. **Portas configuráveis:** Serviços de rede (Notepad HTTP/WS e WhatsApp Webhook) devem sempre ler/salvar suas portas em `config.json`.
8. **Referência legada:** A pasta irmã `../hub/` (Python) é apenas referência histórica — **não a altere** salvo pedido explícito.

---

## 3. Comandos de Verificação

### Linux
```bash
# Build e type-check do frontend
npm run build

# Verificação do backend Rust (0 erros, 0 warnings)
cd src-tauri && cargo check

# Rodar aplicação em modo desenvolvimento
npm run tauri dev
```

### Windows (PowerShell)
> **Atenção no Windows:** se a ExecutionPolicy do PowerShell bloquear `npm.ps1`, use **`npm.cmd`**.

```powershell
# Build e type-check do frontend
npm.cmd run build

# Verificação do backend Rust (0 erros, 0 warnings)
cd src-tauri
cargo check

# Rodar aplicação em modo desenvolvimento
npm.cmd run tauri dev
```

Sempre rode `npm run build` / `npm.cmd run build` (após mudanças em `src/`) e `cargo check` (após mudanças em `src-tauri/`) antes de concluir uma tarefa.

---

## 4. Deploy, Releases e Atualizações (GitHub Actions)

- **Workflow Único (Release Windows):** O repositório possui exclusivamente o workflow `.github/workflows/release.yml`. **Não crie workflows de CI adicionais para push em branch** — commits enviados para a `main` não disparam builds no GitHub Actions, evitando execuções duplicadas e consumo desnecessário de minutos.
- **Gatilho Estrito por Git Tag:** A compilação e publicação de instaladores Windows ocorre **apenas quando uma nova tag `v*` é enviada** (`push: tags: ['v*']`) ou via disparo manual no painel do GitHub (`workflow_dispatch`).
- **Tag como Fonte da Verdade:** A versão é extraída diretamente da Git tag (`vX.Y.Z`). Durante o build no CI, o script `scripts/sync-version.mjs` atualiza `package.json`, `tauri.conf.json`, `Cargo.toml` e `Cargo.lock` automaticamente antes da compilação.
- **In-App Updater (`UPD-00`):**
  - Integração via `tauri-plugin-updater` e `tauri-plugin-process`.
  - Assinatura criptográfica com Minisign: a chave pública reside em `tauri.conf.json` e a chave privada nas secrets do repositório (`TAURI_SIGNING_PRIVATE_KEY` e `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`).
  - O workflow gera o instalador NSIS (`*-setup.exe`), MSI (`*.msi`) e o manifesto assinado `latest.json` na release do GitHub.
  - No frontend, o hook `useUpdater` gerencia checagens automáticas (8s pós-abertura e a cada 30 min) e o modal `UpdateModal.tsx` (`Alt+U`) impede reinício acidental enquanto houver trabalhos de corte ou imagem ativos (*Busy Guard*).
- **Instância Única:** O plugin `tauri-plugin-single-instance` no `lib.rs` assegura que uma segunda janela nunca seja aberta, trazendo a existente para foco e prevenindo conflitos nas portas de rede (`8765`, `8766`, `5050`) e múltiplos observadores de pasta.
- **Ícones do Sistema:** O ícone-base do projeto é o vetor industrial `src-tauri/icons/app-icon.svg`. Para regenerar todos os tamanhos (`.ico`, `.icns`, PNGs), use `npm run icons`.

---

## 5. Padrão de Commits

Use **Conventional Commits** em inglês ou português claro, separando commits por responsabilidade lógica:
- `feat(escopo): ...` — nova funcionalidade ou módulo
- `fix(escopo): ...` — correção de bug ou compatibilidade
- `perf(escopo): ...` — melhoria de performance
- `style(escopo): ...` — ajustes visuais / Tailwind
- `refactor(escopo): ...` — refatoração sem mudança de comportamento
- `docs: ...` — documentação (`README.md`, `AGENTS.md`)
- `chore: ...` — dependências e configuração
