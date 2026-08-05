import { describe, expect, it } from 'vitest';
import {
  addBusinessMinutes,
  businessMinutesBetween,
  calculateSlaDueAt,
  isWithinBusinessHours,
  zonedParts,
  type SlaConfig,
} from './sla';

/**
 * O ponto do §7.7 é que o SLA conta apenas tempo dentro da janela de atendimento. Os casos
 * abaixo cobrem exatamente onde a implementação ingênua erraria: comentário fora do horário,
 * no fim de semana, e atravessando a virada do dia.
 *
 * Fuso America/Sao_Paulo, que desde 2019 é UTC-3 o ano inteiro (o Brasil aboliu o horário de
 * verão). Um caso com Europe/Lisbon cobre o cenário com transição.
 */

const config: SlaConfig = {
  timezone: 'America/Sao_Paulo',
  businessHours: { start: '09:00', end: '18:00', weekdays: [1, 2, 3, 4, 5] },
  targetMinutes: 120,
};

/** Helper: constrói um instante a partir da hora local de São Paulo (UTC-3). */
function sp(iso: string): Date {
  return new Date(`${iso}-03:00`);
}

describe('janela de atendimento', () => {
  it('reconhece dentro e fora do horário', () => {
    expect(isWithinBusinessHours(sp('2026-08-05T10:00'), config)).toBe(true);
    expect(isWithinBusinessHours(sp('2026-08-05T08:59'), config)).toBe(false);
    expect(isWithinBusinessHours(sp('2026-08-05T18:00'), config)).toBe(false);
    expect(isWithinBusinessHours(sp('2026-08-05T17:59'), config)).toBe(true);
  });

  it('reconhece fim de semana como fora', () => {
    // 2026-08-08 é sábado, 2026-08-09 domingo.
    expect(isWithinBusinessHours(sp('2026-08-08T10:00'), config)).toBe(false);
    expect(isWithinBusinessHours(sp('2026-08-09T10:00'), config)).toBe(false);
  });
});

describe('vencimento de SLA', () => {
  it('soma direto quando cabe no mesmo dia', () => {
    const due = calculateSlaDueAt(sp('2026-08-05T10:00'), config);
    expect(zonedParts(due, config.timezone)).toMatchObject({ hour: 12, minute: 0, day: 5 });
  });

  it('comentário fora do horário começa a contar na abertura seguinte', () => {
    // Quarta 23h → conta a partir de quinta 09h → vence quinta 11h.
    const due = calculateSlaDueAt(sp('2026-08-05T23:00'), config);
    expect(zonedParts(due, config.timezone)).toMatchObject({ day: 6, hour: 11, minute: 0 });
  });

  it('comentário antes da abertura conta da abertura do mesmo dia', () => {
    const due = calculateSlaDueAt(sp('2026-08-05T06:30'), config);
    expect(zonedParts(due, config.timezone)).toMatchObject({ day: 5, hour: 11, minute: 0 });
  });

  it('comentário de sábado vence na segunda — o caso que a soma ingênua erraria', () => {
    // Sábado 23h com alvo de 2h: somar minutos daria domingo 01h, um prazo que ninguém
    // poderia cumprir e que entraria na fila como SLA estourado.
    const due = calculateSlaDueAt(sp('2026-08-08T23:00'), config);
    expect(zonedParts(due, config.timezone)).toMatchObject({ day: 10, hour: 11, minute: 0 });
  });

  it('atravessa a virada do dia consumindo o saldo restante', () => {
    // Quarta 17h com alvo de 120 min: 60 min até as 18h, 60 min restantes na quinta a partir
    // das 09h → quinta 10h.
    const due = calculateSlaDueAt(sp('2026-08-05T17:00'), config);
    expect(zonedParts(due, config.timezone)).toMatchObject({ day: 6, hour: 10, minute: 0 });
  });

  it('atravessa vários dias quando o alvo é longo', () => {
    // Alvo de 24h úteis = 2 dias completos de 9h + 6h. Segunda 09h → quarta 15h.
    const longConfig: SlaConfig = { ...config, targetMinutes: 24 * 60 };
    const due = calculateSlaDueAt(sp('2026-08-03T09:00'), longConfig);
    expect(zonedParts(due, config.timezone)).toMatchObject({ day: 5, hour: 15, minute: 0 });
  });

  it('usa o alvo diferenciado por urgência quando configurado (§7.7)', () => {
    const withUrgency: SlaConfig = {
      ...config,
      targetByUrgency: { critical: 15, high: 60 },
    };
    expect(
      zonedParts(calculateSlaDueAt(sp('2026-08-05T10:00'), withUrgency, 'critical'), config.timezone),
    ).toMatchObject({ hour: 10, minute: 15 });
    expect(
      zonedParts(calculateSlaDueAt(sp('2026-08-05T10:00'), withUrgency, 'high'), config.timezone),
    ).toMatchObject({ hour: 11, minute: 0 });
    // Urgência sem alvo próprio cai no default.
    expect(
      zonedParts(calculateSlaDueAt(sp('2026-08-05T10:00'), withUrgency, 'low'), config.timezone),
    ).toMatchObject({ hour: 12, minute: 0 });
  });

  it('respeita janela com dias úteis customizados', () => {
    // Operação que atende de domingo a quinta, como em alguns setores.
    const custom: SlaConfig = {
      ...config,
      businessHours: { start: '09:00', end: '18:00', weekdays: [0, 1, 2, 3, 4] },
    };
    // Sexta 10h → não é dia útil → conta a partir de domingo 09h.
    const due = calculateSlaDueAt(sp('2026-08-07T10:00'), custom);
    expect(zonedParts(due, config.timezone)).toMatchObject({ day: 9, hour: 11 });
  });
});

