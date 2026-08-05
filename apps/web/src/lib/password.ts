/**
 * Hash de senha.
 *
 * bcrypt via `bcryptjs` (JavaScript puro) e não argon2 nativo: o binário nativo é mais
 * rápido, mas adiciona uma classe de falha de build por arquitetura e libc que já custou
 * vários ciclos de deploy neste projeto. Custo de cerca de 100 ms por login não é gargalo.
 *
 * Custo 12: cerca de 250 ms em hardware de container atual. Alto o suficiente para tornar
 * força bruta caro, baixo o suficiente para não virar vetor de negação de serviço no login.
 */

import bcrypt from 'bcryptjs';

const COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

/**
 * Verifica a senha.
 *
 * `hash` pode ser nulo quando o usuário existe mas se cadastrou via Google e nunca definiu
 * senha. Nesse caso comparamos contra um hash descartável de mesmo custo, para que o tempo
 * de resposta não revele se o e-mail existe — um `return false` imediato transformaria o
 * login em oráculo de enumeração de contas.
 */
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEe.qJVFYtsPBnZBFf9BmcMHnH4z8AsEEXe';

export async function verifyPassword(plain: string, hash: string | null): Promise<boolean> {
  if (hash === null) {
    await bcrypt.compare(plain, DUMMY_HASH);
    return false;
  }
  return bcrypt.compare(plain, hash);
}
