import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit usa o role DONO das tabelas, não o role de runtime: gerar e aplicar
 * DDL exige privilégio que `pulse_app` deliberadamente não tem (§4.1 do PRD).
 */
const url = process.env.DATABASE_URL_MIGRATOR ?? process.env.DATABASE_URL;
if (!url) {
  throw new Error('Defina DATABASE_URL_MIGRATOR (preferencial) ou DATABASE_URL.');
}

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
  casing: 'snake_case',
  verbose: true,
  strict: true,
});
