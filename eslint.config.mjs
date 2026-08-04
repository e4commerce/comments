import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/coverage/**',
      'packages/db/drizzle/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // Arquivos de configuração na raiz não pertencem a nenhum tsconfig de pacote.
          allowDefaultProject: ['*.mjs', '*.config.ts', 'vitest.setup.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      // §11.3 do PRD: nenhum segredo em log. console.log escapa da redação do Pino.
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // Regras type-aware não se aplicam aos arquivos de configuração em .mjs: eles não
    // pertencem a nenhum tsconfig, e os imports resolvem como `error typed`.
    files: ['**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // O código de servidor pode ler process.env; o de cliente não (ver teste
    // apps/web/src/__tests__/env-leak.test.ts, que é o gate real).
    files: ['**/*.config.{ts,mjs,js}', 'packages/db/src/seed/**', 'packages/db/drizzle.config.ts'],
    rules: { 'no-console': 'off' },
  },
  prettier,
);
