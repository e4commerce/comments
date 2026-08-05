import { createHmac } from 'node:crypto';
import { env, requireMetaConfig } from '../env';

/**
 * Transporte único para a Graph API. Todo acesso ao Meta passa por aqui, para
 * que timeout, `appsecret_proof`, backoff de rate limit e tradução de erro
 * existam em um lugar só.
 */

export class GraphError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly subcode: number | null,
    readonly type: string | null,
    readonly traceId: string | null,
    readonly httpStatus: number,
  ) {
    super(message);
    this.name = 'GraphError';
  }

  /** Token inválido, expirado ou revogado: exige reconectar a conta. */
  get needsReauth(): boolean {
    return this.code === 190 || this.code === 102 || this.code === 463;
  }

  /** Limite de chamadas atingido: esperar, não reescrever a requisição. */
  get isRateLimit(): boolean {
    return [4, 17, 32, 613, 80001, 80002, 80003].includes(this.code) || this.httpStatus === 429;
  }

  /**
   * O objeto não existe mais, ou nunca foi visível para este token. Em
   * reconciliação não é falha: é o comentário tendo sido excluído.
   */
  get isMissing(): boolean {
    return this.code === 803 || (this.code === 100 && this.subcode === 33) || this.httpStatus === 404;
  }

  /** Falta permissão/tarefa na página. Não resolve com retry. */
  get isPermission(): boolean {
    return this.code === 200 || this.code === 10 || (this.code >= 300 && this.code <= 399);
  }
}

/**
 * Prova de que quem chama detém o app secret, e não apenas um token roubado.
 * O App Dashboard permite exigi-la; enviamos sempre, custa um HMAC.
 */
function appsecretProof(token: string, appSecret: string): string {
  return createHmac('sha256', appSecret).update(token).digest('hex');
}

export interface GraphRequest {
  /** Caminho sem versão nem barra inicial: `123/comments`. */
  path: string;
  token: string;
  method?: 'GET' | 'POST' | 'DELETE';
  params?: Record<string, string | number | boolean | undefined>;
  /** Corpo de POST. Enviado como form-urlencoded, que é o que a Graph espera. */
  body?: Record<string, string | number | boolean | undefined>;
}

const MAX_ATTEMPTS = 3;

/** Backoff explícito: rate limit do Meta é por página e recupera em segundos. */
function backoffMs(attempt: number): number {
  return [1_000, 4_000, 10_000][attempt] ?? 10_000;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function graph<T = unknown>(request: GraphRequest): Promise<T> {
  const { appSecret } = requireMetaConfig();
  const method = request.method ?? 'GET';

  const url = new URL(`https://graph.facebook.com/${env.graphVersion}/${request.path}`);
  url.searchParams.set('access_token', request.token);
  url.searchParams.set('appsecret_proof', appsecretProof(request.token, appSecret));
  for (const [key, value] of Object.entries(request.params ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  let body: URLSearchParams | undefined;
  if (request.body) {
    body = new URLSearchParams();
    for (const [key, value] of Object.entries(request.body)) {
      if (value !== undefined) body.set(key, String(value));
    }
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        method,
        body,
        headers: body ? { 'content-type': 'application/x-www-form-urlencoded' } : undefined,
        signal: AbortSignal.timeout(env.metaTimeoutMs),
        cache: 'no-store',
      });

      const text = await response.text();
      const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};

      if (!response.ok || json.error) {
        const error = (json.error ?? {}) as Record<string, unknown>;
        const graphError = new GraphError(
          String(error.message ?? `HTTP ${response.status}`),
          Number(error.code ?? 0),
          error.error_subcode === undefined ? null : Number(error.error_subcode),
          error.type ? String(error.type) : null,
          error.fbtrace_id ? String(error.fbtrace_id) : null,
          response.status,
        );

        // Só rate limit e 5xx merecem nova tentativa. Repetir um erro de
        // permissão ou de token só multiplica a chamada que já falhou.
        const retriable = graphError.isRateLimit || response.status >= 500;
        if (retriable && attempt < MAX_ATTEMPTS - 1) {
          lastError = graphError;
          await sleep(backoffMs(attempt));
          continue;
        }
        throw graphError;
      }

      return json as T;
    } catch (error) {
      if (error instanceof GraphError) throw error;
      // Timeout e falha de rede: vale repetir.
      lastError = error;
      if (attempt < MAX_ATTEMPTS - 1) {
        await sleep(backoffMs(attempt));
        continue;
      }
      const reason = error instanceof Error ? error.message : String(error);
      throw new GraphError(`Falha de rede ao chamar a Graph API: ${reason}`, 0, null, null, null, 0);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Falha desconhecida na Graph API');
}

interface Paged<T> {
  data: T[];
  paging?: { cursors?: { after?: string }; next?: string };
}

/**
 * Percorre uma coleção paginada por cursor.
 *
 * `maxPages` existe porque uma página com anos de histórico produz centenas de
 * requisições, e um backfill sem teto some sem log. Quando o teto é atingido, a
 * chamada termina normalmente — quem consome decide se continua.
 */
export async function* paginate<T>(
  request: GraphRequest & { limit?: number; maxPages?: number },
): AsyncGenerator<T, void, undefined> {
  const maxPages = request.maxPages ?? 50;
  let after: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const result = await graph<Paged<T>>({
      ...request,
      params: { ...request.params, limit: request.limit ?? 100, after },
    });

    for (const item of result.data ?? []) yield item;

    after = result.paging?.cursors?.after;
    // Sem `next` a coleção acabou; o cursor sozinho pode vir mesmo na última.
    if (!after || !result.paging?.next) return;
  }
}
