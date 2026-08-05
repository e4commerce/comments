import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { env } from './env';

/**
 * Sessão de operador único: sem tabela de usuários, sem provider externo.
 * É um cookie assinado com AUTH_SECRET que diz apenas "esta pessoa provou saber
 * APP_PASSWORD, e a prova vale até tal data".
 *
 * Cabe aqui porque a plataforma é de uso próprio. Se um dia houver equipe, este
 * é o arquivo que muda — e nenhum outro depende do formato do cookie.
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

/**
 * Compara os digests, e não as senhas.
 *
 * `timingSafeEqual` exige buffers do mesmo tamanho, então comparar as senhas
 * cruas obrigaria a devolver `false` de imediato quando os tamanhos diferem — o
 * que vaza o tamanho da senha correta. Hashear primeiro deixa os dois lados com
 * 32 bytes sempre.
 */
export function verifyPassword(candidate: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(candidate), digest(env.appPassword));
}

export async function createSession(): Promise<void> {
  const expiresAt = Date.now() + MAX_AGE_SECONDS * 1000;
  const payload = String(expiresAt);
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

export async function isAuthenticated(): Promise<boolean> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return false;

  const [payload, signature] = raw.split('.');
  if (!payload || !signature) return false;
  if (!safeEqual(signature, sign(payload))) return false;

  const expiresAt = Number(payload);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

/**
 * Porta de entrada de toda página e server action. Redireciona em vez de lançar,
 * para que sessão expirada não apareça como tela de erro.
 */
export async function requireSession(): Promise<void> {
  if (!(await isAuthenticated())) redirect('/login');
}
