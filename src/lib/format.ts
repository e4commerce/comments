/** Formatação em pt-BR, centralizada para data e número não divergirem entre telas. */

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const dateOnly = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });

export function formatDateTime(value: Date | null): string {
  return value ? dateTime.format(value) : '—';
}

export function formatDay(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(`${value}T12:00:00`) : value;
  return dateOnly.format(date);
}

/** "há 3 h" — em moderação, o tempo de espera importa mais que o horário exato. */
export function formatRelative(value: Date | null): string {
  if (!value) return '—';

  const seconds = Math.floor((Date.now() - value.getTime()) / 1000);
  if (seconds < 60) return 'agora';
  if (seconds < 3600) return `há ${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `há ${Math.floor(seconds / 3600)} h`;
  const days = Math.floor(seconds / 86400);
  if (days < 30) return `há ${days} d`;
  return dateTime.format(value);
}

export const formatNumber = (value: number): string => value.toLocaleString('pt-BR');

export function formatPercent(part: number, total: number): string {
  if (total === 0) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}
