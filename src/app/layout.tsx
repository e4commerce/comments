import type { Metadata } from 'next';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/session';
import { logout } from './actions';
import './globals.css';

export const metadata: Metadata = {
  title: 'Meta Comments',
  description: 'Gestão e análise de comentários do Facebook e Instagram',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  return (
    <html lang="pt-BR">
      <body className="min-h-screen font-sans">
        {user && (
          <header className="border-b border-line bg-surface">
            <nav className="mx-auto flex max-w-6xl items-center gap-1 px-4 py-3">
              <span className="mr-4 font-semibold tracking-tight">Meta Comments</span>
              <NavLink href="/">Análise</NavLink>
              <NavLink href="/inbox">Comentários</NavLink>
              {user.role === 'admin' && <NavLink href="/settings">Configurações</NavLink>}
              <span className="ml-auto hidden max-w-56 truncate text-xs text-ink-muted sm:block">
                {user.email}
              </span>
              <form action={logout} className="ml-auto sm:ml-0">
                <button
                  type="submit"
                  className="rounded-md px-3 py-1.5 text-sm text-ink-muted hover:bg-surface-muted hover:text-ink"
                >
                  Sair
                </button>
              </form>
            </nav>
          </header>
        )}
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-md px-3 py-1.5 text-sm text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
    >
      {children}
    </Link>
  );
}
