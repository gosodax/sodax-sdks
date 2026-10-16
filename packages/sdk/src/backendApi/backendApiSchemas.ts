// Valibot response schemas for the backend API (BackendApiService data reads).
//
// One schema per response shape returned by BackendApiService's data/token/money-market
// endpoints. The service validates each HTTP body against these before returning it, so a
// backend contract drift surfaces as a `Result` error rather than an untyped runtime surprise.
// (The config/relay reads — getAllConfig, getSpokeChainConfig, getRelayChainIdMap — are
// intentionally NOT validated here; see BackendApiService.requestUnvalidated.)
//
// Same convention as `@sodax/swaps-api`'s response schemas: schemas are intentionally NOT pinned with `v.GenericSchema<…>`
// (that forces the schema INPUT type to equal the readonly declared type, which trips on
// covariance for `v.record`/`v.array`). Type fidelity is enforced where each schema is consumed —
// BackendApiService methods declare their return type, so a schema whose inferred output drifts is
// a compile error at the call site.
//
// All bigint-derived numeric fields arrive as decimal strings on the wire, so every such field is
// `v.string()`; genuine numbers (block numbers, counts, relay chain ids) are `v.number()`. The
// nominal `@sodax/types` scalars (ChainKey / SpokeChainKey / Address) are runtime-validated as
// strings and typed via `v.custom<T>` so the inferred output matches the declared type without a cast.

import * as v from 'valibot';
import type { Address, ChainKey, GetSwapTokensApiResponse, SpokeChainKey } from '@sodax/types';

// Nominal scalars: validated as strings at runtime, typed as the branded @sodax/types type.
const ChainKeySchema = v.custom<ChainKey>(input => typeof input === 'string');
const SpokeChainKeySchema = v.custom<SpokeChainKey>(input => typeof input === 'string');
const AddressSchema = v.custom<Address>(input => typeof input === 'string');

/** Cross-chain token descriptor (`XToken`). Shared across the swap/money-market token reads. */
export const XTokenSchema = v.object({
  symbol: v.string(),
  name: v.string(),
  decimals: v.number(),
  address: v.string(),
  chainKey: ChainKeySchema,
  hubAsset: AddressSchema,
  vault: AddressSchema,
  access: v.optional(v.picklist(['withdrawOnly', 'depositOnly'])),
});

/** Hub-side intent struct embedded in an `IntentResponse` (bigint-derived fields are decimal strings). */
const IntentStructSchema = v.object({
  intentId: v.string(),
  creator: v.string(),
  inputToken: v.string(),
  outputToken: v.string(),
  inputAmount: v.string(),
  minOutputAmount: v.string(),
  deadline: v.string(),
  allowPartialFill: v.boolean(),
  srcChain: v.number(),
  dstChain: v.number(),
  srcAddress: v.string(),
  dstAddress: v.string(),
  solver: v.string(),
  data: v.string(),
});

/** An `intent-filled` entry in `IntentResponse.events`. Narrow with `isFillEvent`. */
export const FillEventSchema = v.object({
  eventType: v.literal('intent-filled'),
  // The hub-chain fill tx; an empty one is no use as `fill_tx_hash`.
  txHash: v.pipe(v.string(), v.nonEmpty()),
  // Terminality. An intent created with `allowPartialFill` emits a fill event per fill, so the
  // event alone does not mean the intent is done — only `remainingInput === '0'` does. Required:
  // without it there is no proof of completion, and claiming SOLVED on a partial fill would report
  // an unfinished swap as complete.
  intentState: v.object({
    remainingInput: v.string(),
  }),
});

/** GET /intent/tx/:txHash · GET /intent/:intentHash (`IntentResponse`). */
export const IntentResponseSchema = v.object({
  intentHash: v.string(),
  txHash: v.string(),
  logIndex: v.number(),
  chainId: v.number(),
  blockNumber: v.number(),
  open: v.boolean(),
  intent: IntentStructSchema,
  events: v.array(v.unknown()),
});

/** GET /intent/user/:userAddress (`UserIntentsResponse`). */
export const UserIntentsResponseSchema = v.object({
  total: v.number(),
  offset: v.number(),
  limit: v.number(),
  items: v.array(IntentResponseSchema),
});

/** GET /solver/orderbook (`OrderbookResponse`). */
export const OrderbookResponseSchema = v.object({
  total: v.number(),
  data: v.array(
    v.object({
      intentState: v.object({
        exists: v.boolean(),
        remainingInput: v.string(),
        receivedOutput: v.string(),
        pendingPayment: v.boolean(),
      }),
      intentData: v.object({
        intentId: v.string(),
        creator: v.string(),
        inputToken: v.string(),
        outputToken: v.string(),
        inputAmount: v.string(),
        minOutputAmount: v.string(),
        deadline: v.string(),
        allowPartialFill: v.boolean(),
        srcChain: v.number(),
        dstChain: v.number(),
        srcAddress: v.string(),
        dstAddress: v.string(),
        solver: v.string(),
        data: v.string(),
        intentHash: v.string(),
        txHash: v.string(),
        blockNumber: v.number(),
      }),
    }),
  ),
});

