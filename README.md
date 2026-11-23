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

- **Design Industrial RIP / Workstation & Operação 100% Teclado:**
  - Alta densidade de informação com tipografia monoespaçada (`font-mono`, `tabular-nums`) para medidas, DPI, pixels e contadores.
  - **Sidebar recolhível** (`Ctrl+B` ou botão no topo) com modo compacto de ícones (`54px`) + LEDs de status dos serviços e persistência no `localStorage`.
  - **Paleta de Comandos (`Ctrl+K` / `Ctrl+P`)** com busca fuzzy para módulos, códigos técnicos e ações da tela ativa, além de **Mapa de Atalhos (`F1` / `Ctrl+/` / `?`)**.
  - **Navegação & Tema pelo Teclado:** `Ctrl+0..9` (salto direto), `Ctrl+Tab` / `Alt+←/→` (abas), `Alt+T` / `Ctrl+Shift+L` (tema Claro/Escuro), `Ctrl+Enter` (ação principal da tela), `Ctrl+O` (pasta), `Ctrl+R` (atualizar/executar), `Ctrl+L` (limpar logs), `Ctrl+F` (filtro) e `Alt+1/2` (sub-abas).
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

Para gerar o executável/instalador de produção localmente:
```bash
npm run tauri build
# (no Windows PowerShell: npm.cmd run tauri build)
```

---

## Ícones

O ícone-fonte é vetorial: [`src-tauri/icons/app-icon.svg`](src-tauri/icons/app-icon.svg) (marca de registro de impressão + marcas de corte). Após editá-lo, regenere todos os tamanhos (`.ico`, `.icns`, PNGs e tiles do Windows):

```bash
npm run icons
```

O favicon da interface fica em `public/favicon.svg`.

---

## Deploy (GitHub Actions → Windows)

O workflow [`release.yml`](.github/workflows/release.yml) é acionado **exclusivamente quando uma nova tag `v*` é enviada** (ou via disparo manual no painel do GitHub). Ele compila a aplicação no Windows (`windows-latest`), assina os binários com Minisign, gera os instaladores NSIS (`*-setup.exe`) e MSI (`*.msi`), além do manifesto de atualização automática `latest.json`, publicando tudo diretamente no **GitHub Releases**.

### Publicando uma nova versão (git tag)

**A tag é a fonte da verdade da versão.** O workflow lê `vX.Y.Z` da tag e aplica em `package.json`, `tauri.conf.json`, `Cargo.toml` e `Cargo.lock` antes de compilar — então o nome do instalador, a versão em "Aplicativos instalados" e a release batem sempre com a tag.

```bash
# Opção A — só a tag (mais rápido)
git tag v0.2.0
git push origin v0.2.0

# Opção B — também grava a versão nos arquivos do repo (recomendado p/ histórico)
npm version minor        # 0.1.0 -> 0.2.0: atualiza package.json + Cargo.toml/lock,
                         # cria commit "chore(release): v0.2.0" e a tag v0.2.0
git push --follow-tags   # envia commit + tag
```

| Tag | Resultado |
|---|---|
| `v1.2.0` | Release estável |
| `v1.3.0-1`, `v1.3.0-2` | **Pré-release** (marcada no GitHub; só sufixo numérico — limitação do MSI) |
| `v1.2`, `1.2.0`, `v1.2.0-beta` | Rejeitada pelo workflow |

Versionamento semântico: `patch` (correções) · `minor` (funcionalidades novas) · `major` (mudanças incompatíveis, ex.: formato do `config.json`).

**Refazer uma release** (ex.: build falhou):
```bash
git tag -d v0.2.0 && git push origin :refs/tags/v0.2.0   # apaga tag local e remota
# apague também a release no GitHub, corrija, e crie a tag de novo
```

Em ~10–15 min a release aparece em **GitHub → Releases** com:
- `PCP.Central_X.Y.Z_x64-setup.exe` — instalador recomendado (por usuário, **não exige administrador**, idioma pt-BR, instala o WebView2 se faltar).
- `PCP.Central_X.Y.Z_x64_pt-BR.msi` — para implantação via GPO.

### Instalação nas máquinas

- Rode o `-setup.exe`. Atualizar = instalar a versão nova por cima; `config.json` e notas (em `%APPDATA%\com.pcp.central\`) são preservados.
- Na primeira execução o Windows Defender Firewall pergunta sobre acesso à rede: **permita em "Redes privadas"** — necessário para Notepad (`8765/8766`), Calandragem e Webhook do WhatsApp (`5050`) serem acessados por outros dispositivos.
- O app é **instância única**: abrir de novo apenas traz a janela existente para frente (evita conflito de portas e watchers duplicados).

---

## Atualizações Automáticas (In-App Updater)

O PCP Central possui um sistema integrado de verificação e atualização (`UPD-00`):

1. **Detecção Silenciosa e Periódica:**
   - 8 segundos após a abertura, o app consulta o endpoint `releases/latest/download/latest.json`.
   - Permanece checando automaticamente a cada **30 minutos** em background (sem interromper o operador).
   - Ao encontrar uma nova versão, exibe notificação nativa do Windows e ativa o indicador visual `[UPD: vX.Y.Z]` na barra de status inferior.
2. **Operação e Teclado:**
   - Pressione **`Alt+U`** ou clique no botão `[UPD]` na barra inferior para abrir o painel de atualização.
   - Pressione **`Ctrl+Enter`** no modal para baixar, verificar a assinatura criptográfica, instalar passivamente e reiniciar.
   - Pressione **`Ctrl+R`** para forçar uma verificação manual imediata.
   - Disponível também na **Paleta de Comandos (`Ctrl+K`)** e na tela de **Specs (`Alt+I`)**.
3. **Proteção de Produção (Busy Guard):**
   - Se houver processos em andamento (corte de painéis, varredura de bolsinhas ou renderização de fichas Shopee), o modal alerta o operador para que aguarde a conclusão antes de reiniciar a estação.
4. **Assinatura Criptográfica dos Pacotes:**
   - As atualizações são assinadas com chave Minisign. A chave pública está fixada em `tauri.conf.json`.
   - No GitHub Actions, os artefatos de release geram o `latest.json` assinado para que o download seja seguro e verificado.

> [!NOTE]
> O instalador não é assinado digitalmente (code signing). O SmartScreen pode exibir "O Windows protegeu o computador" → **Mais informações → Executar assim mesmo**.
