import { formatUnits } from 'viem';

/** USD is for display only: it never feeds amounts or minimums, and a missing price shows nothing rather than "$0". */

/** USD per whole token, keyed by lowercase money-market reserve address (see `useUsdPrices`). */
export type UsdPrices = ReadonlyMap<string, number>;

/** Price of a vault's asset (`vault.asset`) or of a deposit/withdraw token (`xToken.vault`, not `hubAsset`). */
export function priceFor(prices: UsdPrices, address: string | undefined): number | undefined {
  return address ? prices.get(address.toLowerCase()) : undefined;
}

/** USD value of `amount` (smallest units), or undefined when the amount or the price is unknown. */
export function toUsd(amount: bigint | undefined, decimals: number, price: number | undefined): number | undefined {
  if (amount === undefined || price === undefined) return undefined;
  return Number(formatUnits(amount, decimals)) * price;
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const compactUsd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});
const wholeUsd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** e.g. 4.931 → "$4.93", 0.004 → "< $0.01", undefined → "". */
export function formatUsd(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '';
  if (value !== 0 && Math.abs(value) < 0.01) return value > 0 ? '< $0.01' : '> -$0.01';
  return usd.format(value);
}

/** For TVL: exact while small, short once large. 632.04 → "$632.04", 2344.48 → "$2,344", 12_300_000 → "$12.3M". */
export function formatTvlUsd(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '';
  const abs = Math.abs(value);
  if (abs < 1000) return formatUsd(value);
  return abs < 1_000_000 ? wholeUsd.format(value) : compactUsd.format(value);
}

export const USD_PRICE_NOTE =
  'USD at SODAX money market prices. Other apps use other price feeds, so their figure may differ slightly.';
