export const INBOX_SORT_OPTIONS = [
  { value: 'priority', label: 'Prioridade e recentes' },
  { value: 'newest', label: 'Mais recentes' },
  { value: 'oldest', label: 'Mais antigos' },
  { value: 'most_liked', label: 'Mais curtidos' },
  { value: 'most_replied', label: 'Mais respostas' },
] as const;

export type InboxSort = (typeof INBOX_SORT_OPTIONS)[number]['value'];

export function normalizeInboxSort(value: string | undefined): InboxSort {
  return INBOX_SORT_OPTIONS.some((option) => option.value === value)
    ? (value as InboxSort)
    : 'priority';
}

export function inboxSortLabel(value: InboxSort): string {
  return (
    INBOX_SORT_OPTIONS.find((option) => option.value === value)?.label ??
    'Prioridade e recentes'
  );
}