describe('configuração degenerada', () => {
  it('recusa janela sem dia útil em vez de laçar para sempre', () => {
    const broken: SlaConfig = {
      ...config,
      businessHours: { start: '09:00', end: '18:00', weekdays: [] },
    };
    expect(() => calculateSlaDueAt(sp('2026-08-05T10:00'), broken)).toThrowError(
      /ao menos um dia útil/,
    );
  });

  it('recusa fechamento anterior à abertura', () => {
    const broken: SlaConfig = { ...config, businessHours: { start: '18:00', end: '09:00' } };
    expect(() => calculateSlaDueAt(sp('2026-08-05T10:00'), broken)).toThrowError(
      /posterior ao de abertura/,
    );
  });
});

describe('minutos úteis decorridos (base do FRT do §1.3)', () => {
  it('conta apenas tempo dentro da janela no mesmo dia', () => {
    expect(businessMinutesBetween(sp('2026-08-05T10:00'), sp('2026-08-05T11:30'), config)).toBe(90);
  });

  it('desconta o tempo fora do horário entre dois dias', () => {
    // Quarta 17h → quinta 10h: 60 min na quarta + 60 min na quinta = 120.
    expect(businessMinutesBetween(sp('2026-08-05T17:00'), sp('2026-08-06T10:00'), config)).toBe(120);
  });

  it('conta zero quando tudo aconteceu fora do horário', () => {
    expect(businessMinutesBetween(sp('2026-08-08T10:00'), sp('2026-08-09T16:00'), config)).toBe(0);
  });

  it('devolve zero quando o fim é anterior ao início', () => {
    expect(businessMinutesBetween(sp('2026-08-05T11:00'), sp('2026-08-05T10:00'), config)).toBe(0);
  });

  it('é o inverso de addBusinessMinutes', () => {
    const start = sp('2026-08-05T16:30');
    const due = addBusinessMinutes(start, 200, config);
    expect(businessMinutesBetween(start, due, config)).toBe(200);
  });
});

describe('fuso com horário de verão', () => {
  it('calcula corretamente em Europe/Lisbon atravessando a transição de outubro', () => {
    // Lisboa volta ao horário padrão no último domingo de outubro (2026-10-25).
    const lisbon: SlaConfig = {
      timezone: 'Europe/Lisbon',
      businessHours: { start: '09:00', end: '18:00' },
      targetMinutes: 120,
    };
    // Sexta 2026-10-23 17h WEST (UTC+1) → 60 min restantes na segunda 26/10 09h WET (UTC+0).
    const due = calculateSlaDueAt(new Date('2026-10-23T17:00:00+01:00'), lisbon);
    expect(zonedParts(due, 'Europe/Lisbon')).toMatchObject({ day: 26, hour: 10, minute: 0 });
  });
});
