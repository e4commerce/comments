import type { Metadata } from 'next';
import { AppShell } from '@/components/app-shell';
import { getCurrentUser } from '@/lib/session';
import './globals.css';

export const metadata: Metadata = {
  title: 'Meta Comments',
  description: 'Gestão e análise de comentários do Facebook e Instagram',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('mc_theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d)}catch(e){}})()`,
          }}
        />
      </head>
      <body className="min-h-screen font-sans">
        {user ? <AppShell user={user}>{children}</AppShell> : <main>{children}</main>}
      </body>
    </html>
  );
}
