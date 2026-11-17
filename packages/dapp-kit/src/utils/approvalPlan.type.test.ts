/**
 * Compile-time contract: `runApprovalPlan` broadcasts an approval plan and resolves to the hashes it
 * sent, the reset hash optional.
 */
import type { IWalletProvider, RawTxReturnType, SpokeChainKey } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type {
  ApprovalHashes,
  ApprovalPlan,
  ApprovalProgress,
  ApprovalProgressListener,
  runApprovalPlan,
} from './approvalPlan.js';

type Hashes = { readonly resetTxHash?: string; readonly approveTxHash: string };
type Plan = { readonly tx: RawTxReturnType; readonly resetTx?: RawTxReturnType };
type Progress = {
  readonly step: 'allowance-reset' | 'approve';
  readonly phase: 'signing' | 'broadcast' | 'confirmed' | 'failed';
  readonly index: number;
  readonly total: number;
  readonly hash?: string;
  readonly error?: unknown;
};

describe('runApprovalPlan', () => {
  it('pins the plan, progress and result shapes', () => {
    expectTypeOf<ApprovalPlan>().toEqualTypeOf<Plan>();
    expectTypeOf<ApprovalHashes>().toEqualTypeOf<Hashes>();
    // `error` is `unknown` legitimately: it is whatever the wallet or RPC threw.
    expectTypeOf<ApprovalProgress>().toEqualTypeOf<Progress>();
    expectTypeOf<ApprovalProgressListener>().toEqualTypeOf<(progress: Progress) => void>();
  });

  it('takes the plan, a spoke chain, any wallet provider and a hook name', () => {
    expectTypeOf<Parameters<typeof runApprovalPlan>>().toEqualTypeOf<
      [
        args: {
          plan: Plan;
          srcChainKey: SpokeChainKey;
          walletProvider: IWalletProvider;
          hookName: string;
          onProgress?: (progress: Progress) => void;
        },
      ]
    >();
  });

  it('resolves to the broadcast hashes', () => {
    expectTypeOf<ReturnType<typeof runApprovalPlan>>().toEqualTypeOf<Promise<Hashes>>();
  });
});
