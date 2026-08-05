/**
 * Primitivas de interface.
 *
 * Escritas à mão em vez de instalar shadcn/ui, que o §3.1 prevê: shadcn é um gerador de
 * componentes, e gerar quarenta arquivos para telas com dois formulários criaria superfície
 * sem uso. A instalação faz sentido na Fase 4, quando a inbox precisa de dialog, dropdown,
 * command, tooltip e virtualização. Estas primitivas são compatíveis com aquele caminho:
 * mesmos nomes, mesma API de props.
 */

import type { ComponentProps, ReactNode } from 'react';

function cx(...classes: (string | false | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        'rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] font-medium">
      {children}
    </label>
  );
}

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      {...props}
      className={cx(
        'w-full rounded-lg border border-[var(--color-border-subtle)] bg-white px-3 py-2 text-[14px]',
        'placeholder:text-[var(--color-ink-muted)] disabled:opacity-60',
        className,
      )}
    />
  );
}

export function Select({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <select
      {...props}
      className={cx(
        'w-full rounded-lg border border-[var(--color-border-subtle)] bg-white px-3 py-2 text-[14px]',
        className,
      )}
    >
      {children}
    </select>
  );
}

export function Button({
  variant = 'primary',
  className,
  children,
  ...props
}: ComponentProps<'button'> & { variant?: 'primary' | 'secondary' | 'danger' }) {
  const styles = {
    primary: 'bg-[var(--color-ink)] text-white hover:opacity-90',
    secondary:
      'border border-[var(--color-border-subtle)] bg-white text-[var(--color-ink)] hover:bg-[var(--color-surface-muted)]',
    danger: 'text-[var(--color-sentiment-negative)] hover:underline',
  }[variant];

  return (
    <button
      {...props}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-[14px] font-semibold',
        'disabled:cursor-not-allowed disabled:opacity-60',
        styles,
        className,
      )}
    >
      {children}
    </button>
  );
}

/**
 * Mensagem de estado.
 *
 * `role="alert"` para que leitores de tela anunciem a mudança — §11.5 exige "anúncio de
 * mudanças dinâmicas em regiões live". E o ícone textual acompanha a cor, porque o §12
 * proíbe cor como único portador de informação.
 */
export function Alert({
  tone,
  children,
}: {
  tone: 'error' | 'success' | 'info';
  children: ReactNode;
}) {
  const styles = {
    error: 'border-red-200 bg-red-50 text-red-900',
    success: 'border-green-200 bg-green-50 text-green-900',
    info: 'border-[var(--color-border-subtle)] bg-[var(--color-surface-muted)] text-[var(--color-ink)]',
  }[tone];
  const prefix = { error: 'Erro:', success: 'Pronto:', info: 'Nota:' }[tone];

  return (
    <div role="alert" className={cx('rounded-lg border px-3 py-2 text-[13px]', styles)}>
      <strong className="font-semibold">{prefix}</strong> {children}
    </div>
  );
}

export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-md bg-[var(--color-surface-muted)] px-2 py-0.5 text-[12px] font-medium text-[var(--color-ink-muted)]">
      {children}
    </span>
  );
}

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mb-6">
      <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
      {subtitle !== undefined && (
        <p className="mt-1 max-w-2xl text-[var(--color-ink-muted)]">{subtitle}</p>
      )}
    </header>
  );
}
