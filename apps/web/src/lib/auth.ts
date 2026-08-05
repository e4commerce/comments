/**
 * Auth.js (NextAuth v5) — §3.1 do PRD.
 *
 * ---------------------------------------------------------------------------
 * DESVIO AO §3.1: sessões em JWT, não em banco.
 *
 * O §3.1 pede "Sessões em banco". O provider Credentials do Auth.js é incompatível com
 * `strategy: 'database'` por desenho da própria biblioteca: ela força JWT quando há
 * Credentials, porque não há fluxo de callback onde criar a sessão persistida. Como
 * e-mail/senha é requisito explícito do mesmo §3.1, a escolha é entre os dois — e senha é
 * o requisito funcional.
 *
 * Consequências assumidas: revogar sessão de um usuário exige trocar `AUTH_SECRET` (derruba
 * todos) ou esperar a expiração. A tabela `sessions` permanece no schema para permitir a
 * migração se um dia o login por senha sair.
 * Registrado em docs/desvios-prd.md.
 * ---------------------------------------------------------------------------
 */

import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { getDb, schema } from '@pulse/db';
import { getEnv } from '@pulse/shared/env';
import { createLogger } from '@pulse/shared/logger';
import { eq } from 'drizzle-orm';
import NextAuth, { type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import { z } from 'zod';
import { verifyPassword } from './password';

const log = createLogger('auth');

export const credentialsSchema = z.object({
  email: z.string().email('E-mail inválido'),
  password: z.string().min(8, 'A senha precisa de no mínimo 8 caracteres'),
});

function buildProviders(): NextAuthConfig['providers'] {
  const env = getEnv();
  const providers: NextAuthConfig['providers'] = [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const email = parsed.data.email.trim().toLowerCase();
        const [user] = await getDb()
          .select()
          .from(schema.users)
          .where(eq(schema.users.email, email))
          .limit(1);

        // `verifyPassword` gasta tempo igual quando o usuário não existe, para o login não
        // virar oráculo de enumeração de contas.
        const ok = await verifyPassword(parsed.data.password, user?.passwordHash ?? null);
        if (!user || !ok) {
          log.warn({ email }, 'tentativa de login rejeitada');
          return null;
        }

        await getDb()
          .update(schema.users)
          .set({ lastSeenAt: new Date() })
          .where(eq(schema.users.id, user.id));

        return { id: user.id, email: user.email, name: user.name, image: user.image };
      },
    }),
  ];

  if (env.AUTH_GOOGLE_ID !== undefined && env.AUTH_GOOGLE_SECRET !== undefined) {
    providers.push(
      Google({
        clientId: env.AUTH_GOOGLE_ID,
        clientSecret: env.AUTH_GOOGLE_SECRET,
        allowDangerousEmailAccountLinking: true,
      }),
    );
  }

  return providers;
}

export const authConfig: NextAuthConfig = {
  // O adapter continua responsável por criar usuário e vincular conta do Google.
  adapter: DrizzleAdapter(getDb(), {
    usersTable: schema.users,
    accountsTable: schema.accounts,
    sessionsTable: schema.sessions,
    verificationTokensTable: schema.verificationTokens,
  }),
  providers: buildProviders(),
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: '/login', error: '/login' },
  callbacks: {
    jwt({ token, user }) {
      if (user?.id !== undefined) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.sub !== undefined) session.user.id = token.sub;
      return session;
    },
  },
  trustHost: true,
};

export const { handlers, signIn, signOut, auth } = NextAuth(authConfig);
