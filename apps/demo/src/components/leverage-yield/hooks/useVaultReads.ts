import { useMemo } from 'react';
import {
  type Address,
  type LeverageYieldVault,
  unwrapResult,
  useLeverageYieldApiPosition,
  useLeverageYieldPosition,
  useReservesUsdFormat,
  useSodaxContext,
} from '@sodax/dapp-kit';
import { type UseQueryResult, useQueries } from '@tanstack/react-query';
import { ONE_SHARE } from '../lib/format';
import type { UsdPrices } from '../lib/usd';
import { useTransport } from '../transport';
import type { Holder } from './useSourceChains';

/**
 * Vault reads for the page's transport. Every vault is read at once, so the list, "Your vaults" and the dialog share
 * one set of queries and totals are plain sums. These are the SDK reads behind the dapp-kit `useLeverageYield*`
 * hooks (`sodax.leverageYield.*`) and their REST twins (`sodax.api.leverageYield.*`) under `useQueries`; the API
 * returns decimal strings, so values are normalised to bigint either way.
 */

export type VaultApr = { effectiveNetAprRay: bigint; leverageMultiplierWad: bigint; stale: boolean };

/** Shares held for one source chain (each chain has its own SODAX hub wallet on Sonic). */
export type Holding = { chainKey: Holder['chainKey']; holder: Address; shares: bigint };

/** One read with the flags the UI needs: a skeleton while loading, "–" on error. */
export type Read<T> = { data: T | undefined; isLoading: boolean; isError: boolean };

export type VaultStats = {
  apr: Read<VaultApr>;
  /** Total assets, in the vault's underlying asset. */
  tvl: Read<bigint>;
  /** Underlying asset per 1 share (previewRedeem of 1e18). */
  sharePrice: Read<bigint>;
  /** One entry per connected holder; `data` only once every holder has loaded, so sums are never partial. */
  holdings: Read<Holding[]>;
};

/** APR, TVL and share price move slowly: the dapp-kit hooks' cadence. */
const STATS_REFETCH_MS = 60_000;
const SHARES_REFETCH_MS = 30_000;

function toRead<T>(query: UseQueryResult<T>): Read<T> {
  return { data: query.data, isLoading: query.isLoading, isError: query.isError };
}

export function useVaultStats(vaults: readonly LeverageYieldVault[], holders: Holder[]): Map<Address, VaultStats> {
  const { transport, apiConfig } = useTransport();
  const { sodax } = useSodaxContext();
  const sdk = sodax.leverageYield;
  const api = sodax.api.leverageYield;

  const perVault = <T>(read: string, fn: (vault: Address) => Promise<T>) => ({
    queries: vaults.map(({ vault }) => ({
      queryKey: ['leverageYield', read, transport, apiConfig?.baseURL, vault],
      queryFn: () => fn(vault),
      refetchInterval: STATS_REFETCH_MS,
    })),
  });

  const aprs = useQueries(
    perVault('effectiveApr', async (vault): Promise<VaultApr> => {
      const apr =
        transport === 'sdk'
          ? unwrapResult(await sdk.getEffectiveApr(vault))
          : unwrapResult(await api.getEffectiveApr({ vault }, apiConfig));
      return {
        effectiveNetAprRay: BigInt(apr.effectiveNetAprRay),
        leverageMultiplierWad: BigInt(apr.leverageMultiplierWad),
        stale: apr.lsdApr.stale,
      };
    }),
  );
  const tvls = useQueries(
    perVault('totalAssets', async vault =>
      transport === 'sdk'
        ? unwrapResult(await sdk.getTotalAssets(vault))
        : BigInt(unwrapResult(await api.getTotalAssets({ vault }, apiConfig)).totalAssets),
    ),
  );
  const sharePrices = useQueries(
    perVault('sharePrice', async vault =>
      transport === 'sdk'
        ? unwrapResult(await sdk.previewRedeem(vault, ONE_SHARE))
        : BigInt(unwrapResult(await api.previewRedeem({ vault, shares: ONE_SHARE.toString() }, apiConfig)).assets),
    ),
  );

  // The hub wallet for (address, chain) is derived with the SDK in both modes: there is no API route for it.
  const holdings = useQueries({
    queries: vaults.flatMap(({ vault }) =>
      holders.map(({ chainKey, address }) => ({
        // Under ['leverageYield', 'shareBalance'] so a finished deposit or withdraw refreshes it (useFlowProgress).
        queryKey: ['leverageYield', 'shareBalance', transport, apiConfig?.baseURL, vault, chainKey, address],
        queryFn: async (): Promise<Holding> => {
          const holder = await sodax.hubProvider.getUserHubWalletAddress(address, chainKey);
          const shares =
            transport === 'sdk'
              ? unwrapResult(await sdk.getShareBalance(vault, holder))
              : BigInt(unwrapResult(await api.getShareBalance({ vault, owner: holder }, apiConfig)).balance);
          return { chainKey, holder, shares };
        },
        refetchInterval: SHARES_REFETCH_MS,
      })),
    ),
  });

  return new Map(
    vaults.map((vault, i): [Address, VaultStats] => {
      const mine = holdings.slice(i * holders.length, (i + 1) * holders.length);
      const loaded = mine.every(query => query.data);
      return [
        vault.vault,
        {
          apr: toRead(aprs[i]),
          tvl: toRead(tvls[i]),
          sharePrice: toRead(sharePrices[i]),
          holdings: {
            data: loaded ? mine.flatMap(query => (query.data ? [query.data] : [])) : undefined,
            isLoading: mine.some(query => query.isLoading),
            isError: mine.some(query => query.isError),
          },
        },
      ];
    }),
  );
}

/** Health factor and LTV of the vault's leveraged position (only the dialog shows them). */
export function useVaultPosition(vault: Address): Read<{ healthFactor: bigint; ltv: bigint }> {
  const { transport, apiConfig } = useTransport();
  const sdk = useLeverageYieldPosition({ params: { vault: transport === 'sdk' ? vault : undefined } });
  const api = useLeverageYieldApiPosition({ params: { vault: transport === 'api' ? vault : undefined, apiConfig } });
  const query = transport === 'sdk' ? sdk : api;
  const position = query.data;
  return {
    data: position && { healthFactor: BigInt(position.healthFactor), ltv: BigInt(position.ltv) },
    isLoading: query.isLoading,
    isError: query.isError,
  };
}

/**
 * USD per whole token from the SODAX money market, keyed by lowercase reserve address (look up with `priceFor`).
 * Read with the SDK on both pages: the leverage-yield API has no prices. Display only.
 */
export function useUsdPrices(): UsdPrices {
  const { data } = useReservesUsdFormat({ queryOptions: { refetchInterval: STATS_REFETCH_MS } });
  return useMemo(
    () => new Map((data ?? []).map(reserve => [reserve.underlyingAsset.toLowerCase(), Number(reserve.priceInUSD)])),
    [data],
  );
}
