/**
 * Matriz de papéis e permissões — §4.3 do PRD [NORMATIVO].
 *
 * A tabela abaixo é a transcrição literal do PRD. Não derive permissões por hierarquia
 * de papel: a matriz não é hierárquica. `agent` pode ocultar comentários mas não pode
 * excluí-los, e pode reclassificar análise de IA — que `manager` também pode. Qualquer
 * atalho do tipo "role >= manager" produz o resultado errado em pelo menos duas linhas.
 *
 * A restrição de exclusão é deliberada e está justificada no próprio §4.3: é irreversível
 * na plataforma de origem.
 */

export const MEMBER_ROLES = ['owner', 'admin', 'manager', 'agent', 'analyst'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const PERMISSIONS = {
  /** Conectar e remover contas Meta */
  'meta_accounts:manage': ['owner', 'admin'],
  /** Gerenciar usuários e papéis */
  'team:manage': ['owner', 'admin'],
  /** Configurar modelos de IA e orçamento */
  'ai_settings:manage': ['owner', 'admin'],
  /** Criar e editar regras de automação */
  'automation_rules:manage': ['owner', 'admin', 'manager'],
  /** Responder comentários */
  'comments:reply': ['owner', 'admin', 'manager', 'agent'],
  /** Ocultar e reexibir comentários */
  'comments:hide': ['owner', 'admin', 'manager', 'agent'],
  /** Excluir comentários — irreversível na plataforma de origem */
  'comments:delete': ['owner', 'admin', 'manager'],
  /** Atribuir comentários a outros usuários */
  'comments:assign': ['owner', 'admin', 'manager'],
  /** Ver dashboards e exportar dados */
  'analytics:view': ['owner', 'admin', 'manager', 'agent', 'analyst'],
  /** Ver trilha de auditoria */
  'audit:view': ['owner', 'admin', 'manager'],
  /** Reclassificar análise de IA */
  'ai_analysis:reclassify': ['owner', 'admin', 'manager', 'agent', 'analyst'],
} as const satisfies Record<string, readonly MemberRole[]>;

export type Permission = keyof typeof PERMISSIONS;

/**
 * Única fonte de verdade para autorização. Rotas de API e componentes de servidor
 * devem chamar isto; nunca comparar strings de papel no call site.
 */
export function can(role: MemberRole | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly MemberRole[]).includes(role);
}

/** Lança em vez de retornar falso. Para uso em route handlers e server actions. */
export class ForbiddenError extends Error {
  readonly code = 'FORBIDDEN';
  constructor(permission: Permission, role: MemberRole | null | undefined) {
    super(`O papel ${role ?? '(nenhum)'} não tem a permissão ${permission}.`);
    this.name = 'ForbiddenError';
  }
}

export function assertCan(role: MemberRole | null | undefined, permission: Permission): void {
  if (!can(role, permission)) throw new ForbiddenError(permission, role);
}
