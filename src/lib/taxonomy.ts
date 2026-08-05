/**
 * Taxonomia de motivos.
 *
 * O modelo é obrigado a escolher um destes rótulos, e não a inventar texto
 * livre. É o que permite somar "principais motivos" no dashboard: rótulo livre
 * produziria "preço alto", "achei caro" e "muito caro" como três motivos
 * distintos, e o gráfico viraria uma lista de frases com contagem 1.
 *
 * **Este é o arquivo a editar para adaptar ao seu negócio.** Adicionar ou
 * renomear um motivo aqui muda o prompt automaticamente. Comentários já
 * analisados mantêm o rótulo antigo até serem reanalisados.
 */
export const MOTIVES = [
  { id: 'preco', label: 'Preço e formas de pagamento' },
  { id: 'duvida_produto', label: 'Dúvida sobre o produto' },
  { id: 'disponibilidade', label: 'Disponibilidade e estoque' },
  { id: 'intencao_compra', label: 'Intenção de compra' },
  { id: 'frete_entrega', label: 'Frete e prazo de entrega' },
  { id: 'status_pedido', label: 'Status de pedido' },
  { id: 'qualidade', label: 'Qualidade do produto' },
  { id: 'atendimento', label: 'Atendimento' },
  { id: 'troca_garantia', label: 'Troca, devolução e garantia' },
  { id: 'promocao', label: 'Promoção e cupom' },
  { id: 'elogio', label: 'Elogio à marca' },
  { id: 'reclamacao', label: 'Reclamação geral' },
  { id: 'spam', label: 'Spam ou irrelevante' },
  { id: 'outro', label: 'Outro' },
] as const;

export type MotiveId = (typeof MOTIVES)[number]['id'];

export const MOTIVE_IDS = MOTIVES.map((motive) => motive.id) as readonly string[];

const MOTIVE_LABELS = new Map(MOTIVES.map((motive) => [motive.id as string, motive.label]));

/** Rótulo legível. Motivo desconhecido (taxonomia editada) aparece como si mesmo. */
export function motiveLabel(id: string | null): string {
  if (!id) return 'Não analisado';
  return MOTIVE_LABELS.get(id) ?? id;
}

export const SENTIMENTS = ['positive', 'neutral', 'negative'] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

export const SENTIMENT_LABELS: Record<Sentiment, string> = {
  positive: 'Positivo',
  neutral: 'Neutro',
  negative: 'Negativo',
};

export const INTENTS = ['question', 'complaint', 'praise', 'purchase_intent', 'other'] as const;
export type Intent = (typeof INTENTS)[number];

export const INTENT_LABELS: Record<Intent, string> = {
  question: 'Pergunta',
  complaint: 'Reclamação',
  praise: 'Elogio',
  purchase_intent: 'Intenção de compra',
  other: 'Outro',
};

export const URGENCIES = ['low', 'medium', 'high'] as const;
export type Urgency = (typeof URGENCIES)[number];

export const URGENCY_LABELS: Record<Urgency, string> = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
};
