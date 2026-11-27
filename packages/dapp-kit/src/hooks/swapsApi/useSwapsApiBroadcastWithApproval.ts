import {
  ATOMIC_BATCH_REFUSED,
  DEFAULT_RELAY_TX_TIMEOUT,
  SodaxError,
  getEvmViemChain,
  isEvmChainKeyType,
  isAtomicBatchRefusal,
  isEvmSpokeOnlyChainKeyType,
  resolveApprovalStrategy,
  sendApprovalBatch,
  type ApprovalOptions,
  type ApprovalStrategy,
  type CreateIntentParamsV2,
  type EvmRawTransaction,
  type Hash,
  type IEvmWalletProvider,
  type RequestOverrideConfig,
  type SpokeChainKey,
} from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import { waitForApiAllowance } from '../shared/waitForApiAllowance.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { runApprovalPlan, type ApprovalHashes, type ApprovalProgressListener } from '../../utils/approvalPlan.js';

const HOOK_NAME = 'useSwapsApiBroadcastWithApproval';

export type UseSwapsApiBroadcastWithApprovalVars = ApprovalOptions & {
  /** The swap's create-intent params — the same body `/swaps/intents` built `intentTx` from. */
  body: CreateIntentParamsV2;
  /** The unsigned source transaction `/swaps/intents` returned for `body`. */
  intentTx: EvmRawTransaction;
  walletProvider: IEvmWalletProvider;
  apiConfig?: RequestOverrideConfig;
  /** Progress of a separate approval, hashes included. A batch is one prompt and reports nothing. */
  onProgress?: ApprovalProgressListener;
  /** Fires once the wallet accepts the batch; persist both so `confirmApprovalBatch` can resume an unconfirmed one. */
  onBatchSent?: (batchId: string, callCount: number) => void;
  /**
   * On refusal or no batch support: approve, then send this `intentTx` (default: reject, send nothing).
   * `intentTx` predates the approval, so its deadline and quote must outlast the approval wait.
   */
  fallbackOnRefusal?: boolean;
};

export type SwapsApiBroadcastWithApprovalResult = {
  /** The source transaction carrying the deposit — what `/swaps/submit-tx` takes as `txHash`. */
  txHash: Hash;
  approvalStrategy: Exclude<ApprovalStrategy, 'not-required'>;
  /** The separate approval's hashes, when it ran on its own (`'sequential'`). */
  approval?: ApprovalHashes;
};

const sameAddress = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/**
 * Sends the approval and EVM `intentTx` as one EIP-5792 batch; a batch the user saw is never resent.
 * Unconfirmed batch → `TX_VERIFICATION_FAILED` (may still land: resume via `confirmApprovalBatch`, never re-swap).
 */
export const useSwapsApiBroadcastWithApproval = ({
  mutationOptions,
}: MutationHookParams<
  SwapsApiBroadcastWithApprovalResult,
  UseSwapsApiBroadcastWithApprovalVars
> = {}): SafeUseMutationResult<SwapsApiBroadcastWithApprovalResult, Error, UseSwapsApiBroadcastWithApprovalVars> => {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<SwapsApiBroadcastWithApprovalResult, Error, UseSwapsApiBroadcastWithApprovalVars>({
    mutationKey: ['swapsApi', 'broadcastWithApproval'],
    ...mutationOptions,
    mutationFn: async ({
      body,
      intentTx,
      walletProvider,
      apiConfig,
      allowAccountUpgrade,
      onProgress,
      onBatchSent,
      fallbackOnRefusal = false,
    }): Promise<SwapsApiBroadcastWithApprovalResult> => {
      const srcChainKey = body.srcChainKey as SpokeChainKey;
      if (!isEvmChainKeyType(srcChainKey)) {
        throw new Error(`[${HOOK_NAME}] ${body.srcChainKey} is not an EVM chain; approve and sign it separately.`);
      }

      // The backend call stays ahead of any wallet call: `_apiKeyWire.test.ts` pins it as the first step.
      const plan = unwrapResult(await sodax.api.swaps.approve(body, apiConfig));

      const account = await walletProvider.getWalletAddress();
      if (!sameAddress(account, body.srcAddress) || !sameAddress(account, intentTx.from)) {
        throw new Error(`[${HOOK_NAME}] the connected account is not the swap's source address.`);
      }

      const strategy = await resolveApprovalStrategy({ srcChainKey, walletProvider, allowAccountUpgrade });
      if (strategy === 'atomic-batch' && isEvmSpokeOnlyChainKeyType(srcChainKey)) {
        // The swaps-api client parses each tx with the source chain's schema: an EVM source yields EVM txs.
        const approvalTxs = (plan.resetTx ? [plan.resetTx, plan.tx] : [plan.tx]) as EvmRawTransaction[];
        const txs = [...approvalTxs, intentTx];
        const sent = await sendApprovalBatch({
          walletProvider,
          srcChainKey,
          txs,
          timeoutMs: DEFAULT_RELAY_TX_TIMEOUT,
          feature: 'swap',
          context: { srcChainKey, dstChainKey: body.dstChainKey, action: HOOK_NAME, approvalStrategy: strategy },
          onBatchSent: onBatchSent && (batchId => onBatchSent(batchId, txs.length)),
        });
        // Only a refusal before signing may approve separately: nothing was sent, so nothing can duplicate.
        if (sent.ok || !isAtomicBatchRefusal(sent.error) || !fallbackOnRefusal) {
          return { txHash: unwrapResult(sent).txHash, approvalStrategy: 'atomic-batch' };
        }
      } else if (!fallbackOnRefusal) {
        // The two-step path is the caller's, so a wallet that cannot batch is handed back like a refusal.
        throw new SodaxError(
          'INTENT_CREATION_FAILED',
          `[${HOOK_NAME}] the wallet cannot send this approval as a batch.`,
          {
            feature: 'swap',
            context: {
              srcChainKey,
              dstChainKey: body.dstChainKey,
              action: HOOK_NAME,
              approvalStrategy: strategy,
              phase: 'intentCreation',
              reason: ATOMIC_BATCH_REFUSED,
            },
          },
        );
      }

      const approval = await runApprovalPlan({ plan, srcChainKey, walletProvider, hookName: HOOK_NAME, onProgress });
      await waitForApiAllowance(config => sodax.api.swaps.checkAllowance(body, config), apiConfig);
      // The allowance is on-chain whatever happens to the intent next; a stale cached `valid: false` would re-offer it.
      await queryClient.invalidateQueries({ queryKey: ['swapsApi', 'allowance'] });
      const txHash = await walletProvider.sendTransaction(intentTx, {
        expectedChainId: getEvmViemChain(srcChainKey).id,
      });
      return { txHash, approvalStrategy: 'sequential', approval };
    },
    onSuccess: async (data, vars, ctx) => {
      // Awaited, as in useSwapsApiApproveAndBroadcast: a stale cached `valid: false` must not re-enable approval.
      await queryClient.invalidateQueries({ queryKey: ['swapsApi', 'allowance'] });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
};
