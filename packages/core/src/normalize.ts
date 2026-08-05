/**
 * Normalização de texto para busca — §7.2 do PRD.
 *
 * `comments.message_normalized` alimenta o índice de trigramas. A busca precisa tolerar erro de
 * digitação e ausência de acento, e o português brasileiro informal traz os dois em volume:
 * "nao chegou", "atrazo", "vcs".
 *
 * O que NÃO é feito aqui: remoção de stopwords e stemming. Trigramas já toleram variação
 * morfológica, e remover palavra curta quebraria busca por termo legítimo como "nao".
 */

/** Minúsculas, sem acento, espaços colapsados. */
export function normalizeForSearch(text: string | null | undefined): string | null {
  if (text == null) return null;

  const normalized = text
    .normalize('NFD')
    // Remove diacríticos combinantes.
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    // Emoji e símbolo viram espaço em vez de desaparecer: colar palavras que estavam separadas
    // por emoji criaria trigramas falsos.
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized.length === 0 ? null : normalized;
}

/**
 * Triagem determinística anterior a qualquer chamada de LLM — §9.2 do PRD.
 *
 * "o sistema descarta comentários sem valor analítico com regras baratas: texto vazio, apenas
 * emoji, apenas menções (@usuario) sem outro conteúdo, texto com menos de três caracteres, ou
 * duplicata exata recente do mesmo autor."
 *
 * O §9.2 estima que isso é de 20% a 30% do volume. Em custo de IA, é a diferença entre
 * US$ 0,50 e US$ 0,70 por mil comentários — e o alvo do §1.3 é abaixo de US$ 0,50.
 */
export type TriageReason =
  | 'empty'
  | 'too_short'
  | 'only_emoji'
  | 'only_mentions'
  | 'only_punctuation';

export interface TriageResult {
  /** Verdadeiro quando vale gastar tokens de LLM. */
  worthAnalyzing: boolean;
  reason: TriageReason | null;
}

const MENTION_RE = /@[\w.]+/gu;

export function triageComment(text: string | null | undefined): TriageResult {
  if (text == null || text.trim().length === 0) {
    return { worthAnalyzing: false, reason: 'empty' };
  }

  const trimmed = text.trim();

  // Menções removidas primeiro: "@joao olha isso" tem conteúdo, "@joao @maria" não.
  const withoutMentions = trimmed.replace(MENTION_RE, ' ').trim();
  if (withoutMentions.length === 0) {
    return { worthAnalyzing: false, reason: 'only_mentions' };
  }

  const withoutEmoji = withoutMentions
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Emoji_Component}]/gu, '')
    .trim();
  if (withoutEmoji.length === 0) {
    return { worthAnalyzing: false, reason: 'only_emoji' };
  }

  // Sem nenhuma letra ou dígito não há o que classificar: "!!!", "...", "???".
  if (!/[\p{L}\p{N}]/u.test(withoutEmoji)) {
    return { worthAnalyzing: false, reason: 'only_punctuation' };
  }

  // §9.2: menos de três caracteres.
  if (withoutEmoji.length < 3) {
    return { worthAnalyzing: false, reason: 'too_short' };
  }

  return { worthAnalyzing: true, reason: null };
}

/**
 * Chave de deduplicação de comentário repetido do mesmo autor (§9.2).
 *
 * Usa o texto normalizado: "Cadê meu pedido???" e "cade meu pedido" do mesmo autor no mesmo dia
 * são a mesma reclamação, e classificar as duas paga o dobro pelo mesmo sinal.
 */
export function duplicateKey(authorExternalId: string, text: string | null): string | null {
  const normalized = normalizeForSearch(text);
  if (normalized === null) return null;
  return `${authorExternalId}:${normalized.replace(/[^\p{L}\p{N} ]/gu, '')}`;
}
