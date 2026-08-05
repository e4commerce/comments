/**
 * Contexto de request: usuário, organização ativa e papel — §4.1 do PRD.
 *
 * "Na camada de aplicação, um contexto de request resolve a organização ativa e todas as
 * funções de acesso a dados recebem esse identificador como primeiro parâmetro obrigatório."
 *
 * Este módulo é a única fonte da organização ativa. Nenhuma página deve ler o cookie
 * diretamente: o cookie é uma *preferência*, e a autorização vem do membership no banco.
 * Confiar no cookie sem conferir o membership seria permitir trocar de tenant editando um
 * valor no navegador.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { can, type MemberRole, type Permission } from '@pulse/shared/permissions';
import { auth } from './auth';
import { listUserOrganizations } from './organizations';

export const ACTIVE_ORG_COOKIE = 'pulse_active_org';

export interface SessionContext {
  userId: string;
  userName: string | null;
  userEmail: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: MemberRole;
  /** Todas as organizações do usuário, para o seletor de conta. */
  organizations: { id: string; name: string; slug: string; role: MemberRole }[];
}

/**
 * Resolve o contexto, ou devolve o motivo de não haver.
 *
 * `no-organization` é diferente de `unauthenticated`: o usuário autenticou mas ainda não
 * pertence a nenhuma organização, e o destino é o onboarding, não o login.
 */
export async function getSessionContext(): Promise<
  SessionContext | { reason: 'unauthenticated' | 'no-organization' }
> {
  const session = await auth();
  const userId = session?.user?.id;
  // `email` pode vir null de um provider OAuth. Sem e-mail não há como identificar a pessoa
  // em convites nem em auditoria, então tratamos como sessão inválida.
  const userEmail = session?.user?.email ?? null;
  if (userId === undefined || userEmail === null) {
    return { reason: 'unauthenticated' };
  }

  const organizations = await listUserOrganizations(userId);
  if (organizations.length === 0) return { reason: 'no-organization' };

  const preferred = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value;
  // O cookie é preferência; a lista vem do banco. Um id que não está na lista é ignorado,
  // não honrado.
  const active = organizations.find((org) => org.id === preferred) ?? organizations[0];
  if (!active) return { reason: 'no-organization' };

  return {
    userId,
    userName: session?.user?.name ?? null,
    userEmail,
    organizationId: active.id,
    organizationName: active.name,
    organizationSlug: active.slug,
    role: active.role,
    organizations,
  };
}

/** Para páginas que exigem organização. Redireciona em vez de devolver estado inválido. */
export async function requireSession(): Promise<SessionContext> {
  const context = await getSessionContext();
  if ('reason' in context) {
    redirect(context.reason === 'unauthenticated' ? '/login' : '/onboarding');
  }
  return context;
}

/**
 * Exige uma permissão do §4.3.
 *
 * Server actions e páginas sensíveis chamam isto. Verificar papel só na interface deixaria a
 * action acessível por POST direto.
 */
export async function requirePermission(permission: Permission): Promise<SessionContext> {
  const context = await requireSession();
  if (!can(context.role, permission)) {
    throw new Error(
      `Seu papel (${context.role}) não permite esta ação. Fale com um administrador.`,
    );
  }
  return context;
}
