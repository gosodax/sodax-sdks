/** Pins the EIP-5792 primitives: the `canSendAtomicBatch` guard and the support / refusal reads. */
import { describe, expectTypeOf, it } from 'vitest';
import type { EvmAtomicBatchSupport, IEvmWalletProvider } from '../../index.js';
import {
  canSendAtomicBatch,
  type isAccountUpgradeDeclined,
  type isAtomicBatchRefused,
  type readAtomicBatchSupport,
} from './evmAtomicBatch.js';

describe('shared/utils/evmAtomicBatch', () => {
  it('canSendAtomicBatch narrows to a provider with all three batch methods required', () => {
    expectTypeOf(canSendAtomicBatch).guards.toEqualTypeOf<
      IEvmWalletProvider &
        Required<Pick<IEvmWalletProvider, 'getAtomicBatchSupport' | 'sendAtomicBatch' | 'waitForBatch'>>
    >();
  });

  it('readAtomicBatchSupport resolves to the support level', () => {
    expectTypeOf<ReturnType<typeof readAtomicBatchSupport>>().toEqualTypeOf<Promise<EvmAtomicBatchSupport>>();
    expectTypeOf<EvmAtomicBatchSupport>().toEqualTypeOf<'supported' | 'ready' | 'unsupported'>();
  });

  it('refusal checks return boolean', () => {
    expectTypeOf<ReturnType<typeof isAtomicBatchRefused>>().toEqualTypeOf<boolean>();
    expectTypeOf<ReturnType<typeof isAccountUpgradeDeclined>>().toEqualTypeOf<boolean>();
  });
});
