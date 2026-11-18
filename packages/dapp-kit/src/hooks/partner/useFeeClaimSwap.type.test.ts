/**
 * Compile-time contract for `useFeeClaimSwap`: a fixed-chain mutation (Sonic hub), so nothing narrows. Pins the
 * variables (wallet provider for that chain only, no `raw`) and the unwrapped `IntentAutoSwapResult` data.
 */
import type {
  HubChainKey,
  IEvmWalletProvider,
  IntentAutoSwapResult,
  ISolanaWalletProvider,
  PartnerFeeClaimSwapAction,
  PartnerFeeClaimSwapParams,
} from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { MutationHookParams } from '../shared/types.js';
import type { SafeUseMutationResult } from '../shared/useSafeMutation.js';
import type { useFeeClaimSwap } from './useFeeClaimSwap.js';

type Vars = Omit<PartnerFeeClaimSwapAction<HubChainKey, false>, 'raw'>;
type Hook = ReturnType<typeof useFeeClaimSwap>;

declare const hook: Hook;
declare const params: PartnerFeeClaimSwapParams;
declare const wallet: IEvmWalletProvider;
declare const wrongWallet: ISolanaWalletProvider;

describe('useFeeClaimSwap', () => {
  it('takes only mutationOptions typed to its data and variables', () => {
    expectTypeOf<Parameters<typeof useFeeClaimSwap>[0]>().toEqualTypeOf<
      MutationHookParams<IntentAutoSwapResult, Vars> | undefined
    >();
  });

  it('returns the mutation result with its data and variables spelled out', () => {
    expectTypeOf<Hook>().toEqualTypeOf<SafeUseMutationResult<IntentAutoSwapResult, Error, Vars>>();
    expectTypeOf<Awaited<ReturnType<Hook['mutateAsync']>>>().toEqualTypeOf<IntentAutoSwapResult>();
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
