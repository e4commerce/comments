/**
 * next-intl — §11.5 do PRD: "português do Brasil como idioma padrão e inglês como segundo
 * idioma, com todas as strings externalizadas desde o início."
 *
 * Sem roteamento por locale (`/pt-BR/...`). O idioma é atributo da organização
 * (`organizations.locale`, §6.2), não da URL: um link compartilhado entre colegas da mesma
 * equipe deve abrir a mesma tela, não uma tradução diferente por prefixo.
 */

import type { AbstractIntlMessages } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';

export const LOCALES = ['pt-BR', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'pt-BR';

function isLocale(value: string | undefined): value is Locale {
  return value !== undefined && (LOCALES as readonly string[]).includes(value);
}

export default getRequestConfig(async () => {
  // Na Fase 1 o locale vem do default. A partir da Fase 4, de `organizations.locale`,
  // resolvido pelo contexto de sessão.
  const locale: Locale = isLocale(process.env.DEFAULT_LOCALE) ? process.env.DEFAULT_LOCALE : DEFAULT_LOCALE;

  const messages = (await import(`../messages/${locale}.json`)) as {
    default: AbstractIntlMessages;
  };

  return { locale, messages: messages.default, timeZone: 'America/Sao_Paulo' };
});
