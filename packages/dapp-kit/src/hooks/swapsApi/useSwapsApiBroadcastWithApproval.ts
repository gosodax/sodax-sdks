import {
  ATOMIC_BATCH_REFUSED,
  DEFAULT_RELAY_TX_TIMEOUT,
  getEvmViemChain,
  isEvmChainKeyType,
  isEvmSpokeOnlyChainKeyType,
  resolveApprovalStrategy,
  sendApprovalBatch,
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
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { runApprovalPlan, type ApprovalHashes, type ApprovalProgressListener } from '../../utils/approvalPlan.js';

const HOOK_NAME = 'useSwapsApiBroadcastWithApproval';

export type UseSwapsApiBroadcastWithApprovalVars = {
  /** The swap's create-intent params — the same body `/swaps/intents` built `intentTx` from. */
  body: CreateIntentParamsV2;
  /** The unsigned source transaction `/swaps/intents` returned for `body`. */
  intentTx: EvmRawTransaction;
  walletProvider: IEvmWalletProvider;
  apiConfig?: RequestOverrideConfig;
  /**
   * Whether a wallet that must first upgrade the account to batch (EIP-5792 `'ready'`, e.g. a MetaMask
   * EOA becoming a smart account) may be asked to. `false` approves separately instead. Defaults to `true`.
   */
  allowAccountUpgrade?: boolean;
  /** Progress of a separate approval. A batch is one prompt and reports nothing. */
  onProgress?: ApprovalProgressListener;
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
 * React hook that broadcasts a swaps-API intent transaction whose source-token allowance is short,
 * with the approval folded in: on an EIP-5792 wallet, the approval and `intentTx` go out as **one
 * atomic batch — one signature**; otherwise the approval is sent and confirmed first (via
 * {@link runApprovalPlan}), then `intentTx`.
 *
 * Call it instead of `useSwapsApiApproveAndBroadcast` + signing `intentTx` yourself, when
 * `/swaps/allowance/check` says the allowance is short and the source is an EVM chain. It stops at
 * the broadcast: persist `txHash` and then call `/swaps/submit-tx` as before.
 *
 * The rules match the SDK's `swapWithApproval`. The Sonic hub always approves separately. A wallet
 * that refuses the batch before signing falls back to approving separately; a batch the user saw is
 * never resent:
 * - rejected → `SodaxError` `USER_REJECTED`, with `context.reason: ACCOUNT_UPGRADE_DECLINED` when the
 *   user declined the account upgrade — retry with `allowAccountUpgrade: false`;
 * - never included or fully reverted → `INTENT_CREATION_FAILED`, `context.reason: 'atomic-batch-failed'`;
 * - sent but not confirmed → `TX_VERIFICATION_FAILED`, `context.reason: ATOMIC_BATCH_UNCONFIRMED`. It
 *   may still land: do not let the user swap again blindly.
 *
 * Errors from a separate approval or intent send are the wallet's own, as with
 * `useSwapsApiApproveAndBroadcast`.
 *
 * @example
 * const { mutateAsyncSafe: broadcast } = useSwapsApiBroadcastWithApproval();
 * const created = await sodax.api.swaps.createIntent(body);
 * const result = await broadcast({ body, intentTx: created.value.tx as EvmRawTransaction, walletProvider });
 * if (result.ok) await submitTx({ txHash: result.value.txHash, ... });
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
    }): Promise<SwapsApiBroadcastWithApprovalResult> => {
      const srcChainKey = body.srcChainKey as SpokeChainKey;
      if (!isEvmChainKeyType(srcChainKey)) {
        throw new Error(`[${HOOK_NAME}] ${body.srcChainKey} is not an EVM chain; approve and sign it separately.`);
      }

      const plan = unwrapResult(await sodax.api.swaps.approve(body, apiConfig));

      const account = await walletProvider.getWalletAddress();
      if (!sameAddress(account, body.srcAddress) || !sameAddress(account, intentTx.from)) {
        throw new Error(`[${HOOK_NAME}] the connected account is not the swap's source address.`);
      }

      const strategy = await resolveApprovalStrategy({ srcChainKey, walletProvider, allowAccountUpgrade });
      if (strategy === 'atomic-batch' && isEvmSpokeOnlyChainKeyType(srcChainKey)) {
        // The swaps-api client parses each tx with the source chain's schema: an EVM source yields EVM txs.
        const approvalTxs = (plan.resetTx ? [plan.resetTx, plan.tx] : [plan.tx]) as EvmRawTransaction[];
        const sent = await sendApprovalBatch({
          walletProvider,
          srcChainKey,
          txs: [...approvalTxs, intentTx],
          timeoutMs: DEFAULT_RELAY_TX_TIMEOUT,
          feature: 'swap',
          context: { srcChainKey, dstChainKey: body.dstChainKey, action: HOOK_NAME, approvalStrategy: strategy },
        });
        if (sent.ok || sent.error.context?.reason !== ATOMIC_BATCH_REFUSED) {
          return { txHash: unwrapResult(sent).txHash, approvalStrategy: 'atomic-batch' };
        }
        // Refused before anything was signed, so approving separately cannot duplicate anything.
      }

      const approval = await runApprovalPlan({ plan, srcChainKey, walletProvider, hookName: HOOK_NAME, onProgress });
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
