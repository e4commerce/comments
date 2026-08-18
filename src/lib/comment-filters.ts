import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';

export interface CommentFilterRule {
  normalizedPattern: string;
}

/** Mesma normalização para impedir duplicatas e comparar textos no SQLite. */
export function normalizeCommentFilterText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('pt-BR');
}

/**
 * Predicados compartilhados pela fila, pelo painel e pela análise de IA.
 * `instr`, em vez de LIKE, trata caracteres como `%` e `_` literalmente.
 */
export function excludeCommentFilterRules(
  messageColumn: SQLWrapper,
  rules: readonly CommentFilterRule[],
): SQL[] {
  return rules.map(
    (rule) =>
      sql`instr(mc_normalize_comment_text(coalesce(${messageColumn}, '')), ${rule.normalizedPattern}) = 0`,
  );
}
