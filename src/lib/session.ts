import { createHmac, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { db, type User, users } from '@/db';
import { env } from './env';

/**
 * Sessão própria e curta: o cookie contém apenas id do usuário e expiração,
 * assinados com AUTH_SECRET. O e-mail e o papel continuam no banco; assim uma
 * conta desativada perde acesso mesmo que ainda tenha um cookie válido.
 */

const COOKIE = 'mc_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function sign(value: string): string {
  return createHmac('sha256', env.authSecret).update(value).digest('base64url');
}

/** Comparação de tempo constante; `a === b` vazaria o tamanho do prefixo correto. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function createSession(userId: string): Promise<void> {
  const expiresAt = Date.now() + MAX_AGE_SECONDS * 1000;
  const payload = Buffer.from(JSON.stringify({ userId, expiresAt })).toString('base64url');
  const store = await cookies();
  store.set(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

export async function getCurrentUser(): Promise<User | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;

  const [payload, signature] = raw.split('.');
  if (!payload || !signature) return null;
  if (!safeEqual(signature, sign(payload))) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      userId?: unknown;
      expiresAt?: unknown;
    };
    if (
      typeof parsed.userId !== 'string' ||
      typeof parsed.expiresAt !== 'number' ||
      !Number.isFinite(parsed.expiresAt) ||
      parsed.expiresAt <= Date.now()
    ) {
      return null;
    }

    const user = await db.select().from(users).where(eq(users.id, parsed.userId)).get();
    return user?.isActive ? user : null;
  } catch {
    return null;
  }
}

export async function isAuthenticated(): Promise<boolean> {
  return Boolean(await getCurrentUser());
}

/**
 * Porta de entrada de toda página e server action. Redireciona em vez de lançar,
 * para que sessão expirada não apareça como tela de erro.
 */
export async function requireSession(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

export async function requireAdmin(): Promise<User> {
  const user = await requireSession();
  if (user.role !== 'admin') redirect('/');
  return user;
}
