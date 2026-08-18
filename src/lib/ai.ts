import { and, eq, isNull, isNotNull, ne, sql } from 'drizzle-orm';
import { comments, db } from '@/db';
import { excludeCommentFilterRules } from './comment-filters';
import { env, requireOpenRouterKey } from './env';
import { listCommentFilters } from './queries';
import { INTENTS, MOTIVE_IDS, MOTIVES, SENTIMENTS, URGENCIES } from './taxonomy';

/**
 * Análise de comentários via OpenRouter: sentimento, motivo, intenção e
 * urgência.
 *
 * Em lote, e não um comentário por chamada, por duas razões: custo (o overhead
 * do prompt de sistema é pago uma vez por lote em vez de por comentário) e
 * tempo de parede — analisar mil comentários um a um levaria mais tempo que a
 * sincronização inteira.
 */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/** Versão do prompt. Mudar o prompt sem mudar isto torna resultados incomparáveis. */
const PROMPT_VERSION = 'v1';

function systemPrompt(): string {
  const motiveList = MOTIVES.map((m) => `- ${m.id}: ${m.label}`).join('\n');

  return `Você classifica comentários de redes sociais (Facebook e Instagram) de uma marca brasileira.

Para CADA comentário recebido, retorne:
- sentiment: "positive", "neutral" ou "negative" — o sentimento em relação à MARCA ou ao PRODUTO, não o humor geral do texto.
- motive: o motivo principal, escolhido EXATAMENTE de um dos ids abaixo:
${motiveList}
- intent: "question", "complaint", "praise", "purchase_intent" ou "other".
- urgency: "high" se exige resposta rápida (cliente irritado, problema com pedido pago, acusação pública, risco à reputação); "medium" se é pergunta comercial ou dúvida que trava uma compra; "low" para elogio, emoji solto, marcação de amigo.
- is_question: true se o comentário espera uma resposta.
- is_spam: true para divulgação de terceiros, golpe, link suspeito, texto repetido sem relação.
- confidence: 0.0 a 1.0, sua confiança na classificação.

Regras:
- Comentário só com emoji, "😍", "❤️" ou marcação de perfil: sentiment "positive" se o emoji for positivo, motive "elogio", intent "praise", urgency "low".
- Português informal, erros de digitação e gírias são normais. Não penalize.
- Ironia e sarcasmo negativo contam como "negative", mesmo com palavra positiva.
- Nunca invente um motive fora da lista. Sem encaixe claro, use "outro".
- Responda SEMPRE com todos os comentários recebidos, na mesma ordem, usando o "id" que veio na entrada.`;
}

/** Schema forçado na resposta: o modelo não tem como devolver prosa. */
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          sentiment: { type: 'string', enum: [...SENTIMENTS] },
          motive: { type: 'string', enum: [...MOTIVE_IDS] },
          intent: { type: 'string', enum: [...INTENTS] },
          urgency: { type: 'string', enum: [...URGENCIES] },
          is_question: { type: 'boolean' },
          is_spam: { type: 'boolean' },
          confidence: { type: 'number' },
        },
        required: [
          'id',
          'sentiment',
          'motive',
          'intent',
          'urgency',
          'is_question',
          'is_spam',
          'confidence',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['results'],
  additionalProperties: false,
} as const;

interface Classification {
  id: number;
  sentiment: string;
  motive: string;
  intent: string;
  urgency: string;
  is_question: boolean;
  is_spam: boolean;
  confidence: number;
}

/** Um lote de comentários → classificações. */
async function classifyBatch(
  batch: { id: number; text: string }[],
): Promise<Map<number, Classification>> {
  const apiKey = requireOpenRouterKey();

  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      // O OpenRouter usa estes dois para atribuir o uso no seu dashboard.
      'http-referer': env.appUrl,
      'x-title': env.openRouterTitle,
    },
    body: JSON.stringify({
      model: env.openRouterModel,
      // Classificação quer reprodutibilidade, não criatividade.
      temperature: 0,
      messages: [
        { role: 'system', content: systemPrompt() },
        { role: 'user', content: JSON.stringify({ comments: batch }) },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'classifications', strict: true, schema: RESPONSE_SCHEMA },
      },
    }),
    // Lote de 25 com modelo lento chega perto de um minuto.
    signal: AbortSignal.timeout(120_000),
    cache: 'no-store',
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`OpenRouter respondeu ${response.status}: ${text.slice(0, 300)}`);
  }

  const payload = JSON.parse(text) as {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
  };
  if (payload.error) throw new Error(`OpenRouter: ${payload.error.message}`);

  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenRouter devolveu resposta sem conteúdo.');

  // Mesmo com json_schema, alguns modelos embrulham a resposta em ```json.
  const cleaned = content.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  const parsed = JSON.parse(cleaned) as { results?: Classification[] };

  return new Map((parsed.results ?? []).map((result) => [result.id, result]));
}

