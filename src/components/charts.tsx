'use client';

import { useState } from 'react';
import { formatDay, formatNumber, formatPercent } from '@/lib/format';
import { motiveLabel } from '@/lib/taxonomy';

/**
 * Gráficos em SVG puro, sem biblioteca.
 *
 * As três formas aqui seguem o trabalho que cada dado tem: volume ao longo do
 * tempo é coluna empilhada; participação de uma escala ordenada (sentimento) é
 * barra divergente centrada no neutro; magnitude por categoria de nome longo é
 * barra horizontal, uma matiz só.
 *
 * As cores do sentimento vêm dos tokens `positive/neutral/negative`, os mesmos
 * das etiquetas do inbox — o gráfico e a lista precisam contar a mesma história
 * na mesma cor.
 */

const SENTIMENT_SERIES = [
  { key: 'positive' as const, label: 'Positivo', color: 'var(--color-positive)' },
  { key: 'neutral' as const, label: 'Neutro', color: 'var(--color-neutral)' },
  { key: 'negative' as const, label: 'Negativo', color: 'var(--color-negative)' },
];

/** Caminho de retângulo com a ponta arredondada em 4px e a base quadrada. */
function cappedBar(x: number, y: number, width: number, height: number, radius = 4): string {
  const r = Math.min(radius, height, width / 2);
  if (height <= 0) return '';
  return [
    `M ${x} ${y + height}`,
    `L ${x} ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y}`,
    `L ${x + width - r} ${y}`,
    `Q ${x + width} ${y} ${x + width} ${y + r}`,
    `L ${x + width} ${y + height}`,
    'Z',
  ].join(' ');
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5 text-xs text-ink-muted">
          <span
            aria-hidden
            className="inline-block size-2.5 rounded-sm"
            style={{ background: item.color }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

// --- Volumetria diária -------------------------------------------------------

export interface DailyPoint {
  day: string;
  total: number;
  positive: number;
  neutral: number;
  negative: number;
}

export function DailyVolumeChart({ data }: { data: DailyPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  const width = 900;
  const height = 220;
  const padding = { top: 16, right: 8, bottom: 26, left: 40 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const max = Math.max(1, ...data.map((point) => point.total));
  // Teto em número redondo: o eixo carrega os valores que não foram rotulados.
  const ceiling = niceCeiling(max);
  const band = plotWidth / Math.max(1, data.length);
  const barWidth = Math.min(24, Math.max(2, band - 2));

  const y = (value: number) => padding.top + plotHeight - (value / ceiling) * plotHeight;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Legend items={SENTIMENT_SERIES} />
        <button
          type="button"
          onClick={() => setShowTable((open) => !open)}
          className="text-xs text-ink-muted underline hover:text-ink"
        >
          {showTable ? 'Ocultar tabela' : 'Ver tabela'}
        </button>
      </div>

      <div className="relative overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-[220px] w-full min-w-[520px]"
          role="img"
          aria-label="Comentários por dia, divididos por sentimento"
        >
          {/* Grade: hairline sólida, recuada. */}
          {[0, 0.5, 1].map((fraction) => {
            const value = ceiling * fraction;
            return (
              <g key={fraction}>
                <line
                  x1={padding.left}
                  x2={width - padding.right}
                  y1={y(value)}
                  y2={y(value)}
                  stroke="var(--color-line)"
                  strokeWidth={1}
                />
                <text
                  x={padding.left - 8}
                  y={y(value) + 4}
                  textAnchor="end"
                  className="fill-[var(--color-ink-muted)] text-[10px] [font-variant-numeric:tabular-nums]"
                >
                  {formatNumber(Math.round(value))}
                </text>
              </g>
            );
          })}

          {data.map((point, index) => {
            const x = padding.left + index * band + (band - barWidth) / 2;
            let cursor = 0;

            return (
              <g
                key={point.day}
                onMouseEnter={() => setHover(index)}
                onMouseLeave={() => setHover(null)}
              >
                {/* Alvo de hover maior que a marca: colunas de 90 dias são finas. */}
                <rect
                  x={padding.left + index * band}
                  y={padding.top}
                  width={band}
                  height={plotHeight}
                  fill={hover === index ? 'var(--color-surface-muted)' : 'transparent'}
                />

                {SENTIMENT_SERIES.map((series) => {
                  const value = point[series.key];
                  if (value === 0) return null;

                  const rawHeight = (value / ceiling) * plotHeight;
                  // Vão de 2px na cor da superfície separa os segmentos: é o
                  // espaço que separa, não um contorno desenhado na marca.
                  const segmentHeight = Math.max(1, rawHeight - 2);
                  const top = padding.top + plotHeight - cursor - rawHeight;
                  cursor += rawHeight;

                  // Só o segmento do topo recebe a ponta arredondada.
                  const isTop = SENTIMENT_SERIES.slice(
                    SENTIMENT_SERIES.indexOf(series) + 1,
                  ).every((later) => point[later.key] === 0);

                  return isTop ? (
                    <path
                      key={series.key}
                      d={cappedBar(x, top, barWidth, segmentHeight)}
                      fill={series.color}
                    />
                  ) : (
                    <rect
                      key={series.key}
                      x={x}
                      y={top}
                      width={barWidth}
                      height={segmentHeight}
                      fill={series.color}
                    />
                  );
                })}
              </g>
            );
          })}

          {/* Linha de base */}
          <line
            x1={padding.left}
            x2={width - padding.right}
            y1={padding.top + plotHeight}
            y2={padding.top + plotHeight}
            stroke="var(--color-line)"
            strokeWidth={1}
          />

          {/* Rótulos de data espaçados, para não colidirem em janelas longas. */}
          {data.map((point, index) => {
            const step = Math.ceil(data.length / 8);
            if (index % step !== 0) return null;
            return (
              <text
                key={point.day}
                x={padding.left + index * band + band / 2}
                y={height - 8}
                textAnchor="middle"
                className="fill-[var(--color-ink-muted)] text-[10px]"
              >
                {formatDay(point.day)}
              </text>
            );
          })}
        </svg>

        {hover !== null && data[hover] && (
          <div
            className="pointer-events-none absolute top-0 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs shadow-sm"
            style={{
              left: `${((hover + 0.5) / Math.max(1, data.length)) * 100}%`,
              transform: 'translateX(-50%)',
            }}
          >
            <p className="mb-0.5 font-medium">{formatDay(data[hover].day)}</p>
            <p className="[font-variant-numeric:tabular-nums]">
              {formatNumber(data[hover].total)} no total
            </p>
            {SENTIMENT_SERIES.map((series) => (
              <p key={series.key} className="flex items-center gap-1.5 text-ink-muted">
                <span
                  aria-hidden
                  className="inline-block size-2 rounded-sm"
                  style={{ background: series.color }}
                />
                {series.label}: {formatNumber(data[hover][series.key])}
              </p>
            ))}
          </div>
        )}
      </div>

      {showTable && (
        <div className="max-h-64 overflow-auto rounded-lg border border-line">
          <table className="w-full text-xs [font-variant-numeric:tabular-nums]">
            <thead className="sticky top-0 bg-surface-muted text-left">
              <tr>
                <th className="px-3 py-1.5 font-medium">Dia</th>
                <th className="px-3 py-1.5 font-medium">Total</th>
                <th className="px-3 py-1.5 font-medium">Positivo</th>
                <th className="px-3 py-1.5 font-medium">Neutro</th>
                <th className="px-3 py-1.5 font-medium">Negativo</th>
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((point) => (
                <tr key={point.day} className="border-t border-line">
                  <td className="px-3 py-1">{formatDay(point.day)}</td>
                  <td className="px-3 py-1">{formatNumber(point.total)}</td>
                  <td className="px-3 py-1">{formatNumber(point.positive)}</td>
                  <td className="px-3 py-1">{formatNumber(point.neutral)}</td>
                  <td className="px-3 py-1">{formatNumber(point.negative)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// --- Participação de sentimento ---------------------------------------------

/**
 * Barra divergente centrada no neutro: negativo cresce à esquerda, positivo à
 * direita. É a forma canônica para escala ordenada, e mostra de imediato de que
 * lado o período pendeu — o que uma pizza de três fatias não faz.
 */
export function SentimentShareBar({
  sentiment,
}: {
  sentiment: { positive: number; neutral: number; negative: number };
}) {
  const total = sentiment.positive + sentiment.neutral + sentiment.negative;

  if (total === 0) {
    return <p className="text-sm text-ink-muted">Nenhum comentário analisado no período.</p>;
  }

  const share = (value: number) => (value / total) * 100;

  return (
    <div className="space-y-2">
      <div className="flex h-7 w-full items-stretch gap-[2px] overflow-hidden">
        {SENTIMENT_SERIES.map((series) => {
          const value = sentiment[series.key];
          if (value === 0) return null;
          const percent = share(value);
          // Rótulo dentro do segmento só quando o texto cabe de fato.
          const fits = percent > 12;

          return (
            <div
              key={series.key}
              className="flex items-center justify-center rounded-sm text-[11px] font-medium"
              style={{
                width: `${percent}%`,
                background: series.color,
                // Branco sobre os polos saturados, tinta escura sobre o cinza.
                color: series.key === 'neutral' ? 'var(--color-ink)' : '#ffffff',
              }}
              title={`${series.label}: ${formatNumber(value)} (${formatPercent(value, total)})`}
            >
              {fits && formatPercent(value, total)}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Legend items={SENTIMENT_SERIES} />
        <p className="text-xs text-ink-muted [font-variant-numeric:tabular-nums]">
          {formatNumber(total)} analisados
        </p>
      </div>
    </div>
  );
}

// --- Principais motivos ------------------------------------------------------

/**
 * Barras horizontais, uma matiz só.
 *
 * Horizontal porque os nomes dos motivos são longos, e uma matiz só porque as
 * barras não são identidades a distinguir — são magnitudes a comparar. A parcela
 * negativa vem como número ao lado, e não como segunda cor: seria uma segunda
 * matiz sem trabalho a fazer.
 */
export function MotiveBars({
  motives,
  hrefBase,
}: {
  motives: { motive: string; count: number; negative: number }[];
  /**
   * Prefixo de URL; o id do motivo é acrescentado ao fim. É uma string, e não
   * uma função, porque props de Server para Client Component precisam ser
   * serializáveis.
   */
  hrefBase?: string;
}) {
  if (motives.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        Nenhum motivo identificado ainda. Rode a análise de IA para preencher.
      </p>
    );
  }

  const max = Math.max(...motives.map((row) => row.count));
  const top = motives.slice(0, 10);

  return (
    <ul className="space-y-2">
      {top.map((row) => {
        const percent = (row.count / max) * 100;

        return (
          <li key={row.motive}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
              <span className="truncate">{motiveLabel(row.motive)}</span>
              <span className="shrink-0 text-ink-muted [font-variant-numeric:tabular-nums]">
                {formatNumber(row.count)}
                {row.negative > 0 && (
                  <span className="ml-1.5 text-negative">{formatNumber(row.negative)} neg.</span>
                )}
              </span>
            </div>
            {hrefBase ? (
              <a
                href={`${hrefBase}${encodeURIComponent(row.motive)}`}
                className="block h-2.5 w-full rounded-sm bg-surface-muted"
                title={`Ver comentários de "${motiveLabel(row.motive)}"`}
              >
                <span
                  className="block h-full rounded-sm"
                  style={{ width: `${percent}%`, background: 'var(--color-series)' }}
                />
              </a>
            ) : (
              <div className="h-2.5 w-full rounded-sm bg-surface-muted">
                <div
                  className="h-full rounded-sm"
                  style={{ width: `${percent}%`, background: 'var(--color-series)' }}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Teto de eixo em número redondo (10, 25, 50, 100, 250…). */
function niceCeiling(max: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 2.5, 5, 10]) {
    const candidate = step * magnitude;
    if (candidate >= max) return candidate;
  }
  return 10 * magnitude;
}
