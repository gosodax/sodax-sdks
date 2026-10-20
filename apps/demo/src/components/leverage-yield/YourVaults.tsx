import React from 'react';
import type { Address, LeverageYieldVault, SpokeChainKey } from '@sodax/dapp-kit';
import { ChevronRightIcon } from 'lucide-react';
import { chainName } from './lib/chains';
import { formatRayPercent } from './lib/format';
import type { VaultStats } from './hooks/useVaultReads';
import { formatUsd, priceFor, toUsd, type UsdPrices } from './lib/usd';
import { formatShares, shareValue, underlying, vaultTitle } from './lib/vaults';
import { SectionHeading } from './SectionHeading';
import { TokenIcon } from './TokenIcon';

/**
 * Every position the user holds, one line per vault and network (each network deposits into its own hub wallet,
 * so a withdrawal is signed there). Hidden until all holdings have loaded, and when there are none.
 */
export function YourVaults({
  vaults,
  stats,
  prices,
  onWithdraw,
}: {
  vaults: readonly LeverageYieldVault[];
  stats: Map<Address, VaultStats>;
  prices: UsdPrices;
  onWithdraw: (vaultName: string, chainKey: SpokeChainKey) => void;
}) {
  if (vaults.some(vault => !stats.get(vault.vault)?.holdings.data)) return null;

  const lines = vaults.flatMap(vault => {
    const vaultStats = stats.get(vault.vault);
    const asset = underlying(vault);
    const apr = vaultStats?.apr.data?.effectiveNetAprRay;
    return (vaultStats?.holdings.data ?? [])
      .filter(holding => holding.shares > 0n)
      .map(holding => {
        const value = shareValue(holding.shares, vaultStats?.sharePrice.data);
        const usd = toUsd(value, asset.decimals, priceFor(prices, vault.asset));
        return {
          vault,
          holding,
          apr,
          usd,
          perMonth: usd !== undefined && apr !== undefined ? monthly(usd, apr) : undefined,
        };
      });
  });
  if (lines.length === 0) return null;

  // Totals only when every line has a value, so they're never quietly partial.
  const complete = lines.every(line => line.perMonth !== undefined);
  const total = complete ? lines.reduce((sum, line) => sum + (line.usd ?? 0), 0) : undefined;
  const perMonth = complete ? lines.reduce((sum, line) => sum + (line.perMonth ?? 0), 0) : undefined;

  return (
    <section aria-labelledby="your-vaults" className="flex flex-col gap-3">
      <SectionHeading id="your-vaults" title="Your vaults" hint="Select one to withdraw" />
      <div className="rounded-lg border bg-card p-5 shadow-sm sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Total value</p>
            <p className="font-display text-3xl font-bold">{total !== undefined ? formatUsd(total) : '–'}</p>
          </div>
          {perMonth !== undefined && (
            <p className="text-sm text-muted-foreground">
              ≈ {formatUsd(perMonth)} per month at today's APRs (an estimate)
            </p>
          )}
        </div>
        <ul className="mt-3 divide-y">
          {lines.map(({ vault, holding, apr, usd }) => (
            <li key={`${vault.vault}-${holding.chainKey}`}>
              <button
                type="button"
                onClick={() => onWithdraw(vault.name, holding.chainKey)}
                className="flex w-full items-center gap-3 py-3 text-left"
              >
                <TokenIcon symbol={underlying(vault).symbol} chainKey={holding.chainKey} className="size-9" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{vaultTitle(vault)}</p>
                  <p className="text-xs text-muted-foreground">
                    From {chainName(holding.chainKey)} · {formatShares(holding.shares)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold">{formatUsd(usd) || '–'}</p>
                  {apr !== undefined && (
                    <p className="text-xs text-muted-foreground">{formatRayPercent(apr)} net APR</p>
                  )}
                </div>
                <span className="inline-flex items-center gap-1 text-sm font-medium text-primary">
                  <span className="hidden sm:inline">Withdraw</span>
                  <ChevronRightIcon className="size-4" />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** USD earned per month at a RAY APR (APR ÷ 12). */
function monthly(usd: number, aprRay: bigint): number {
  return (usd * Number(aprRay)) / 1e27 / 12;
}
