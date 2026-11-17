/**
 * Compile-time contract: `useStellarGate` takes the destination inputs and returns the gate state
 * plus actions resolving to the SDK results or `undefined`.
 */
import type { ActivateStellarAccountResult, IWalletProvider, Result, SpokeChainKey } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { StellarGate, UseStellarGateParams, useStellarGate } from './useStellarGate.js';

type Params = {
  dstChainKey: SpokeChainKey | undefined;
  token: string | undefined;
  amount: bigint | undefined;
  address: string | undefined;
  walletProvider: IWalletProvider | undefined;
};

type Gate = {
  isStellar: boolean;
  needsActivation: boolean;
  needsFunding: boolean;
  needsTrustline: boolean;
  checkFailed: boolean;
  blocksAction: boolean;
  isChecking: boolean;
  error: Error | undefined;
  retry: () => void;
  isActivating: boolean;
  isRequestingTrustline: boolean;
  activate: () => Promise<Result<ActivateStellarAccountResult> | undefined>;
  requestTrustline: () => Promise<Result<string> | undefined>;
};

describe('useStellarGate', () => {
  it('accepts any spoke destination and any wallet provider', () => {
    expectTypeOf<UseStellarGateParams>().toEqualTypeOf<Params>();
    expectTypeOf<Parameters<typeof useStellarGate>>().toEqualTypeOf<[params: Params]>();
  });

  it('returns the gate', () => {
    expectTypeOf<StellarGate>().toEqualTypeOf<Gate>();
    expectTypeOf<ReturnType<typeof useStellarGate>>().toEqualTypeOf<Gate>();
  });
});
