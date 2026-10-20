import React, { type ReactNode } from 'react';
import type { LeverageYieldVault, SpokeChainKey, XToken } from '@sodax/dapp-kit';
import { DEFAULT_SLIPPAGE_BPS } from './lib/quote';
import { chainName } from './lib/chains';
import { formatBps, formatRayPercent, formatTokenAmount } from './lib/format';
import { cn } from '@/lib/utils';
import type { VaultStats } from './hooks/useVaultReads';
import { formatUsd, priceFor, toUsd, type UsdPrices } from './lib/usd';
import { formatShares, shareValue, underlying } from './lib/vaults';

/**
 * Deposit quote rows: what the shares are worth today, the APR they earn and the minimum accepted. `review` adds
 * the frozen input and the expected shares on top, plus the slippage. "—" until there is a quote.
 */
export function QuoteDetails({
  vault,
  stats,
  prices,
  shares,
  minShares,
  review,
}: {
  vault: LeverageYieldVault;
  stats: VaultStats;
  prices: UsdPrices;
  shares: bigint | undefined;
  minShares: bigint | undefined;
  review?: { token: XToken; chainKey: SpokeChainKey; inputAmount: bigint };
}) {
  const asset = underlying(vault);
  const worth = shareValue(shares, stats.sharePrice.data);
  const worthUsd = formatUsd(toUsd(worth, asset.decimals, priceFor(prices, vault.asset)));
  const apr = stats.apr.data;

  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
      {review && (
        <>
          <DetailRow label="You deposit">
            {formatTokenAmount(review.inputAmount, review.token.decimals)} {review.token.symbol} on{' '}
            {chainName(review.chainKey)}
          </DetailRow>
          <DetailRow label="You get">
            <span className="font-semibold">
              {shares !== undefined ? `≈ ${formatShares(shares, 'vault share')}` : '—'}
            </span>
          </DetailRow>
        </>
      )}
      <DetailRow label="Worth today">
        {worth !== undefined
          ? `≈ ${formatTokenAmount(worth, asset.decimals)} ${asset.symbol}${worthUsd && ` · ${worthUsd}`}`
          : '—'}
      </DetailRow>
      <DetailRow label="You'll earn">
        {apr ? (
          <span className={cn('font-medium', apr.effectiveNetAprRay < 0n ? 'text-destructive' : 'text-success')}>
            {formatRayPercent(apr.effectiveNetAprRay)} net APR
          </span>
        ) : (
          '—'
        )}
      </DetailRow>
      <DetailRow label="Minimum received">{minShares !== undefined ? formatShares(minShares) : '—'}</DetailRow>
      {review && <DetailRow label="Max slippage">{formatBps(DEFAULT_SLIPPAGE_BPS)}</DetailRow>}
    </dl>
  );
}

/** One label/value row of a two-column `dl`. */
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{children}</dd>
    </>
  );
}
