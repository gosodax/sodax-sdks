/** Pins useSwapsApiBroadcastWithApproval: EVM-only variables, its options and the broadcast result. */
import type {
  ApprovalOptions,
  ApprovalStrategy,
  CreateIntentParamsV2,
  EvmRawTransaction,
  Hash,
  IEvmWalletProvider,
  ISuiWalletProvider,
  RequestOverrideConfig,
} from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { ApprovalHashes, ApprovalProgressListener } from '../../utils/approvalPlan.js';
import type { MutationHookOptions } from '../shared/types.js';
import type { SafeUseMutationResult } from '../shared/useSafeMutation.js';
import type {
  SwapsApiBroadcastWithApprovalResult,
  UseSwapsApiBroadcastWithApprovalVars,
  useSwapsApiBroadcastWithApproval,
} from './useSwapsApiBroadcastWithApproval.js';

describe('useSwapsApiBroadcastWithApproval', () => {
  it('takes only mutation options; the EVM-only inputs arrive through mutate()', () => {
    expectTypeOf<Parameters<typeof useSwapsApiBroadcastWithApproval>>().toEqualTypeOf<
      [
        {
          mutationOptions?: MutationHookOptions<
            SwapsApiBroadcastWithApprovalResult,
            UseSwapsApiBroadcastWithApprovalVars
          >;
        }?,
      ]
    >();
    expectTypeOf<ApprovalOptions>().toEqualTypeOf<{ allowAccountUpgrade?: boolean }>();
    expectTypeOf<UseSwapsApiBroadcastWithApprovalVars>().toEqualTypeOf<
      ApprovalOptions & {
        body: CreateIntentParamsV2;
        intentTx: EvmRawTransaction;
        walletProvider: IEvmWalletProvider;
        apiConfig?: RequestOverrideConfig;
        onProgress?: ApprovalProgressListener;
        onBatchSent?: (batchId: string, callCount: number) => void;
        fallbackOnRefusal?: boolean;
      }
    >();
  });

  it('resolves to the deposit hash and the strategy that ran', () => {
    expectTypeOf<ReturnType<typeof useSwapsApiBroadcastWithApproval>>().toEqualTypeOf<
      SafeUseMutationResult<SwapsApiBroadcastWithApprovalResult, Error, UseSwapsApiBroadcastWithApprovalVars>
    >();
    expectTypeOf<SwapsApiBroadcastWithApprovalResult>().toEqualTypeOf<{
      txHash: Hash;
      approvalStrategy: Exclude<ApprovalStrategy, 'not-required'>;
      approval?: ApprovalHashes;
    }>();
    expectTypeOf<NonNullable<ReturnType<typeof useSwapsApiBroadcastWithApproval>['data']>>().toEqualTypeOf<{
      txHash: Hash;
      approvalStrategy: Exclude<ApprovalStrategy, 'not-required'>;
      approval?: ApprovalHashes;
    }>();
    expectTypeOf<Exclude<ApprovalStrategy, 'not-required'>>().toEqualTypeOf<'atomic-batch' | 'sequential'>();
  });

  it('rejects a non-EVM wallet provider', () => {
    const suiProvider = (
      broadcast: ReturnType<typeof useSwapsApiBroadcastWithApproval>,
      body: CreateIntentParamsV2,
      intentTx: EvmRawTransaction,
      walletProvider: ISuiWalletProvider,
    ) =>
      // @ts-expect-error — the batch path signs with an EVM wallet only
      broadcast.mutate({ body, intentTx, walletProvider });
    expectTypeOf(suiProvider).returns.toBeVoid();
  });
});
