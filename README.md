# PCP Central (`pcp-tauri`)

Aplicação desktop em **Rust + Tauri v2** com interface em **React + TypeScript + Tailwind CSS v4**, criada a partir da migração do `hub/` (Python/CustomTkinter) para unificar as ferramentas de produção e comunicação da sublimação em uma única janela nativa para Windows.

---

## Arquitetura

```text
pcp-tauri/
├── src/                        # Frontend (React + TypeScript + Tailwind CSS v4)
│   ├── components/ui.tsx       # Primitivas de UI (PageHeader, SurfaceCard, StatusBadge, StatCard, TerminalLog)
│   ├── modules/registry.ts     # Registro de módulos, grupos e metadados
│   ├── pages/                  # Uma página por ferramenta + HomePage
│   └── App.tsx                 # Sidebar, atalhos (Ctrl+0..7), status ao vivo e tema Claro/Escuro
│
└── src-tauri/                  # Backend Nativo (Rust + Tauri v2)
    ├── assets/notepad.html     # Interface web servida na rede local pelo Notepad
    └── src/
        ├── lib.rs              # Setup de estado, auto-inicialização e registro de comandos
        ├── commands/           # Ponte IPC (#[tauri::command]) por módulo
        └── core/               # Lógica pura e serviços em Rust
            ├── config.rs       # config.json atômico (.tmp -> rename) + pasta_do_dia()
            ├── global_log.rs   # Log global TSV (processados_global.tsv) com fingerprint (size + mtime)
            ├── imaging.rs      # Decodificação TIFF single-open, DPI/ICC, resize SIMD e blit por slice
            ├── pastas.rs       # Criação da estrutura de pastas do dia e totens
            ├── consumo.rs      # Leitura paralela de cabeçalhos TIFF e cálculo linear de tecido
            ├── tiff_proc.rs    # Monitoramento (notify + polling) e tratamento automático de TIFFs
            ├── bolsinhas.rs    # Geração paralela de JPEGs 10%, comparação de miniaturas e varredura
            ├── cortador.rs     # Cortador de painéis (Automático e Medidas personalizadas)
            ├── notepad_srv.rs  # Servidor Axum (HTTP + WebSocket) com portas configuráveis
            └── zap_srv.rs      # Webhook Axum para Evolution Go (/webhook) com porta configurável
```

---

## Módulos Implementados

| Grupo | Módulo | Descrição |
|---|---|---|
| **Dia a Dia** | **Pastas do Dia** | Cria a estrutura `DD MM AAAA` (`BOLSINHAS/PARA FAZER`, `PAINEL_CUT`, `CONF`, `APS`, `TEX`, totens) no drive configurado. |
| **Produção** | **TIFF Processor** | Monitora pasta (`notify` + polling), rotaciona 90°, aplica borda 1 px, padding inferior 1 cm, nome do cliente, preserva DPI/ICC e registra no `processados_global.tsv`. |
| **Produção** | **Bolsinhas** | Monitora `PARA FAZER` gerando JPEGs reduzidos (10%) em paralelo, compara miniaturas (`_miniaturas`) para evitar artes repetidas e realiza varredura de duplicadas. |
| **Produção** | **Cortador de Painéis** | Modos **Automático** (fatiamento uniforme em paralelo, paleta de 20 cores, extração de cidade + overrides) e **Medidas personalizadas**, com gabarito e numeração. |
| **Produção** | **Consumo / Avarias** | Lê apenas cabeçalhos TIFF em paralelo (`rayon`), calcula consumo linear (160 cm mídia / 150 cm útil / 155 cm emenda) e exibe gráficos por categoria e tecido. |
| **Comunicação** | **Notepad** | Servidor `axum` embutido (HTTP + WebSocket com **portas configuráveis**, padrão `8766`/`8765`), persistência atômica e editor colaborativo em tempo real. |
| **Comunicação** | **WhatsApp** | Servidor `axum` (`/webhook`) com **porta configurável** (padrão `5050`), validação de `instanceToken`, filtro por grupo e busca ao vivo. |

---

## Destaques Técnicos

- **Persistência Atômica:** `config.json` e `notes_state.json` são gravados via arquivo `.tmp` + `rename` para evitar corrupção em quedas ou falhas de rede.
- **Processamento de Imagem Otimizado:**
  - Leitura de TIFF em **passada única** (DPI, perfil ICC e pixels no mesmo `tiff::Decoder`).
  - Redimensionamento via **`fast_image_resize`** (SIMD) e cópia por scanline (`blit_rgb_fast`).
  - Cache global da fonte TTF (`OnceLock`) e paralelismo real via **`rayon`**.
- **Interface & Usabilidade:**
  - **Modo Claro como padrão** com alternância instantânea para **Modo Escuro** na barra lateral.
  - Atalhos de teclado `Ctrl+0` (Início) e `Ctrl+1..7` (módulos).

---

## Como Executar

Pré-requisitos: **Node.js 20+** e **Rust (Cargo)**.

```powershell
cd pcp-tauri
npm.cmd install
npm.cmd run tauri dev
```

Para gerar o executável/instalador de produção:

```powershell
npm.cmd run tauri build
```
