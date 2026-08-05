import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getEnv } from '@pulse/shared/env';
import { signInAction, signInWithGoogleAction } from '@/app/actions';
import { SignInForm } from '@/components/auth-forms';
import { Button, Card } from '@/components/ui';
import { auth } from '@/lib/auth';

export default async function LoginPage() {
  if ((await auth())?.user) redirect('/');

  const t = await getTranslations('auth');
  const tCommon = await getTranslations('common');
  const googleEnabled = getEnv().AUTH_GOOGLE_ID !== undefined;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <div className="mb-8">
        <p className="text-[13px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
          {tCommon('appName')}
        </p>
        <h1 className="mt-1 text-[24px] font-semibold tracking-tight">{t('signInTitle')}</h1>
        <p className="mt-1 text-[var(--color-ink-muted)]">{t('signInSubtitle')}</p>
      </div>

      <Card>
        <SignInForm action={signInAction} />

        {googleEnabled && (
          <>
            <div className="my-5 flex items-center gap-3 text-[12px] text-[var(--color-ink-muted)]">
              <span className="h-px flex-1 bg-[var(--color-border-subtle)]" />
              {t('orContinueWith')}
              <span className="h-px flex-1 bg-[var(--color-border-subtle)]" />
            </div>
            <form action={signInWithGoogleAction}>
              <Button type="submit" variant="secondary" className="w-full">
                {t('google')}
              </Button>
            </form>
          </>
        )}
      </Card>

      <p className="mt-6 text-center text-[13px] text-[var(--color-ink-muted)]">
        {t('noAccount')}{' '}
        <Link href="/signup" className="font-semibold text-[var(--color-accent)] underline">
          {t('signUp')}
        </Link>
      </p>
    </main>
  );
}
