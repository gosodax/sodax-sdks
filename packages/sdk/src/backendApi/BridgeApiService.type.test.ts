/**
 * Compile-time contract for `BridgeApiService.ts`: every `/bridge/*` method resolves to
 * `Promise<Result<…>>` of its exact v2 response type, and the domain-to-wire mapper returns the wire DTO.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type {
  BridgeableAmountResponseV2,
  BridgeableCheckResponseV2,
  BridgeAllowanceCheckResponseV2,
  BridgeApproveResponseV2,
  BridgeFeeResponseV2,
  BridgeSubmitTxResponseV2,
  BridgeSubmitTxStatusResponseV2,
  CreateBridgeIntentParamsV2,
  CreateBridgeIntentResponseV2,
  GetBridgeTokensByChainResponseV2,
  GetBridgeTokensResponseV2,
  RawTxReturnType,
  Result,
} from '../index.js';
import { type BridgeApiService, toCreateBridgeIntentParamsV2 } from './BridgeApiService.js';

type Svc = BridgeApiService;
// Known gap against ADR 0001: declared as plain Result<T>, so the error is unknown.
type R<T> = Promise<Result<T>>;
type Err<P> = Awaited<P> extends infer U ? (U extends { ok: false; error: infer E } ? E : never) : never;

const domainParams = {
  srcChainKey: 'bsc',
  dstChainKey: 'sonic',
  srcToken: '0x1',
  dstToken: '0x2',
  amount: 1n,
  srcAddress: '0x3',
  recipient: '0x4',
};

describe('toCreateBridgeIntentParamsV2', () => {
  it('maps domain params to the wire DTO with or without extras', () => {
    const plain = () => toCreateBridgeIntentParamsV2(domainParams);
    const withExtras = () => toCreateBridgeIntentParamsV2(domainParams, { srcPublicKey: '02ab' });
    expectTypeOf<ReturnType<typeof plain>>().toEqualTypeOf<CreateBridgeIntentParamsV2>();
    expectTypeOf<ReturnType<typeof withExtras>>().toEqualTypeOf<CreateBridgeIntentParamsV2>();
    const invalid = () => [
      // @ts-expect-error — `amount` is a bigint in the domain params; the mapper serializes it.
      toCreateBridgeIntentParamsV2({ ...domainParams, amount: '1' }),
    ];
    expectTypeOf(invalid).toBeFunction();
  });
});

describe('BridgeApiService', () => {
  it('token, fee and bridgeability endpoints', () => {
    expectTypeOf<ReturnType<Svc['getTokens']>>().toEqualTypeOf<R<GetBridgeTokensResponseV2>>();
    expectTypeOf<ReturnType<Svc['getTokensByChain']>>().toEqualTypeOf<R<GetBridgeTokensByChainResponseV2>>();
    expectTypeOf<ReturnType<Svc['getFee']>>().toEqualTypeOf<R<BridgeFeeResponseV2>>();
    expectTypeOf<ReturnType<Svc['getBridgeableAmount']>>().toEqualTypeOf<R<BridgeableAmountResponseV2>>();
    expectTypeOf<ReturnType<Svc['isBridgeable']>>().toEqualTypeOf<R<BridgeableCheckResponseV2>>();
  });

  it('transaction-building endpoints return the all-family raw tx union', () => {
    expectTypeOf<ReturnType<Svc['checkAllowance']>>().toEqualTypeOf<R<BridgeAllowanceCheckResponseV2>>();
    expectTypeOf<ReturnType<Svc['approve']>>().toEqualTypeOf<R<BridgeApproveResponseV2>>();
    expectTypeOf<ReturnType<Svc['createBridgeIntent']>>().toEqualTypeOf<R<CreateBridgeIntentResponseV2>>();
    // `srcChainKey: string` in the request cannot select a family, so `tx` stays the full union.
    expectTypeOf<BridgeApproveResponseV2['tx']>().toEqualTypeOf<RawTxReturnType>();
    expectTypeOf<CreateBridgeIntentResponseV2['tx']>().toEqualTypeOf<RawTxReturnType>();
  });

  it('submit-tx endpoints', () => {
    expectTypeOf<ReturnType<Svc['submitTx']>>().toEqualTypeOf<R<BridgeSubmitTxResponseV2>>();
    expectTypeOf<ReturnType<Svc['getSubmitTxStatus']>>().toEqualTypeOf<R<BridgeSubmitTxStatusResponseV2>>();
  });

  it('header, URL and timeout accessors', () => {
    expectTypeOf<ReturnType<Svc['setHeaders']>>().toEqualTypeOf<void>();
    expectTypeOf<ReturnType<Svc['getBaseURL']>>().toEqualTypeOf<string>();
    expectTypeOf<ReturnType<Svc['getTimeout']>>().toEqualTypeOf<number>();
  });

  it('failure side', () => {
    // Known gap against ADR 0001: declared as plain Result<T>, so the error is unknown.
    expectTypeOf<Err<ReturnType<Svc['getFee']>>>().toBeUnknown();
  });
});
