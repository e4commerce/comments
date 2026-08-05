/**
 * Fluxo da Fase 1 ponta a ponta, contra o banco real.
 *
 * É o critério de entrega do §16: "usuário se cadastra, cria organização e convida colegas."
 * Testar as telas com Playwright vem na Fase 8; aqui provamos a lógica que elas acionam,
 * incluindo o que não é visível: a taxonomia semeada sob RLS, o convite guardado como hash e
 * a recusa de remover o último owner.
 */

import { closeDb, getDb, pingDb, schema, withOrg } from '@pulse/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  acceptInvitation,
  createInvitation,
  findPendingInvitation,
  listPendingInvitations,
} from './invitations';
import {
  createOrganization,
  listMembers,
  listUserOrganizations,
  slugify,
  updateMemberRole,
} from './organizations';
import { hashPassword, verifyPassword } from './password';

let available = false;
const createdUserIds: string[] = [];
const createdOrgIds: string[] = [];
const stamp = Date.now().toString(36);

async function createUser(label: string): Promise<{ id: string; email: string }> {
  const email = `${label}-${stamp}@teste.pulse.local`;
  const [user] = await getDb()
    .insert(schema.users)
    .values({ email, name: label, passwordHash: await hashPassword('senha-de-teste-123') })
    .returning({ id: schema.users.id });
  if (!user) throw new Error('falha ao criar usuário');
  createdUserIds.push(user.id);
  return { id: user.id, email };
}

beforeAll(async () => {
  // Pula com aviso se o banco não responder, em vez de falhar: teste de infraestrutura não
  // deve quebrar quem está mexendo em outra parte do código.
  available = await pingDb();
  if (!available) console.warn('[onboarding.test] banco inacessível; casos com banco pulados');
}, 60_000);

afterAll(async () => {
  for (const id of createdOrgIds) {
    await getDb().delete(schema.organizations).where(eq(schema.organizations.id, id));
  }
  for (const id of createdUserIds) {
    await getDb().delete(schema.users).where(eq(schema.users.id, id));
  }
  await closeDb();
}, 60_000);

describe('slug de organização', () => {
  it('remove acento e caractere especial', () => {
    expect(slugify('Murano Joias & Cia.')).toBe('murano-joias-cia');
    expect(slugify('Ação Ímpar')).toBe('acao-impar');
  });

  it('não deixa hífen sobrando nas pontas', () => {
    expect(slugify('  -- Loja --  ')).toBe('loja');
  });
});

describe('senha', () => {
  it('verifica corretamente', async () => {
    const hash = await hashPassword('minha-senha-123');
    expect(await verifyPassword('minha-senha-123', hash)).toBe(true);
    expect(await verifyPassword('senha-errada', hash)).toBe(false);
  });

  it('recusa sem vazar que o usuário não tem senha definida', async () => {
    // Usuário criado via Google não tem hash. A função retorna false gastando tempo
    // equivalente, para o login não virar oráculo de enumeração de contas.
    expect(await verifyPassword('qualquer', null)).toBe(false);
  });
});

describe('cadastro, organização e convite', () => {
  it('cria organização, torna o criador owner e semeia a taxonomia do Apêndice A', async () => {
    if (!available) return;
    const owner = await createUser('owner');

    const org = await createOrganization(owner.id, { name: `Teste ${stamp}` });
    createdOrgIds.push(org.id);

    expect(org.slug).toContain('teste');
    // 20 motivos, conforme o Apêndice A.
    expect(org.topicsSeeded).toBe(20);

    const orgs = await listUserOrganizations(owner.id);
    expect(orgs).toHaveLength(1);
    expect(orgs[0]?.role).toBe('owner');

    // A taxonomia está sob RLS: só é visível dentro de withOrg.
    const topics = await withOrg(org.id, (tx) =>
      tx.select({ name: schema.aiTopics.name }).from(schema.aiTopics),
    );
    expect(topics).toHaveLength(20);
    expect(topics.map((t) => t.name)).toContain('atraso na entrega');

    // Fora do contexto, nada.
    const leaked = await getDb().select().from(schema.aiTopics);
    expect(leaked).toHaveLength(0);
  }, 60_000);

  it('convida, resolve o token e aceita criando o membership com o papel do convite', async () => {
    if (!available) return;
    const owner = await createUser('inviter');
    const org = await createOrganization(owner.id, { name: `Convites ${stamp}` });
    createdOrgIds.push(org.id);

    const invited = await createUser('convidado');

    const invitation = await createInvitation(org.id, org.name, owner.id, {
      email: invited.email,
      role: 'manager',
    });

    // O e-mail não sai sem Resend configurado, e o link é devolvido para envio manual.
    expect(invitation.acceptUrl).toContain('/invite/');
    const token = invitation.acceptUrl.split('/invite/')[1];
    expect(token).toBeDefined();

    // O token em claro NÃO está no banco: só o hash.
    const [row] = await getDb()
      .select({ tokenHash: schema.invitations.tokenHash })
      .from(schema.invitations)
      .where(eq(schema.invitations.id, invitation.id));
    expect(row?.tokenHash).not.toBe(token);
    expect(row?.tokenHash).toHaveLength(64);

    const pending = await findPendingInvitation(token as string);
    expect(pending?.email).toBe(invited.email);
    expect(pending?.role).toBe('manager');

    await acceptInvitation(token as string, invited.id);

    const members = await listMembers(org.id);
    expect(members).toHaveLength(2);
    expect(members.find((m) => m.email === invited.email)?.role).toBe('manager');

    // Aceito não aparece mais como pendente, e o token não resolve de novo.
    expect(await listPendingInvitations(org.id)).toHaveLength(0);
    expect(await findPendingInvitation(token as string)).toBeNull();
  }, 60_000);

  it('token inexistente não resolve', async () => {
    if (!available) return;
    expect(await findPendingInvitation('token-que-nunca-existiu')).toBeNull();
  });

  it('recusa rebaixar o último owner, que deixaria a organização inadministrável', async () => {
    if (!available) return;
    const owner = await createUser('solo-owner');
    const org = await createOrganization(owner.id, { name: `Solo ${stamp}` });
    createdOrgIds.push(org.id);

    const members = await listMembers(org.id);
    const membershipId = members[0]?.membershipId;
    expect(membershipId).toBeDefined();

    await expect(
      updateMemberRole(org.id, membershipId as string, 'agent'),
    ).rejects.toThrow(/única pessoa com papel de owner/);

    // O papel permanece intacto após a recusa.
    expect((await listMembers(org.id))[0]?.role).toBe('owner');
  }, 60_000);

  it('recusa convidar quem já é membro', async () => {
    if (!available) return;
    const owner = await createUser('dono');
    const org = await createOrganization(owner.id, { name: `Duplicado ${stamp}` });
    createdOrgIds.push(org.id);

    await expect(
      createInvitation(org.id, org.name, owner.id, { email: owner.email, role: 'agent' }),
    ).rejects.toThrow(/já faz parte/);
  }, 60_000);
});
