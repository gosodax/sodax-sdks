import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { ApprovalStrategy, GetWalletProviderType, LeverageYieldSwapPayload, SpokeChainKey } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';
import { unwrapResult } from '../shared/unwrapResult.js';

export type UseLeverageYieldApprovalStrategyParams<K extends SpokeChainKey = SpokeChainKey> = ReadHookParams<
  ApprovalStrategy,
  {
    /** The payload `useLeverageYieldDeposit` / `useLeverageYieldWithdraw` built. */
    payload: LeverageYieldSwapPayload | undefined;
    walletProvider: GetWalletProviderType<K> | undefined;
    /** `false` keeps a wallet that would first ask to upgrade the account (EIP-5792 `'ready'`) off the batch path. Defaults to `true`. */
    allowAccountUpgrade?: boolean;
  }
>;

/**
 * Which approval path {@link useLeverageYieldVaultSwapWithApproval} would take: `'not-required'`
 * (always for a withdraw), `'atomic-batch'` (approve + deposit in one EIP-5792 signature) or
 * `'sequential'` (approve, then deposit). Use it to label the deposit button. Pass the same
 * `allowAccountUpgrade` you give the vault swap.
 *
 * Not polled: the vault swap invalidates it on success and re-reads the strategy at execution.
 */
export function useLeverageYieldApprovalStrategy<K extends SpokeChainKey = SpokeChainKey>({
  params,
  queryOptions,
}: UseLeverageYieldApprovalStrategyParams<K> = {}): UseQueryResult<ApprovalStrategy, Error> {
  const { sodax } = useSodaxContext();
  const payload = params?.payload;
  const walletProvider = params?.walletProvider;
  const allowAccountUpgrade = params?.allowAccountUpgrade ?? true;

  return useQuery<ApprovalStrategy, Error>({
    queryKey: [
      'leverageYield',
      'approvalStrategy',
      payload?.params.srcChainKey,
      payload?.params.srcAddress,
      payload?.params.inputToken,
      payload?.params.inputAmount.toString(),
      payload?.hubWalletSwap ?? false,
      allowAccountUpgrade,
    ],
    queryFn: async () => {
      if (!payload || !walletProvider) throw new Error('payload and walletProvider are required');
      return unwrapResult(
        await sodax.leverageYield.getApprovalStrategy({ ...payload, walletProvider, allowAccountUpgrade }),
      );
    },
    enabled: !!payload && !!walletProvider,
    ...queryOptions,
  });
}
