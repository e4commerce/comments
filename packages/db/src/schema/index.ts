/**
 * Schema completo — §6 do PRD.
 *
 * A ordem dos re-exports é a ordem de dependência entre módulos, o que mantém a
 * inicialização determinística: enums → organizações → conexões Meta → conteúdo →
 * ações → IA → operacional.
 */

export * from './enums';
export * from './organizations';
export * from './meta';
export * from './content';
export * from './actions';
export * from './ai';
export * from './ops';
