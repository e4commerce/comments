import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['{apps,packages}/*/src/**/*.{test,spec}.ts'],
    // Os testes de RLS compartilham um banco: rodar suítes em paralelo causaria
    // interferência entre transações. Paralelismo dentro de um arquivo continua.
    fileParallelism: false,
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['{apps,packages}/*/src/**/*.ts'],
      exclude: ['**/*.{test,spec}.ts', '**/drizzle/**', '**/*.d.ts'],
    },
  },
});
