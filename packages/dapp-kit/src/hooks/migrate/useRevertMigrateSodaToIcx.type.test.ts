/**
 * Compile-time contract for `useRevertMigrateSodaToIcx`: a fixed-chain mutation (Sonic hub source), so nothing narrows. Pins the
 * variables (wallet provider for that chain only, no `raw`) and the unwrapped `TxHashPair` data.
 */
import type {
  IcxCreateRevertMigrationParams,
  IcxRevertMigrationAction,
  IEvmWalletProvider,
  IIconWalletProvider,
  TxHashPair,
} from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { MutationHookParams } from '../shared/types.js';
import type { SafeUseMutationResult } from '../shared/useSafeMutation.js';
import type { useRevertMigrateSodaToIcx } from './useRevertMigrateSodaToIcx.js';

type Vars = Omit<IcxRevertMigrationAction<false>, 'raw'>;
type Hook = ReturnType<typeof useRevertMigrateSodaToIcx>;

declare const hook: Hook;
declare const params: IcxCreateRevertMigrationParams;
declare const wallet: IEvmWalletProvider;
declare const wrongWallet: IIconWalletProvider;

describe('useRevertMigrateSodaToIcx', () => {
  it('takes only mutationOptions typed to its data and variables', () => {
    expectTypeOf<Parameters<typeof useRevertMigrateSodaToIcx>[0]>().toEqualTypeOf<
      MutationHookParams<TxHashPair, Vars> | undefined
    >();
  });

  it('returns the mutation result with its data and variables spelled out', () => {
    expectTypeOf<Hook>().toEqualTypeOf<SafeUseMutationResult<TxHashPair, Error, Vars>>();
    expectTypeOf<Awaited<ReturnType<Hook['mutateAsync']>>>().toEqualTypeOf<TxHashPair>();
    expectTypeOf<Parameters<Hook['mutate']>[0]['walletProvider']>().toEqualTypeOf<IEvmWalletProvider>();
  });

  it('rejects variables for another chain or execution mode', () => {
    const calls = () => [
      hook.mutate({ params, walletProvider: wallet }),
      // @ts-expect-error — an ICON wallet cannot sign on the hub
      hook.mutate({ params, walletProvider: wrongWallet }),
      // @ts-expect-error — the hook always signs; raw is not a variable
      hook.mutate({ params, walletProvider: wallet, raw: true }),
      // @ts-expect-error — a signed call needs a wallet provider
      hook.mutate({ params }),
    ];
    expectTypeOf(calls).toBeFunction();
  });
});
