export type ModuloId =
  | "inicio"
  | "pastas"
  | "tiff"
  | "bolsinhas"
  | "cortador"
  | "consumo"
  | "notepad"
  | "whatsapp";

export interface ModuloMeta {
  id: Exclude<ModuloId, "inicio">;
  grupo: "DIA A DIA" | "PRODUÇÃO" | "COMUNICAÇÃO";
  nome: string;
  icone: string;
  descricao: string;
  cor: "emerald" | "sky" | "amber" | "violet" | "rose" | "indigo" | "teal";
  pronto: boolean;
}

export const MODULOS: ModuloMeta[] = [
  {
    id: "pastas",
    grupo: "DIA A DIA",
    nome: "Pastas do Dia",
    icone: "📁",
    descricao:
      "Cria a estrutura de pastas do dia no Z: (BOLSINHAS, PAINEL_CUT, CONF…).",
    cor: "amber",
    pronto: true,
  },
  {
    id: "tiff",
    grupo: "PRODUÇÃO",
    nome: "TIFF Processor",
    icone: "🖨️",
    descricao: "Monitora pasta: rotação, contorno, padding e nome do cliente.",
    cor: "sky",
    pronto: true,
  },
  {
    id: "bolsinhas",
    grupo: "PRODUÇÃO",
    nome: "Bolsinhas",
    icone: "👜",
    descricao:
      "Monitora PARA FAZER e gera bolsinhas JPEG; varredura de duplicadas.",
    cor: "violet",
    pronto: true,
  },
  {
    id: "cortador",
    grupo: "PRODUÇÃO",
    nome: "Cortador de Painéis",
    icone: "✂️",
    descricao:
      "Corta painéis em placas com gabarito. Modo automático ou medidas personalizadas.",
    cor: "emerald",
    pronto: true,
  },
  {
    id: "consumo",
    grupo: "PRODUÇÃO",
    nome: "Consumo / Avarias",
    icone: "📊",
    descricao: "Calcula consumo de tecido de uma pasta de TIFFs, com gráficos.",
    cor: "rose",
    pronto: true,
  },
  {
    id: "notepad",
    grupo: "COMUNICAÇÃO",
    nome: "Notepad",
    icone: "📝",
    descricao:
      "Bloco de notas compartilhado com os outros PCs (servidor embutido).",
    cor: "indigo",
    pronto: true,
  },
  {
    id: "whatsapp",
    grupo: "COMUNICAÇÃO",
    nome: "WhatsApp",
    icone: "💬",
    descricao:
      "Webhook do Evolution Go: mensagens dos grupos ao vivo, com filtro.",
    cor: "teal",
    pronto: true,
  },
];
