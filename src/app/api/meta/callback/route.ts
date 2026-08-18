import { type NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { accounts, db } from '@/db';
import { encrypt } from '@/lib/crypto';
import { env } from '@/lib/env';
import { OAUTH_STATE_COOKIE, discoverPages, exchangeCodeForUserToken } from '@/lib/meta/oauth';
import { getCurrentUser } from '@/lib/session';

/**
 * Retorno do OAuth. Troca o código pelos tokens de página e grava uma conta por
 * Página e uma por conta de Instagram vinculada.
 */
export async function GET(request: NextRequest) {
  const back = (params: string) => NextResponse.redirect(new URL(`/settings?${params}`, env.appUrl));

  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL('/login', env.appUrl));
  if (user.role !== 'admin') return NextResponse.redirect(new URL('/', env.appUrl));

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expectedState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;

  // O usuário pode ter clicado em "Cancelar" no diálogo do Meta.
  if (url.searchParams.get('error')) {
    return back(`error=${encodeURIComponent(url.searchParams.get('error_description') ?? 'negado')}`);
  }
  if (!code) return back('error=codigo_ausente');
  if (!state || !expectedState || state !== expectedState) return back('error=state_invalido');

  try {
    const userToken = await exchangeCodeForUserToken(code);
    const pages = await discoverPages(userToken);

    if (pages.length === 0) {
      return back('error=nenhuma_pagina_administrada');
    }

    for (const page of pages) {
      await upsertAccount({
        platform: 'facebook',
        externalId: page.id,
        name: page.name,
        username: null,
        pictureUrl: page.pictureUrl,
        accessToken: encrypt(page.accessToken),
        parentPageId: null,
        tasks: page.tasks,
      });

      if (page.instagram) {
        await upsertAccount({
          platform: 'instagram',
          externalId: page.instagram.id,
          name: page.instagram.username ?? page.name,
          username: page.instagram.username,
          pictureUrl: page.instagram.pictureUrl,
          // Conta de Instagram é operada com o token da Página que a administra.
          accessToken: encrypt(page.accessToken),
          parentPageId: page.id,
          tasks: page.tasks,
        });
      }
    }

    const response = back(`conectadas=${pages.length}`);
    response.cookies.delete(OAUTH_STATE_COOKIE);
    return response;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'erro desconhecido';
    return back(`error=${encodeURIComponent(reason)}`);
  }
}

type NewAccount = Omit<typeof accounts.$inferInsert, 'id' | 'createdAt'>;

/**
 * Reconectar não deve duplicar conta nem zerar `lastSyncedAt` — atualiza nome,
 * foto, tarefas e token, e devolve a conta a `active` se estava `needs_reauth`.
 */
async function upsertAccount(account: NewAccount): Promise<void> {
  const existing = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.externalId, account.externalId))
    .get();

  if (existing) {
    await db
      .update(accounts)
      .set({ ...account, status: 'active' })
      .where(eq(accounts.id, existing.id));
    return;
  }
  await db.insert(accounts).values(account);
}
