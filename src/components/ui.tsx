import type { ComponentProps, ReactNode } from 'react';
import { AlertCircle, ArrowRight } from 'lucide-react';

/** Peças compartilhadas, alinhadas aos tokens do design system do e4desk. */

export function Card({ className = '', ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={`rounded-xl border border-line-subtle bg-surface p-5 shadow-card ${className}`}
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
    primary:
      'bg-inverse text-[var(--text-on-dark)] shadow-card hover:bg-[var(--action-primary-hover)]',
    secondary:
      'border border-line bg-surface text-ink hover:border-line-strong hover:bg-surface-muted',
    ghost: 'text-ink-muted hover:bg-surface-muted hover:text-ink',
    danger: 'border border-negative/25 bg-surface text-negative hover:bg-error-soft',
  };
  const sizes = { sm: 'min-h-8 px-3 py-1.5 text-xs', md: 'min-h-9 px-4 py-2 text-sm' };

  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-full font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${variants[variant]} ${sizes[size]} ${className}`}
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
    positive: 'bg-positive/12 text-positive',
    neutral: 'bg-neutral/15 text-ink-muted',
    negative: 'bg-error-soft text-negative',
    warning: 'bg-warning-soft text-warning',
    accent: 'bg-accent-soft text-accent',
    plain: 'border border-line text-ink-muted',
  };
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${tones[tone]}`}
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
    <Card className="border-dashed py-14 text-center shadow-none">
      <span className="mx-auto mb-4 flex size-10 items-center justify-center rounded-full bg-accent-soft text-lg text-accent">
        •
      </span>
      <p className="text-base font-semibold">{title}</p>
      {children && (
        <div className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-muted">
          {children}
        </div>
      )}
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
    warning: 'border-warning/25 bg-warning-soft text-ink',
    negative: 'border-negative/25 bg-error-soft text-ink',
    accent: 'border-accent/20 bg-accent-soft text-ink',
  };
  return (
    <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${tones[tone]}`}>
      <AlertCircle
        size={16}
        strokeWidth={1.8}
        className={`mt-0.5 shrink-0 ${
          tone === 'negative' ? 'text-negative' : tone === 'accent' ? 'text-accent' : 'text-warning'
        }`}
      />
      <div className="min-w-0 flex-1 leading-relaxed">{children}</div>
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 border-b border-line-subtle pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-muted">
            <span className="size-1.5 rounded-sm bg-accent" />
            {eyebrow}
          </p>
        )}
        <h1 className="font-display text-[32px] leading-[1.08] tracking-[-0.02em] text-ink sm:text-[38px]">
          {title}
        </h1>
        {description && <div className="mt-2 max-w-2xl text-sm text-ink-muted">{description}</div>}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </header>
  );
}

export function SectionHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
        {description && <p className="mt-1 text-xs leading-relaxed text-ink-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function InlineLink({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 font-medium">
      {children}
      <ArrowRight size={13} strokeWidth={1.8} />
    </span>
  );
}

export const inputClass =
  'w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-muted transition-[border-color,box-shadow]';

export const selectClass =
  'w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink transition-[border-color,box-shadow]';
