'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, Inbox, LogOut, Settings } from 'lucide-react';
import { logout } from '@/app/actions';
import { ThemeToggle } from './theme-toggle';

const primaryItems = [
  { href: '/', label: 'Análise', icon: BarChart3 },
  { href: '/inbox', label: 'Comentários', icon: Inbox },
];

export function AppShell({
  user,
  children,
}: {
  user: { email: string; role: 'admin' | 'user' };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const items =
    user.role === 'admin'
      ? [...primaryItems, { href: '/settings', label: 'Configurações', icon: Settings }]
      : primaryItems;
  const initials = user.email.slice(0, 2).toUpperCase();

  return (
    <div className="min-h-screen lg:flex">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[68px] flex-col items-center border-r border-line bg-surface-sidebar px-2 py-4 lg:flex">
        <Link
          href="/"
          aria-label="Meta Comments"
          className="mb-5 flex size-10 items-center justify-center rounded-xl bg-inverse text-sm font-semibold text-[var(--text-on-dark)] shadow-card"
        >
          M<span className="text-accent">•</span>
        </Link>

        <nav className="flex w-full flex-col gap-1" aria-label="Navegação principal">
          {items.map((item) => (
            <RailLink key={item.href} {...item} active={isActive(pathname, item.href)} />
          ))}
        </nav>

        <div className="mt-auto flex w-full flex-col items-center gap-2">
          <ThemeToggle compact />
          <div
            className="flex size-9 items-center justify-center rounded-lg border border-line bg-surface text-[11px] font-semibold"
            title={user.email}
          >
            {initials}
          </div>
          <form action={logout} className="w-full">
            <button
              type="submit"
              className="flex size-10 w-full items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
              aria-label="Sair"
              title="Sair"
            >
              <LogOut size={17} strokeWidth={1.8} />
            </button>
          </form>
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center border-b border-line bg-surface/95 px-4 backdrop-blur lg:hidden">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="flex size-7 items-center justify-center rounded-lg bg-inverse text-[11px] text-[var(--text-on-dark)]">
            M<span className="text-accent">•</span>
          </span>
          Meta Comments
        </Link>
        <span className="ml-auto hidden max-w-40 truncate text-xs text-ink-muted sm:block">
          {user.email}
        </span>
        <div className="ml-2">
          <ThemeToggle compact />
        </div>
      </header>

      <main className="min-w-0 flex-1 pb-24 lg:ml-[68px] lg:pb-0">
        <div className="mx-auto w-full max-w-[1180px] px-4 py-7 sm:px-6 lg:px-8 lg:py-9">
          {children}
        </div>
      </main>

      <nav
        className="fixed inset-x-3 bottom-3 z-40 flex items-center justify-around rounded-2xl border border-line bg-surface/95 p-1.5 shadow-popover backdrop-blur lg:hidden"
        aria-label="Navegação principal"
      >
        {items.map((item) => {
          const Icon = item.icon;
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`flex min-w-20 flex-col items-center gap-0.5 rounded-xl px-3 py-2 text-[11px] font-medium transition-colors ${
                active ? 'bg-inverse text-[var(--text-on-dark)]' : 'text-ink-muted'
              }`}
            >
              <Icon size={16} strokeWidth={1.8} />
              {item.label}
            </Link>
          );
        })}
        <form action={logout}>
          <button
            type="submit"
            className="flex min-w-16 flex-col items-center gap-0.5 rounded-xl px-3 py-2 text-[11px] font-medium text-ink-muted"
          >
            <LogOut size={16} strokeWidth={1.8} />
            Sair
          </button>
        </form>
      </nav>
    </div>
  );
}

function RailLink({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: typeof BarChart3;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      aria-current={active ? 'page' : undefined}
      className={`relative flex h-11 w-full items-center justify-center rounded-xl transition-colors ${
        active
          ? 'bg-inverse text-[var(--text-on-dark)]'
          : 'text-ink-muted hover:bg-surface-muted hover:text-ink'
      }`}
    >
      <Icon size={18} strokeWidth={1.8} />
      {active && <span className="absolute -right-2 h-5 w-0.5 rounded-full bg-accent" />}
    </Link>
  );
}

function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === href : pathname.startsWith(href);
}
