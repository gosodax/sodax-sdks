/**
 * Compile-time contract for `SwapsApiService`: every `/swaps/*` method resolves to `Promise<Result<…>>`
 * of its exact v2 response type. The wire DTOs carry chain keys as `string`, so nothing narrows by chain.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type {
  AllowanceCheckResponseV2,
  ApproveResponseV2,
  CancelIntentResponseV2,
  CreateIntentResponseV2,
  CreateLimitOrderResponseV2,
  DeadlineResponseV2,
  FeeResponseV2,
  GasEstimateResponseV2,
  GetIntentResponseV2,
  GetSwapTokensByChainResponseV2,
  GetSwapTokensResponseV2,
  IntentExtraDataResponseV2,
  IntentHashResponseV2,
  IntentPacketResponseV2,
  IntentStateV2,
  QuoteResponseV2,
  RawTxReturnType,
  Result,
  StatusResponseV2,
  SubmitIntentResponseV2,
  SubmitTxResponseV2,
  SubmitTxStatusResponseV2,
} from '../index.js';
import type { SwapsApiService } from './SwapsApiService.js';

type Svc = SwapsApiService;
// Known gap against ADR 0001: declared as plain Result<T>, so the error is unknown.
type R<T> = Promise<Result<T>>;
type Err<P> = Awaited<P> extends infer U ? (U extends { ok: false; error: infer E } ? E : never) : never;

describe('SwapsApiService', () => {
  it('token, quote and fee endpoints', () => {
    expectTypeOf<ReturnType<Svc['getTokens']>>().toEqualTypeOf<R<GetSwapTokensResponseV2>>();
    expectTypeOf<ReturnType<Svc['getTokensByChain']>>().toEqualTypeOf<R<GetSwapTokensByChainResponseV2>>();
    expectTypeOf<ReturnType<Svc['getQuote']>>().toEqualTypeOf<R<QuoteResponseV2>>();
    expectTypeOf<ReturnType<Svc['getDeadline']>>().toEqualTypeOf<R<DeadlineResponseV2>>();
    expectTypeOf<ReturnType<Svc['getPartnerFee']>>().toEqualTypeOf<R<FeeResponseV2>>();
    expectTypeOf<ReturnType<Svc['getSolverFee']>>().toEqualTypeOf<R<FeeResponseV2>>();
    expectTypeOf<ReturnType<Svc['estimateGas']>>().toEqualTypeOf<R<GasEstimateResponseV2>>();
    // Gas estimate shape varies per chain family and the request names the chain only as `string`.
    expectTypeOf<GasEstimateResponseV2['gas']>().toBeUnknown();
  });

  it('transaction-building endpoints return the all-family raw tx union', () => {
    expectTypeOf<ReturnType<Svc['checkAllowance']>>().toEqualTypeOf<R<AllowanceCheckResponseV2>>();
    expectTypeOf<ReturnType<Svc['approve']>>().toEqualTypeOf<R<ApproveResponseV2>>();
    expectTypeOf<ReturnType<Svc['createIntent']>>().toEqualTypeOf<R<CreateIntentResponseV2>>();
    expectTypeOf<ReturnType<Svc['createLimitOrderIntent']>>().toEqualTypeOf<R<CreateLimitOrderResponseV2>>();
    expectTypeOf<ReturnType<Svc['cancelIntent']>>().toEqualTypeOf<R<CancelIntentResponseV2>>();
    // `srcChainKey: string` in the request cannot select a family, so `tx` stays the full union.
    expectTypeOf<CreateIntentResponseV2['tx']>().toEqualTypeOf<RawTxReturnType>();
    expectTypeOf<ApproveResponseV2['tx']>().toEqualTypeOf<RawTxReturnType>();
    expectTypeOf<CancelIntentResponseV2['tx']>().toEqualTypeOf<RawTxReturnType>();
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
    // Known gap against ADR 0001: declared as plain Result<T>, so the error is unknown.
    expectTypeOf<Err<ReturnType<Svc['getQuote']>>>().toBeUnknown();
  });
});
