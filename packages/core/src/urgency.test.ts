import { describe, expect, it } from 'vitest';
import { calculateUrgency, urgencyScoreForDb, type UrgencyInput } from './urgency';

/**
 * A fórmula do §6.8 é NORMATIVA. Estes testes a verificam termo por termo com os pesos
 * transcritos do PRD, para que uma "otimização" futura da função quebre aqui em vez de mudar
 * silenciosamente a ordenação da inbox.
 */

const base: UrgencyInput = {
  sentiment: null,
  intent: null,
  isToxic: false,
  likeCount: 0,
  replyCount: 0,
  isAdComment: false,
  minutesWaiting: 0,
  hasPageReply: false,
};

describe('peso de sentimento (0 a 30)', () => {
  it('usa os valores exatos do §6.8', () => {
    const cases = [
      ['very_negative', 30],
      ['negative', 20],
      ['neutral', 5],
      ['positive', 0],
      ['very_positive', 0],
    ] as const;
    for (const [sentiment, expected] of cases) {
      expect(calculateUrgency({ ...base, sentiment }).sentiment).toBe(expected);
    }
  });

  it('vale zero sem análise de IA, mantendo o escore utilizável antes da Fase 5', () => {
    expect(calculateUrgency({ ...base, sentiment: null }).sentiment).toBe(0);
    expect(calculateUrgency(base).total).toBe(0);
  });
});

describe('peso de intenção (0 a 20)', () => {
  it('usa os valores exatos do §6.8', () => {
    const cases = [
      ['complaint', 20],
      ['support_request', 18],
      ['question', 15],
      ['purchase_intent', 15],
      ['suggestion', 5],
      ['praise', 0],
      ['spam', 0],
    ] as const;
    for (const [intent, expected] of cases) {
      expect(calculateUrgency({ ...base, intent }).intent).toBe(expected);
    }
  });

  it('atribui zero às intenções que o §6.8 não lista, em vez de inventar peso', () => {
    for (const intent of ['troll', 'off_topic', 'other'] as const) {
      expect(calculateUrgency({ ...base, intent }).intent).toBe(0);
    }
  });
});

describe('peso de visibilidade (0 a 15)', () => {
  it('é log10(1 + curtidas + respostas) * 5', () => {
    expect(calculateUrgency({ ...base, likeCount: 0, replyCount: 0 }).visibility).toBe(0);
    // log10(10) * 5 = 5
    expect(calculateUrgency({ ...base, likeCount: 9, replyCount: 0 }).visibility).toBeCloseTo(5, 5);
    // log10(100) * 5 = 10
    expect(calculateUrgency({ ...base, likeCount: 99, replyCount: 0 }).visibility).toBeCloseTo(10, 5);
    // Soma curtidas e respostas.
    expect(calculateUrgency({ ...base, likeCount: 50, replyCount: 49 }).visibility).toBeCloseTo(10, 5);
  });

  it('satura em 15, mesmo com engajamento absurdo', () => {
    expect(calculateUrgency({ ...base, likeCount: 1_000_000, replyCount: 0 }).visibility).toBe(15);
  });

  it('ignora contagem negativa em vez de produzir NaN', () => {
    expect(calculateUrgency({ ...base, likeCount: -5, replyCount: -3 }).visibility).toBe(0);
  });
});

describe('peso de mídia paga (0 a 10)', () => {
  it('exige comentário de anúncio E anúncio ativo, como o §6.8 diz', () => {
    expect(calculateUrgency({ ...base, isAdComment: true, isAdActive: true }).paidMedia).toBe(10);
    expect(calculateUrgency({ ...base, isAdComment: true, isAdActive: false }).paidMedia).toBe(0);
    expect(calculateUrgency({ ...base, isAdComment: false, isAdActive: true }).paidMedia).toBe(0);
  });

  it('assume ativo quando o estado do anúncio é desconhecido', () => {
    // Marcar como inativo por falta de informação subestimaria urgência de comentário que
    // pode estar queimando verba agora.
    expect(calculateUrgency({ ...base, isAdComment: true }).paidMedia).toBe(10);
  });
});

describe('peso de tempo de espera (0 a 10)', () => {
  it('é minutos/60 * 2 e satura em 5 horas', () => {
    expect(calculateUrgency({ ...base, minutesWaiting: 0 }).waitTime).toBe(0);
    expect(calculateUrgency({ ...base, minutesWaiting: 60 }).waitTime).toBeCloseTo(2, 5);
    expect(calculateUrgency({ ...base, minutesWaiting: 300 }).waitTime).toBe(10);
    expect(calculateUrgency({ ...base, minutesWaiting: 10_000 }).waitTime).toBe(10);
  });

  it('cresce com o tempo — é por isso que o recálculo periódico existe', () => {
    const early = calculateUrgency({ ...base, sentiment: 'negative', minutesWaiting: 10 }).total;
    const later = calculateUrgency({ ...base, sentiment: 'negative', minutesWaiting: 240 }).total;
    expect(later).toBeGreaterThan(early);
  });
});

describe('desconto de respondido (30)', () => {
  it('subtrai 30 quando a página já respondeu na thread', () => {
    const withoutReply = calculateUrgency({ ...base, sentiment: 'very_negative' });
    const withReply = calculateUrgency({ ...base, sentiment: 'very_negative', hasPageReply: true });
    expect(withoutReply.total - withReply.total).toBe(30);
  });

  it('nunca produz escore negativo', () => {
    expect(calculateUrgency({ ...base, sentiment: 'neutral', hasPageReply: true }).total).toBe(0);
  });
});

describe('total', () => {
  it('soma máxima dos termos chega exatamente a 100', () => {
    // 30 + 20 + 15 + 15 + 10 + 10 = 100. A fórmula do §6.8 é internamente consistente.
    const max = calculateUrgency({
      sentiment: 'very_negative',
      intent: 'complaint',
      isToxic: true,
      likeCount: 100_000,
      replyCount: 0,
      isAdComment: true,
      isAdActive: true,
      minutesWaiting: 600,
      hasPageReply: false,
    });
    expect(max.total).toBe(100);
  });

  it('caso realista: reclamação negativa em anúncio ativo esperando 1 hora', () => {
    const result = calculateUrgency({
      ...base,
      sentiment: 'negative',
      intent: 'complaint',
      likeCount: 9,
      isAdComment: true,
      minutesWaiting: 60,
    });
    // 20 + 20 + 0 + 5 + 10 + 2 = 57
    expect(result.total).toBeCloseTo(57, 5);
  });

  it('elogio sem engajamento fica no fim da fila', () => {
    expect(
      calculateUrgency({ ...base, sentiment: 'very_positive', intent: 'praise' }).total,
    ).toBe(0);
  });

  it('a decomposição soma o total, para "por que está no topo?" ser respondível', () => {
    const b = calculateUrgency({
      ...base,
      sentiment: 'negative',
      intent: 'question',
      isToxic: true,
      likeCount: 20,
      minutesWaiting: 90,
    });
    const sum =
      b.sentiment + b.intent + b.toxicity + b.visibility + b.paidMedia + b.waitTime -
      b.repliedDiscount;
    expect(b.total).toBeCloseTo(sum, 10);
  });
});

describe('valor para o banco', () => {
  it('formata com duas casas, compatível com numeric(5,2)', () => {
    expect(urgencyScoreForDb(base)).toBe('0.00');
    expect(urgencyScoreForDb({ ...base, sentiment: 'negative' })).toBe('20.00');
    expect(/^\d+\.\d{2}$/.test(urgencyScoreForDb({ ...base, likeCount: 7 }))).toBe(true);
  });
});