/** GET /moneymarket/position/:userAddress (`MoneyMarketPosition`). */
export const MoneyMarketPositionSchema = v.object({
  userAddress: v.string(),
  positions: v.array(
    v.object({
      reserveAddress: v.string(),
      aTokenAddress: v.string(),
      variableDebtTokenAddress: v.string(),
      aTokenBalance: v.string(),
      variableDebtTokenBalance: v.string(),
      blockNumber: v.number(),
    }),
  ),
});

/** A single money-market reserve snapshot (`MoneyMarketAsset`). */
export const MoneyMarketAssetSchema = v.object({
  reserveAddress: v.string(),
  aTokenAddress: v.string(),
  totalATokenBalance: v.string(),
  variableDebtTokenAddress: v.string(),
  totalVariableDebtTokenBalance: v.string(),
  liquidityRate: v.string(),
  symbol: v.string(),
  totalSuppliers: v.number(),
  totalBorrowers: v.number(),
  variableBorrowRate: v.string(),
  stableBorrowRate: v.string(),
  liquidityIndex: v.string(),
  variableBorrowIndex: v.string(),
  blockNumber: v.number(),
});

/** GET /moneymarket/asset/all (`MoneyMarketAsset[]`). */
export const MoneyMarketAssetsSchema = v.array(MoneyMarketAssetSchema);

/** GET /moneymarket/asset/:reserveAddress/borrowers (`MoneyMarketAssetBorrowers`). */
export const MoneyMarketAssetBorrowersSchema = v.object({
  borrowers: v.array(v.string()),
  total: v.number(),
  offset: v.number(),
  limit: v.number(),
});

/** GET /moneymarket/asset/:reserveAddress/suppliers (`MoneyMarketAssetSuppliers`). */
export const MoneyMarketAssetSuppliersSchema = v.object({
  suppliers: v.array(v.string()),
  total: v.number(),
  offset: v.number(),
  limit: v.number(),
});

/** GET /moneymarket/borrowers (`MoneyMarketBorrowers`). */
export const MoneyMarketBorrowersSchema = v.object({
  borrowers: v.array(v.string()),
  total: v.number(),
  offset: v.number(),
  limit: v.number(),
});

/** GET /config/spoke/chains (`GetChainsApiResponse` — readonly SpokeChainKey[]). */
export const GetChainsResponseSchema = v.array(SpokeChainKeySchema);

/**
 * GET /config/swap/tokens · /config/money-market/tokens (`Record<SpokeChainKey, readonly XToken[]>`).
 *
 * The declared type requires an entry for every `SpokeChainKey`, but the backend returns only the
 * supported chains — and valibot's `v.record` over a literal-union key infers a *partial* map
 * (`XToken[] | undefined` values) that won't satisfy the required type. So validate the structure
 * (an object whose every value is an array of `XToken`s, reusing {@link XTokenSchema} per token) and
 * type the output as the declared response via `v.custom`. `GetSwapTokensApiResponse` and
 * `GetMoneyMarketTokensApiResponse` are the same shape, so one schema serves both endpoints.
 */
export const TokensByChainMapSchema = v.custom<GetSwapTokensApiResponse>(
  input =>
    typeof input === 'object' &&
    input !== null &&
    Object.values(input).every(tokens => Array.isArray(tokens) && tokens.every(t => v.is(XTokenSchema, t))),
);

/** GET /config/swap/:chainId/tokens · /config/money-market/:chainId/tokens (`readonly XToken[]`). */
export const TokensListSchema = v.array(XTokenSchema);

/** GET /config/money-market/reserve-assets (`readonly Address[]`). */
export const ReserveAssetsSchema = v.array(AddressSchema);

/**
 * Candle bucket sizes the oracle serves (60s / 300s / 3600s / 86400s). Runtime source of truth for
 * the public `OracleCandleInterval` union, which is derived from it in `BackendApiService.ts`.
 */
export const ORACLE_CANDLE_INTERVALS = ['1m', '5m', '1h', '1d'] as const;

/** Closed set of interval keys; also backs the public `isOracleCandleInterval` guard. */
export const OracleCandleIntervalSchema = v.picklist(ORACLE_CANDLE_INTERVALS);

/** GET /oracle/markets. `intervals[].key` is `v.string()`, not a picklist — see `OracleMarketInterval`. */
export const OracleMarketsResponseSchema = v.object({
  quote: v.string(),
  intervals: v.array(
    v.object({
      key: v.string(),
      label: v.string(),
      seconds: v.number(),
    }),
  ),
  symbols: v.array(v.string()),
});

/**
 * GET /oracle/candles (`OracleCandlesResponse`). OHLC prices are USD decimal strings. `interval` is a
 * strict picklist: it echoes a caller-supplied `OracleCandleInterval`, so anything else is real drift.
 * `final` stays `v.optional(v.boolean())` — the backend only ever sends `false` today, but `true` is the
 * benign complement, and rejecting it would blank a whole chart over an advisory flag.
 */
export const OracleCandlesResponseSchema = v.object({
  symbol: v.string(),
  quote: v.string(),
  interval: OracleCandleIntervalSchema,
  candles: v.array(
    v.object({
      timestamp: v.number(),
      open: v.string(),
      high: v.string(),
      low: v.string(),
      close: v.string(),
      final: v.optional(v.boolean()),
    }),
  ),
});
