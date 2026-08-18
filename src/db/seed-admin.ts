import { db, users } from './index';

const ADMIN_EMAIL = 'thiago@muranojoias.com.br';

await db
  .insert(users)
  .values({ email: ADMIN_EMAIL, role: 'admin', isActive: true })
  .onConflictDoUpdate({ target: users.email, set: { role: 'admin' } });

console.log(`Usuário administrador disponível: ${ADMIN_EMAIL}`);
