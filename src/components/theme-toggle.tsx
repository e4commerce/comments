'use client';

import { Moon, Sun } from 'lucide-react';

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  function toggle() {
    const next = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', next);
    window.localStorage.setItem('mc_theme', next ? 'dark' : 'light');
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Alternar entre tema claro e escuro"
      title="Alternar tema"
      className={
        compact
          ? 'flex size-10 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink'
          : 'inline-flex min-h-9 items-center gap-2 rounded-full border border-line bg-surface px-3 py-2 text-xs font-medium text-ink-muted shadow-card transition-colors hover:bg-surface-muted hover:text-ink'
      }
    >
      <Moon size={16} strokeWidth={1.8} className="dark:hidden" />
      <Sun size={16} strokeWidth={1.8} className="hidden dark:block" />
      {!compact && (
        <>
          <span className="dark:hidden">Tema escuro</span>
          <span className="hidden dark:inline">Tema claro</span>
        </>
      )}
    </button>
  );
}
