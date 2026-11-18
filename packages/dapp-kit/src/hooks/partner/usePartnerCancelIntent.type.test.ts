/**
 * Compile-time contract for `usePartnerCancelIntent`: a fixed-chain mutation (Sonic hub), so nothing narrows. Pins the
 * variables (wallet provider for that chain only, no `raw`) and the unwrapped `Hex` data.
 */
import type {
  Hex,
  HubChainKey,
  IEvmWalletProvider,
  ISolanaWalletProvider,
  PartnerFeeClaimCancelAction,
  PartnerFeeClaimCancelParams,
} from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { MutationHookParams } from '../shared/types.js';
import type { SafeUseMutationResult } from '../shared/useSafeMutation.js';
import type { usePartnerCancelIntent } from './usePartnerCancelIntent.js';

type Vars = Omit<PartnerFeeClaimCancelAction<HubChainKey, false>, 'raw'>;
type Hook = ReturnType<typeof usePartnerCancelIntent>;

declare const hook: Hook;
declare const params: PartnerFeeClaimCancelParams;
declare const wallet: IEvmWalletProvider;
declare const wrongWallet: ISolanaWalletProvider;

describe('usePartnerCancelIntent', () => {
  it('takes only mutationOptions typed to its data and variables', () => {
    expectTypeOf<Parameters<typeof usePartnerCancelIntent>[0]>().toEqualTypeOf<
      MutationHookParams<Hex, Vars> | undefined
    >();
  });

  it('returns the mutation result with its data and variables spelled out', () => {
    expectTypeOf<Hook>().toEqualTypeOf<SafeUseMutationResult<Hex, Error, Vars>>();
    expectTypeOf<Awaited<ReturnType<Hook['mutateAsync']>>>().toEqualTypeOf<Hex>();
    expectTypeOf<Parameters<Hook['mutate']>[0]['walletProvider']>().toEqualTypeOf<IEvmWalletProvider>();
  });

  it('rejects variables for another chain or execution mode', () => {
    const calls = () => [
      hook.mutate({ params, walletProvider: wallet }),
      // @ts-expect-error — a Solana wallet cannot sign on the hub
      hook.mutate({ params, walletProvider: wrongWallet }),
      // @ts-expect-error — the hook always signs; raw is not a variable
      hook.mutate({ params, walletProvider: wallet, raw: true }),
      // @ts-expect-error — a signed call needs a wallet provider
      hook.mutate({ params }),
    ];
    expectTypeOf(calls).toBeFunction();
  });
});
