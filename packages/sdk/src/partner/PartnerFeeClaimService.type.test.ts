/**
 * Compile-time contract for `PartnerFeeClaimService`: the hub-only actions narrow their result by the
 * execution mode (the chain is fixed to the Sonic hub), inferred from the arguments; the rest are
 * pinned once.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type {
  AutoSwapPreferences,
  EvmRawTransaction,
  FeeTokenApproveParams,
  Hex,
  IEvmWalletProvider,
  Intent,
  IntentAutoSwapResult,
  ISolanaWalletProvider,
  OriginalAssetAddress,
  PartnerFeeClaimAssetBalance,
  PartnerFeeClaimCancelParams,
  PartnerFeeClaimSwapParams,
  Result,
  SetSwapPreferenceParams,
  SolverExecutionResponse,
  XToken,
} from '../index.js';
import type { PartnerFeeClaimService } from './PartnerFeeClaimService.js';

// Unwraps only an exact Promise, so a sync or `X | Promise<X>` result fails the row it is in.
type Unpromise<P> = [P] extends [Promise<infer V>] ? V : 'not a Promise';
type AwaitAll<T extends readonly unknown[]> = { -readonly [I in keyof T]: Unpromise<T[I]> };
type Settled<T extends Record<string, readonly unknown[]>> = { -readonly [F in keyof T]: AwaitAll<T[F]> };
// Columns: [walletProvider, raw: false, raw: true, runtime boolean]; the hub is EVM.
// Known gap against ADR 0001: declared as plain Result<T>, so the error is unknown.
type HubModes = [Result<Hex>, Result<Hex>, Result<EvmRawTransaction>, Result<Hex | EvmRawTransaction>];

declare const feeClaim: PartnerFeeClaimService;
declare const isRaw: boolean;
declare const evm: IEvmWalletProvider;
declare const solana: ISolanaWalletProvider;
declare const prefP: SetSwapPreferenceParams;
declare const approveP: FeeTokenApproveParams;
declare const swapP: PartnerFeeClaimSwapParams;
declare const cancelP: PartnerFeeClaimCancelParams;

// Never invoked: one row per hub action across the four execution modes.
const hubRows = () =>
  ({
    setSwapPreference: [
      feeClaim.setSwapPreference({ params: prefP, walletProvider: evm }),
      feeClaim.setSwapPreference({ params: prefP, raw: false, walletProvider: evm }),
      feeClaim.setSwapPreference({ params: prefP, raw: true }),
      feeClaim.setSwapPreference(
        isRaw ? { params: prefP, raw: true } : { params: prefP, raw: false, walletProvider: evm },
      ),
    ],
    approveToken: [
      feeClaim.approveToken({ params: approveP, walletProvider: evm }),
      feeClaim.approveToken({ params: approveP, raw: false, walletProvider: evm }),
      feeClaim.approveToken({ params: approveP, raw: true }),
      feeClaim.approveToken(
        isRaw ? { params: approveP, raw: true } : { params: approveP, raw: false, walletProvider: evm },
      ),
    ],
    createIntentAutoSwap: [
      feeClaim.createIntentAutoSwap({ params: swapP, walletProvider: evm }),
      feeClaim.createIntentAutoSwap({ params: swapP, raw: false, walletProvider: evm }),
      feeClaim.createIntentAutoSwap({ params: swapP, raw: true }),
      feeClaim.createIntentAutoSwap(
        isRaw ? { params: swapP, raw: true } : { params: swapP, raw: false, walletProvider: evm },
      ),
    ],
    cancelIntent: [
      feeClaim.cancelIntent({ params: cancelP, walletProvider: evm }),
      feeClaim.cancelIntent({ params: cancelP, raw: false, walletProvider: evm }),
      feeClaim.cancelIntent({ params: cancelP, raw: true }),
      feeClaim.cancelIntent(
        isRaw ? { params: cancelP, raw: true } : { params: cancelP, raw: false, walletProvider: evm },
      ),
    ],
  }) as const;

describe('PartnerFeeClaimService — hub actions', () => {
  it('each resolves to the hub hash when signed and the EVM unsigned tx with raw: true', () => {
    expectTypeOf<Settled<ReturnType<typeof hubRows>>>().toEqualTypeOf<{
      setSwapPreference: HubModes;
      approveToken: HubModes;
      createIntentAutoSwap: HubModes;
      cancelIntent: HubModes;
    }>();
  });

  it('swap is signed-only and returns the auto-swap result', () => {
    const call = () => feeClaim.swap({ params: swapP, walletProvider: evm });
    // Known gap against ADR 0001: declared as plain Result<T>, so the error is unknown.
    expectTypeOf<ReturnType<typeof call>>().toEqualTypeOf<Promise<Result<IntentAutoSwapResult>>>();
    expectTypeOf<IntentAutoSwapResult>().toEqualTypeOf<{
      srcTxHash: Hex;
      solverExecutionResponse: SolverExecutionResponse;
      intentTxHash: Hex;
    }>();
  });

  it('rejects invalid wallet / mode combinations', () => {
    const calls = () => [
      // @ts-expect-error — raw: true forbids a walletProvider.
      feeClaim.approveToken({ params: approveP, raw: true, walletProvider: evm }),
      // @ts-expect-error — a signed call needs a walletProvider.
      feeClaim.createIntentAutoSwap({ params: swapP }),
      // @ts-expect-error — hub actions take an EVM wallet provider.
      feeClaim.cancelIntent({ params: cancelP, walletProvider: solana }),
      // @ts-expect-error — hub actions take an EVM wallet provider.
      feeClaim.setSwapPreference({ params: prefP, walletProvider: solana }),
      // @ts-expect-error — swap is signed-only.
      feeClaim.swap({ params: swapP, raw: true }),
    ];
    expectTypeOf(calls).toBeFunction();
  });
});

describe('PartnerFeeClaimService — non-narrowing methods', () => {
  it('pins each result type', () => {
    expectTypeOf<ReturnType<PartnerFeeClaimService['getOriginalAssetAddress']>>().toEqualTypeOf<
      OriginalAssetAddress | undefined
    >();
    expectTypeOf<ReturnType<PartnerFeeClaimService['getSpokeTokenFromOriginalAssetAddress']>>().toEqualTypeOf<
      XToken | undefined
    >();
    expectTypeOf<ReturnType<PartnerFeeClaimService['fetchAssetsBalances']>>().toEqualTypeOf<
      Promise<Result<Map<string, PartnerFeeClaimAssetBalance>, Error>>
    >();
    expectTypeOf<ReturnType<PartnerFeeClaimService['getAutoSwapPreferences']>>().toEqualTypeOf<
      Promise<Result<AutoSwapPreferences, Error>>
    >();
    expectTypeOf<ReturnType<PartnerFeeClaimService['isTokenApproved']>>().toEqualTypeOf<
      Promise<Result<boolean, Error>>
    >();
    expectTypeOf<ReturnType<PartnerFeeClaimService['getUserIntent']>>().toEqualTypeOf<Promise<Result<Hex, Error>>>();
    expectTypeOf<ReturnType<PartnerFeeClaimService['getIntentDetails']>>().toEqualTypeOf<
      Promise<Result<Intent, Error>>
    >();
  });
});
