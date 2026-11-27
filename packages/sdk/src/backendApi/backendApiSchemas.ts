// Schemas aren't pinned with `v.GenericSchema<…>` (readonly covariance breaks it); call-site return types enforce fidelity.
// bigint-derived fields are decimal strings on the wire; nominal scalars are strings typed via `v.custom<T>`.

import * as v from 'valibot';
import type { Address, ChainKey, GetSwapTokensApiResponse, SpokeChainKey } from '@sodax/types';

const ChainKeySchema = v.custom<ChainKey>(input => typeof input === 'string');
const SpokeChainKeySchema = v.custom<SpokeChainKey>(input => typeof input === 'string');
const AddressSchema = v.custom<Address>(input => typeof input === 'string');

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

/** Bigint-derived fields are decimal strings. */
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

export const FillEventSchema = v.object({
  eventType: v.literal('intent-filled'),
  txHash: v.pipe(v.string(), v.nonEmpty()),
  // Only `remainingInput === '0'` proves completion: `allowPartialFill` intents emit a fill event per fill.
  intentState: v.object({
    remainingInput: v.string(),
  }),
});

export const IntentEventTypeSchema = v.object({ eventType: v.string() });

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

export const UserIntentsResponseSchema = v.object({
  total: v.number(),
  offset: v.number(),
  limit: v.number(),
  items: v.array(IntentResponseSchema),
});

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

export const MoneyMarketAssetsSchema = v.array(MoneyMarketAssetSchema);

export const MoneyMarketAssetBorrowersSchema = v.object({
  borrowers: v.array(v.string()),
  total: v.number(),
  offset: v.number(),
  limit: v.number(),
});

export const MoneyMarketAssetSuppliersSchema = v.object({
  suppliers: v.array(v.string()),
  total: v.number(),
  offset: v.number(),
  limit: v.number(),
});

export const MoneyMarketBorrowersSchema = v.object({
  borrowers: v.array(v.string()),
  total: v.number(),
  offset: v.number(),
  limit: v.number(),
});

export const GetChainsResponseSchema = v.array(SpokeChainKeySchema);

/** `v.record` over the literal-union key infers a partial map, so validate structurally and type via `v.custom`. */
export const TokensByChainMapSchema = v.custom<GetSwapTokensApiResponse>(
  input =>
    typeof input === 'object' &&
    input !== null &&
    Object.values(input).every(tokens => Array.isArray(tokens) && tokens.every(t => v.is(XTokenSchema, t))),
);

export const TokensListSchema = v.array(XTokenSchema);

export const ReserveAssetsSchema = v.array(AddressSchema);

/** Runtime source of truth for the public `OracleCandleInterval` union. */
export const ORACLE_CANDLE_INTERVALS = ['1m', '5m', '1h', '1d'] as const;

export const OracleCandleIntervalSchema = v.picklist(ORACLE_CANDLE_INTERVALS);

/** `intervals[].key` is `v.string()`, not a picklist — see `OracleMarketInterval`. */
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
 * `interval` is a strict picklist (it echoes the caller's value). `final` accepts `true` too: rejecting the
 * benign complement would blank a whole chart over an advisory flag.
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
