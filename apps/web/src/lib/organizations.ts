/**
 * Criação e resolução de organizações — §4.1 do PRD.
 */

import { getDb, schema, seedTaxonomy, setOrgContext } from '@pulse/db';
import { getEnv } from '@pulse/shared/env';
import { createLogger } from '@pulse/shared/logger';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

const log = createLogger('organizations');

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2, 'O nome precisa de no mínimo 2 caracteres').max(120),
});

/** Slug estável e legível a partir do nome, sem acento e sem caractere especial. */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export interface CreatedOrganization {
  id: string;
  name: string;
  slug: string;
  topicsSeeded: number;
}

/**
 * Cria a organização, torna o criador `owner` e semeia a taxonomia inicial.
 *
 * Tudo em UMA transação, com `setOrgContext` depois do insert da organização: a taxonomia
 * está sob RLS, então precisa do contexto definido, e o contexto precisa do id, que só
 * existe depois do insert. Fazer em duas transações deixaria uma organização sem taxonomia
 * caso a segunda falhasse — e o Apêndice A existe justamente para a descoberta de tópicos
 * não começar do zero.
 */
export async function createOrganization(
  userId: string,
  input: z.infer<typeof createOrganizationSchema>,
): Promise<CreatedOrganization> {
  const env = getEnv();
  const base = slugify(input.name) || 'organizacao';

  return getDb().transaction(async (tx) => {
    // Sufixo curto evita colisão sem expor contagem de clientes, que um `-2` sequencial faria.
    let slug = base;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const [existing] = await tx
        .select({ id: schema.organizations.id })
        .from(schema.organizations)
        .where(eq(schema.organizations.slug, slug))
        .limit(1);
      if (!existing) break;
      slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
    }

    const [org] = await tx
      .insert(schema.organizations)
      .values({
        name: input.name,
        slug,
        settings: {
          retentionMonths: env.RETENTION_MONTHS_DEFAULT,
          // Janela de atendimento do §7.7. Default conservador; editável na Fase 4.
          sla: { businessHours: { start: '09:00', end: '18:00' }, targetMinutes: 120 },
        },
        ...(env.AI_MONTHLY_BUDGET_USD === undefined
          ? {}
          : { aiBudgetUsd: env.AI_MONTHLY_BUDGET_USD.toFixed(2) }),
      })
      .returning({
        id: schema.organizations.id,
        name: schema.organizations.name,
        slug: schema.organizations.slug,
      });
    if (!org) throw new Error('falha ao criar organização');

    await tx.insert(schema.memberships).values({
      organizationId: org.id,
      userId,
      role: 'owner',
    });

    await setOrgContext(tx, org.id);
    const topicsSeeded = await seedTaxonomy(tx, org.id);

    log.info({ organization_id: org.id, user_id: userId, topicsSeeded }, 'organização criada');
    return { ...org, topicsSeeded };
  });
}

/** Organizações às quais o usuário tem acesso, com o papel dele em cada uma. */
export async function listUserOrganizations(userId: string) {
  return getDb()
    .select({
      id: schema.organizations.id,
      name: schema.organizations.name,
      slug: schema.organizations.slug,
      role: schema.memberships.role,
    })
    .from(schema.memberships)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.organizationId))
    .where(eq(schema.memberships.userId, userId));
}

/** Membros de uma organização, para a tela de equipe. */
export async function listMembers(organizationId: string) {
  return getDb()
    .select({
      membershipId: schema.memberships.id,
      userId: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      role: schema.memberships.role,
      lastSeenAt: schema.users.lastSeenAt,
      joinedAt: schema.memberships.createdAt,
    })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(eq(schema.memberships.organizationId, organizationId));
}

/**
 * Altera o papel de um membro.
 *
 * Recusa remover o último `owner`: uma organização sem owner não pode conectar contas Meta
 * nem gerenciar usuários (§4.3), ficando permanentemente inadministrável.
 */
export async function updateMemberRole(
  organizationId: string,
  membershipId: string,
  role: (typeof schema.memberRoleEnum.enumValues)[number],
): Promise<void> {
  await getDb().transaction(async (tx) => {
    const [target] = await tx
      .select({ role: schema.memberships.role })
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.id, membershipId),
          eq(schema.memberships.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!target) throw new Error('Membro não encontrado nesta organização.');

    if (target.role === 'owner' && role !== 'owner') {
      const owners = await tx
        .select({ id: schema.memberships.id })
        .from(schema.memberships)
        .where(
          and(
            eq(schema.memberships.organizationId, organizationId),
            eq(schema.memberships.role, 'owner'),
          ),
        );
      if (owners.length <= 1) {
        throw new Error(
          'Esta é a única pessoa com papel de owner. Promova outra antes de alterar este papel, ' +
            'ou a organização ficaria sem quem possa gerenciar contas e usuários.',
        );
      }
    }

    await tx
      .update(schema.memberships)
      .set({ role })
      .where(eq(schema.memberships.id, membershipId));
  });
}
