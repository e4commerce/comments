import { describe, expect, it } from 'vitest';
import { MEMBER_ROLES, PERMISSIONS, can, assertCan, type Permission } from './permissions';

/**
 * Este teste é a transcrição independente da tabela do §4.3. Se alguém "simplificar"
 * permissions.ts para uma hierarquia de papéis, estas asserções quebram — que é
 * exatamente o ponto: a matriz do PRD não é hierárquica.
 */
describe('matriz de permissões do §4.3', () => {
  const expected: Record<Permission, readonly string[]> = {
    'meta_accounts:manage': ['owner', 'admin'],
    'team:manage': ['owner', 'admin'],
    'ai_settings:manage': ['owner', 'admin'],
    'automation_rules:manage': ['owner', 'admin', 'manager'],
    'comments:reply': ['owner', 'admin', 'manager', 'agent'],
    'comments:hide': ['owner', 'admin', 'manager', 'agent'],
    'comments:delete': ['owner', 'admin', 'manager'],
    'comments:assign': ['owner', 'admin', 'manager'],
    'analytics:view': ['owner', 'admin', 'manager', 'agent', 'analyst'],
    'audit:view': ['owner', 'admin', 'manager'],
    'ai_analysis:reclassify': ['owner', 'admin', 'manager', 'agent', 'analyst'],
  };

  it('cobre exatamente as onze linhas da tabela, sem sobra nem falta', () => {
    expect(Object.keys(PERMISSIONS).sort()).toEqual(Object.keys(expected).sort());
  });

  for (const [permission, allowed] of Object.entries(expected) as [Permission, string[]][]) {
    it(`${permission}: concede a ${allowed.join(', ')} e nega ao resto`, () => {
      for (const role of MEMBER_ROLES) {
        expect(can(role, permission)).toBe(allowed.includes(role));
      }
    });
  }

  it('nega quando não há papel (usuário sem membership na organização)', () => {
    expect(can(null, 'analytics:view')).toBe(false);
    expect(can(undefined, 'comments:reply')).toBe(false);
  });

  it('agent pode ocultar mas não excluir — a assimetria deliberada do §4.3', () => {
    expect(can('agent', 'comments:hide')).toBe(true);
    expect(can('agent', 'comments:delete')).toBe(false);
  });

  it('analyst pode reclassificar IA mas não responder', () => {
    expect(can('analyst', 'ai_analysis:reclassify')).toBe(true);
    expect(can('analyst', 'comments:reply')).toBe(false);
  });

  it('agent não vê trilha de auditoria, apesar de ver dashboards', () => {
    expect(can('agent', 'analytics:view')).toBe(true);
    expect(can('agent', 'audit:view')).toBe(false);
  });

  it('assertCan lança ForbiddenError com o papel e a permissão na mensagem', () => {
    expect(() => assertCan('agent', 'comments:delete')).toThrowError(/agent.*comments:delete/);
    expect(() => assertCan('owner', 'comments:delete')).not.toThrow();
  });
});
