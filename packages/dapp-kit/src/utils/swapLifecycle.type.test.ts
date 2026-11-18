/**
 * Compile-time contract: the swap-lifecycle reducers compare intents, reduce a swap mutation to an
 * attempt, and derive the discriminated lifecycle state.
 */
import type {
  CreateIntentParams,
  Hex,
  SpokeChainKey,
  SwapApprovalStrategy,
  SwapStatusSummary,
  SwapWithApprovalResponse,
} from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { NearStorageGateState } from './nearStorageGate.js';
import type { StellarGateState } from './stellarGate.js';
import type {
  isSameIntent,
  resolveSwapLifecycle,
  SwapAttempt,
  SwapAttemptSource,
  SwapLifecycleInputs,
  SwapLifecycleState,
  SwapSetupReason,
  toSwapAttempt,
} from './swapLifecycle.js';

type Reason =
  | 'stellarActivation'
  | 'stellarFunding'
  | 'stellarTrustline'
  | 'stellarCheckFailed'
  | 'nearStorage'
  | 'nearStorageCheckFailed'
  | 'external';

type Attempt =
  | { phase: 'none' }
  | { phase: 'submitting' }
  | { phase: 'broadcast'; srcChainKey: SpokeChainKey; srcTxHash: string; error?: Error }
  | { phase: 'unconfirmed'; batchId: string; callCount?: number; error: Error }
  | { phase: 'failed'; error: Error };

type State =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'needsChainSwitch' }
  | { kind: 'needsSetup'; reason: Reason }
  | { kind: 'ready'; approvalStrategy: SwapApprovalStrategy }
  | { kind: 'submitting' }
  | { kind: 'pending'; srcChainKey: SpokeChainKey; srcTxHash: string; error?: Error }
  | { kind: 'unconfirmed'; batchId: string; callCount?: number; error: Error }
  | { kind: 'settled'; srcChainKey: SpokeChainKey; srcTxHash: string; fillTxHash?: Hex }
  | { kind: 'failed'; error: Error; srcChainKey?: SpokeChainKey; srcTxHash?: string };

type Source = {
  status: 'idle' | 'pending' | 'success' | 'error';
  data: SwapWithApprovalResponse | undefined;
  error: Error | null;
  variables: { params: CreateIntentParams } | undefined;
};

type Inputs = {
  attempt: Attempt;
  status: SwapStatusSummary | undefined;
  statusError: Error | undefined;
  hasInputs: boolean;
  stellar: StellarGateState;
  nearStorage: NearStorageGateState & { checkFailed?: boolean };
  externalBlocked: boolean;
  setupBusy: boolean;
  isWrongChain: boolean;
  strategy: { data: SwapApprovalStrategy | undefined; error: Error | null };
};

describe('isSameIntent', () => {
  it('compares two intents to a boolean', () => {
    expectTypeOf<Parameters<typeof isSameIntent>>().toEqualTypeOf<[a: CreateIntentParams, b: CreateIntentParams]>();
    expectTypeOf<ReturnType<typeof isSameIntent>>().toEqualTypeOf<boolean>();
  });
});

describe('toSwapAttempt', () => {
  it('reduces the mutation slice to the attempt union', () => {
    expectTypeOf<SwapAttemptSource>().toEqualTypeOf<Source>();
    expectTypeOf<Parameters<typeof toSwapAttempt>>().toEqualTypeOf<
      [mutation: Source, intentParams: CreateIntentParams | undefined]
    >();
    expectTypeOf<SwapAttempt>().toEqualTypeOf<Attempt>();
    expectTypeOf<ReturnType<typeof toSwapAttempt>>().toEqualTypeOf<Attempt>();
  });
});

describe('resolveSwapLifecycle', () => {
  it('derives the discriminated lifecycle state', () => {
    expectTypeOf<SwapSetupReason>().toEqualTypeOf<Reason>();
    expectTypeOf<SwapLifecycleInputs>().toEqualTypeOf<Inputs>();
    expectTypeOf<Parameters<typeof resolveSwapLifecycle>>().toEqualTypeOf<[inputs: Inputs]>();
    expectTypeOf<SwapLifecycleState>().toEqualTypeOf<State>();
    expectTypeOf<ReturnType<typeof resolveSwapLifecycle>>().toEqualTypeOf<State>();
  });

  it('narrows each state on its kind', () => {
    expectTypeOf<Extract<SwapLifecycleState, { kind: 'settled' }>['fillTxHash']>().toEqualTypeOf<Hex | undefined>();
    expectTypeOf<
      Extract<SwapLifecycleState, { kind: 'ready' }>['approvalStrategy']
    >().toEqualTypeOf<SwapApprovalStrategy>();
  });
});
