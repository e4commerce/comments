import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { createOrganizationAction } from '@/app/actions';
import { CreateOrganizationForm } from '@/components/auth-forms';
import { Card, PageHeader } from '@/components/ui';
import { auth } from '@/lib/auth';
import { listUserOrganizations } from '@/lib/organizations';

export default async function OnboardingPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (userId === undefined) redirect('/login');

  // Quem já tem organização não deveria estar aqui.
  if ((await listUserOrganizations(userId)).length > 0) redirect('/');

  const t = await getTranslations('onboarding');

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6 py-12">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <Card>
        <CreateOrganizationForm action={createOrganizationAction} />
      </Card>
    </main>
  );
}
