import { formatUnits, parseUnits } from 'viem';

/**
 * Unit helpers. SODAX amounts are always bigint in the token's smallest unit.
 * - Token amounts: token decimals (USDC = 6). lsoda* vault shares are always 18 decimals.
 * - Rates (APR): RAY, 1e27 = 100%.
 * - Multipliers (leverage, health factor): WAD, 1e18 = 1.0.
 * - Ratios such as LTV: basis points, 10_000 = 100%.
 */

const RAY_PER_PERCENT = 10n ** 25n; // 1e27 / 100
const WAD = 10n ** 18n;

/** 1.0 in WAD, the share amount for a share-price read (`previewRedeem(vault, ONE_SHARE)`). */
export const ONE_SHARE = WAD;

/**
 * bigint → human string, e.g. formatTokenAmount(5_000_000n, 6) === '5'. Rounds down, so a balance or minimum is
 * never overstated. Below 1 it keeps `maxFractionDigits` significant digits: 0.000375 → '0.000375', not '0.0003'.
 */
export function formatTokenAmount(amount: bigint | undefined, decimals: number, maxFractionDigits = 4): string {
  if (amount === undefined) return '–';
  const [whole = '0', fraction = ''] = formatUnits(amount, decimals).split('.');
  const negative = whole.startsWith('-');
  const wholeDigits = negative ? whole.slice(1) : whole;
  const leadingZeros = wholeDigits === '0' ? (fraction.match(/^0*/)?.[0].length ?? 0) : 0;
  const trimmed = fraction.slice(0, leadingZeros + maxFractionDigits).replace(/0+$/, '');
  const wholeFormatted = `${negative ? '-' : ''}${BigInt(wholeDigits).toLocaleString('en-US')}`;
  return trimmed ? `${wholeFormatted}.${trimmed}` : wholeFormatted;
}

/** Human input → bigint; undefined for empty, malformed or over-precise input, so a submit can disable instead of throw. */
export function parseTokenAmount(value: string, decimals: number): bigint | undefined {
  const cleaned = value.trim().replace(/,/g, '');
  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === '' || cleaned === '.') return undefined;
  const fraction = cleaned.split('.')[1] ?? '';
  if (fraction.length > decimals) return undefined;
  try {
    return parseUnits(cleaned, decimals);
  } catch {
    return undefined;
  }
}

/** RAY rate → percent string rounded half away from zero, e.g. 6.1666% → '6.17%'. Handles negative rates. */
export function formatRayPercent(ray: bigint | undefined, fractionDigits = 2): string {
  if (ray === undefined) return '–';
  const scale = 10n ** BigInt(fractionDigits);
  const negative = ray < 0n;
  const abs = ((negative ? -ray : ray) * scale + RAY_PER_PERCENT / 2n) / RAY_PER_PERCENT;
  const whole = abs / scale;
  const fraction = (abs % scale).toString().padStart(fractionDigits, '0');
  return `${negative && abs > 0n ? '-' : ''}${whole}${fractionDigits > 0 ? `.${fraction}` : ''}%`;
}

/** WAD multiplier → string, e.g. 4.56e18 → '4.56'. */
export function formatWad(wad: bigint | undefined, fractionDigits = 2): string {
  if (wad === undefined) return '–';
  return Number(formatUnits(wad, 18)).toFixed(fractionDigits);
}

/** Basis points → percent string, e.g. 8200 → '82%', 7950 → '79.5%'. */
export function formatBps(bps: bigint | number | undefined, maxFractionDigits = 2): string {
  if (bps === undefined) return '–';
  return `${Number((Number(bps) / 100).toFixed(maxFractionDigits))}%`;
}

/** amount × (1 − bps / 10_000), rounded down: the `minOutputAmount` for a quote. */
export function minAmountAfterSlippage(amount: bigint, slippageBps: number): bigint {
  if (slippageBps < 0 || slippageBps >= 10_000) throw new Error(`Invalid slippage: ${slippageBps} bps`);
  return (amount * BigInt(10_000 - slippageBps)) / 10_000n;
}

export function shortenAddress(address: string | undefined, chars = 4): string {
  if (!address) return '';
  return `${address.slice(0, chars + 2)}…${address.slice(-chars)}`;
}
