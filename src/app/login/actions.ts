'use server';

import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, isNull, ne } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { db, loginCodes, users } from '@/db';
import { sendLoginCode } from '@/lib/email';
import { env, hasResendConfig } from '@/lib/env';
import { createSession } from '@/lib/session';

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_WAIT_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

export interface RequestCodeResult {
  ok: boolean;
  message: string;
  email?: string;
}

export interface VerifyCodeResult {
  ok: boolean;
  message: string;
}

function normalizeEmail(value: FormDataEntryValue | null): string {
  return String(value ?? '').trim().toLowerCase();
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function hashCode(userId: string, code: string): string {
  return createHmac('sha256', env.authSecret)
    .update(`${userId}:${code}`)
    .digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function requestLoginCode(
  _previous: RequestCodeResult | null,
  formData: FormData,
): Promise<RequestCodeResult> {
  const email = normalizeEmail(formData.get('email'));
  if (!isEmail(email)) return { ok: false, message: 'Digite um e-mail válido.' };

  const user = await db
    .select()
    .from(users)
    .where(and(eq(users.email, email), eq(users.isActive, true)))
    .get();

  if (!user) {
    return { ok: false, message: 'Este e-mail não está cadastrado ou está desativado.' };
  }

  if (!hasResendConfig()) {
    return {
      ok: false,
      message: 'O envio de e-mail ainda não está configurado. Informe o administrador.',
    };
  }

  const latest = await db
    .select()
    .from(loginCodes)
    .where(eq(loginCodes.userId, user.id))
    .orderBy(desc(loginCodes.createdAt))
    .limit(1)
    .get();

  if (latest && Date.now() - latest.createdAt.getTime() < RESEND_WAIT_MS) {
    const waitSeconds = Math.ceil(
      (RESEND_WAIT_MS - (Date.now() - latest.createdAt.getTime())) / 1000,
    );
    return { ok: false, message: `Aguarde ${waitSeconds}s para pedir outro código.` };
  }

  const code = String(randomInt(100_000, 1_000_000));
  const codeId = randomUUID();
  const now = new Date();

  await db.insert(loginCodes).values({
    id: codeId,
    userId: user.id,
    codeHash: hashCode(user.id, code),
    expiresAt: new Date(now.getTime() + CODE_TTL_MS),
  });

  try {
    await sendLoginCode(user.email, code);
  } catch (error) {
    await db.delete(loginCodes).where(eq(loginCodes.id, codeId));
    console.error('Falha ao enviar código de login pelo Resend:', error);
    return { ok: false, message: 'Não foi possível enviar o código. Tente novamente.' };
  }

  // Um novo envio invalida qualquer código anterior ainda não consumido.
  await db
    .update(loginCodes)
    .set({ usedAt: now })
    .where(
      and(
        eq(loginCodes.userId, user.id),
        isNull(loginCodes.usedAt),
        ne(loginCodes.id, codeId),
      ),
    );

  return {
    ok: true,
    email: user.email,
    message: 'Código enviado. Confira sua caixa de entrada e o spam.',
  };
}

export async function verifyLoginCode(
  _previous: VerifyCodeResult | null,
  formData: FormData,
): Promise<VerifyCodeResult> {
  const email = normalizeEmail(formData.get('email'));
  const code = String(formData.get('code') ?? '').replace(/\D/g, '');

  if (!isEmail(email) || code.length !== 6) {
    return { ok: false, message: 'Digite o código de 6 dígitos.' };
  }

  const user = await db
    .select()
    .from(users)
    .where(and(eq(users.email, email), eq(users.isActive, true)))
    .get();
  if (!user) return { ok: false, message: 'Código inválido ou expirado.' };

  const loginCode = await db
    .select()
    .from(loginCodes)
    .where(and(eq(loginCodes.userId, user.id), isNull(loginCodes.usedAt)))
    .orderBy(desc(loginCodes.createdAt))
    .limit(1)
    .get();

  const now = new Date();
  if (!loginCode || loginCode.expiresAt <= now || loginCode.attempts >= MAX_ATTEMPTS) {
    if (loginCode) {
      await db.update(loginCodes).set({ usedAt: now }).where(eq(loginCodes.id, loginCode.id));
    }
    return { ok: false, message: 'Código inválido ou expirado. Solicite um novo.' };
  }

  if (!safeEqual(loginCode.codeHash, hashCode(user.id, code))) {
    const attempts = loginCode.attempts + 1;
    await db
      .update(loginCodes)
      .set({ attempts, usedAt: attempts >= MAX_ATTEMPTS ? now : null })
      .where(eq(loginCodes.id, loginCode.id));
    return {
      ok: false,
      message:
        attempts >= MAX_ATTEMPTS
          ? 'Muitas tentativas. Solicite um novo código.'
          : 'Código incorreto.',
    };
  }

  await db.update(loginCodes).set({ usedAt: now }).where(eq(loginCodes.id, loginCode.id));
  await db.update(users).set({ lastLoginAt: now }).where(eq(users.id, user.id));
  await createSession(user.id);
  redirect('/');
}
