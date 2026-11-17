/**
 * Compile-time contract: `useNearStorageGate` takes the destination inputs and returns the full
 * gate, whose `registerStorage` resolves to the SDK result or `undefined`.
 */
import type { GetWalletProviderType, IWalletProvider, Result, SpokeChainKey } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { NearStorageGate, UseNearStorageGateParams, useNearStorageGate } from './useNearStorageGate.js';

type Params = {
  dstChainKey: SpokeChainKey | undefined;
  token: string | undefined;
  accountId: string | undefined;
  walletProvider: IWalletProvider | undefined;
};

type Gate = {
  isNear: boolean;
  needsRegistration: boolean;
  blocksAction: boolean;
  isChecking: boolean;
  checkFailed: boolean;
  retry: () => void;
  isRegistering: boolean;
  registerStorage: () => Promise<Result<string> | undefined>;
};

describe('useNearStorageGate', () => {
  it('accepts any spoke destination and any wallet provider', () => {
    expectTypeOf<GetWalletProviderType<SpokeChainKey>>().toEqualTypeOf<IWalletProvider>();
    expectTypeOf<UseNearStorageGateParams>().toEqualTypeOf<Params>();
    expectTypeOf<Parameters<typeof useNearStorageGate>>().toEqualTypeOf<[params: Params]>();
  });

  it('returns the gate', () => {
    expectTypeOf<NearStorageGate>().toEqualTypeOf<Gate>();
    expectTypeOf<ReturnType<typeof useNearStorageGate>>().toEqualTypeOf<Gate>();
  });
});
