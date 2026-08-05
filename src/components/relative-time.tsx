import { formatDateTime, formatRelative } from '@/lib/format';

/**
 * Tempo relativo ("há 2 h").
 *
 * `suppressHydrationWarning` é necessário e não é um atalho: o texto deriva de
 * `Date.now()`, então o servidor renderiza "há 1 min" e o cliente, um instante
 * depois, "há 2 min" — divergência real que o React acusa. O `dateTime` carrega
 * o instante exato em ISO, e o `title` a data legível, então nada de informação
 * depende do texto aproximado.
 */
export function RelativeTime({ value }: { value: Date | null }) {
  if (!value) return <span className="text-xs text-ink-muted">—</span>;

  return (
    <time
      dateTime={value.toISOString()}
      title={formatDateTime(value)}
      className="text-xs text-ink-muted"
      suppressHydrationWarning
    >
      {formatRelative(value)}
    </time>
  );
}
