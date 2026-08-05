import { describe, expect, it } from 'vitest';
import { evaluateRule, parseActions, type Condition, type RuleContext } from './rules';

function context(overrides: {
  comment?: Partial<RuleContext['comment']>;
  ai?: Partial<RuleContext['ai']>;
  author?: Partial<RuleContext['author']>;
} = {}): RuleContext {
  return {
    comment: {
      source_type: 'organic_post',
      platform: 'facebook',
      like_count: 0,
      reply_count: 0,
      is_hidden: false,
      status: 'new',
      message: null,
      depth: 0,
      has_attachment: false,
      urgency_score: 0,
      minutes_since_published: 0,
      ...overrides.comment,
    },
    ai: {
      sentiment: null,
      sentiment_score: null,
      confidence: null,
      intent: null,
      urgency: null,
      is_toxic: false,
      is_spam: false,
      is_question: false,
      requires_response: false,
      contains_pii: false,
      mentions_competitor: false,
      language: null,
      topic_name: null,
      ...overrides.ai,
    },
    author: {
      comments_count: 0,
      negative_count: 0,
      is_blocked: false,
      is_verified: false,
      ...overrides.author,
    },
  };
}

/** A regra de exemplo do §9.7, literal. */
const EXAMPLE_RULE: Condition = {
  all: [
    { field: 'ai.is_toxic', op: 'eq', value: true },
    { field: 'ai.confidence', op: 'gte', value: 0.8 },
    {
      any: [
        { field: 'comment.source_type', op: 'eq', value: 'ad_comment' },
        { field: 'comment.like_count', op: 'gte', value: 5 },
      ],
    },
  ],
};

describe('regra de exemplo do §9.7', () => {
  it('dispara com tóxico, confiança alta e comentário de anúncio', () => {
    const result = evaluateRule(
      context({
        ai: { is_toxic: true, confidence: 0.9 },
        comment: { source_type: 'ad_comment' },
      }),
      EXAMPLE_RULE,
    );
    expect(result.matched).toBe(true);
    expect(result.unknownFields).toEqual([]);
  });

  it('dispara com tóxico, confiança alta e 5 curtidas', () => {
    expect(
      evaluateRule(
        context({ ai: { is_toxic: true, confidence: 0.8 }, comment: { like_count: 5 } }),
        EXAMPLE_RULE,
      ).matched,
    ).toBe(true);
  });

  it('não dispara com confiança abaixo do limiar', () => {
    expect(
      evaluateRule(
        context({ ai: { is_toxic: true, confidence: 0.79 }, comment: { like_count: 100 } }),
        EXAMPLE_RULE,
      ).matched,
    ).toBe(false);
  });

  it('não dispara quando nenhum ramo do any é satisfeito', () => {
    expect(
      evaluateRule(
        context({
          ai: { is_toxic: true, confidence: 0.95 },
          comment: { source_type: 'organic_post', like_count: 4 },
        }),
        EXAMPLE_RULE,
      ).matched,
    ).toBe(false);
  });

  it('não dispara sem análise de IA: confidence null não satisfaz gte', () => {
    // Automação avaliada antes da classificação não deve agir por falta de dado.
    expect(
      evaluateRule(
        context({ ai: { is_toxic: true, confidence: null }, comment: { like_count: 50 } }),
        EXAMPLE_RULE,
      ).matched,
    ).toBe(false);
  });
});

describe('falha fechada', () => {
  it('campo desconhecido não satisfaz, e é reportado', () => {
    const result = evaluateRule(context({ ai: { is_toxic: true } }), {
      all: [{ field: 'ai.is_toxick', op: 'eq', value: true }],
    });
    expect(result.matched).toBe(false);
    expect(result.unknownFields).toEqual(['ai.is_toxick']);
  });

  it('não permite alcançar propriedade fora da lista permitida', () => {
    for (const field of ['__proto__', 'constructor', 'comment.raw', 'comment', 'ai.__proto__']) {
      const result = evaluateRule(context(), { all: [{ field, op: 'is_not_null' }] });
      expect(result.matched).toBe(false);
      expect(result.unknownFields).toContain(field);
    }
  });

  it('grupo vazio não dispara — senão a regra agiria em TODO comentário', () => {
    expect(evaluateRule(context(), { all: [] }).matched).toBe(false);
    expect(evaluateRule(context(), { any: [] }).matched).toBe(false);
  });

  it('operador desconhecido não satisfaz', () => {
    expect(
      evaluateRule(context({ ai: { is_toxic: true } }), {
        all: [{ field: 'ai.is_toxic', op: 'aproximadamente' as never, value: true }],
      }).matched,
    ).toBe(false);
  });

  it('condição malformada não satisfaz', () => {
    expect(evaluateRule(context(), {} as Condition).matched).toBe(false);
    expect(evaluateRule(context(), null as unknown as Condition).matched).toBe(false);
  });

  it('aninhamento patológico não estoura a pilha', () => {
    let deep: Condition = { field: 'ai.is_toxic', op: 'eq', value: true };
    for (let i = 0; i < 50; i += 1) deep = { all: [deep] };
    expect(() => evaluateRule(context({ ai: { is_toxic: true } }), deep)).not.toThrow();
    expect(evaluateRule(context({ ai: { is_toxic: true } }), deep).matched).toBe(false);
  });
});

