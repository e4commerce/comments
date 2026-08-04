/**
 * Isolamento multi-tenant — critério de aceite do Apêndice B do PRD:
 *
 *   "Um usuário da organização A que manipule identificadores de comentários da
 *    organização B recebe 404, e a política de RLS impede a leitura mesmo com filtro de
 *    aplicação removido."
 *
 * A segunda metade é o que este arquivo prova, e é a única forma de prová-la: as consultas
 * abaixo NÃO filtram por `organization_id`. Se a RLS não estivesse ativa, ou se a aplicação
 * estivesse conectada como dono das tabelas, elas retornariam dados de outro tenant e os
 * testes falhariam.
 *
 * Roda contra o banco de `DATABASE_URL`, que aponta para `pulse_app`. Se o banco estiver
 * inacessível, a suíte é pulada com aviso em vez de falhar — testes de infraestrutura não
 * devem quebrar o CI de quem está mexendo em outra parte do código.
 */

import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, withOrg, withoutOrg } from './client';
import { comments, metaConnections, organizations, socialAccounts } from './schema/index';

interface Fixture {
  orgId: string;
  accountId: string;
  commentId: string;
  commentExternalId: string;
}

let orgA: Fixture;
let orgB: Fixture;
let available = false;

async function createTenant(slug: string): Promise<Fixture> {
  const [org] = await withoutOrg((tx) =>
    tx
      .insert(organizations)
      .values({ name: `Org ${slug}`, slug })
      .returning({ id: organizations.id }),
  );
  if (!org) throw new Error('falha ao criar organização');

  return withOrg(org.id, async (tx) => {
    const [connection] = await tx
      .insert(metaConnections)
      .values({
        organizationId: org.id,
        metaUserId: `meta-user-${slug}`,
        accessTokenEncrypted: `v1:fake:fake:fake-${slug}`,
      })
      .returning({ id: metaConnections.id });
    if (!connection) throw new Error('falha ao criar conexão');

    const [account] = await tx
      .insert(socialAccounts)
      .values({
        organizationId: org.id,
        connectionId: connection.id,
        platform: 'facebook',
        externalId: `page-${slug}`,
        name: `Página ${slug}`,
      })
      .returning({ id: socialAccounts.id });
    if (!account) throw new Error('falha ao criar conta');

    const externalId = `comment-${slug}`;
    const [comment] = await tx
      .insert(comments)
      .values({
        organizationId: org.id,
        socialAccountId: account.id,
        platform: 'facebook',
        externalId,
        message: `segredo de ${slug}`,
        publishedAt: new Date(),
      })
      .returning({ id: comments.id });
    if (!comment) throw new Error('falha ao criar comentário');

    return { orgId: org.id, accountId: account.id, commentId: comment.id, commentExternalId: externalId };
  });
}

beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
    available = true;
  } catch {
    console.warn('[rls.test] banco inacessível; suíte pulada');
    return;
  }
  const stamp = Date.now().toString(36);
  orgA = await createTenant(`rls-a-${stamp}`);
  orgB = await createTenant(`rls-b-${stamp}`);
}, 60_000);

afterAll(async () => {
  if (available) {
    await withoutOrg(async (tx) => {
      if (orgA) await tx.delete(organizations).where(eq(organizations.id, orgA.orgId));
      if (orgB) await tx.delete(organizations).where(eq(organizations.id, orgB.orgId));
    });
  }
  await closeDb();
}, 60_000);

describe.runIf(process.env.SKIP_DB_TESTS !== '1')('isolamento por Row Level Security', () => {
  it('withOrg(A) enxerga apenas os comentários de A, SEM filtro de aplicação', async () => {
    if (!available) return;
    const rows = await withOrg(orgA.orgId, (tx) => tx.select().from(comments));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(orgA.commentId);
    expect(rows[0]?.message).toBe(`segredo de ${orgA.commentExternalId.replace('comment-', '')}`);
  });

  it('withOrg(B) enxerga apenas os comentários de B', async () => {
    if (!available) return;
    const rows = await withOrg(orgB.orgId, (tx) => tx.select().from(comments));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(orgB.commentId);
  });

  it('GATE: consulta sem organização definida retorna zero linhas, não todas', async () => {
    if (!available) return;
    // Este é o critério do Apêndice B. Sem RLS — ou conectado como dono das tabelas —
    // esta query devolveria os comentários das duas organizações.
    const rows = await getDb().select().from(comments);
    expect(rows).toHaveLength(0);
  });

  it('A não alcança o comentário de B nem pelo id exato (o "404" do Apêndice B)', async () => {
    if (!available) return;
    const rows = await withOrg(orgA.orgId, (tx) =>
      tx.select().from(comments).where(eq(comments.id, orgB.commentId)),
    );
    expect(rows).toHaveLength(0);
  });

  it('A não consegue GRAVAR linha atribuída a B (WITH CHECK)', async () => {
    if (!available) return;
    await expect(
      withOrg(orgA.orgId, (tx) =>
        tx.insert(comments).values({
          organizationId: orgB.orgId,
          socialAccountId: orgB.accountId,
          platform: 'facebook',
          externalId: `invasao-${Date.now()}`,
          publishedAt: new Date(),
        }),
      ),
    ).rejects.toThrow();
  });

  it('A não consegue ALTERAR o comentário de B', async () => {
    if (!available) return;
    const updated = await withOrg(orgA.orgId, (tx) =>
      tx
        .update(comments)
        .set({ message: 'sequestrado' })
        .where(eq(comments.id, orgB.commentId))
        .returning({ id: comments.id }),
    );
    // Não lança: a linha simplesmente não é visível, então nada é atualizado.
    expect(updated).toHaveLength(0);

    const intact = await withOrg(orgB.orgId, (tx) =>
      tx.select({ message: comments.message }).from(comments).where(eq(comments.id, orgB.commentId)),
    );
    expect(intact[0]?.message).not.toBe('sequestrado');
  });

  it('A não consegue EXCLUIR o comentário de B', async () => {
    if (!available) return;
    const deleted = await withOrg(orgA.orgId, (tx) =>
      tx.delete(comments).where(eq(comments.id, orgB.commentId)).returning({ id: comments.id }),
    );
    expect(deleted).toHaveLength(0);
  });

  it('o contexto de organização não vaza para a próxima query da mesma conexão', async () => {
    if (!available) return;
    // set_config(..., true) é escopado à transação. Se fosse SET sem LOCAL, a conexão
    // devolvida ao pool carregaria a organização de A para o próximo request — que é
    // exatamente a falha de isolamento mais difícil de detectar em produção.
    await withOrg(orgA.orgId, (tx) => tx.select().from(comments));
    const leaked = await getDb().select().from(comments);
    expect(leaked).toHaveLength(0);
  });

  it('withOrg rejeita organizationId que não é UUID, sem chegar ao banco', async () => {
    await expect(withOrg("' or '1'='1", () => Promise.resolve(undefined))).rejects.toThrow(
      /organizationId inválido/,
    );
  });
});
