# PCP Central (`pcp-tauri`)

Aplicação desktop multiplataforma (**Windows** em produção e **Linux** em desenvolvimento) construída em **Rust + Tauri v2** com interface **React 19 + TypeScript + Tailwind CSS v4**. Projetada com estética **Workstation Gráfica / RIP Industrial** para unificar as ferramentas de pré-impressão, produção e comunicação de sublimação em uma única janela nativa de alta velocidade.

---

## Arquitetura

```text
pcp-tauri/
├── src/                        # Frontend (React 19 + TypeScript + Tailwind CSS v4)
│   ├── components/ui.tsx       # Primitivas industriais (PageHeader, SurfaceCard, StatusBadge, StatCard, TerminalLog)
│   ├── modules/registry.ts     # Registro de módulos, códigos técnicos (RIP-01, CUT-03...), bancadas e atalhos
│   ├── pages/                  # Telas técnicas por módulo + Command Center (HomePage)
│   └── App.tsx                 # Sidebar densa, status bar de telemetria, atalhos (Ctrl+0..7) e tema Claro/Escuro
│
└── src-tauri/                  # Backend Nativo (Rust + Tauri v2)
    ├── assets/notepad.html     # Interface web servida na rede local pelo Notepad
    └── src/
        ├── lib.rs              # Setup de estado, auto-inicialização e registro de comandos
        ├── commands/           # Ponte IPC fina (#[tauri::command]) por módulo
        └── core/               # Lógica de negócio pura e pipelines de alta performance
            ├── config.rs       # config.json atômico (.tmp -> rename) + pasta_do_dia()
            ├── global_log.rs   # Log global TSV (processados_global.tsv) com fingerprint (size + mtime)
            ├── imaging.rs      # TIFF single-open, DPI/ICC, resize SIMD, rotação paralela tiled 64×64 e BufWriter 8MB
            ├── pastas.rs       # Criação da estrutura de pastas do dia e totens
            ├── consumo.rs      # Leitura paralela de cabeçalhos TIFF, cálculo linear e watcher reativo
            ├── tiff_proc.rs    # Monitoramento reativo (notify) e tratamento zero-copy de TIFFs
            ├── bolsinhas.rs    # Geração paralela de JPEGs 10% e varredura O(N) de duplicadas com Rayon
            ├── cortador.rs     # Cortador de painéis (Automático e Medidas) zero-copy + rotação paralela
            ├── shopee.rs       # Fichas Shopee (WinRT PDF no Windows / pdftoppm no Linux) + regex em cache
            ├── notepad_srv.rs  # Servidor Axum (HTTP + WebSocket) com portas configuráveis
            └── zap_srv.rs      # Webhook Axum para Evolution Go (/webhook) com porta configurável
```

---

## Módulos e Bancadas Operacionais

A tela inicial (Command Center) organiza os módulos em bancadas técnicas com códigos operacionais padronizados:

| Bancada | Código | Módulo | Descrição |
|---|---|---|---|
| **Dia a Dia** | `PRE-00` | **Pastas do Dia** | Cria a estrutura `DD MM AAAA` (`BOLSINHAS/PARA FAZER`, `PAINEL_CUT`, `CONF`, `APS`, `TEX`, totens) no drive configurado. |
| **Dia a Dia** | `NOTE-01` | **Notepad** | Servidor `axum` embutido (HTTP + WebSocket com portas configuráveis, padrão `8766`/`8765`), persistência atômica e editor colaborativo em tempo real. |
| **Dia a Dia** | `WPP-02` | **WhatsApp** | Servidor `axum` (`/webhook`) com porta configurável (padrão `5050`), validação de `instanceToken`, filtro por grupo e busca ao vivo. |
| **Produção** | `RIP-01` | **TIFF Processor** | Monitora pasta de entrada com reação <10ms, rotaciona 90° em paralelo, aplica borda 1 px in-place, padding inferior 1 cm, nome do cliente, preserva DPI/ICC e registra no `processados_global.tsv`. |
| **Produção** | `BAGS-02` | **Bolsinhas** | Monitora `PARA FAZER` gerando JPEGs reduzidos (10%) em paralelo, compara miniaturas (`_miniaturas`) e executa varredura O(N) de artes duplicadas. |
| **Produção** | `CUT-03` | **Cortador de Painéis** | Modos **Automático** (fatiamento uniforme em paralelo, paleta de 20 cores, extração de cidade + overrides) e **Medidas personalizadas**, com gabarito e numeração. |
| **Produção** | `CALC-05` | **Consumo / Avarias** | Lê apenas cabeçalhos TIFF em paralelo (`rayon`), calcula consumo linear (160 cm mídia / 150 cm útil / 155 cm emenda) e exibe telemetria por categoria e tecido. |
| **Produção** | `CAL-06` | **Calandragem** | Controle operacional de calandragem e acompanhamento de produção. |
| **Expedição** | `LOG-04` | **Fichas Shopee** | Montagem automática de fichas de pedido combinando PDF (WinRT no Windows / `pdftoppm` no Linux) e fotos dos produtos. |

