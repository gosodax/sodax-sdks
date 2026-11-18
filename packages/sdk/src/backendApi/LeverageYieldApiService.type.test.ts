/**
 * Compile-time contract for `LeverageYieldApiService`: every `/leverage-yield/*` method resolves to
 * `Promise<Result<…>>` of its exact v2 response type. None of them narrows on its inputs.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type {
  AllowanceCheckResponseV2,
  ApproveResponseV2,
  CancelIntentResponseV2,
  CreateIntentResponseV2,
  DeadlineResponseV2,
  FeeResponseV2,
  GasEstimateResponseV2,
  GetIntentResponseV2,
  GetLeverageVaultResponseV2,
  GetLeverageVaultsResponseV2,
  IntentExtraDataResponseV2,
  IntentHashResponseV2,
  IntentPacketResponseV2,
  IntentStateV2,
  LeverageYieldAprV2,
  LeverageYieldEffectiveAprV2,
  LeverageYieldLsdAprV2,
  LeverageYieldPositionV2,
  MaxWithdrawResponseV2,
  PreviewDepositResponseV2,
  PreviewRedeemResponseV2,
  PreviewWithdrawResponseV2,
  QuoteResponseV2,
  Result,
  ShareBalanceResponseV2,
  StatusResponseV2,
  SubmitIntentResponseV2,
  SubmitTxResponseV2,
  SubmitTxStatusResponseV2,
  VaultAssetResponseV2,
  VaultTotalAssetsResponseV2,
} from '../index.js';
import type { SodaxError } from '../errors/SodaxError.js';
import type { LeverageYieldApiService } from './LeverageYieldApiService.js';

type Svc = LeverageYieldApiService;
type R<T> = Promise<Result<T, SodaxError<'EXTERNAL_API_ERROR'>>>;
type Err<P> = Awaited<P> extends infer U ? (U extends { ok: false; error: infer E } ? E : never) : never;

describe('LeverageYieldApiService', () => {
  it('vault read endpoints', () => {
    expectTypeOf<ReturnType<Svc['getVaults']>>().toEqualTypeOf<R<GetLeverageVaultsResponseV2>>();
    expectTypeOf<ReturnType<Svc['getVault']>>().toEqualTypeOf<R<GetLeverageVaultResponseV2>>();
    expectTypeOf<ReturnType<Svc['getAsset']>>().toEqualTypeOf<R<VaultAssetResponseV2>>();
    expectTypeOf<ReturnType<Svc['getPosition']>>().toEqualTypeOf<R<LeverageYieldPositionV2>>();
    expectTypeOf<ReturnType<Svc['getApr']>>().toEqualTypeOf<R<LeverageYieldAprV2>>();
    expectTypeOf<ReturnType<Svc['getEffectiveApr']>>().toEqualTypeOf<R<LeverageYieldEffectiveAprV2>>();
    expectTypeOf<ReturnType<Svc['getLsdApr']>>().toEqualTypeOf<R<LeverageYieldLsdAprV2>>();
    expectTypeOf<ReturnType<Svc['getTotalAssets']>>().toEqualTypeOf<R<VaultTotalAssetsResponseV2>>();
    expectTypeOf<ReturnType<Svc['previewDeposit']>>().toEqualTypeOf<R<PreviewDepositResponseV2>>();
    expectTypeOf<ReturnType<Svc['previewWithdraw']>>().toEqualTypeOf<R<PreviewWithdrawResponseV2>>();
    expectTypeOf<ReturnType<Svc['previewRedeem']>>().toEqualTypeOf<R<PreviewRedeemResponseV2>>();
    expectTypeOf<ReturnType<Svc['getShareBalance']>>().toEqualTypeOf<R<ShareBalanceResponseV2>>();
    expectTypeOf<ReturnType<Svc['getMaxWithdraw']>>().toEqualTypeOf<R<MaxWithdrawResponseV2>>();
  });

  it('quote, fee and gas endpoints', () => {
    expectTypeOf<ReturnType<Svc['getDepositQuote']>>().toEqualTypeOf<R<QuoteResponseV2>>();
    expectTypeOf<ReturnType<Svc['getWithdrawQuote']>>().toEqualTypeOf<R<QuoteResponseV2>>();
    expectTypeOf<ReturnType<Svc['getDeadline']>>().toEqualTypeOf<R<DeadlineResponseV2>>();
    expectTypeOf<ReturnType<Svc['getPartnerFee']>>().toEqualTypeOf<R<FeeResponseV2>>();
    expectTypeOf<ReturnType<Svc['getSolverFee']>>().toEqualTypeOf<R<FeeResponseV2>>();
    expectTypeOf<ReturnType<Svc['estimateGas']>>().toEqualTypeOf<R<GasEstimateResponseV2>>();
    // Gas estimate shape varies per chain family and the request names the chain only as `string`.
    expectTypeOf<GasEstimateResponseV2['gas']>().toBeUnknown();
  });

  it('transaction-building endpoints', () => {
    expectTypeOf<ReturnType<Svc['checkAllowance']>>().toEqualTypeOf<R<AllowanceCheckResponseV2>>();
    expectTypeOf<ReturnType<Svc['approve']>>().toEqualTypeOf<R<ApproveResponseV2>>();
    expectTypeOf<ReturnType<Svc['createDepositIntent']>>().toEqualTypeOf<R<CreateIntentResponseV2>>();
    expectTypeOf<ReturnType<Svc['createWithdrawIntent']>>().toEqualTypeOf<R<CreateIntentResponseV2>>();
    expectTypeOf<ReturnType<Svc['cancelIntent']>>().toEqualTypeOf<R<CancelIntentResponseV2>>();
  });

  it('intent lifecycle endpoints', () => {
    expectTypeOf<ReturnType<Svc['submitIntent']>>().toEqualTypeOf<R<SubmitIntentResponseV2>>();
    // Raw intent-relay response; the relay does not publish a schema for it.
    expectTypeOf<SubmitIntentResponseV2['result']>().toBeUnknown();
    expectTypeOf<ReturnType<Svc['getStatus']>>().toEqualTypeOf<R<StatusResponseV2>>();
    expectTypeOf<ReturnType<Svc['getIntentHash']>>().toEqualTypeOf<R<IntentHashResponseV2>>();
    expectTypeOf<ReturnType<Svc['getSolvedIntentPacket']>>().toEqualTypeOf<R<IntentPacketResponseV2>>();
    expectTypeOf<ReturnType<Svc['getIntentSubmitTxExtraData']>>().toEqualTypeOf<R<IntentExtraDataResponseV2>>();
    expectTypeOf<ReturnType<Svc['getFilledIntent']>>().toEqualTypeOf<R<IntentStateV2>>();
    expectTypeOf<ReturnType<Svc['getIntent']>>().toEqualTypeOf<R<GetIntentResponseV2>>();
  });

  it('submit-tx endpoints', () => {
    expectTypeOf<ReturnType<Svc['submitTx']>>().toEqualTypeOf<R<SubmitTxResponseV2>>();
    expectTypeOf<ReturnType<Svc['getSubmitTxStatus']>>().toEqualTypeOf<R<SubmitTxStatusResponseV2>>();
  });

  it('header, URL and timeout accessors', () => {
    expectTypeOf<ReturnType<Svc['setHeaders']>>().toEqualTypeOf<void>();
    expectTypeOf<ReturnType<Svc['getBaseURL']>>().toEqualTypeOf<string>();
    expectTypeOf<ReturnType<Svc['getTimeout']>>().toEqualTypeOf<number>();
  });

  it('failure side', () => {
    expectTypeOf<Err<ReturnType<Svc['getVault']>>>().toEqualTypeOf<SodaxError<'EXTERNAL_API_ERROR'>>();
  });
});
