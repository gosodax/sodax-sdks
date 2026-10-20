import React, { type ComponentProps, type ReactNode } from 'react';
import type { LeverageYieldVault } from '@sodax/dapp-kit';
import { InfoIcon } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { formatBps, formatRayPercent, formatTokenAmount, formatWad } from './lib/format';
import { type Read, useVaultPosition, type VaultStats } from './hooks/useVaultReads';
import { formatTvlUsd, priceFor, toUsd, USD_PRICE_NOTE, type UsdPrices } from './lib/usd';
import { underlying } from './lib/vaults';
import { Hint } from './Hint';
import { Stepper } from './Stepper';

/** Health factor reads as max uint when the vault has no debt. */
const NO_DEBT_HEALTH = 10n ** 30n;

/** Right column of the vault dialog: "What will happen" (preview before confirm, live after) and the vault's stats. */
export function SidePanel({
  vault,
  stats,
  prices,
  steps,
}: {
  vault: LeverageYieldVault;
  stats: VaultStats;
  prices: UsdPrices;
  steps: ComponentProps<typeof Stepper>['steps'];
}) {
  const asset = underlying(vault);
  const position = useVaultPosition(vault.vault);
  const tvlUsd = formatTvlUsd(toUsd(stats.tvl.data, asset.decimals, priceFor(prices, vault.asset)));

  return (
    <aside className="flex flex-col gap-5 rounded-lg bg-muted p-4 text-sm">
      <section className="flex flex-col gap-3">
        <h3 className="font-semibold">What will happen</h3>
        <Stepper steps={steps} />
      </section>
      <section className="flex flex-col gap-2 border-t pt-4">
        <h3 className="font-semibold">Vault details</h3>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
          <Stat
            label={
              <span className="inline-flex items-center gap-1">
                Net APR
                <Hint content="Staking yield of the underlying asset plus the lending spread, multiplied by the vault's leverage. Variable; can turn negative.">
                  <InfoIcon aria-label="More info" className="size-3.5" />
                </Hint>
              </span>
            }
            read={stats.apr}
            format={apr => `${formatRayPercent(apr.effectiveNetAprRay)}${apr.stale ? ' (estimate)' : ''}`}
          />
          <Stat
            label={
              <span className="inline-flex items-center gap-1">
                TVL
                <Hint content={`Total value locked, in ${asset.symbol}. ${USD_PRICE_NOTE}`}>
                  <InfoIcon aria-label="More info" className="size-3.5" />
                </Hint>
              </span>
            }
            read={stats.tvl}
            format={tvl => `${formatTokenAmount(tvl, asset.decimals, 2)} ${asset.symbol}${tvlUsd && ` · ${tvlUsd}`}`}
          />
          <Stat
            label="Share price"
            read={stats.sharePrice}
            format={price => `${formatTokenAmount(price, asset.decimals)} ${asset.symbol}`}
          />
          <Stat label="Leverage" read={stats.apr} format={apr => `${formatWad(apr.leverageMultiplierWad)}×`} />
          <Stat
            label="Health / LTV"
            read={position}
            format={p => `${p.healthFactor > NO_DEBT_HEALTH ? '∞' : formatWad(p.healthFactor)} / ${formatBps(p.ltv)}`}
          />
        </dl>
      </section>
    </aside>
  );
}

function Stat<T>({ label, read, format }: { label: ReactNode; read: Read<T>; format: (value: T) => string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">
        {read.data !== undefined ? (
          format(read.data)
        ) : read.isError ? (
          '–'
        ) : (
          <Skeleton className="ml-auto h-4 w-16 bg-card" />
        )}
      </dd>
    </>
  );
}
