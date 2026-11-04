import React from 'react';
import type { OracleCandle } from '@sodax/dapp-kit';

const WIDTH = 800;
const HEIGHT = 320;
const PADDING = { top: 12, right: 64, bottom: 24, left: 8 };
const PRICE_TICKS = 5;

const formatPrice = (price: number): string =>
  price.toLocaleString(undefined, { maximumFractionDigits: price >= 1 ? 2 : 6 });

const formatTime = (unixSeconds: number): string => new Date(unixSeconds * 1000).toLocaleString();

/** Minimal SVG candlestick chart: wick + body per candle, native <title> tooltips. */
export default function CandleChart({ candles }: { candles: OracleCandle[] }) {
  const lowest = Math.min(...candles.map(c => Number(c.low)));
  const highest = Math.max(...candles.map(c => Number(c.high)));
  // A perfectly flat series has no span to scale by — pad around the value so it centers.
  const pad = (highest - lowest || Math.abs(highest) || 1) * 0.05;
  const min = lowest - pad;
  const max = highest + pad;
  const span = max - min;
  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const step = plotWidth / candles.length;
  const bodyWidth = Math.max(1, Math.min(12, step * 0.6));
  const yFor = (price: number): number => PADDING.top + ((max - price) / span) * plotHeight;

  const ticks = Array.from({ length: PRICE_TICKS }, (_, i) => min + (span * i) / (PRICE_TICKS - 1));

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full min-w-[640px] h-auto"
        role="img"
        aria-label="Candlestick chart"
      >
        {ticks.map(price => (
          <g key={price}>
            <line
              x1={PADDING.left}
              x2={WIDTH - PADDING.right}
              y1={yFor(price)}
              y2={yFor(price)}
              stroke="currentColor"
              strokeOpacity={0.1}
            />
            <text x={WIDTH - PADDING.right + 6} y={yFor(price) + 4} fontSize={11} fill="currentColor" opacity={0.6}>
              {formatPrice(price)}
            </text>
          </g>
        ))}
        {candles.map((candle, i) => {
          const open = Number(candle.open);
          const close = Number(candle.close);
          const x = PADDING.left + step * (i + 0.5);
          const color = close >= open ? '#16a34a' : '#dc2626';
          return (
            <g key={candle.timestamp} opacity={candle.final === false ? 0.6 : 1}>
              <title>
                {`${formatTime(candle.timestamp)}${candle.final === false ? ' (forming)' : ''}\nO ${candle.open}  H ${candle.high}  L ${candle.low}  C ${candle.close}`}
              </title>
              <line x1={x} x2={x} y1={yFor(Number(candle.high))} y2={yFor(Number(candle.low))} stroke={color} />
              <rect
                x={x - bodyWidth / 2}
                y={yFor(Math.max(open, close))}
                width={bodyWidth}
                height={Math.max(1, Math.abs(yFor(open) - yFor(close)))}
                fill={color}
              />
            </g>
          );
        })}
        <text x={PADDING.left} y={HEIGHT - 6} fontSize={11} fill="currentColor" opacity={0.6}>
          {formatTime(candles[0].timestamp)}
        </text>
        <text x={WIDTH - PADDING.right} y={HEIGHT - 6} fontSize={11} fill="currentColor" opacity={0.6} textAnchor="end">
          {formatTime(candles[candles.length - 1].timestamp)}
        </text>
      </svg>
    </div>
  );
}
