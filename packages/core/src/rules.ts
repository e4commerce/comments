/**
 * Avaliador de condições de automação — §9.7 do PRD [NORMATIVO].
 *
 * Contrato do §9.7, literal:
 *
 *   {
 *     "all": [
 *       { "field": "ai.is_toxic", "op": "eq", "value": true },
 *       { "field": "ai.confidence", "op": "gte", "value": 0.8 },
 *       { "any": [
 *         { "field": "comment.source_type", "op": "eq", "value": "ad_comment" },
 *         { "field": "comment.like_count", "op": "gte", "value": 5 }
 *       ]}
 *     ]
 *   }
 *
 * Duas decisões de segurança governam este arquivo.
 *
 * A primeira: campo desconhecido **não** satisfaz a condição. Uma regra que oculta comentários
 * e referencia `ai.is_toxick` (com erro de digitação) precisa nunca disparar, jamais disparar
 * sempre. Automação que age sobre conteúdo de cliente falha fechada.
 *
 * A segunda: nada de acesso dinâmico a propriedade arbitrária. Os campos permitidos são uma
 * lista explícita. Sem isso, `field: "__proto__"` ou um caminho para dentro de `raw` daria a
 * uma regra criada pela interface alcance sobre o objeto inteiro.
 */

export type ComparisonOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'not_contains'
  | 'in'
  | 'not_in'
  | 'is_null'
  | 'is_not_null';

export interface Comparison {
  field: string;
  op: ComparisonOperator;
  value?: unknown;
}

export interface AllGroup {
  all: Condition[];
}
export interface AnyGroup {
  any: Condition[];
}
export type Condition = Comparison | AllGroup | AnyGroup;

/**
 * Contexto avaliado. Achatado em caminhos com ponto para casar com o contrato do §9.7, em vez
 * de percorrer objetos aninhados em runtime.
 */
export interface RuleContext {
  comment: {
    source_type: string;
    platform: string;
    like_count: number;
    reply_count: number;
    is_hidden: boolean;
    status: string;
    message: string | null;
    depth: number;
    has_attachment: boolean;
    urgency_score: number;
    minutes_since_published: number;
  };
  ai: {
    sentiment: string | null;
    sentiment_score: number | null;
    confidence: number | null;
    intent: string | null;
    urgency: string | null;
    is_toxic: boolean;
    is_spam: boolean;
    is_question: boolean;
    requires_response: boolean;
    contains_pii: boolean;
    mentions_competitor: boolean;
    language: string | null;
    topic_name: string | null;
  };
  author: {
    comments_count: number;
    negative_count: number;
    is_blocked: boolean;
    is_verified: boolean;
  };
}

/** Caminhos permitidos. Qualquer outro é desconhecido e nunca satisfaz. */
export const ALLOWED_FIELDS: readonly string[] = [
  'comment.source_type',
  'comment.platform',
  'comment.like_count',
  'comment.reply_count',
  'comment.is_hidden',
  'comment.status',
  'comment.message',
  'comment.depth',
  'comment.has_attachment',
  'comment.urgency_score',
  'comment.minutes_since_published',
  'ai.sentiment',
  'ai.sentiment_score',
  'ai.confidence',
  'ai.intent',
  'ai.urgency',
  'ai.is_toxic',
  'ai.is_spam',
  'ai.is_question',
  'ai.requires_response',
  'ai.contains_pii',
  'ai.mentions_competitor',
  'ai.language',
  'ai.topic_name',
  'author.comments_count',
  'author.negative_count',
  'author.is_blocked',
  'author.is_verified',
];

const ALLOWED = new Set(ALLOWED_FIELDS);

export interface EvaluationResult {
  matched: boolean;
  /** Campos referenciados que não existem. Alimentam o aviso na interface de regras. */
  unknownFields: string[];
}

function readField(context: RuleContext, path: string): unknown {
  if (!ALLOWED.has(path)) return undefined;
  const [group, key] = path.split('.');
  if (group === undefined || key === undefined) return undefined;

  // Acesso por grupo conhecido, nunca por índice arbitrário no objeto raiz.
  const bag =
    group === 'comment'
      ? (context.comment as unknown as Record<string, unknown>)
      : group === 'ai'
        ? (context.ai as unknown as Record<string, unknown>)
        : group === 'author'
          ? (context.author as unknown as Record<string, unknown>)
          : undefined;

  return bag === undefined ? undefined : bag[key];
}

function compareNumbers(
  actual: unknown,
  expected: unknown,
  compare: (a: number, b: number) => boolean,
): boolean {
  if (typeof actual !== 'number' || typeof expected !== 'number') return false;
  if (Number.isNaN(actual) || Number.isNaN(expected)) return false;
  return compare(actual, expected);
}

