// Per-chain schemas for the unsigned `tx` the Bridge API v2 returns (approve / createBridgeIntent).
// Each validates the wire shape and transforms it to its `RawTxReturnType` variant (decimal-string →
// `bigint`; Injective index-object bytes → `Uint8Array`). `rawTxSchemaForChainKey` picks the variant
// by source chain key, since EVM/Solana/Sui/Stellar/Bitcoin are wire-identical and a blind union could
// not disambiguate them.
//
// A copy of `packages/swaps-api/src/rawTxSchemas.ts`. Nothing enforces that the two stay in step —
// extracting them into a shared package is a tracked follow-up — and they already differ: only this
// copy carries the `BITCOIN` branch below.

import { getChainType } from '@sodax/types';
import type { Address, ContractArgs, Hex, RawTxReturnType, SpokeChainKey } from '@sodax/types';
import * as v from 'valibot';

// Nominal scalars: runtime-validated as strings, typed as the branded type.
const AddressSchema = v.custom<Address>(input => typeof input === 'string');
const HexSchema = v.custom<Hex>(input => typeof input === 'string');

/**
 * Decimal-string wire numeric → `bigint`. The `^\d+$` gate rejects inputs that `v.toBigint`'s
 * underlying `BigInt()` would otherwise coerce silently — `''`/whitespace → `0n`, `'0x1f'` → `31n`,
 * `'1.5'` already throws — so a malformed or non-decimal amount fails the parse instead of yielding a
 * wrong value. Every field this validates (tx `value`, Injective `accountNumber`, NEAR `gas`/`deposit`)
 * is a non-negative integer on the wire.
 */
const BigintFromString = v.pipe(v.string(), v.regex(/^\d+$/), v.toBigint());

/**
 * Injective `bodyBytes`/`authInfoBytes`: wire `{ "0": N, "1": N, … }` index object → `Uint8Array`.
 * V8 enumerates integer-like keys in ascending numeric order, so `Object.values` is ordered. Each
 * value is validated as a byte (0–255 integer) so an out-of-range/negative/fractional entry fails the
 * parse rather than being silently wrapped/truncated by `Uint8Array.from`.
 */
const BytesFromIndexRecord = v.pipe(
  v.record(v.string(), v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(255))),
  v.transform(indexed => Uint8Array.from(Object.values(indexed))),
);

// EVM / Solana / Sui / Stellar — identical `{ from, to, value, data }` wire shape; only branding differs.

/** `EvmRawTransaction` — `value` decimal-string → `bigint`. */
export const EvmRawTxSchema = v.object({
  from: AddressSchema,
  to: AddressSchema,
  value: BigintFromString,
  data: HexSchema,
});

/** `SolanaRawTransaction` — base58/base64 strings; `value` decimal-string → `bigint`. */
const SolanaRawTxSchema = v.object({
  from: v.string(),
  to: v.string(),
  value: BigintFromString,
  data: v.string(),
});

/** `SuiRawTransaction` — `from` is hex; `value` decimal-string → `bigint`. */
const SuiRawTxSchema = v.object({
  from: HexSchema,
  to: v.string(),
  value: BigintFromString,
  data: v.string(),
});

/** `StellarRawTransaction` — `value` decimal-string → `bigint`. */
const StellarRawTxSchema = v.object({
  from: v.string(),
  to: v.string(),
  value: BigintFromString,
  data: v.string(),
});

/**
 * `BitcoinRawTransaction` — the Bound-built deposit: `data` is the base64 PSBT, `from` the (trading)
 * wallet address, and `value` the output amount in satoshis as a decimal string → `bigint`. Declared
 * separately from the wire-identical Solana/Stellar schemas so the chain dispatch stays explicit; without
 * this branch Bitcoin fell through to {@link AnyRawTxSchema} and `value` stayed a string while
 * `BitcoinRawTransaction.value` is typed `bigint`.
 */
const BitcoinRawTxSchema = v.object({
  from: v.string(),
  to: v.string(),
  value: BigintFromString,
  data: v.string(),
});

/** `InjectiveRawTransaction` — nested `signedDoc` with `Uint8Array` bytes + `bigint` account number. */
export const InjectiveRawTxSchema = v.object({
  from: HexSchema,
  to: HexSchema,
  signedDoc: v.object({
    bodyBytes: BytesFromIndexRecord,
    authInfoBytes: BytesFromIndexRecord,
    chainId: v.string(),
    accountNumber: BigintFromString,
  }),
});

/** `NearRawTransaction` — optional `gas`/`deposit` decimal-string → `bigint`; `args` is an opaque union. */
const NearRawTxSchema = v.object({
  signerId: v.string(),
  params: v.object({
    contractId: v.string(),
    method: v.string(),
    args: v.custom<ContractArgs>(input => typeof input === 'object' && input !== null),
    gas: v.optional(BigintFromString),
    deposit: v.optional(BigintFromString),
  }),
});

/** `IconRawTransaction` — loose hex-field call-tx dictionary; no bigint, survives JSON unchanged. */
const IconRawTxSchema = v.record(
  v.string(),
  v.union([v.string(), v.custom<object>(input => typeof input === 'object' && input !== null)]),
);

/** `StacksRawTransaction` — hex-serialized payload; no bigint. */
const StacksRawTxSchema = v.object({
  payload: v.string(),
  estimatedLength: v.optional(v.number()),
});

/** Permissive fallback for an unmapped chain key: non-null object, typed as `RawTxReturnType`. */
const AnyRawTxSchema = v.custom<RawTxReturnType>(input => typeof input === 'object' && input !== null);

/**
 * Pick the raw-tx schema for a source chain key. Pinned to `v.GenericSchema<unknown, RawTxReturnType>`
 * so the response factories infer `tx` as the domain union. Never throws — an unmapped key falls back
 * to the permissive schema.
 */
export function rawTxSchemaForChainKey(chainKey: string): v.GenericSchema<unknown, RawTxReturnType> {
  let chainType: string | undefined;
  try {
    chainType = getChainType(chainKey as SpokeChainKey);
  } catch {
    chainType = undefined;
  }
  switch (chainType) {
    case 'EVM':
      return EvmRawTxSchema;
    case 'SOLANA':
      return SolanaRawTxSchema;
    case 'SUI':
      return SuiRawTxSchema;
    case 'STELLAR':
      return StellarRawTxSchema;
    case 'INJECTIVE':
      return InjectiveRawTxSchema;
    case 'ICON':
      return IconRawTxSchema;
    case 'STACKS':
      return StacksRawTxSchema;
    case 'NEAR':
      return NearRawTxSchema;
    case 'BITCOIN':
      return BitcoinRawTxSchema;
    default:
      return AnyRawTxSchema;
  }
}
