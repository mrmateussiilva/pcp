export type ModuloId =
  | "inicio"
  | "pastas"
  | "tiff"
  | "bolsinhas"
  | "cortador"
  | "consumo"
  | "shopee"
  | "calandragem"
  | "notepad"
  | "whatsapp";

export interface ModuloMeta {
  id: Exclude<ModuloId, "inicio">;
  codigo: string;
  grupo: "DIA A DIA" | "PRODUÇÃO" | "COMUNICAÇÃO";
  nome: string;
  tipo: "BATCH" | "WATCHER" | "CALC" | "SERVICE";
  descricao: string;
  pronto: boolean;
}

export const MODULOS: ModuloMeta[] = [
  {
    id: "pastas",
    codigo: "DIR-01",
    grupo: "DIA A DIA",
    nome: "Pastas do Dia",
    tipo: "BATCH",
    descricao: "Estruturação de diretórios de produção no drive Z: (Bolsinhas, Painéis, Conf, Totens).",
    pronto: true,
  },
  {
    id: "tiff",
    codigo: "RIP-01",
    grupo: "PRODUÇÃO",
    nome: "TIFF Processor",
    tipo: "WATCHER",
    descricao: "Monitoramento e RIP: rotação 90°, contorno 1px, padding inferior 1cm e DPI/ICC preservados.",
    pronto: true,
  },
  {
    id: "bolsinhas",
    codigo: "IMG-02",
    grupo: "PRODUÇÃO",
    nome: "Bolsinhas",
    tipo: "WATCHER",
    descricao: "Conversão paralela para JPEG 10%, catálogo de miniaturas e varredura de artes repetidas.",
    pronto: true,
  },
  {
    id: "cortador",
    codigo: "CUT-03",
    grupo: "PRODUÇÃO",
    nome: "Cortador de Painéis",
    tipo: "BATCH",
    descricao: "Fatiamento de painéis em placas com gabarito de costura, numeração e rótulo de cidade.",
    pronto: true,
  },
  {
    id: "consumo",
    codigo: "MET-04",
    grupo: "PRODUÇÃO",
    nome: "Consumo / Avarias",
    tipo: "CALC",
    descricao: "Leitura linear de cabeçalhos TIFF em lote, cálculo de metragem e classificação por tecido.",
    pronto: true,
  },
  {
    id: "shopee",
    codigo: "DOC-05",
    grupo: "PRODUÇÃO",
    nome: "Fichas Shopee",
    tipo: "WATCHER",
    descricao: "Renderização da Declaração de Conteúdo e pareamento horário com fotos do WhatsApp.",
    pronto: true,
  },
  {
    id: "calandragem",
    codigo: "SRV-01",
    grupo: "PRODUÇÃO",
    nome: "Calandragem",
    tipo: "SERVICE",
    descricao: "Servidor HTTP embutido (:8767) integrado à fila de calandragem e sincronização WebSocket.",
    pronto: true,
  },
  {
    id: "notepad",
    codigo: "SRV-02",
    grupo: "COMUNICAÇÃO",
    nome: "Notepad Colaborativo",
    tipo: "SERVICE",
    descricao: "Servidor Axum WebSocket (:8765) + HTTP (:8766) com persistência atômica para a rede local.",
    pronto: true,
  },
  {
    id: "whatsapp",
    codigo: "SRV-03",
    grupo: "COMUNICAÇÃO",
    nome: "WhatsApp Live Hook",
    tipo: "SERVICE",
    descricao: "Webhook receptor Evolution Go (:5050) com histórico em memória e filtros por grupo.",
    pronto: true,
  },
];
