'use server';

/**
 * Server actions da Fase 1.
 *
 * Toda action valida entrada com Zod e verifica permissão pelo §4.3 via `requirePermission`.
 * Checar papel apenas na interface deixaria a action acessível por POST direto — server
 * actions são endpoints, mesmo sem rota visível.
 *
 * O retorno é sempre `{ error }` ou `{ ok, ... }`, nunca uma exceção propagada até a tela:
 * o §12 exige que todo erro apresente a causa em linguagem clara.
 */

import { getDb, schema } from '@pulse/db';
import { createLogger } from '@pulse/shared/logger';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { credentialsSchema, signIn, signOut } from '@/lib/auth';
import {
  createInvitation,
  inviteSchema,
  revokeInvitation as revokeInvitationRecord,
} from '@/lib/invitations';
import { createOrganization, createOrganizationSchema } from '@/lib/organizations';
import { hashPassword } from '@/lib/password';
import { ACTIVE_ORG_COOKIE, requirePermission, requireSession } from '@/lib/session';

const log = createLogger('actions');

export interface ActionResult {
  error?: string;
  ok?: boolean;
  inviteLink?: string;
  emailDelivered?: boolean;
}

const signUpSchema = credentialsSchema.extend({
  name: z.string().trim().min(2, 'Informe seu nome').max(120),
});

export async function signUpAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = signUpSchema.safeParse({
    name: form.get('name'),
    email: form.get('email'),
    password: form.get('password'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };
  }

  const email = parsed.data.email.trim().toLowerCase();

  const [existing] = await getDb()
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);
  if (existing) {
    return { error: 'Este e-mail já está cadastrado. Tente entrar.' };
  }

  await getDb().insert(schema.users).values({
    email,
    name: parsed.data.name,
    passwordHash: await hashPassword(parsed.data.password),
  });

  log.info({ email }, 'usuário cadastrado');

  // `redirectTo` leva ao onboarding: o usuário existe mas ainda não tem organização.
  await signIn('credentials', {
    email,
    password: parsed.data.password,
    redirectTo: '/onboarding',
  });
  return { ok: true };
}

export async function signInAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = credentialsSchema.safeParse({
    email: form.get('email'),
    password: form.get('password'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };
  }

  try {
    await signIn('credentials', {
      email: parsed.data.email.trim().toLowerCase(),
      password: parsed.data.password,
      redirectTo: '/',
    });
    return { ok: true };
  } catch (error) {
    // `signIn` sinaliza redirecionamento por exceção; repassar é obrigatório.
    if (isRedirectError(error)) throw error;
    return { error: 'E-mail ou senha incorretos.' };
  }
}

export async function signInWithGoogleAction(): Promise<void> {
  await signIn('google', { redirectTo: '/' });
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: '/login' });
}

export async function createOrganizationAction(
  _prev: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  const session = await requireSession().catch(() => null);
  // requireSession redireciona quando não há organização; aqui é o caso esperado, então
  // resolvemos a identidade direto.
  const { auth } = await import('@/lib/auth');
  const authSession = await auth();
  const userId = session?.userId ?? authSession?.user?.id;
  if (userId === undefined) return { error: 'Sessão expirada. Entre novamente.' };

  const parsed = createOrganizationSchema.safeParse({ name: form.get('name') });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Nome inválido.' };
  }

  try {
    const org = await createOrganization(userId, parsed.data);
    (await cookies()).set(ACTIVE_ORG_COOKIE, org.id, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    });
  } catch (error) {
    log.error({ err: error }, 'falha ao criar organização');
    return { error: 'Não foi possível criar a organização. Tente novamente.' };
  }

  redirect('/');
}

export async function inviteMemberAction(
  _prev: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  let session;
  try {
    session = await requirePermission('team:manage');
  } catch {
    return { error: 'Seu papel não permite convidar pessoas.' };
  }

  const parsed = inviteSchema.safeParse({ email: form.get('email'), role: form.get('role') });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };
  }

  try {
    const invitation = await createInvitation(
      session.organizationId,
      session.organizationName,
      session.userId,
      parsed.data,
    );
    revalidatePath('/settings/team');
    // O link volta para a interface quando o e-mail NÃO saiu, porque o §12 exige estado
    // honesto: melhor entregar o link para envio manual do que dizer "convite enviado"
    // quando não foi. A propriedade é omitida em vez de recebida como undefined por causa de
    // exactOptionalPropertyTypes.
    return {
      ok: true,
      emailDelivered: invitation.emailDelivered,
      ...(invitation.emailDelivered ? {} : { inviteLink: invitation.acceptUrl }),
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Não foi possível convidar.' };
  }
}

export async function revokeInvitationAction(form: FormData): Promise<void> {
  const session = await requirePermission('team:manage');
  const invitationId = z.string().uuid().safeParse(form.get('invitationId'));
  if (!invitationId.success) return;
  await revokeInvitationRecord(session.organizationId, invitationId.data);
  revalidatePath('/settings/team');
}

export async function switchOrganizationAction(form: FormData): Promise<void> {
  const session = await requireSession();
  const target = z.string().uuid().safeParse(form.get('organizationId'));
  if (!target.success) return;
  // Só aceita organização em que o usuário realmente tem membership: o cookie é preferência,
  // não autorização.
  if (!session.organizations.some((org) => org.id === target.data)) return;

  (await cookies()).set(ACTIVE_ORG_COOKIE, target.data, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect('/');
}

/**
 * O Next sinaliza redirecionamento lançando um erro com `digest` começando em NEXT_REDIRECT.
 * Capturá-lo por engano num `catch` genérico transforma um redirect em "erro desconhecido" na
 * tela — sintoma clássico de server action que engole o próprio fluxo de navegação.
 */
function isRedirectError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('digest' in error)) return false;
  const { digest } = error;
  return typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT');
}
