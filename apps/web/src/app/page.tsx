import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { signOutAction } from '@/app/actions';
import { Alert, Badge, Button, Card, PageHeader } from '@/components/ui';
import { requireSession } from '@/lib/session';

export default async function HomePage() {
  const session = await requireSession();
  const t = await getTranslations('home');
  const tRoles = await getTranslations('roles');
  const tCommon = await getTranslations('common');

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <p className="text-[13px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
            {tCommon('appName')}
          </p>
          <h1 className="mt-1 text-[22px] font-semibold tracking-tight">
            {session.organizationName}
          </h1>
          <p className="mt-1 flex items-center gap-2 text-[13px] text-[var(--color-ink-muted)]">
            {session.userEmail}
            <Badge>{tRoles(session.role)}</Badge>
          </p>
        </div>
        <form action={signOutAction}>
          <Button type="submit" variant="secondary">
            {tCommon('signOut')}
          </Button>
        </form>
      </div>

      <Card className="mb-6">
        <PageHeader title={t('phaseTitle')} subtitle={t('phaseBody')} />
        <div className="flex flex-wrap gap-3">
          <Link href="/settings/team">
            <Button>{t('team')}</Button>
          </Link>
          <Link href="/api/health" target="_blank" rel="noreferrer">
            <Button variant="secondary">{t('health')}</Button>
          </Link>
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 text-[16px] font-semibold">{t('connectMeta')}</h2>
        {/* Estado vazio instrutivo, não decorativo (§12): diz o que falta e por quê. */}
        <Alert tone="info">{t('connectMetaBlocked')}</Alert>
      </Card>
    </main>
  );
}