---

## Destaques Técnicos & Performance Rust

- **Design Industrial RIP / Workstation:**
  - Alta densidade de informação com tipografia monoespaçada (`font-mono`, `tabular-nums`) para medidas, DPI, pixels e contadores.
  - Barra inferior de telemetria em tempo real (drive base, portas HTTP/WS ativas, atalhos globais `Ctrl+0..7`).
  - **Modo Claro** de alto contraste como padrão, com alternância instantânea para **Modo Escuro** técnico.
- **Engine de Imagem Ultra-Rápida (`core/imaging.rs`):**
  - **Zero-Copy & In-Place:** eliminação de clones intermediários de imagens de 300 DPI (~300–800 MB cada) usando `add_1px_black_border_inside_inplace` e `imageops::rotate180_in_place` (-65% de RAM).
  - **Rotação Paralela Cache-Friendly:** `rotate90_rgb_fast` e `rotate270_rgb_fast` processam em blocos (tiling 64×64) via **Rayon** (10–20× mais rápido que rotação serial).
  - **CMYK → RGB Paralelo:** conversão vetorizada com `par_chunks_exact_mut` usando todos os núcleos da CPU.
  - **SIMD & Blit Rápido:** redimensionamento via `fast_image_resize` e cópia paralela por scanlines (`blit_rgb_fast`).
  - **I/O de Rede Otimizado (`Z:\`):** escrita de TIFFs via `BufWriter::with_capacity(8 MB)` evitando micro-pacotes SMB lentos, sempre preservando DPI e perfil ICC (`Tag::Unknown(34675)`).
- **Algoritmos & Watchers Reativos:**
  - Varredura de duplicadas em **Bolsinhas** otimizada de $O(N^2)$ para $O(N)$ com pré-cálculo paralelo de miniaturas de 64 px.
  - Expressões regulares cacheadas uma única vez via `OnceLock<Regex>` (`cortador.rs`, `shopee.rs`).
  - Watchers de disco (`tiff_proc.rs`, `consumo.rs`) baseados em `rx.recv_timeout(2s)` sobre eventos do `notify`, reagindo em **<10 ms** à chegada de novos arquivos.
  - Perfil `[profile.dev.package."*"] opt-level = 3` garantindo máxima velocidade das dependências mesmo em modo desenvolvimento.
- **Multiplataforma (Windows + Linux):**
  - Dependência `windows` isolada sob `[target.'cfg(windows)'.dependencies]`, com fallback automático via `pdftoppm` (`poppler-utils`) no Linux para renderização de PDFs na Shopee.
- **Persistência Atômica:**
  - `config.json` e `notes_state.json` são gravados em `.json.tmp` seguidos de `fs::rename` para evitar corrupção.

---

## Como Executar

Pré-requisitos: **Node.js 20+** e **Rust (Cargo)**. No Linux, recomenda-se ter `poppler-utils` (`pdftoppm`) instalado para renderização de PDFs no módulo Shopee.

### Linux / macOS
```bash
npm install
npm run tauri dev
```

### Windows (PowerShell)
```powershell
npm.cmd install
npm.cmd run tauri dev
```

Para gerar o executável/instalador de produção:
```bash
npm run tauri build
# (no Windows PowerShell: npm.cmd run tauri build)
```
