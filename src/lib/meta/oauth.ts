import { randomBytes } from 'node:crypto';
import { env, requireMetaConfig } from '../env';
import { GraphError, graph } from './client';

/**
 * OAuth do Meta, do botão "Conectar" até os Page Access Tokens.
 *
 * O caminho é: código → token de usuário curto → token de usuário longo →
 * tokens de página. O passo do token longo não é opcional: tokens de página
 * derivados de um token curto expiram em ~1 hora, e a sincronização quebraria
 * no dia seguinte sem explicação.
 */

/**
 * Escopos mínimos para ler e moderar comentários.
 *
 * `pages_read_user_content` é o que permite ver comentários de terceiros;
 * `pages_manage_engagement` é o que permite responder, curtir, ocultar e
 * excluir. `instagram_manage_comments` é obrigatório para que o `username` de
 * quem comentou seja retornado — sem ele a interface exibiria comentários
 * anônimos.
 */
export const SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_read_user_content',
  'pages_manage_engagement',
  'instagram_basic',
  'instagram_manage_comments',
  'business_management',
] as const;

export const OAUTH_STATE_COOKIE = 'mc_oauth_state';

export function redirectUri(): string {
  return `${env.appUrl}/api/meta/callback`;
}

export function newState(): string {
  return randomBytes(16).toString('base64url');
}

export function authorizeUrl(state: string): string {
  const { appId } = requireMetaConfig();
  const url = new URL(`https://www.facebook.com/${env.graphVersion}/dialog/oauth`);
  url.searchParams.set('client_id', appId);
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('state', state);
  url.searchParams.set('scope', SCOPES.join(','));
  url.searchParams.set('response_type', 'code');
  return url.toString();
}

/**
 * As chamadas de `/oauth/access_token` são as únicas sem token prévio, logo sem
 * `appsecret_proof` — não passam pelo `graph()`.
 */
async function oauthFetch<T>(params: Record<string, string>): Promise<T> {
  const url = new URL(`https://graph.facebook.com/${env.graphVersion}/oauth/access_token`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const response = await fetch(url, {
    signal: AbortSignal.timeout(env.metaTimeoutMs),
    cache: 'no-store',
  });
  const json = (await response.json()) as Record<string, unknown>;

  if (!response.ok || json.error) {
    const error = (json.error ?? {}) as Record<string, unknown>;
    throw new GraphError(
      String(error.message ?? `HTTP ${response.status}`),
      Number(error.code ?? 0),
      error.error_subcode === undefined ? null : Number(error.error_subcode),
      error.type ? String(error.type) : null,
      error.fbtrace_id ? String(error.fbtrace_id) : null,
      response.status,
    );
  }
  return json as T;
}

/** Código do callback → token de usuário de longa duração (~60 dias). */
export async function exchangeCodeForUserToken(code: string): Promise<string> {
  const { appId, appSecret } = requireMetaConfig();

  const short = await oauthFetch<{ access_token: string }>({
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: redirectUri(),
    code,
  });

  const long = await oauthFetch<{ access_token: string }>({
    grant_type: 'fb_exchange_token',
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: short.access_token,
  });

  return long.access_token;
}

export interface DiscoveredPage {
  id: string;
  name: string;
  accessToken: string;
  /** Tarefas concedidas. Sem `MODERATE` não há moderação de comentários. */
  tasks: string[];
  pictureUrl: string | null;
  instagram: { id: string; username: string | null; pictureUrl: string | null } | null;
}

/**
 * Páginas administradas pelo usuário, já com o token de cada uma e a conta de
 * Instagram vinculada quando existe.
 *
 * O Instagram não emite token próprio: uma conta profissional é operada com o
 * token da Página que a administra. É por isso que `accounts.parentPageId`
 * existe.
 */
export async function discoverPages(userToken: string): Promise<DiscoveredPage[]> {
  interface RawPage {
    id: string;
    name: string;
    access_token: string;
    tasks?: string[];
    picture?: { data?: { url?: string } };
    instagram_business_account?: {
      id: string;
      username?: string;
      profile_picture_url?: string;
    };
  }

  const result = await graph<{ data: RawPage[] }>({
    path: 'me/accounts',
    token: userToken,
    params: {
      fields:
        'id,name,access_token,tasks,picture{url},instagram_business_account{id,username,profile_picture_url}',
      limit: 100,
    },
  });

  return (result.data ?? []).map((page) => ({
    id: page.id,
    name: page.name,
    accessToken: page.access_token,
    tasks: page.tasks ?? [],
    pictureUrl: page.picture?.data?.url ?? null,
    instagram: page.instagram_business_account
      ? {
          id: page.instagram_business_account.id,
          username: page.instagram_business_account.username ?? null,
          pictureUrl: page.instagram_business_account.profile_picture_url ?? null,
        }
      : null,
  }));
}
