import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Alert, Button, Card, PageHeader } from '@/components/ui';
import { auth } from '@/lib/auth';
import { acceptInvitation, findPendingInvitation } from '@/lib/invitations';
import { ACTIVE_ORG_COOKIE } from '@/lib/session';
import { cookies } from 'next/headers';

/**
 * Aceite de convite.
 *
 * A validação do token acontece no servidor antes de renderizar qualquer coisa, e o convite é
 * vinculado a um e-mail: aceitar autenticado como outra pessoa é recusado com explicação, não
 * silenciosamente aceito. Sem essa checagem, encaminhar o link daria acesso a quem não foi
 * convidado.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations('invite');
  const tCommon = await getTranslations('common');

  const invitation = await findPendingInvitation(token);
  if (!invitation) {
    return (
      <Shell title={t('title')}>
        <Alert tone="error">{t('invalid')}</Alert>
        <div className="mt-4">
          <Link href="/login">
            <Button variant="secondary">{tCommon('appName')}</Button>
          </Link>
        </div>
      </Shell>
    );
  }

  const session = await auth();
  // `email` do Auth.js é string | null | undefined: um provider OAuth pode não devolver
  // e-mail. Normalizamos para null e tratamos como "não autenticado o suficiente para
  // aceitar um convite", que é vinculado a um endereço.
  const currentEmail = session?.user?.email ?? null;

  if (currentEmail === null) {
    return (
      <Shell
        title={t('title')}
        subtitle={t('subtitle', { organization: invitation.organizationName, role: invitation.role })}
      >
        <Alert tone="info">{t('signInFirst', { email: invitation.email })}</Alert>
        <div className="mt-4 flex gap-3">
          <Link href={`/signup?email=${encodeURIComponent(invitation.email)}`}>
            <Button>{tCommon('appName')}</Button>
          </Link>
          <Link href="/login">
            <Button variant="secondary">Entrar</Button>
          </Link>
        </div>
      </Shell>
    );
  }

  if (currentEmail.toLowerCase() !== invitation.email.toLowerCase()) {
    return (
      <Shell title={t('title')}>
        <Alert tone="error">
          {t('wrongAccount', { email: invitation.email, current: currentEmail })}
        </Alert>
      </Shell>
    );
  }

  const userId = session?.user?.id;
  if (userId === undefined) redirect('/login');

  const organizationId = await acceptInvitation(token, userId);
  (await cookies()).set(ACTIVE_ORG_COOKIE, organizationId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect('/');
}

function Shell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <PageHeader title={title} {...(subtitle === undefined ? {} : { subtitle })} />
      <Card>{children}</Card>
    </main>
  );
}
