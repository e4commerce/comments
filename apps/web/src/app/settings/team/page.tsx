import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { MEMBER_ROLES, can } from '@pulse/shared/permissions';
import { inviteMemberAction, revokeInvitationAction } from '@/app/actions';
import { InviteForm } from '@/components/auth-forms';
import { Alert, Badge, Button, Card, PageHeader } from '@/components/ui';
import { listPendingInvitations } from '@/lib/invitations';
import { listMembers } from '@/lib/organizations';
import { requireSession } from '@/lib/session';

export default async function TeamPage() {
  const session = await requireSession();
  const t = await getTranslations('team');
  const tRoles = await getTranslations('roles');
  const tCommon = await getTranslations('common');
  const format = await getFormatter();

  const canManage = can(session.role, 'team:manage');
  const [members, pending] = await Promise.all([
    listMembers(session.organizationId),
    canManage ? listPendingInvitations(session.organizationId) : Promise.resolve([]),
  ]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link
        href="/"
        className="mb-4 inline-block text-[13px] text-[var(--color-ink-muted)] underline"
      >
        ← {tCommon('back')}
      </Link>

      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      {canManage ? (
        <Card className="mb-6">
          <h2 className="mb-4 text-[16px] font-semibold">{t('inviteTitle')}</h2>
          <InviteForm action={inviteMemberAction} roles={MEMBER_ROLES} />
          <dl className="mt-5 grid gap-1.5 border-t border-[var(--color-border-subtle)] pt-4 text-[12px] text-[var(--color-ink-muted)]">
            {MEMBER_ROLES.map((role) => (
              <div key={role} className="flex gap-2">
                <dt className="w-28 shrink-0 font-medium text-[var(--color-ink)]">
                  {tRoles(role)}
                </dt>
                <dd>{tRoles(`${role}Hint`)}</dd>
              </div>
            ))}
          </dl>
        </Card>
      ) : (
        <Alert tone="info">{t('noPermission')}</Alert>
      )}

      <Card className="mb-6">
        <h2 className="mb-4 text-[16px] font-semibold">
          {t('members')} <Badge>{String(members.length)}</Badge>
        </h2>
        <ul className="divide-y divide-[var(--color-border-subtle)]">
          {members.map((member) => (
            <li key={member.membershipId} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{member.name ?? member.email}</p>
                <p className="truncate text-[12px] text-[var(--color-ink-muted)]">
                  {member.email} · {t('lastSeen')}:{' '}
                  {member.lastSeenAt === null
                    ? t('never')
                    : format.dateTime(member.lastSeenAt, { dateStyle: 'short' })}
                </p>
              </div>
              <Badge>{tRoles(member.role)}</Badge>
            </li>
          ))}
        </ul>
      </Card>

      {canManage && pending.length > 0 && (
        <Card>
          <h2 className="mb-4 text-[16px] font-semibold">
            {t('pending')} <Badge>{String(pending.length)}</Badge>
          </h2>
          <ul className="divide-y divide-[var(--color-border-subtle)]">
            {pending.map((invitation) => (
              <li
                key={invitation.id}
                className="flex items-center justify-between gap-4 py-3 text-[13px]"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{invitation.email}</p>
                  <p className="text-[12px] text-[var(--color-ink-muted)]">
                    {tRoles(invitation.role)} · {t('expiresAt')}:{' '}
                    {format.dateTime(invitation.expiresAt, { dateStyle: 'short' })}
                  </p>
                </div>
                <form action={revokeInvitationAction}>
                  <input type="hidden" name="invitationId" value={invitation.id} />
                  <Button type="submit" variant="danger">
                    {t('revoke')}
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </main>
  );
}
