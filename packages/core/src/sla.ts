/**
 * SLA de primeira resposta — §7.7 do PRD.
 *
 * "O campo `sla_due_at` é calculado no momento da criação do comentário considerando apenas
 * tempo dentro da janela de atendimento."
 *
 * Essa frase é a parte difícil. Um comentário que chega sábado às 23h com alvo de 2 horas não
 * vence às 01h de domingo: vence duas horas depois da abertura de segunda. Somar minutos ao
 * timestamp seria trivial e daria uma fila cheia de SLA estourado que ninguém tinha como ter
 * cumprido — e um indicador que pune a equipe por horário comercial é um indicador que a equipe
 * aprende a ignorar.
 *
 * Todo cálculo acontece no fuso da organização (`organizations.timezone`, §6.2), não no do
 * servidor. Um contêiner em UTC calculando janela comercial de Brasília erraria em 3 horas.
 */

export interface BusinessHours {
  /** 'HH:MM' no fuso da organização. */
  start: string;
  end: string;
  /**
   * Dias úteis, 0 = domingo … 6 = sábado. Default de segunda a sexta.
   */
  weekdays?: number[];
}

export interface SlaConfig {
  timezone: string;
  businessHours: BusinessHours;
  /** Alvo de primeira resposta, em minutos de tempo útil. */
  targetMinutes: number;
  /** Alvo diferenciado por urgência (§7.7, "opcionalmente diferenciado por urgência"). */
  targetByUrgency?: Partial<Record<'low' | 'medium' | 'high' | 'critical', number>>;
}

const DEFAULT_WEEKDAYS = [1, 2, 3, 4, 5];

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = partsFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
    });
    partsFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Decompõe um instante nos campos de calendário do fuso indicado. */
export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(date);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '0';
  return {
    year: Number.parseInt(get('year'), 10),
    month: Number.parseInt(get('month'), 10),
    day: Number.parseInt(get('day'), 10),
    // '24' aparece em algumas implementações para meia-noite com hour12:false.
    hour: Number.parseInt(get('hour'), 10) % 24,
    minute: Number.parseInt(get('minute'), 10),
    weekday: WEEKDAY_INDEX[get('weekday')] ?? 0,
  };
}

/**
 * Instante UTC correspondente a uma data/hora local no fuso indicado.
 *
 * Feito por aproximação e correção: assume o valor como se fosse UTC, mede o desvio que o fuso
 * introduz e compensa. Duas iterações cobrem a transição de horário de verão, quando o desvio
 * usado para corrigir é diferente do desvio no instante corrigido.
 */
export function zonedTimeToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  for (let i = 0; i < 2; i += 1) {
    const parts = zonedParts(new Date(utc), timeZone);
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    const drift = asUtc - Date.UTC(year, month - 1, day, hour, minute);
    if (drift === 0) break;
    utc -= drift;
  }
  return new Date(utc);
}

function parseHhMm(value: string): { hour: number; minute: number } {
  const [h, m] = value.split(':');
  return {
    hour: clampInt(Number.parseInt(h ?? '0', 10), 0, 23),
    minute: clampInt(Number.parseInt(m ?? '0', 10), 0, 59),
  };
}

