import { NextResponse } from 'next/server';
import { hasMetaConfig } from '@/lib/env';
import { OAUTH_STATE_COOKIE, authorizeUrl, newState } from '@/lib/meta/oauth';
import { getCurrentUser } from '@/lib/session';

/** Início do OAuth: guarda o `state` em cookie e manda o operador ao Meta. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.redirect(new URL('/login', process.env.APP_URL ?? 'http://localhost:3000'));
  }
  if (user.role !== 'admin') {
    return NextResponse.redirect(new URL('/', process.env.APP_URL ?? 'http://localhost:3000'));
  }
  if (!hasMetaConfig()) {
    return NextResponse.redirect(
      new URL('/settings?error=meta_nao_configurado', process.env.APP_URL),
    );
  }

  const state = newState();
  const response = NextResponse.redirect(authorizeUrl(state));
  // O `state` volta do Meta na query; comparar com o cookie é o que impede que
  // um terceiro conecte a conta dele à sua sessão (CSRF no callback).
  response.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  });
  return response;
}