describe('operadores', () => {
  it('comparação numérica ignora tipo incompatível em vez de coagir', () => {
    // '10' > 5 seria verdadeiro com coerção, e uma regra numérica passaria a casar texto.
    expect(
      evaluateRule(context({ comment: { like_count: 10 } }), {
        all: [{ field: 'comment.like_count', op: 'gt', value: '5' }],
      }).matched,
    ).toBe(false);
  });

  it('contains ignora acento e caixa', () => {
    const ctx = context({ comment: { message: 'Que ATRASO absurdo' } });
    expect(
      evaluateRule(ctx, { all: [{ field: 'comment.message', op: 'contains', value: 'atraso' }] })
        .matched,
    ).toBe(true);
    expect(
      evaluateRule(ctx, { all: [{ field: 'comment.message', op: 'contains', value: 'atrasö' }] })
        .matched,
    ).toBe(true);
    expect(
      evaluateRule(ctx, { all: [{ field: 'comment.message', op: 'contains', value: 'elogio' }] })
        .matched,
    ).toBe(false);
  });

  it('in e not_in operam sobre lista', () => {
    const ctx = context({ ai: { intent: 'complaint' } });
    expect(
      evaluateRule(ctx, {
        all: [{ field: 'ai.intent', op: 'in', value: ['complaint', 'support_request'] }],
      }).matched,
    ).toBe(true);
    expect(
      evaluateRule(ctx, { all: [{ field: 'ai.intent', op: 'not_in', value: ['praise'] }] }).matched,
    ).toBe(true);
    // `in` sem lista não satisfaz.
    expect(
      evaluateRule(ctx, { all: [{ field: 'ai.intent', op: 'in', value: 'complaint' }] }).matched,
    ).toBe(false);
  });

  it('is_null e is_not_null distinguem ausência de análise', () => {
    expect(
      evaluateRule(context(), { all: [{ field: 'ai.sentiment', op: 'is_null' }] }).matched,
    ).toBe(true);
    expect(
      evaluateRule(context({ ai: { sentiment: 'negative' } }), {
        all: [{ field: 'ai.sentiment', op: 'is_not_null' }],
      }).matched,
    ).toBe(true);
  });
});

describe('ações permitidas na v1 (§9.7)', () => {
  it('aceita as seis ações da v1', () => {
    const { actions, rejected } = parseActions([
      { type: 'hide' },
      { type: 'add_tag', value: 'moderado_automaticamente' },
      { type: 'assign', value: 'uuid-do-usuario' },
      { type: 'set_status', value: 'resolved' },
      { type: 'set_priority', value: 'critical' },
      { type: 'notify', channel: 'in_app', target: 'managers' },
    ]);
    expect(actions).toHaveLength(6);
    expect(rejected).toEqual([]);
  });

  it('REJEITA resposta automática, que o §9.7 exclui da v1 por decisão de produto', () => {
    const { actions, rejected } = parseActions([
      { type: 'reply', value: 'Olá! Já verificamos seu pedido.' },
      { type: 'hide' },
    ]);
    expect(actions).toHaveLength(1);
    expect(rejected).toContain('reply');
  });

  it('rejeita ação malformada em vez de aceitar silenciosamente', () => {
    const { actions, rejected } = parseActions([{}, null, 'hide', { type: 42 }]);
    expect(actions).toHaveLength(0);
    expect(rejected).toHaveLength(4);
  });

  it('trata entrada não-array como lista vazia', () => {
    expect(parseActions(null).actions).toEqual([]);
    expect(parseActions({ type: 'hide' }).actions).toEqual([]);
  });
});
