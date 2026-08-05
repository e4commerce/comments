/**
 * Escore de urgência — §6.8 do PRD [NORMATIVO].
 *
 * A fórmula é transcrição literal:
 *
 *   urgency_score =
 *       peso_sentimento        (0 a 30)
 *     + peso_intencao          (0 a 20)
 *     + peso_toxicidade        (0 a 15)
 *     + peso_visibilidade      (0 a 15)   log10(1 + likes + replies) * 5, limitado a 15
 *     + peso_midia_paga        (0 a 10)
 *     + peso_tempo_espera      (0 a 10)   minutos/60 * 2, limitado a 10
 *     - desconto_respondido    (30)
 *
 * Resultado limitado ao intervalo de 0 a 100.
 *
 * O §6.8 é explícito sobre a razão de o número prevalecer sobre o rótulo `urgency` da IA: o
 * escore incorpora contexto de negócio que o modelo não tem — visibilidade real do comentário,
 * se há verba de mídia por trás, e quanto tempo a pessoa está esperando.
 *
 * Duas notas de implementação que o §6.8 não diz mas decorrem dele:
 *
 *  1. Os pesos de sentimento, intenção e toxicidade valem ZERO quando não há análise de IA.
 *     Isso mantém o escore utilizável antes da Fase 5, com os termos que não dependem de
 *     modelo — visibilidade, mídia paga, espera e desconto de respondido.
 *
 *  2. O termo de espera cresce com o tempo, então o escore é uma função do INSTANTE em que é
 *     calculado, não um valor estável. Recalcular apenas quando a análise conclui deixaria a
 *     fila estagnada; por isso o job de 5 minutos do §7.7 recalcula em lote.
 */

export type SentimentLabel =
  | 'very_negative'
  | 'negative'
  | 'neutral'
  | 'positive'
  | 'very_positive';

export type IntentLabel =
  | 'question'
  | 'complaint'
  | 'praise'
  | 'purchase_intent'
  | 'support_request'
  | 'suggestion'
  | 'spam'
  | 'troll'
  | 'off_topic'
  | 'other';

/** §6.8: very_negative=30, negative=20, neutral=5, positive=0, very_positive=0 */
const SENTIMENT_WEIGHT: Record<SentimentLabel, number> = {
  very_negative: 30,
  negative: 20,
  neutral: 5,
  positive: 0,
  very_positive: 0,
};

/**
 * §6.8: complaint=20, support_request=18, question=15, purchase_intent=15, suggestion=5,
 * praise=0, spam=0.
 *
 * `troll`, `off_topic` e `other` não constam na fórmula e recebem 0 — o §6.8 lista os pesos
 * exaustivamente, e inventar valor para os ausentes seria alterar a especificação.
 */
const INTENT_WEIGHT: Record<IntentLabel, number> = {
  complaint: 20,
  support_request: 18,
  question: 15,
  purchase_intent: 15,
  suggestion: 5,
  praise: 0,
  spam: 0,
  troll: 0,
  off_topic: 0,
  other: 0,
};

export const URGENCY_WEIGHT_CAPS = {
  sentiment: 30,
  intent: 20,
  toxicity: 15,
  visibility: 15,
  paidMedia: 10,
  waitTime: 10,
  repliedDiscount: 30,
} as const;

export interface UrgencyInput {
  /** Ausente antes da análise de IA (Fase 5). */
  sentiment?: SentimentLabel | null;
  intent?: IntentLabel | null;
  isToxic?: boolean;
  likeCount: number;
  replyCount: number;
  /** §6.8 exige `source_type = 'ad_comment'` E anúncio ativo para os 10 pontos. */
  isAdComment: boolean;
  isAdActive?: boolean;
  /** Minutos desde a publicação sem resposta da página. */
  minutesWaiting: number;
  /** Já existe resposta da página na thread. */
  hasPageReply: boolean;
}

export interface UrgencyBreakdown {
  sentiment: number;
  intent: number;
  toxicity: number;
  visibility: number;
  paidMedia: number;
  waitTime: number
  repliedDiscount: number;
  total: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Calcula o escore e devolve a decomposição.
 *
 * A decomposição não é luxo: sem ela, "por que este comentário está no topo da fila?" é
 * inrespondível, e a ordenação da inbox passa a parecer arbitrária ao operador.
 */
export function calculateUrgency(input: UrgencyInput): UrgencyBreakdown {
  const sentiment =
    input.sentiment == null ? 0 : (SENTIMENT_WEIGHT[input.sentiment] ?? 0);

  const intent = input.intent == null ? 0 : (INTENT_WEIGHT[input.intent] ?? 0);

  const toxicity = input.isToxic === true ? URGENCY_WEIGHT_CAPS.toxicity : 0;

  // log10(1 + likes + replies) * 5, limitado a 15. Log e não linear porque a diferença entre
  // 0 e 10 curtidas importa muito mais que entre 500 e 510.
  const engagement = Math.max(0, input.likeCount) + Math.max(0, input.replyCount);
  const visibility = clamp(Math.log10(1 + engagement) * 5, 0, URGENCY_WEIGHT_CAPS.visibility);

  // O §6.8 exige as duas condições. Comentário em anúncio pausado não queima verba.
  const paidMedia =
    input.isAdComment && input.isAdActive !== false ? URGENCY_WEIGHT_CAPS.paidMedia : 0;

  // minutos / 60 * 2, limitado a 10 — satura em 5 horas de espera.
  const waitTime = clamp(
    (Math.max(0, input.minutesWaiting) / 60) * 2,
    0,
    URGENCY_WEIGHT_CAPS.waitTime,
  );

  const repliedDiscount = input.hasPageReply ? URGENCY_WEIGHT_CAPS.repliedDiscount : 0;

  const total = clamp(
    sentiment + intent + toxicity + visibility + paidMedia + waitTime - repliedDiscount,
    0,
    100,
  );

  return { sentiment, intent, toxicity, visibility, paidMedia, waitTime, repliedDiscount, total };
}

/** Valor pronto para `comments.urgency_score`, que é numeric(5,2). */
export function urgencyScoreForDb(input: UrgencyInput): string {
  return calculateUrgency(input).total.toFixed(2);
}
