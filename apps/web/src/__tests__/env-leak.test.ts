/**
 * §3.4 do PRD: "o código deve garantir que nenhuma variável sem prefixo `NEXT_PUBLIC_` seja
 * importada em componentes de cliente."
 *
 * Este é o gate dessa exigência. O guard de runtime em `@pulse/shared/env` ajuda, mas só
 * dispara se o código executar; uma leitura de `process.env.META_APP_SECRET` num componente
 * de cliente é inlinada pelo bundler em tempo de build e vai para o JavaScript entregue ao
 * navegador — onde o guard nunca roda.
 *
 * A análise é estática sobre a árvore de arquivos: encontra todo módulo marcado com
 * 'use client', segue o que ele importa dentro do app, e falha se qualquer um desses módulos
 * tocar `process.env` fora do prefixo permitido ou importar o módulo de ambiente do servidor.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(import.meta.dirname, '..');

const ALLOWED_ENV_READS = new Set(['NODE_ENV']);
const SERVER_ONLY_MODULES = ['@pulse/shared/env', '@pulse/db', '@/lib/auth', '@/lib/session'];

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

function isClientModule(source: string): boolean {
  // A diretiva tem de ser a primeira instrução do arquivo para valer.
  return /^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/.*\n\s*)*['"]use client['"]/.test(source);
}

/** Leituras de process.env que não são NEXT_PUBLIC_ nem estão na lista permitida. */
function findForbiddenEnvReads(source: string): string[] {
  const matches = source.matchAll(/process\.env\.([A-Za-z0-9_]+)/g);
  const found: string[] = [];
  for (const match of matches) {
    const name = match[1];
    if (name === undefined) continue;
    if (name.startsWith('NEXT_PUBLIC_')) continue;
    if (ALLOWED_ENV_READS.has(name)) continue;
    found.push(name);
  }
  return found;
}

function findServerOnlyImports(source: string): string[] {
  return SERVER_ONLY_MODULES.filter((moduleName) =>
    new RegExp(`from\\s+['"]${moduleName.replace(/[/@]/g, '\\$&')}['"]`).test(source),
  );
}

/** Resolve um import relativo ou com alias `@/` para um caminho de arquivo, se existir. */
function resolveLocalImport(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) base = join(SRC, specifier.slice(2));
  else if (specifier.startsWith('.')) base = resolve(dirname(fromFile), specifier);
  else return null;

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // caminho inexistente; tenta o próximo
    }
  }
  return null;
}

function localImportsOf(file: string, source: string): string[] {
  const specifiers = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  return specifiers
    .filter((s): s is string => s !== undefined)
    .map((s) => resolveLocalImport(file, s))
    .filter((s): s is string => s !== null);
}

/** Fecho transitivo dos módulos alcançáveis a partir dos componentes de cliente. */
function collectClientGraph(): Map<string, string> {
  const files = listFiles(SRC);
  const graph = new Map<string, string>();
  const queue: string[] = [];

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    if (isClientModule(source)) {
      graph.set(file, source);
      queue.push(file);
    }
  }

  while (queue.length > 0) {
    const current = queue.pop();
    if (current === undefined) continue;
    const source = graph.get(current);
    if (source === undefined) continue;

    for (const imported of localImportsOf(current, source)) {
      if (graph.has(imported)) continue;
      const importedSource = readFileSync(imported, 'utf8');
      // Um módulo com 'use server' é fronteira: o corpo dele roda no servidor mesmo quando
      // referenciado por componente de cliente, então não faz parte do bundle do navegador.
      if (/^\s*['"]use server['"]/.test(importedSource)) continue;
      graph.set(imported, importedSource);
      queue.push(imported);
    }
  }

  return graph;
}

describe('vazamento de ambiente para o cliente (§3.4)', () => {
  const graph = collectClientGraph();

  it('encontra os componentes de cliente do projeto', () => {
    // Guarda contra o teste passar por não ter analisado nada.
    expect(graph.size).toBeGreaterThan(0);
  });

  it('nenhum módulo alcançável do cliente lê process.env sem NEXT_PUBLIC_', () => {
    const offenders: string[] = [];
    for (const [file, source] of graph) {
      const forbidden = findForbiddenEnvReads(source);
      if (forbidden.length > 0) {
        offenders.push(`${file.replace(SRC, 'src')}: ${forbidden.join(', ')}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('nenhum módulo alcançável do cliente importa módulo exclusivo de servidor', () => {
    const offenders: string[] = [];
    for (const [file, source] of graph) {
      const imports = findServerOnlyImports(source);
      if (imports.length > 0) {
        offenders.push(`${file.replace(SRC, 'src')}: ${imports.join(', ')}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('detecta violação quando ela existe (o teste sabe falhar)', () => {
    // Sem esta verificação, um erro na expressão regular faria os dois testes acima passarem
    // sempre — e um gate que não sabe reprovar não é gate.
    expect(findForbiddenEnvReads('const k = process.env.META_APP_SECRET;')).toEqual([
      'META_APP_SECRET',
    ]);
    expect(findForbiddenEnvReads('const k = process.env.NEXT_PUBLIC_URL;')).toEqual([]);
    expect(findServerOnlyImports("import { getEnv } from '@pulse/shared/env';")).toEqual([
      '@pulse/shared/env',
    ]);
    expect(isClientModule("'use client';\nexport const a = 1;")).toBe(true);
    expect(isClientModule("export const a = 1;")).toBe(false);
  });
});