function clampInt(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function minutesOfDay(hour: number, minute: number): number {
  return hour * 60 + minute;
}

/**
 * Soma minutos ÚTEIS a um instante, respeitando a janela de atendimento.
 *
 * Avança dia a dia consumindo o saldo de minutos disponível em cada janela. O limite de 400
 * iterações existe para que uma configuração degenerada — janela de duração zero, ou nenhum
 * dia útil — falhe de forma explícita em vez de travar o job de SLA em laço infinito.
 */
export function addBusinessMinutes(from: Date, minutes: number, config: SlaConfig): Date {
  const weekdays = config.businessHours.weekdays ?? DEFAULT_WEEKDAYS;
  const open = parseHhMm(config.businessHours.start);
  const close = parseHhMm(config.businessHours.end);
  const openMin = minutesOfDay(open.hour, open.minute);
  const closeMin = minutesOfDay(close.hour, close.minute);

  if (weekdays.length === 0 || closeMin <= openMin) {
    throw new Error(
      'Janela de atendimento inválida: é preciso ao menos um dia útil e horário de fechamento ' +
        'posterior ao de abertura. Sem isso o SLA nunca venceria.',
    );
  }

  let remaining = Math.max(0, minutes);
  let cursor = zonedParts(from, config.timezone);

  for (let guard = 0; guard < 400; guard += 1) {
    const isBusinessDay = weekdays.includes(cursor.weekday);
    const cursorMin = minutesOfDay(cursor.hour, cursor.minute);

    if (!isBusinessDay || cursorMin >= closeMin) {
      // Fora da janela: pula para a abertura do próximo dia útil.
      const next = nextDay(cursor, config.timezone);
      cursor = { ...next, hour: open.hour, minute: open.minute };
      continue;
    }

    // Antes da abertura no mesmo dia: a contagem começa na abertura.
    const startMin = Math.max(cursorMin, openMin);
    const available = closeMin - startMin;

    if (remaining <= available) {
      const endMin = startMin + remaining;
      return zonedTimeToUtc(
        config.timezone,
        cursor.year,
        cursor.month,
        cursor.day,
        Math.floor(endMin / 60),
        endMin % 60,
      );
    }

    remaining -= available;
    const next = nextDay(cursor, config.timezone);
    cursor = { ...next, hour: open.hour, minute: open.minute };
  }

  throw new Error(
    'Não foi possível calcular o vencimento de SLA em 400 dias. Verifique a janela de ' +
      'atendimento da organização.',
  );
}

function nextDay(parts: ZonedParts, timeZone: string): ZonedParts {
  // Meio-dia evita que a soma de 24 h caia no mesmo dia por causa de transição de fuso.
  const noon = zonedTimeToUtc(timeZone, parts.year, parts.month, parts.day, 12, 0);
  return zonedParts(new Date(noon.getTime() + 24 * 60 * 60 * 1000), timeZone);
}

/** Verdadeiro se o instante cai dentro da janela de atendimento. */
export function isWithinBusinessHours(date: Date, config: SlaConfig): boolean {
  const weekdays = config.businessHours.weekdays ?? DEFAULT_WEEKDAYS;
  const parts = zonedParts(date, config.timezone);
  if (!weekdays.includes(parts.weekday)) return false;
  const open = parseHhMm(config.businessHours.start);
  const close = parseHhMm(config.businessHours.end);
  const current = minutesOfDay(parts.hour, parts.minute);
  return current >= minutesOfDay(open.hour, open.minute) && current < minutesOfDay(close.hour, close.minute);
}

/**
 * Vencimento do SLA de primeira resposta para um comentário.
 *
 * `urgency` seleciona o alvo diferenciado quando a organização configurou um.
 */
export function calculateSlaDueAt(
  publishedAt: Date,
  config: SlaConfig,
  urgency?: 'low' | 'medium' | 'high' | 'critical' | null,
): Date {
  const target =
    (urgency != null ? config.targetByUrgency?.[urgency] : undefined) ?? config.targetMinutes;
  return addBusinessMinutes(publishedAt, target, config);
}

/** Minutos úteis decorridos entre dois instantes. Base do FRT do §1.3 e do §8.6. */
export function businessMinutesBetween(from: Date, to: Date, config: SlaConfig): number {
  if (to.getTime() <= from.getTime()) return 0;

  const weekdays = config.businessHours.weekdays ?? DEFAULT_WEEKDAYS;
  const open = parseHhMm(config.businessHours.start);
  const close = parseHhMm(config.businessHours.end);
  const openMin = minutesOfDay(open.hour, open.minute);
  const closeMin = minutesOfDay(close.hour, close.minute);

  let total = 0;
  let cursor = zonedParts(from, config.timezone);
  const target = zonedParts(to, config.timezone);

  for (let guard = 0; guard < 400; guard += 1) {
    const sameDay =
      cursor.year === target.year && cursor.month === target.month && cursor.day === target.day;

    if (weekdays.includes(cursor.weekday)) {
      const start = Math.max(minutesOfDay(cursor.hour, cursor.minute), openMin);
      const end = sameDay
        ? Math.min(minutesOfDay(target.hour, target.minute), closeMin)
        : closeMin;
      if (end > start) total += end - start;
    }

    if (sameDay) return total;

    const next = nextDay(cursor, config.timezone);
    cursor = { ...next, hour: open.hour, minute: open.minute };

    // Passou do alvo sem casar o dia: intervalo maior que a guarda.
    const cursorStamp = Date.UTC(cursor.year, cursor.month - 1, cursor.day);
    const targetStamp = Date.UTC(target.year, target.month - 1, target.day);
    if (cursorStamp > targetStamp) return total;
  }

  return total;
}
