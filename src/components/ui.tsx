import type { ComponentProps, ReactNode } from 'react';

/** Peças visuais compartilhadas. Sem biblioteca de componentes: são cinco. */

export function Card({ className = '', ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={`rounded-xl border border-line bg-surface p-4 ${className}`}
      {...props}
    />
  );
}

type ButtonProps = ComponentProps<'button'> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  ...props
}: ButtonProps) {
  const variants = {
    primary: 'bg-accent text-accent-ink hover:opacity-90',
    secondary: 'border border-line bg-surface hover:bg-surface-muted',
    ghost: 'text-ink-muted hover:bg-surface-muted hover:text-ink',
    danger: 'border border-line text-negative hover:bg-negative/10',
  };
  const sizes = { sm: 'px-2.5 py-1 text-xs', md: 'px-3 py-1.5 text-sm' };

  return (
    <button
      className={`inline-flex items-center gap-1.5 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    />
  );
}

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'positive' | 'neutral' | 'negative' | 'warning' | 'accent' | 'plain';
  children: ReactNode;
}) {
  const tones = {
    positive: 'bg-positive/15 text-positive',
    neutral: 'bg-neutral/15 text-ink-muted',
    negative: 'bg-negative/15 text-negative',
    warning: 'bg-warning/15 text-warning',
    accent: 'bg-accent/15 text-accent',
    plain: 'border border-line text-ink-muted',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <Card className="py-12 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-md text-sm text-ink-muted">{children}</div>}
    </Card>
  );
}

/** Aviso de estado do sistema — chave ausente, permissão faltando, token expirado. */
export function Notice({
  tone = 'warning',
  children,
}: {
  tone?: 'warning' | 'negative' | 'accent';
  children: ReactNode;
}) {
  const tones = {
    warning: 'border-warning/40 bg-warning/10',
    negative: 'border-negative/40 bg-negative/10',
    accent: 'border-accent/40 bg-accent/10',
  };
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${tones[tone]}`}>{children}</div>
  );
}
