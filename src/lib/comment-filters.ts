/** Mesma normalização para impedir duplicatas e comparar textos no SQLite. */
export function normalizeCommentFilterText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('pt-BR');
}