function evaluateComparison(
  context: RuleContext,
  comparison: Comparison,
  unknownFields: string[],
): boolean {
  if (!ALLOWED.has(comparison.field)) {
    unknownFields.push(comparison.field);
    return false;
  }

  const actual = readField(context, comparison.field);
  const expected = comparison.value;

  switch (comparison.op) {
    case 'is_null':
      return actual === null || actual === undefined;
    case 'is_not_null':
      return actual !== null && actual !== undefined;
    case 'eq':
      return actual === expected;
    case 'neq':
      return actual !== expected;
    case 'gt':
      return compareNumbers(actual, expected, (a, b) => a > b);
    case 'gte':
      return compareNumbers(actual, expected, (a, b) => a >= b);
    case 'lt':
      return compareNumbers(actual, expected, (a, b) => a < b);
    case 'lte':
      return compareNumbers(actual, expected, (a, b) => a <= b);
    case 'contains':
      // Comparação sem acento e sem caixa: uma regra escrita com "atraso" precisa casar
      // "ATRASO" e "atrasö".
      return typeof actual === 'string' && typeof expected === 'string'
        ? fold(actual).includes(fold(expected))
        : false;
    case 'not_contains':
      return typeof actual === 'string' && typeof expected === 'string'
        ? !fold(actual).includes(fold(expected))
        : false;
    case 'in':
      return Array.isArray(expected) && expected.includes(actual);
    case 'not_in':
      return Array.isArray(expected) ? !expected.includes(actual) : false;
    default:
      // Operador desconhecido: falha fechada, como campo desconhecido.
      return false;
  }
}

function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function isAllGroup(condition: Condition): condition is AllGroup {
  return 'all' in condition && Array.isArray(condition.all);
}

function isAnyGroup(condition: Condition): condition is AnyGroup {
  return 'any' in condition && Array.isArray(condition.any);
}

function evaluateCondition(
  context: RuleContext,
  condition: Condition,
  unknownFields: string[],
  depth: number,
): boolean {
  // Aninhamento é limitado: uma estrutura patológica vinda do banco não deve poder estourar a
  // pilha dentro do worker de automação.
  if (depth > 10) return false;

  // `conditions` vem de jsonb, então pode ser qualquer coisa — inclusive null. Sem esta
  // guarda, o `'all' in condition` abaixo lança TypeError e derruba o job de automação em vez
  // de simplesmente não disparar a regra.
  if (typeof condition !== 'object' || condition === null) return false;

  if (isAllGroup(condition)) {
    // `all` vazio seria vacuamente verdadeiro e faria a regra disparar em TODO comentário.
    // Para automação que oculta e exclui, isso é inaceitável.
    if (condition.all.length === 0) return false;
    return condition.all.every((child) =>
      evaluateCondition(context, child, unknownFields, depth + 1),
    );
  }

  if (isAnyGroup(condition)) {
    if (condition.any.length === 0) return false;
    return condition.any.some((child) =>
      evaluateCondition(context, child, unknownFields, depth + 1),
    );
  }

  if (typeof condition === 'object' && 'field' in condition && 'op' in condition) {
    return evaluateComparison(context, condition, unknownFields);
  }

  return false;
}

export function evaluateRule(context: RuleContext, condition: Condition): EvaluationResult {
  const unknownFields: string[] = [];
  const matched = evaluateCondition(context, condition, unknownFields, 0);
  return { matched, unknownFields: [...new Set(unknownFields)] };
}

// ---------------------------------------------------------------------------
// Ações
// ---------------------------------------------------------------------------

/**
 * §9.7: "Na v1 as automações permitidas são ocultar, etiquetar, atribuir, alterar status,
 * marcar prioridade e notificar. A resposta automática sem revisão humana fica fora da v1 por
 * decisão de produto."
 *
 * `reply` está deliberadamente AUSENTE deste tipo. A decisão do §9.7 é de produto e tem razão
 * declarada — o risco reputacional de uma resposta gerada por IA publicada sem supervisão supera
 * o ganho de eficiência. Deixar o tipo permitir resposta tornaria a violação uma linha de código
 * de distância.
 */
export type AutomationAction =
  | { type: 'hide' }
  | { type: 'add_tag'; value: string }
  | { type: 'assign'; value: string }
  | { type: 'set_status'; value: 'in_progress' | 'resolved' | 'ignored' | 'archived' }
  | { type: 'set_priority'; value: 'low' | 'medium' | 'high' | 'critical' }
  | { type: 'notify'; channel: 'in_app' | 'email'; target: 'managers' | 'assignee' | 'owners' };

const VALID_ACTION_TYPES = new Set([
  'hide',
  'add_tag',
  'assign',
  'set_status',
  'set_priority',
  'notify',
]);

/**
 * Filtra ações válidas, descartando o que a v1 não permite.
 *
 * Devolve também o que foi descartado, para a interface poder dizer ao administrador que a
 * regra dele contém ação não suportada — em vez de silenciosamente ignorá-la.
 */
export function parseActions(raw: unknown): {
  actions: AutomationAction[];
  rejected: string[];
} {
  const list = Array.isArray(raw) ? raw : [];
  const actions: AutomationAction[] = [];
  const rejected: string[] = [];

  for (const item of list) {
    if (typeof item !== 'object' || item === null || !('type' in item)) {
      rejected.push('(ação sem tipo)');
      continue;
    }
    const type = (item as { type: unknown }).type;
    if (typeof type !== 'string' || !VALID_ACTION_TYPES.has(type)) {
      rejected.push(typeof type === 'string' ? type : '(tipo inválido)');
      continue;
    }
    actions.push(item as AutomationAction);
  }

  return { actions, rejected };
}
