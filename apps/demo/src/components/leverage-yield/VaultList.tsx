import React from 'react';
import type { Address, LeverageYieldVault } from '@sodax/dapp-kit';
import { ChevronRightIcon } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { formatRayPercent } from './lib/format';
import { cn } from '@/lib/utils';
import type { VaultStats } from './hooks/useVaultReads';
import { formatTvlUsd, formatUsd, priceFor, toUsd, type UsdPrices } from './lib/usd';
import { formatShares, shareValue, underlying, vaultTagline, vaultTitle } from './lib/vaults';
import { SectionHeading } from './SectionHeading';
import { TokenIcon } from './TokenIcon';

/** One row per vault: net APR, TVL in USD and, when connected, the user's shares across networks. */
export function VaultList({
  vaults,
  stats,
  prices,
  connected,
  onOpen,
}: {
  vaults: readonly LeverageYieldVault[];
  stats: Map<Address, VaultStats>;
  prices: UsdPrices;
  connected: boolean;
  onOpen: (vaultName: string) => void;
}) {
  return (
    <section aria-labelledby="all-vaults" className="flex flex-col gap-3">
      <SectionHeading
        id="all-vaults"
        title="All vaults"
        hint={`${vaults.length} vault${vaults.length === 1 ? '' : 's'} · Select one to deposit`}
      />
      <ul className="flex flex-col gap-3">
        {vaults.map(vault => {
          const vaultStats = stats.get(vault.vault);
          return (
            vaultStats && (
              <li key={vault.vault}>
                <VaultRow
                  vault={vault}
                  stats={vaultStats}
                  prices={prices}
                  connected={connected}
                  onOpen={() => onOpen(vault.name)}
                />
              </li>
            )
          );
        })}
      </ul>
    </section>
  );
}

function VaultRow({
  vault,
  stats,
  prices,
  connected,
  onOpen,
}: {
  vault: LeverageYieldVault;
  stats: VaultStats;
  prices: UsdPrices;
  connected: boolean;
  onOpen: () => void;
}) {
  const asset = underlying(vault);
  const assetPrice = priceFor(prices, vault.asset);
  const apr = stats.apr.data;
  const tvlUsd = toUsd(stats.tvl.data, asset.decimals, assetPrice);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-4 rounded-lg border bg-card p-4 text-left shadow-sm transition-colors hover:bg-secondary sm:px-6"
    >
      <TokenIcon symbol={asset.symbol} className="size-11" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{vaultTitle(vault)}</span>
          {apr?.stale && (
            <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
              APR estimate
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{vaultTagline(vault)}</p>
        {connected && <Holdings stats={stats} assetPrice={assetPrice} decimals={asset.decimals} />}
      </div>
      <div className="text-right">
        {apr ? (
          <p className={cn('text-2xl font-bold', apr.effectiveNetAprRay < 0n ? 'text-destructive' : 'text-success')}>
            {formatRayPercent(apr.effectiveNetAprRay)}
          </p>
        ) : stats.apr.isError ? (
          <p className="text-2xl font-bold text-subtle-foreground">–</p>
        ) : (
          <Skeleton className="ml-auto h-8 w-20" />
        )}
        <p className="text-xs text-muted-foreground">Net APR</p>
      </div>
      <div className="hidden w-20 text-right sm:block">
        {tvlUsd !== undefined ? (
          <p className="text-lg font-semibold">{formatTvlUsd(tvlUsd)}</p>
        ) : stats.tvl.isLoading ? (
          <Skeleton className="ml-auto h-7 w-14" />
        ) : (
          <p className="text-lg font-semibold text-subtle-foreground">–</p>
        )}
        <p className="text-xs text-muted-foreground">TVL</p>
      </div>
      <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" />
    </button>
  );
}

/** "You hold N shares · $X", summed across networks. Nothing for zero; never a false "0" while loading. */
function Holdings({
  stats,
  assetPrice,
  decimals,
}: {
  stats: VaultStats;
  assetPrice: number | undefined;
  decimals: number;
}) {
  const holdings = stats.holdings.data;
  if (!holdings) {
    return stats.holdings.isError ? (
      <p className="mt-1 text-xs text-muted-foreground">You hold –</p>
    ) : (
      <Skeleton className="mt-1.5 h-3.5 w-36" />
    );
  }
  const shares = holdings.reduce((sum, holding) => sum + holding.shares, 0n);
  if (shares === 0n) return null;
  const usd = formatUsd(toUsd(shareValue(shares, stats.sharePrice.data), decimals, assetPrice));
  return (
    <p className="mt-1 text-xs font-medium text-foreground">
      You hold {formatShares(shares)}
      {usd && ` · ${usd}`}
    </p>
  );
}
