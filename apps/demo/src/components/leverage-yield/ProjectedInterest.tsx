import React from 'react';
import type { LeverageYieldVault } from '@sodax/dapp-kit';
import { formatUnits } from 'viem';
import { formatRayPercent } from './lib/format';
import { formatUsd, priceFor, toUsd, type UsdPrices } from './lib/usd';
import { projectedInterest, underlying } from './lib/vaults';

const PERIODS = [
  { days: 30, label: '30 days' },
  { days: 182, label: '6 months' },
  { days: 365, label: '1 year' },
];

/**
 * Interest the deposit would earn at today's APR (simple interest, an estimate). Shown in the vault's asset so
 * price moves don't skew it, with USD beside it.
 */
export function ProjectedInterest({
  vault,
  assets,
  aprRay,
  prices,
}: {
  vault: LeverageYieldVault;
  /** What the deposit is worth today, in the vault's asset. */
  assets: bigint | undefined;
  aprRay: bigint | undefined;
  prices: UsdPrices;
}) {
  const asset = underlying(vault);
  const assetPrice = priceFor(prices, vault.asset);

  return (
    <div className="rounded-lg bg-muted p-4 text-sm">
      <p className="font-medium">
        Projected interest <span className="font-normal text-muted-foreground">in {asset.symbol}</span>
      </p>
      <dl className="mt-2 grid grid-cols-3 gap-3">
        {PERIODS.map(({ days, label }) => {
          const interest =
            assets !== undefined && aprRay !== undefined ? projectedInterest(assets, aprRay, days) : undefined;
          return (
            <div key={label} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="truncate font-semibold">
                {interest === undefined ? '—' : signed(interest, asset.decimals)}
              </dd>
              <dd className="text-xs text-muted-foreground">
                {formatUsd(toUsd(interest, asset.decimals, assetPrice))}
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">
        An estimate at today's {aprRay !== undefined && `${formatRayPercent(aprRay)} `}net APR, in {asset.symbol} so
        price moves don't skew it. The APR changes and can turn negative.
      </p>
    </div>
  );
}

/** Four significant digits with a sign, e.g. "+0.0527" or "+0.000007535" (small ETH-sized amounts stay visible). */
function signed(amount: bigint, decimals: number): string {
  const value = Number(formatUnits(amount, decimals));
  return `${value < 0 ? '-' : '+'}${Math.abs(value).toLocaleString('en-US', { maximumSignificantDigits: 4 })}`;
}
