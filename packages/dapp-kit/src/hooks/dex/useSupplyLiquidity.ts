// packages/dapp-kit/src/hooks/dex/useSupplyLiquidity.ts
import type {
  ClIncreaseLiquidityParams,
  ClSupplyParams,
  GetWalletProviderType,
  SpokeChainKey,
  TxHashPair,
} from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { invalidateBalances } from '../shared/invalidateBalances.js';
import type { UseCreateSupplyLiquidityParamsResult } from './useCreateSupplyLiquidityParams.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

/**
 * Mutation variables for {@link useSupplyLiquidity}. Generic over `K extends SpokeChainKey`
 * (defaults to the full union). The hook fans out internally to either
 * `clService.increaseLiquidity` (when `params.tokenId` + `params.isValidPosition` are present) or
 * `clService.supplyLiquidity` (mint a new position).
 */
export type UseSupplyLiquidityVars<K extends SpokeChainKey = SpokeChainKey> = {
  params: UseCreateSupplyLiquidityParamsResult & { srcChainKey: K; srcAddress: string };
  walletProvider: GetWalletProviderType<K>;
  /** Optional relay timeout in ms (default 60_000) */
  timeout?: number;
};

/**
 * React hook for supplying liquidity to a concentrated-liquidity pool. If the input vars include a
 * valid `tokenId` for an existing position, the hook calls `increaseLiquidity`; otherwise it mints
 * a new position via `supplyLiquidity`.
 *
 * Throws on SDK failure so React Query's native error model engages (`isError`, `error`,
 * `onError`, `retry`). Returns the unwrapped `TxHashPair` on success.
 */
export function useSupplyLiquidity<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<TxHashPair, UseSupplyLiquidityVars<K>> = {}): SafeUseMutationResult<
  TxHashPair,
  Error,
  UseSupplyLiquidityVars<K>
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<TxHashPair, Error, UseSupplyLiquidityVars<K>>({
    mutationKey: ['dex', 'supplyLiquidity'],
    ...mutationOptions,
    mutationFn: async ({ params, walletProvider, timeout }) => {
      const sharedParams = {
        srcChainKey: params.srcChainKey,
        srcAddress: params.srcAddress as ClSupplyParams<K>['srcAddress'],
        poolKey: params.poolKey,
        tickLower: params.tickLower,
        tickUpper: params.tickUpper,
        liquidity: params.liquidity,
        amount0Max: params.amount0Max,
        amount1Max: params.amount1Max,
        sqrtPriceX96: params.sqrtPriceX96,
      } satisfies ClSupplyParams<K>;

      if (params.tokenId !== undefined && params.isValidPosition) {
        const increaseParams: ClIncreaseLiquidityParams<K> = {
          ...sharedParams,
          tokenId: typeof params.tokenId === 'bigint' ? params.tokenId : BigInt(params.tokenId),
        };
        return unwrapResult(
          await sodax.dex.clService.increaseLiquidity({ params: increaseParams, raw: false, walletProvider, timeout }),
        );
      }

      return unwrapResult(
        await sodax.dex.clService.supplyLiquidity({ params: sharedParams, raw: false, walletProvider, timeout }),
      );
    },
    onSuccess: async (data, vars, ctx) => {
      const { params } = vars;
      // Increase-liquidity branch knows the affected position — scope to it. Mint-new-position
      // branch creates a fresh tokenId that's only known after the tx, so a bare invalidation is
      // the right fallback (refetches all positions, including the new one once it lands).
      if (params.tokenId !== undefined && params.isValidPosition) {
        // `usePositionInfo` keys by string tokenId — coerce here to match its shape regardless of
        // whether the caller passed bigint or string.
        const tokenIdStr = String(params.tokenId);
        queryClient.invalidateQueries({ queryKey: ['dex', 'positionInfo', tokenIdStr, params.poolKey] });
      } else {
        queryClient.invalidateQueries({ queryKey: ['dex', 'positionInfo'] });
      }
      queryClient.invalidateQueries({ queryKey: ['dex', 'poolData', params.poolKey] });
      queryClient.invalidateQueries({ queryKey: ['dex', 'poolBalances', params.srcChainKey, params.srcAddress] });
      invalidateBalances(queryClient, params.srcChainKey);
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
