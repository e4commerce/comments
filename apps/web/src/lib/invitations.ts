/**
 * Convites de usuário — §6.2 do PRD.
 *
 * O token nunca é armazenado: guardamos apenas o SHA-256 dele, em `invitations.token_hash`.
 * Um dump do banco não permite aceitar convite de ninguém. O token em claro existe uma única
 * vez, no link enviado por e-mail.
 */

import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { getDb, schema } from '@pulse/db';
import { getEnv } from '@pulse/shared/env';
import { getEmailSender } from '@pulse/shared/email';
import { createLogger } from '@pulse/shared/logger';
import { MEMBER_ROLES } from '@pulse/shared/permissions';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

const log = createLogger('invitations');

const EXPIRY_DAYS = 7;

export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email('E-mail inválido'),
  role: z.enum(MEMBER_ROLES),
});

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface CreatedInvitation {
  id: string;
  email: string;
  acceptUrl: string;
  emailDelivered: boolean;
  expiresAt: Date;
}

export async function createInvitation(
  organizationId: string,
  organizationName: string,
  invitedBy: string,
  input: z.infer<typeof inviteSchema>,
): Promise<CreatedInvitation> {
  const env = getEnv();

  const existingMember = await getDb()
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(
      and(
        eq(schema.memberships.organizationId, organizationId),
        eq(schema.users.email, input.email),
      ),
    )
    .limit(1);
  if (existingMember.length > 0) {
    throw new Error('Esta pessoa já faz parte da organização.');
  }

  // 32 bytes em base64url: sem caractere que quebre em URL ou em cliente de e-mail.
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  const [invitation] = await getDb()
    .insert(schema.invitations)
    .values({
      organizationId,
      email: input.email,
      role: input.role,
      tokenHash: hashToken(token),
      invitedBy,
      expiresAt,
    })
    .returning({ id: schema.invitations.id });
  if (!invitation) throw new Error('falha ao criar convite');

  const acceptUrl = `${env.APP_URL.replace(/\/$/, '')}/invite/${token}`;

  const result = await getEmailSender().send({
    to: input.email,
    subject: `Convite para ${organizationName} no Pulse`,
    html: renderInviteEmail(organizationName, input.role, acceptUrl, EXPIRY_DAYS),
    text:
      `Você foi convidado para ${organizationName} no Pulse com o papel de ${input.role}.\n\n` +
      `Aceite em: ${acceptUrl}\n\nO convite expira em ${String(EXPIRY_DAYS)} dias.`,
  });

  log.info(
    { organization_id: organizationId, invitationId: invitation.id, delivered: result.delivered },
    'convite criado',
  );

  return {
    id: invitation.id,
    email: input.email,
    acceptUrl,
    emailDelivered: result.delivered,
    expiresAt,
  };
}

export interface PendingInvitation {
  organizationId: string;
  organizationName: string;
  email: string;
  role: (typeof MEMBER_ROLES)[number];
}

/**
 * Resolve um token de convite, se válido.
 *
 * A comparação do hash usa tempo constante. O ganho é pequeno aqui — o hash já vem de uma
 * busca indexada — mas o custo também é, e o hábito evita a versão perigosa desse mesmo
 * padrão aparecer na validação de assinatura de webhook na Fase 2.
 */
export async function findPendingInvitation(token: string): Promise<PendingInvitation | null> {
  const candidate = hashToken(token);

  const [row] = await getDb()
    .select({
      tokenHash: schema.invitations.tokenHash,
      organizationId: schema.invitations.organizationId,
      organizationName: schema.organizations.name,
      email: schema.invitations.email,
      role: schema.invitations.role,
      expiresAt: schema.invitations.expiresAt,
    })
    .from(schema.invitations)
    .innerJoin(
      schema.organizations,
      eq(schema.organizations.id, schema.invitations.organizationId),
    )
    .where(
      and(eq(schema.invitations.tokenHash, candidate), isNull(schema.invitations.acceptedAt)),
    )
    .limit(1);

  if (!row) return null;

  const a = Buffer.from(row.tokenHash);
  const b = Buffer.from(candidate);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;

  return {
    organizationId: row.organizationId,
    organizationName: row.organizationName,
    email: row.email,
    role: row.role,
  };
}

/**
 * Aceita o convite, criando o membership.
 *
 * Atômico e idempotente: `acceptedAt` só é gravado se ainda for nulo, e o membership usa
 * `onConflictDoNothing` sobre (organization_id, user_id). Dois cliques no mesmo link não
 * geram dois memberships nem erro na cara do usuário.
 */
export async function acceptInvitation(token: string, userId: string): Promise<string> {
  const candidate = hashToken(token);

  return getDb().transaction(async (tx) => {
    const [invitation] = await tx
      .select()
      .from(schema.invitations)
      .where(
        and(eq(schema.invitations.tokenHash, candidate), isNull(schema.invitations.acceptedAt)),
      )
      .limit(1);

    if (!invitation) throw new Error('Convite inválido ou já utilizado.');
    if (invitation.expiresAt.getTime() < Date.now()) {
      throw new Error('Este convite expirou. Peça um novo ao administrador.');
    }

    await tx
      .insert(schema.memberships)
      .values({
        organizationId: invitation.organizationId,
        userId,
        role: invitation.role,
      })
      .onConflictDoNothing({
        target: [schema.memberships.organizationId, schema.memberships.userId],
      });

    await tx
      .update(schema.invitations)
      .set({ acceptedAt: new Date() })
      .where(eq(schema.invitations.id, invitation.id));

    log.info(
      { organization_id: invitation.organizationId, user_id: userId },
      'convite aceito',
    );
    return invitation.organizationId;
  });
}

export async function listPendingInvitations(organizationId: string) {
  return getDb()
    .select({
      id: schema.invitations.id,
      email: schema.invitations.email,
      role: schema.invitations.role,
      expiresAt: schema.invitations.expiresAt,
      createdAt: schema.invitations.createdAt,
    })
    .from(schema.invitations)
    .where(
      and(
        eq(schema.invitations.organizationId, organizationId),
        isNull(schema.invitations.acceptedAt),
      ),
    );
}

export async function revokeInvitation(organizationId: string, invitationId: string): Promise<void> {
  await getDb()
    .delete(schema.invitations)
    .where(
      and(
        eq(schema.invitations.id, invitationId),
        eq(schema.invitations.organizationId, organizationId),
      ),
    );
}

function renderInviteEmail(
  organizationName: string,
  role: string,
  acceptUrl: string,
  expiryDays: number,
): string {
  // HTML com estilo inline: clientes de e-mail descartam <style> em <head>.
  return `<!doctype html>
<html lang="pt-BR"><body style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:32px">
    <h1 style="margin:0 0 16px;font-size:20px">Convite para ${escapeHtml(organizationName)}</h1>
    <p style="margin:0 0 8px;line-height:1.6">
      Você foi convidado para gerenciar comentários de Facebook e Instagram no Pulse,
      com o papel de <strong>${escapeHtml(role)}</strong>.
    </p>
    <p style="margin:24px 0">
      <a href="${acceptUrl}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Aceitar convite</a>
    </p>
    <p style="margin:0;color:#64748b;font-size:13px;line-height:1.6">
      O convite expira em ${String(expiryDays)} dias. Se você não esperava este e-mail, ignore-o.
    </p>
  </div>
</body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
