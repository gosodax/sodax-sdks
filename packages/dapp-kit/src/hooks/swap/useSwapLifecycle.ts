import {
  isAuthFailure,
  summarizeSwapStatus,
  type CreateIntentParams,
  type GetWalletProviderType,
  type Result,
  type SpokeChainKey,
  type SwapApprovalStrategy,
  type SwapExtras,
  type SwapWithApprovalResponse,
} from '@sodax/sdk';
import { useIsFetching, type UseQueryResult } from '@tanstack/react-query';
import { useRef } from 'react';
import { resolveSwapLifecycle, toSwapAttempt, type SwapLifecycleState } from '../../utils/swapLifecycle.js';
import { useNearStorageGate, type NearStorageGate } from '../shared/useNearStorageGate.js';
import { useStellarGate, type StellarGate } from '../shared/useStellarGate.js';
import type { MutationHookOptions } from '../shared/types.js';
import type { SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { useDetailedStatus, type UseDetailedStatusResult } from './useDetailedStatus.js';
import { useSwapApprovalStrategy } from './useSwapApprovalStrategy.js';
import { useSwapWithApproval, type UseSwapWithApprovalVars } from './useSwapWithApproval.js';

export type { SwapLifecycleState, SwapSetupReason } from '../../utils/swapLifecycle.js';

export type UseSwapLifecycleParams<K extends SpokeChainKey = SpokeChainKey> = {
  /**
   * The swap to run. Changing it starts a new lifecycle once the current swap is done; one that may still
   * land (failed after broadcast, or an unconfirmed batch) holds until `reset()`.
   */
  intentParams: CreateIntentParams<K> | undefined;
  srcWalletProvider: GetWalletProviderType<K> | undefined;
  /**
   * Destination wallet, for the Stellar and NEAR setup actions. The gates check `intentParams.dstAddress`,
   * the account the swap pays, so this wallet must control it for those actions to clear them.
   */
  dstWalletProvider: GetWalletProviderType<SpokeChainKey> | undefined;
  /** Source-chain switching, e.g. `useEvmSwitchChain` from `@sodax/wallet-sdk-react`. */
  chainSwitch?: { isWrongChain: boolean; switchChain: () => void | Promise<void> };
  /** An app-owned prerequisite that must hold before swapping (e.g. a Bitcoin trading-wallet setup). */
  externalBlocked?: boolean;
  /**
   * `false` approves separately instead of asking a `'ready'` wallet to upgrade the account (e.g. after
   * the user declined: `USER_REJECTED` with `context.reason === ACCOUNT_UPGRADE_DECLINED`). Defaults to `true`.
   */
  allowAccountUpgrade?: boolean;
  extras?: SwapExtras<K>;
  timeout?: number;
  mutationOptions?: MutationHookOptions<SwapWithApprovalResponse, UseSwapWithApprovalVars<K>>;
};

export type SwapLifecycle<K extends SpokeChainKey = SpokeChainKey> = {
  state: SwapLifecycleState;
  /** The error behind `failed`, `unconfirmed` or a `pending` with one. Setup-action failures come back from `next()`. */
  error: Error | undefined;
  /**
   * Does what the current state needs: switch chain, resolve a setup step, swap, re-check an `unconfirmed`
   * batch (finishing the swap once it lands, never sending it again), or start over after a settled or
   * failed swap. Does nothing while waiting or while a previous call is still running.
   */
  next: () => Promise<Result<unknown> | undefined>;
  /**
   * Stops tracking the current swap and re-reads the approval strategy. Cancels nothing on-chain; a no-op
   * while the swap call is still in flight.
   */
  reset: () => void;
  // Escape hatches: the composed hooks, for UIs that need more than `state`.
  approvalStrategy: UseQueryResult<SwapApprovalStrategy, Error>;
  swap: SafeUseMutationResult<SwapWithApprovalResponse, Error, UseSwapWithApprovalVars<K>>;
  status: UseQueryResult<UseDetailedStatusResult>;
  stellar: StellarGate;
  nearStorage: NearStorageGate;
};

/**
 * One hook for a swap form: approval strategy, destination prerequisites (Stellar account and
 * trustline, NEAR storage), source-chain switching, the swap itself (`useSwapWithApproval` — one
 * signature on an EIP-5792 wallet) and its status (`useDetailedStatus`), as a single discriminated
 * `state` with one `next()` action. Render from `state.kind`; wire the button to `next()`.
 *
 * Headless and additive: the granular hooks are unchanged, and each one this composes is returned.
 * Wallet-layer concerns (chain switching, app-owned setup) are passed in, because dapp-kit does not
 * depend on the wallet packages.
 */
export function useSwapLifecycle<K extends SpokeChainKey = SpokeChainKey>({
  intentParams,
  srcWalletProvider,
  dstWalletProvider,
  chainSwitch,
  externalBlocked = false,
  allowAccountUpgrade,
  extras,
  timeout,
  mutationOptions,
}: UseSwapLifecycleParams<K>): SwapLifecycle<K> {
  const approvalStrategy = useSwapApprovalStrategy<K>({
    params: { payload: intentParams, walletProvider: srcWalletProvider, allowAccountUpgrade },
  });
  const swap = useSwapWithApproval<K>({ mutationOptions });
  const stellar = useStellarGate({
    dstChainKey: intentParams?.dstChainKey,
    token: intentParams?.outputToken,
    amount: intentParams?.minOutputAmount,
    address: intentParams?.dstAddress,
    walletProvider: dstWalletProvider,
  });
  const nearStorage = useNearStorageGate({
    dstChainKey: intentParams?.dstChainKey,
    token: intentParams?.outputToken,
    accountId: intentParams?.dstAddress,
    walletProvider: dstWalletProvider,
  });

  // The setup mutations invalidate these checks without awaiting the refetch, so a stale "needs setup"
  // outlives the tx by one read.
  const fetchingSetupChecks =
    useIsFetching({ queryKey: ['sponsoring', 'stellarAccountStatus'] }) +
    useIsFetching({ queryKey: ['shared', 'stellarTrustlineCheck'] }) +
    useIsFetching({ queryKey: ['shared', 'nearStorageCheck'] });

  const attempt = toSwapAttempt(swap, intentParams);
  const broadcast = attempt.phase === 'broadcast' ? attempt : undefined;
  const status = useDetailedStatus({
    params: { srcChainKey: broadcast?.srcChainKey, srcTxHash: broadcast?.srcTxHash },
  });

  const state = resolveSwapLifecycle({
    attempt,
    status: status.data?.ok ? summarizeSwapStatus(status.data.value) : undefined,
    statusError: status.data && !status.data.ok && isAuthFailure(status.data.error) ? status.data.error : undefined,
    hasInputs: !!intentParams && !!srcWalletProvider,
    stellar,
    nearStorage,
    externalBlocked,
    setupBusy:
      stellar.isActivating || stellar.isRequestingTrustline || nearStorage.isRegistering || fetchingSetupChecks > 0,
    isWrongChain: chainSwitch?.isWrongChain ?? false,
    strategy: { data: approvalStrategy.data, error: approvalStrategy.error },
  });

  const reset = (): void => {
    // Resetting mid-call would detach the observer and re-enable the button while the swap still runs.
    if (swap.isPending) return;
    swap.reset();
    void approvalStrategy.refetch();
  };

  const act = async (): Promise<Result<unknown> | undefined> => {
    switch (state.kind) {
      case 'needsChainSwitch':
        await chainSwitch?.switchChain();
        return undefined;
      case 'needsSetup':
        if (state.reason === 'stellarActivation') return stellar.activate();
        if (state.reason === 'stellarTrustline') return stellar.requestTrustline();
        if (state.reason === 'nearStorage') return nearStorage.registerStorage();
        if (state.reason === 'stellarCheckFailed') stellar.retry();
        if (state.reason === 'nearStorageCheckFailed') nearStorage.retry();
        // `stellarFunding` and `external` are for the app to resolve.
        return undefined;
      case 'ready':
        if (!intentParams || !srcWalletProvider) return undefined;
        return swap.mutateAsyncSafe({
          params: intentParams,
          walletProvider: srcWalletProvider,
          allowAccountUpgrade,
          extras,
          timeout,
        });
      // Sending it again could swap twice, so this only waits for the batch the wallet already holds.
      case 'unconfirmed':
        if (!swap.variables) return undefined;
        return swap.mutateAsyncSafe({
          ...swap.variables,
          resumeBatchId: state.batchId,
          resumeBatchCallCount: state.callCount,
        });
      case 'settled':
      case 'failed':
        reset();
        return undefined;
      default:
        return undefined;
    }
  };

  // Two calls before React re-renders would both see `ready` and swap twice.
  const acting = useRef(false);
  const next = async (): Promise<Result<unknown> | undefined> => {
    if (acting.current) return undefined;
    acting.current = true;
    try {
      return await act();
    } finally {
      acting.current = false;
    }
  };

  return {
    state,
    error:
      state.kind === 'failed' || state.kind === 'unconfirmed' || state.kind === 'pending' ? state.error : undefined,
    next,
    reset,
    approvalStrategy,
    swap,
    status,
    stellar,
    nearStorage,
  };
}