export interface AnalyzeResult {
  analyzed: number;
  skipped: number;
  errors: string[];
}

/**
 * Analisa os comentários pendentes.
 *
 * `limit` existe para que a primeira análise depois de um backfill de 90 dias
 * não seja uma chamada única de milhares de comentários — a interface analisa em
 * blocos e mostra o progresso.
 */
export async function analyzePending(limit = 200): Promise<AnalyzeResult> {
  const result: AnalyzeResult = { analyzed: 0, skipped: 0, errors: [] };
  const commentFilterRules = await listCommentFilters();

  const pending = await db
    .select({ id: comments.id, message: comments.message })
    .from(comments)
    .where(
      and(
        isNull(comments.analyzedAt),
        // Nossas próprias respostas não são para classificar.
        eq(comments.isOwn, false),
        eq(comments.deletedOnPlatform, false),
        isNotNull(comments.message),
        ne(comments.message, ''),
        ...excludeCommentFilterRules(comments.message, commentFilterRules),
      ),
    )
    .orderBy(sql`${comments.publishedAt} desc`)
    .limit(limit)
    .all();

  if (pending.length === 0) return result;

  const size = env.aiBatchSize;
  for (let offset = 0; offset < pending.length; offset += size) {
    const slice = pending.slice(offset, offset + size);

    // Índice local como id: manda o mínimo ao modelo e não expõe id interno.
    const batch = slice.map((comment, index) => ({
      id: index,
      // Comentário muito longo é raro e só encarece o lote.
      text: (comment.message ?? '').slice(0, 1_000),
    }));

    try {
      const classifications = await classifyBatch(batch);

      for (const [index, comment] of slice.entries()) {
        const classification = classifications.get(index);
        if (!classification) {
          // Fica pendente e entra no próximo bloco, em vez de ser marcado como
          // analisado sem resultado.
          result.skipped++;
          continue;
        }

        await db
          .update(comments)
          .set({
            sentiment: classification.sentiment,
            motive: classification.motive,
            intent: classification.intent,
            urgency: classification.urgency,
            isQuestion: classification.is_question,
            isSpam: classification.is_spam,
            // Inteiro 0..100: SQLite não tem numeric com escala, e a precisão
            // de duas casas não serve para nada aqui.
            aiConfidence: Math.round((classification.confidence ?? 0) * 100),
            aiModel: `${env.openRouterModel}@${PROMPT_VERSION}`,
            analyzedAt: new Date(),
          })
          .where(eq(comments.id, comment.id));
        result.analyzed++;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(message);
      result.skipped += slice.length;
      // Erro de chave ou de crédito repete em todo lote seguinte; parar aqui
      // evita queimar a janela de rate limit para nada.
      if (/401|403|credit|insufficient/i.test(message)) break;
    }
  }

  return result;
}

/** Quantos comentários seguem sem análise. Alimenta o aviso na interface. */
export async function countPendingAnalysis(): Promise<number> {
  const commentFilterRules = await listCommentFilters();
  const row = await db
    .select({ count: sql<number>`count(*)` })
    .from(comments)
    .where(
      and(
        isNull(comments.analyzedAt),
        eq(comments.isOwn, false),
        eq(comments.deletedOnPlatform, false),
        isNotNull(comments.message),
        ne(comments.message, ''),
        ...excludeCommentFilterRules(comments.message, commentFilterRules),
      ),
    )
    .get();
  return row?.count ?? 0;
}

/**
 * Resumo executivo em texto livre sobre os motivos do período.
 *
 * Separado da classificação porque roda sobre o agregado, não sobre comentários
 * individuais: é uma chamada por vez que o operador pede, não por comentário.
 */
export async function summarizeMotives(
  rows: { motive: string; count: number; negative: number }[],
): Promise<string> {
  if (rows.length === 0) return 'Sem comentários analisados no período.';

  const apiKey = requireOpenRouterKey();
  const table = rows
    .map((row) => `${row.motive}: ${row.count} comentários, ${row.negative} negativos`)
    .join('\n');

  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      'http-referer': env.appUrl,
      'x-title': env.openRouterTitle,
    },
    body: JSON.stringify({
      model: env.openRouterModel,
      temperature: 0.3,
      messages: [
        {
          role: 'system',
          content:
            'Você analisa dados de comentários de uma marca. Escreva no máximo 5 frases, em português do Brasil, ' +
            'apontando o que merece ação. Seja concreto e não repita os números como lista — interprete. ' +
            'Se algo parecer um problema operacional (entrega, pedido, qualidade), diga explicitamente.',
        },
        { role: 'user', content: `Motivos do período:\n${table}` },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`OpenRouter respondeu ${response.status}`);
  }
  const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  return payload.choices?.[0]?.message?.content?.trim() ?? 'Não foi possível gerar o resumo.';
}
