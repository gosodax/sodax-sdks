import { parseUnits } from 'viem';

/**
 * Parses a typed amount into base units, or `undefined` when it is not a positive decimal. Both
 * flows gate their payload on this, so a half-typed `0.` never reaches an SDK call.
 */
export function parseAmount(value: string, decimals: number): bigint | undefined {
  const trimmed = value.trim();
  if (!/^\d+(\.\d*)?$|^\.\d+$/.test(trimmed)) return undefined;
  try {
    const parsed = parseUnits(trimmed, decimals);
    return parsed > 0n ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Trims a decimal amount for display. `formatUnits` returns full token precision — eighteen
 * decimals of quoted output is unreadable in a form field, and no swap UI shows it.
 *
 * Operates on the string, so there is no float rounding, and truncates rather than rounds so a
 * displayed output or minimum never reads higher than the real one. Sub-1 amounts keep
 * `significant` digits after the leading zeros, so dust never collapses to `0`.
 */
export function formatTokenAmount(value: string, significant = 6): string {
  const [whole, fraction] = value.split('.');
  if (!fraction) return value;

  const leadingZeros = fraction.length - fraction.replace(/^0+/, '').length;
  const keep = whole === '0' ? leadingZeros + significant : significant;
  const trimmed = fraction.slice(0, keep).replace(/0+$/, '');

  return trimmed ? `${whole}.${trimmed}` : whole;
}
