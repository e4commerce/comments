import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { signUpAction } from '@/app/actions';
import { SignUpForm } from '@/components/auth-forms';
import { Card } from '@/components/ui';
import { auth } from '@/lib/auth';

export default async function SignupPage() {
  if ((await auth())?.user) redirect('/');

  const t = await getTranslations('auth');
  const tCommon = await getTranslations('common');

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <div className="mb-8">
        <p className="text-[13px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
          {tCommon('appName')}
        </p>
        <h1 className="mt-1 text-[24px] font-semibold tracking-tight">{t('signUpTitle')}</h1>
        <p className="mt-1 text-[var(--color-ink-muted)]">{t('signUpSubtitle')}</p>
      </div>

      <Card>
        <SignUpForm action={signUpAction} />
      </Card>

      <p className="mt-6 text-center text-[13px] text-[var(--color-ink-muted)]">
        {t('hasAccount')}{' '}
        <Link href="/login" className="font-semibold text-[var(--color-accent)] underline">
          {t('signIn')}
        </Link>
      </p>
    </main>
  );
}
