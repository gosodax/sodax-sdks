/**
 * Compile-time contract for `BackendApiService`: every endpoint method resolves to `Promise<Result<…>>`
 * of its exact named response type. None of them narrows on its inputs.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type {
  BridgeApiService,
  GetAllConfigApiResponse,
  GetChainsApiResponse,
  GetMoneyMarketReserveAssetsApiResponse,
  GetMoneyMarketTokensApiResponse,
  GetMoneyMarketTokensByChainIdApiResponse,
  GetRelayChainIdMapApiResponse,
  GetSpokeChainConfigApiResponse,
  GetSwapTokensApiResponse,
  GetSwapTokensByChainIdApiResponse,
  IntentResponse,
  LeverageYieldApiService,
  MoneyMarketAsset,
  MoneyMarketAssetBorrowers,
  MoneyMarketAssetSuppliers,
  MoneyMarketBorrowers,
  MoneyMarketPosition,
  OracleCandleInterval,
  OracleCandlesResponse,
  OracleMarketsResponse,
  OrderbookResponse,
  Result,
  SponsoringApiService,
  SwapsApiService,
  UserIntentsResponse,
} from '../index.js';
import type { BackendApiService } from './BackendApiService.js';

type Svc = BackendApiService;
type R<T> = Promise<Result<T>>;
type Err<P> = Awaited<P> extends infer U ? (U extends { ok: false; error: infer E } ? E : never) : never;

describe('BackendApiService', () => {
  it('intent and solver endpoints', () => {
    expectTypeOf<ReturnType<Svc['getIntentByTxHash']>>().toEqualTypeOf<R<IntentResponse>>();
    expectTypeOf<ReturnType<Svc['getIntentByHash']>>().toEqualTypeOf<R<IntentResponse>>();
    expectTypeOf<ReturnType<Svc['getOrderbook']>>().toEqualTypeOf<R<OrderbookResponse>>();
    expectTypeOf<ReturnType<Svc['getUserIntents']>>().toEqualTypeOf<R<UserIntentsResponse>>();
    // Journal entries are heterogeneous backend events; callers narrow them with `isFillEvent`.
    expectTypeOf<IntentResponse['events']>().toEqualTypeOf<unknown[]>();
  });

  it('money market endpoints', () => {
    expectTypeOf<ReturnType<Svc['getMoneyMarketPosition']>>().toEqualTypeOf<R<MoneyMarketPosition>>();
    expectTypeOf<ReturnType<Svc['getAllMoneyMarketAssets']>>().toEqualTypeOf<R<MoneyMarketAsset[]>>();
    expectTypeOf<ReturnType<Svc['getMoneyMarketAsset']>>().toEqualTypeOf<R<MoneyMarketAsset>>();
    expectTypeOf<ReturnType<Svc['getMoneyMarketAssetBorrowers']>>().toEqualTypeOf<R<MoneyMarketAssetBorrowers>>();
    expectTypeOf<ReturnType<Svc['getMoneyMarketAssetSuppliers']>>().toEqualTypeOf<R<MoneyMarketAssetSuppliers>>();
    expectTypeOf<ReturnType<Svc['getAllMoneyMarketBorrowers']>>().toEqualTypeOf<R<MoneyMarketBorrowers>>();
  });

  it('oracle endpoints', () => {
    expectTypeOf<ReturnType<Svc['getOracleMarkets']>>().toEqualTypeOf<R<OracleMarketsResponse>>();
    expectTypeOf<ReturnType<Svc['getOracleCandles']>>().toEqualTypeOf<R<OracleCandlesResponse>>();
    expectTypeOf<OracleCandlesResponse['interval']>().toEqualTypeOf<OracleCandleInterval>();
  });

  it('config endpoints', () => {
    expectTypeOf<ReturnType<Svc['getAllConfig']>>().toEqualTypeOf<R<GetAllConfigApiResponse>>();
    expectTypeOf<ReturnType<Svc['getChains']>>().toEqualTypeOf<R<GetChainsApiResponse>>();
    expectTypeOf<ReturnType<Svc['getSwapTokens']>>().toEqualTypeOf<R<GetSwapTokensApiResponse>>();
    expectTypeOf<ReturnType<Svc['getSwapTokensByChainId']>>().toEqualTypeOf<R<GetSwapTokensByChainIdApiResponse>>();
    expectTypeOf<ReturnType<Svc['getMoneyMarketTokens']>>().toEqualTypeOf<R<GetMoneyMarketTokensApiResponse>>();
    expectTypeOf<ReturnType<Svc['getMoneyMarketReserveAssets']>>().toEqualTypeOf<
      R<GetMoneyMarketReserveAssetsApiResponse>
    >();
    expectTypeOf<ReturnType<Svc['getMoneyMarketTokensByChainId']>>().toEqualTypeOf<
      R<GetMoneyMarketTokensByChainIdApiResponse>
    >();
    expectTypeOf<ReturnType<Svc['getRelayChainIdMap']>>().toEqualTypeOf<R<GetRelayChainIdMapApiResponse>>();
    expectTypeOf<ReturnType<Svc['getSpokeChainConfig']>>().toEqualTypeOf<R<GetSpokeChainConfigApiResponse>>();
  });

  it('header, URL and sub-service accessors', () => {
    expectTypeOf<ReturnType<Svc['setHeaders']>>().toEqualTypeOf<void>();
    expectTypeOf<ReturnType<Svc['getBaseURL']>>().toEqualTypeOf<string>();
    expectTypeOf<ReturnType<Svc['getBasePath']>>().toEqualTypeOf<string>();
    expectTypeOf<Svc['requestTimeoutMs']>().toEqualTypeOf<number>();
    expectTypeOf<Svc['swaps']>().toEqualTypeOf<SwapsApiService>();
    expectTypeOf<Svc['sponsoring']>().toEqualTypeOf<SponsoringApiService>();
    expectTypeOf<Svc['bridge']>().toEqualTypeOf<BridgeApiService>();
    expectTypeOf<Svc['leverageYield']>().toEqualTypeOf<LeverageYieldApiService>();
  });

  it('failure side', () => {
    // Declared `Result<T>` widens the error to `unknown`, though the service only produces
    // `SodaxError<'EXTERNAL_API_ERROR'>` (reported for tightening).
    expectTypeOf<Err<ReturnType<Svc['getIntentByHash']>>>().toBeUnknown();
  });
});
