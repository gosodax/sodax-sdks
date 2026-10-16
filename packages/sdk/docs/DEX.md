<!-- packages/sdk/docs/DEX.md -->
# DEX (Concentrated Liquidity)

> **Error handling conventions:** DEX has a **mixed** contract. Everything except the relay leg returns a typed `SodaxError` with `feature: 'dex'` — discriminate on `error.code`. Relay failures are the exception: DEX is the only feature module that does not run them through `mapRelayFailure`, so they surface as a plain `Error` whose `.message` is one of `RELAY_ERROR_CODES`. See [Error Handling](#error-handling) below before writing any branching.

The DEX portion of the SDK provides helpers for asset wrapping/deposits and concentrated liquidity (CL) operations.
All DEX features are accessible through the `dex` property of a `Sodax` instance.

```typescript
import { Sodax } from "@sodax/sdk";
import { ChainKeys } from "@sodax/sdk";

const sodax = new Sodax();
await sodax.config.initialize();

// Asset operations (deposit/withdraw/allowance)
const assetService = sodax.dex.assetService;

// Concentrated liquidity operations (positions/pools/rewards)
const clService = sodax.dex.clService;
```

All liquidity pools live on the Sonic hub chain. Cross-chain users route assets through the hub-and-spoke relay before
interacting with the pool. The `srcChainKey` field in every action's `params` object identifies the source chain
and drives both TypeScript type narrowing and runtime routing — no per-chain spoke provider construction is needed.

## Call conventions

### `SpokeExecActionParams` wrapper

Every mutating method takes a single argument that follows the `SpokeExecActionParams<K, Raw, Params>` shape:

```typescript
// Signed execution — walletProvider is required and chain-narrowed
await sodax.dex.assetService.deposit({
  params: { srcChainKey: ChainKeys.ETHEREUM_MAINNET, srcAddress: "0xabc...", ... },
  walletProvider: evmWalletProvider, // IEvmWalletProvider
  timeout: 30_000,
});

// Raw transaction — walletProvider is forbidden (compile error if passed)
await sodax.dex.assetService.executeDeposit({
  params: { srcChainKey: ChainKeys.ETHEREUM_MAINNET, srcAddress: "0xabc...", ... },
  raw: true,
});
```

`SpokeExecActionParams` fields:

| Field | Required | Description |
|---|---|---|
| `params` | always | Operation-specific params object (includes `srcChainKey` and `srcAddress`) |
| `raw` | always | `true` → return raw tx payload; `false` → sign and broadcast |
| `walletProvider` | when `raw: false` | Chain-narrowed wallet provider; **forbidden** when `raw: true` |
| `skipSimulation` | optional | Skip tx simulation before broadcasting |
| `timeout` | optional | Relay wait timeout in milliseconds (relay-waiting methods only) |

### `WalletProviderSlot` rules

- `{ raw: true }` — `walletProvider` must be absent. Returns an unsigned transaction payload (`TxReturnType<K, true>`).
- `{ raw: false, walletProvider }` — `walletProvider` is required and chain-narrowed via `GetWalletProviderType<K>`. Returns a tx hash (`TxReturnType<K, false>`).

### Execute vs relay-waiting variants

Each mutating operation has two variants:

- **`execute*`** — broadcasts the spoke-chain transaction and returns `IntentTxResult<K, Raw>` (spoke tx + relay data). Both `raw: true` and `raw: false` are supported.
- **Non-prefixed** (e.g. `deposit`, `supplyLiquidity`) — calls the `execute*` variant and then waits for the cross-chain relay packet to arrive at the hub. Returns `TxHashPair` (`{ srcChainTxHash, dstChainTxHash }`). Only accepts `raw: false`.

## AssetService

Handles wrapping/unwrapping spoke-chain tokens into the StatAToken (ERC-4626) representation used by DEX pools.

### isAllowanceValid

Checks whether sufficient allowance exists for a DEX deposit action.

The required spender varies by chain type:
- **EVM spoke chains**: the chain's `assetManager` contract.
- **Hub chain (Sonic)**: the user's hub wallet address.
- **Stellar**: verifies the sender's trustline.
- **All other non-EVM chains**: always returns `true` (no on-chain approval required).

**Returns:** `Promise<Result<boolean>>`

**Note**: For Stellar-based operations, allowance works differently:
- **Source Chain (Stellar)**: `isAllowanceValid` checks trustlines automatically.
- **Destination Chain (Stellar)**: You must manually check trustlines before executing DEX operations. See [Stellar Trustline Requirements](https://docs.sodax.com/developers/how-to/stellar_trustline).

**Example:**
```typescript
const result = await sodax.dex.assetService.isAllowanceValid({
  params: {
    srcChainKey: ChainKeys.ETHEREUM_MAINNET,
    srcAddress: "0xabc...",
    asset: "0x1234...",
    amount: 1000000000000000000n,
    poolToken: "0xabcd...",
  },
  walletProvider: evmWalletProvider,
});

if (result.ok && result.value) {
  console.log("Allowance is sufficient");
} else {
  console.log("Approval or trustline is required");
}
```

### approve

Submits an ERC-20 approval (or Stellar trustline operation) required before depositing.

**Some tokens take two transactions.** A few ERC-20s of the 2017 TetherToken lineage — Ethereum USDT
is the only one in the SODAX token list today — reject an allowance change from one non-zero value to
another, so `approve` sends `approve(0)` first and waits for it to be mined before the real approval.
The user signs twice; the returned value is still a single transaction hash, the **last** one's.
Detection simulates the approval rather than consulting a token list, so a token listed later behaves
the same way.

Supported chain types: Stellar, EVM spoke chains, hub chain (Sonic). Returns an error for other chain types where no approval is needed or supported.

**Returns:** `Promise<Result<TxReturnType<K, Raw>>>`

**Note**: For Stellar-based operations:
- **Source Chain (Stellar)**: `approve` requests trustlines automatically.
- **Destination Chain (Stellar)**: You must establish trustlines before receiving assets. See [Stellar Trustline Requirements](https://docs.sodax.com/developers/how-to/stellar_trustline).

**Example:**
```typescript
const result = await sodax.dex.assetService.approve({
  params: {
    srcChainKey: ChainKeys.ETHEREUM_MAINNET,
    srcAddress: "0xabc...",
    asset: "0x1234...",
    amount: 1000000000000000000n,
    poolToken: "0xabcd...",
  },
  walletProvider: evmWalletProvider,
});

if (result.ok) {
  console.log("Approval tx:", result.value);
}
```

### executeDeposit

Builds and broadcasts the spoke-side transaction that wraps tokens into the pool's StatAToken. Returns `IntentTxResult<K, Raw>` (spoke tx + relay data) without waiting for the relay.

Supports both `raw: true` (unsigned tx payload) and `raw: false` (signed broadcast).

**Returns:** `Promise<Result<IntentTxResult<K, Raw>>>`

**Example:**
```typescript
const result = await sodax.dex.assetService.executeDeposit({
  params: {
    srcChainKey: ChainKeys.ETHEREUM_MAINNET,
    srcAddress: "0xabc...",
    asset: "0x1234...",
    amount: 1000000000000000000n,
    poolToken: "0xabcd...",
  },
  walletProvider: evmWalletProvider,
});

if (result.ok) {
  const { tx, relayData } = result.value;
  // relay manually or wait for packet separately
}
```

### deposit

Wraps assets into the pool's StatAToken and waits for the cross-chain relay to complete. Combines `executeDeposit` with relay packet tracking. For hub-chain (Sonic) callers the relay step is skipped.

Only accepts `raw: false`.

**Returns:** `Promise<Result<TxHashPair>>`

**Example:**
```typescript
const result = await sodax.dex.assetService.deposit({
  params: {
    srcChainKey: ChainKeys.ETHEREUM_MAINNET,
    srcAddress: "0xabc...",
    asset: "0x1234...",
    amount: 1000000000000000000n,
    poolToken: "0xabcd...",
  },
  walletProvider: evmWalletProvider,
  timeout: 30_000,
});

if (result.ok) {
  const { srcChainTxHash, dstChainTxHash } = result.value;
  console.log("Deposit complete:", { srcChainTxHash, dstChainTxHash });
}
```

### executeWithdraw

Builds and broadcasts the spoke-side transaction that unwraps StatATokens back to the original asset. Returns `IntentTxResult<K, Raw>` without waiting for the relay.

Supports both `raw: true` and `raw: false`.

**Returns:** `Promise<Result<IntentTxResult<K, Raw>>>`

### withdraw

Unwraps StatATokens back to the original asset and waits for the cross-chain relay to complete. Combines `executeWithdraw` with relay packet tracking. For hub-chain callers the relay step is skipped.

Only accepts `raw: false`.

**Returns:** `Promise<Result<TxHashPair>>`

**Example:**
```typescript
const result = await sodax.dex.assetService.withdraw({
  params: {
    srcChainKey: ChainKeys.ETHEREUM_MAINNET,
    srcAddress: "0xabc...",
    poolToken: "0xabcd...",
    asset: "0x1234...",
    amount: 500000000000000000n,
  },
  walletProvider: evmWalletProvider,
});

if (result.ok) {
  const { srcChainTxHash, dstChainTxHash } = result.value;
  console.log("Withdraw complete:", { srcChainTxHash, dstChainTxHash });
}
```

### isSodaAsXSodaInPool

Returns `true` if the asset maps to SODA and the pool token is the hub's xSoda address. Check this before calling `executeDeposit` to route SODA staking deposits through the staking contract instead of the standard wrap path.

**Example:**
```typescript
const isSodaDeposit = sodax.dex.assetService.isSodaAsXSodaInPool({
  chainId: ChainKeys.ETHEREUM_MAINNET,
  asset: "0xsodaAddress...",
  poolToken: "0xpoolToken...",
});
```

### getDeposit

Fetches the user's current DEX deposit balance (in StatAToken shares) for a given pool token, by deriving their hub wallet address from their spoke-chain address.

**Signature:** `getDeposit(poolToken: Address, walletAddress: Address, chainKey: SpokeChainKey): Promise<Result<bigint>>`

**Example:**
```typescript
const result = await sodax.dex.assetService.getDeposit(
  "0xabcd...",   // poolToken (StatAToken on hub)
  "0xabc...",    // user's spoke-chain address
  ChainKeys.ETHEREUM_MAINNET,
);

if (result.ok) {
  console.log("Deposit balance (shares):", result.value);
}
```

### getWrappedAmount / getUnwrappedAmount

Convert between underlying asset amounts and ERC-4626 share amounts for any StatAToken.

**Signatures:**
```typescript
getWrappedAmount(dexToken: Address, assetAmount: bigint): Promise<Result<bigint>>
getUnwrappedAmount(dexToken: Address, shareAmount: bigint): Promise<Result<bigint>>
```

**Example:**
```typescript
const wrappedResult = await sodax.dex.assetService.getWrappedAmount(
  "0xpoolToken...", // StatAToken (ERC-4626) address on hub
  1000000000000000000n,
);

const unwrappedResult = await sodax.dex.assetService.getUnwrappedAmount(
  "0xpoolToken...",
  1000000000000000000n,
);
```

### getTokenWrapAction / getTokenUnwrapAction

Builds the hub-side `EvmContractCall` arrays that encode wrapping/unwrapping without broadcasting them. Intended for advanced use-cases that need to compose multicall payloads manually.

**Signatures:**
```typescript
getTokenWrapAction(
  address: OriginalAssetAddress,
  spokeChainId: SpokeChainKey,
  amount: bigint,
  poolToken: Address,
  recipient: Address,
): Promise<EvmContractCall[]>

getTokenUnwrapAction(
  dstChainKey: SpokeChainKey,
  address: OriginalAssetAddress,
  amount: bigint,
  userAddress: Address,
  recipient: Hex,
): Promise<EvmContractCall[]>
```

## Concentrated Liquidity (CL)

All CL operations are available through `sodax.dex.clService`. The service is an instance of `ClService`.

### executeSupplyLiquidity

Builds and broadcasts the spoke-side transaction that opens a new CL position. Encodes Permit2 approvals for both pool tokens plus a `CLPositionManager.mint` call into a single batched payload. Returns `IntentTxResult<K, Raw>` without waiting for relay.

Supports both `raw: true` and `raw: false`.

**Returns:** `Promise<Result<IntentTxResult<K, Raw>>>`

### supplyLiquidity

Opens a new CL position and waits for the cross-chain relay to complete. Calls `executeSupplyLiquidity` then tracks the relay packet. For hub-chain callers the relay step is skipped.

Only accepts `raw: false`.

**Returns:** `Promise<Result<TxHashPair>>`

**Example:**
```typescript
const result = await sodax.dex.clService.supplyLiquidity({
  params: {
    srcChainKey: ChainKeys.ETHEREUM_MAINNET,
    srcAddress: "0xabc...",
    poolKey,
    tickLower: -60000n,
    tickUpper: 60000n,
    liquidity: 1000000n,
    amount0Max: 1000000000000000000n,
    amount1Max: 1000000000000000000n,
    sqrtPriceX96,
  },
  walletProvider: evmWalletProvider,
});

if (result.ok) {
  const { srcChainTxHash, dstChainTxHash } = result.value;
}
```

### getMintPositionEvent

Waits for the hub transaction receipt and extracts the NFT `tokenId` assigned to a newly minted position from the `MintPosition` event log.

**Signature:** `getMintPositionEvent(hubTxHash: Hash): Promise<Result<ClMintPositionEventLog>>`

**Example:**
```typescript
const mintEvent = await sodax.dex.clService.getMintPositionEvent(dstChainTxHash);
if (mintEvent.ok) {
  console.log("Position token ID:", mintEvent.value.tokenId);
}
```

### executeIncreaseLiquidity / increaseLiquidity

Add liquidity to an existing position.

- `executeIncreaseLiquidity` — broadcasts and returns `IntentTxResult<K, Raw>`. Supports `raw: true` and `raw: false`.
- `increaseLiquidity` — calls `executeIncreaseLiquidity` and waits for relay. Only `raw: false`. Returns `TxHashPair`.

**Example:**
```typescript
const result = await sodax.dex.clService.increaseLiquidity({
  params: {
    srcChainKey: ChainKeys.ETHEREUM_MAINNET,
    srcAddress: "0xabc...",
    poolKey,
    tokenId: 1n,
    tickLower: -60000n,
    tickUpper: 60000n,
    liquidity: 500000n,
    amount0Max: 500000000000000000n,
    amount1Max: 500000000000000000n,
    sqrtPriceX96,
  },
  walletProvider: evmWalletProvider,
});
```

### executeDecreaseLiquidity / decreaseLiquidity

Remove liquidity from an existing position. Accumulated fees are automatically collected by the position manager as part of the decrease.

- `executeDecreaseLiquidity` — broadcasts and returns `IntentTxResult<K, Raw>`. Supports `raw: true` and `raw: false`.
- `decreaseLiquidity` — calls `executeDecreaseLiquidity` and waits for relay. Only `raw: false`. Returns `TxHashPair`.

**Example:**
```typescript
const result = await sodax.dex.clService.decreaseLiquidity({
  params: {
    srcChainKey: ChainKeys.ETHEREUM_MAINNET,
    srcAddress: "0xabc...",
    poolKey,
    tokenId: 1n,
    liquidity: 250000n,
    amount0Min: 0n,
    amount1Min: 0n,
  },
  walletProvider: evmWalletProvider,
});
```

### executeClaimRewards / claimRewards

Harvest hook rewards for a position. Internally encodes a `decreaseLiquidity` call with `liquidity = 0`, which triggers reward accounting without removing any liquidity.

- `executeClaimRewards` — broadcasts and returns `IntentTxResult<K, Raw>`. Supports `raw: true` and `raw: false`.
- `claimRewards` — calls `executeClaimRewards` and waits for relay. Only `raw: false`. Returns `TxHashPair`.

**Example:**
```typescript
const result = await sodax.dex.clService.claimRewards({
  params: {
    srcChainKey: ChainKeys.ETHEREUM_MAINNET,
    srcAddress: "0xabc...",
    poolKey,
    tokenId: 1n,
    tickLower: -60000n,
    tickUpper: 60000n,
  },
  walletProvider: evmWalletProvider,
});
```

### Pool and Position Data

- `getPools()` — returns the list of configured `PoolKey` objects from `ConfigService`.
- `getAssetsForPool(srcChainKey, poolKey)` — translates hub-side pool currency addresses back to their original spoke-chain `XToken` descriptors.
- `getPoolData(poolKey, publicClient)` — fetches on-chain pool state (price, tick, liquidity, fee tiers, StatAToken enrichment, optional reward config).
- `getPositionInfo(tokenId, publicClient)` — fetches position data, computes current token amounts, unclaimed fees, and (for StatAToken pools) the equivalent underlying amounts.
- `getPoolRewardConfig(poolKey, publicClient)` — fetches reward configuration from the pool's hook contract.

**Example:**
```typescript
const pools = sodax.dex.clService.getPools();
const poolKey = pools[0];

// Translate pool currencies to spoke-chain token descriptors
const { token0, token1 } = sodax.dex.clService.getAssetsForPool(
  ChainKeys.ETHEREUM_MAINNET,
  poolKey,
);

const poolData = await sodax.dex.clService.getPoolData(poolKey, publicClient);
const positionInfo = await sodax.dex.clService.getPositionInfo(1n, publicClient);

const rewardConfig = await sodax.dex.clService.getPoolRewardConfig(poolKey, publicClient);
if (rewardConfig.ok) {
  console.log("Reward config:", rewardConfig.value);
}
```

### Utility Helpers

The CL service exposes static helpers for price/tick and liquidity math:

- `ClService.calculateLiquidityFromAmounts(amount0, amount1, tickLower, tickUpper, currentTick)` — compute the maximum liquidity achievable given both token input amounts (Uniswap V3 math).
- `ClService.calculateAmount1FromAmount0(amount0, tickLower, tickUpper, currentTick, sqrtPriceX96)` — derive the token1 amount paired with a given token0 amount.
- `ClService.calculateAmount0FromAmount1(amount1, tickLower, tickUpper, currentTick, sqrtPriceX96)` — derive the token0 amount paired with a given token1 amount.
- `ClService.calculateMaxAmountsForSlippage(liquidity, tickLower, tickUpper, currentTick, sqrtPriceX96, slippagePercent)` — compute worst-case `amount0Max` / `amount1Max` for a given slippage tolerance. Pass the results directly as `amount0Max` / `amount1Max` in supply/increase params.
- `ClService.priceToTick(price, token0, token1, tickSpacing)` — convert a human-readable price (token1 per token0) to the nearest initializable tick.

**Example:**
```typescript
const liquidity = ClService.calculateLiquidityFromAmounts(
  amount0,
  amount1,
  tickLower,
  tickUpper,
  currentTick,
);

const { amount0Max, amount1Max } = ClService.calculateMaxAmountsForSlippage(
  liquidity,
  tickLower,
  tickUpper,
  currentTick,
  sqrtPriceX96,
  0.5, // 0.5% slippage
);
```

## Types

### AssetService Types

```typescript
export type CreateAssetDepositParams<K extends SpokeChainKey> = {
  srcChainKey: K;
  srcAddress: GetAddressType<K>;
  asset: OriginalAssetAddress;
  amount: bigint;
  poolToken: Address;
  dst?: DestinationParamsType;
};

export type CreateAssetWithdrawParams<K extends SpokeChainKey> = {
  srcChainKey: K;
  srcAddress: GetAddressType<K>;
  poolToken: Address;
  asset: OriginalAssetAddress;
  amount: bigint;
  dst?: DestinationParamsType;
};

// Action wrappers (SpokeExecActionParams adds raw/walletProvider/skipSimulation/timeout)
export type AssetDepositAction<K extends SpokeChainKey, Raw extends boolean> =
  SpokeExecActionParams<K, Raw, CreateAssetDepositParams<K>>;

export type AssetWithdrawAction<K extends SpokeChainKey, Raw extends boolean> =
  SpokeExecActionParams<K, Raw, CreateAssetWithdrawParams<K>>;
```

### Concentrated Liquidity Types

```typescript
export type ClSupplyParams<K extends SpokeChainKey> = {
  srcChainKey: K;
  srcAddress: Address;
  poolKey: PoolKey;
  tickLower: bigint;
  tickUpper: bigint;
  liquidity: bigint;
  amount0Max: bigint;
  amount1Max: bigint;
  sqrtPriceX96: bigint;
};

export type ClIncreaseLiquidityParams<K extends SpokeChainKey> = {
  srcChainKey: K;
  srcAddress: Address;
  poolKey: PoolKey;
  tokenId: bigint;
  tickLower: bigint;
  tickUpper: bigint;
  liquidity: bigint;
  amount0Max: bigint;
  amount1Max: bigint;
  sqrtPriceX96: bigint;
};

export type ClDecreaseLiquidityParams<K extends SpokeChainKey> = {
  srcChainKey: K;
  srcAddress: Address;
  poolKey: PoolKey;
  tokenId: bigint;
  liquidity: bigint;
  amount0Min: bigint;
  amount1Min: bigint;
};

export type ClClaimRewardsParams<K extends SpokeChainKey> = {
  srcChainKey: K;
  srcAddress: Address;
  poolKey: PoolKey;
  tokenId: bigint;
  tickLower: bigint;
  tickUpper: bigint;
};
```

### Return Types

```typescript
// Relay-waiting methods (deposit, withdraw, supplyLiquidity, etc.)
export type TxHashPair = {
  srcChainTxHash: string; // spoke-chain tx hash
  dstChainTxHash: string; // hub-chain tx hash
};

// Execute methods (executeDeposit, executeSupplyLiquidity, etc.)
export type IntentTxResult<K extends SpokeChainKey, Raw extends boolean> = {
  tx: TxReturnType<K, Raw>;    // hash (raw: false) or unsigned tx bytes (raw: true)
  relayData: { address: `0x${string}`; payload: Hex };
};
```

## Error Handling

All async public methods return `Promise<Result<T>>`:

```typescript
type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: Error | unknown };
```

### Two contracts coexist

Almost every DEX failure is a `SodaxError` carrying `feature: 'dex'`, a `code`, and a `context`
object. The exception is the **relay leg**: DEX is the only feature module that does not pass relay
failures through `mapRelayFailure`, so the relay-waiting variants (`deposit`, `withdraw`,
`supplyLiquidity`, `increaseLiquidity`, `decreaseLiquidity`, `claimRewards`) forward the relay layer's
own error unchanged — a plain `Error` whose `.message` is one of `RELAY_ERROR_CODES`:
`SUBMIT_TX_FAILED`, `RELAY_TIMEOUT`, `RELAY_POLLING_FAILED`.

Handle both shapes:

```typescript
import { isSodaxError, isDexCreateIntentError } from "@sodax/sdk";

const result = await sodax.dex.assetService.deposit(params);

if (!result.ok) {
  if (isSodaxError(result.error)) {
    // Typed path — feature === 'dex'
    switch (result.error.code) {
      case "USER_REJECTED":         /* wallet popup dismissed */ break;
      case "VALIDATION_FAILED":     /* bad input, see error.context.field */ break;
      case "INTENT_CREATION_FAILED":/* build/sign/broadcast failed */ break;
      default:                      /* UNKNOWN */ break;
    }
    console.error(result.error.context, result.error.cause);
  } else if (result.error instanceof Error) {
    // Relay path — 'SUBMIT_TX_FAILED' | 'RELAY_TIMEOUT' | 'RELAY_POLLING_FAILED'.
    // The spoke transaction already landed; only delivery to the hub failed.
    console.error("relay:", result.error.message);
  }
}
```

The distinction matters operationally. All three relay codes mean the source-chain transaction
landed and only cross-chain delivery is unresolved, so the response is to keep polling or to
reconcile, not to resubmit.

Ordering the `isSodaxError` check first also keeps this code correct if DEX later routes relay
failures through `mapRelayFailure`: the relay branch simply stops being reached.

### Guards

`@sodax/sdk` exports three narrowing guards for DEX, each matching a code set:

| Guard | Code set | Use on |
| --- | --- | --- |
| `isDexApproveError` | `USER_REJECTED`, `VALIDATION_FAILED`, `APPROVE_FAILED`, `UNKNOWN` | `assetService.approve` |
| `isDexCreateIntentError` | `USER_REJECTED`, `VALIDATION_FAILED`, `INTENT_CREATION_FAILED`, `UNKNOWN` | every `execute*` method |
| `isDexError` | `VALIDATION_FAILED`, `LOOKUP_FAILED`, `UNKNOWN` | every read/lookup method |

`USER_REJECTED` takes precedence wherever it can appear. The `approveFailed` and
`intentCreationFailed` wrappers test `isWalletRejection(cause)` first, so a dismissed wallet prompt
arrives as `USER_REJECTED` rather than the generic failure code for that phase.

### Codes per method

| Method | Codes | Guard |
| --- | --- | --- |
| `assetService.approve` | `USER_REJECTED`, `VALIDATION_FAILED`, `APPROVE_FAILED`, `UNKNOWN` | `isDexApproveError` |
| `assetService.executeDeposit` / `executeWithdraw` | `USER_REJECTED`, `VALIDATION_FAILED`, `INTENT_CREATION_FAILED`, `UNKNOWN` | `isDexCreateIntentError` |
| `assetService.deposit` / `withdraw` | the above **plus** a raw relay `Error` | both, plus the `instanceof Error` fallback |
| `assetService.getWrappedAmount` / `getUnwrappedAmount` / `getDeposit` | `LOOKUP_FAILED`, `UNKNOWN` | `isDexError` |
| `assetService.isAllowanceValid` | **untyped** — see below | none |
| `clService.executeSupplyLiquidity` / `executeIncreaseLiquidity` / `executeDecreaseLiquidity` / `executeClaimRewards` | `USER_REJECTED`, `VALIDATION_FAILED`, `INTENT_CREATION_FAILED`, `UNKNOWN` | `isDexCreateIntentError` |
| `clService.supplyLiquidity` / `increaseLiquidity` / `decreaseLiquidity` / `claimRewards` | the above **plus** a raw relay `Error` | both |
| `clService.getMintPositionEvent` | `LOOKUP_FAILED`, `UNKNOWN` | `isDexError` |
| `clService.getPoolData` / `getPositionInfo` | `LOOKUP_FAILED`, `UNKNOWN` | `isDexError` |
| `clService.getPoolRewardConfig` | `VALIDATION_FAILED` (`'Pool has no hook configured'`), `LOOKUP_FAILED`, `UNKNOWN` | `isDexError` |

Codes listed here are the ones these methods actually produce; `UNKNOWN` is the forward-compatible
catch-all. The guards narrow to a wider code set than any single method emits.

`LOOKUP_FAILED` does not vary by method — the method name is carried on `error.context.method`
(`'getPoolData'`, `'getPositionInfo'`, `'getPoolRewardConfig'`, `'getMintPositionEvent'`,
`'getWrappedAmount'`, `'getUnwrappedAmount'`, `'getDeposit'`). Branch on `context.method`, not on the
code.

### `isAllowanceValid` is on neither contract

`assetService.isAllowanceValid` still returns its raw failure — the thrown `tiny-invariant` `Error`,
or a forwarded spoke-service error — without wrapping it in a `SodaxError`. Treat its error channel
as `unknown` and do not assume a `code`. It is the one method in the module still on this shape.

### Precondition failures are not uniformly `VALIDATION_FAILED`

DEX uses two different assertion helpers and they produce different codes:

- `dexInvariant(...)` throws a `SodaxError<'VALIDATION_FAILED'>` with `context.phase: 'validate'`.
  Only two consumer-visible messages come from it: `'Approve only supported for EVM/Stellar spoke
  chains'` and the `getAssetsForPool` token-not-found messages.
- plain `invariant(...)` throws a bare `Error`, which the enclosing catch then re-wraps with
  `approveFailed` / `intentCreationFailed`.

The same message therefore surfaces under different codes depending on the method: `'Amount must be
greater than 0'` arrives as `APPROVE_FAILED` from `approve()` and as `INTENT_CREATION_FAILED` from
`executeDeposit()`. Do not key user-facing copy on `VALIDATION_FAILED` alone; read
`error.message` / `error.cause` when you need the specific precondition.

### Methods that throw instead of returning `Result`

These helpers throw rather than returning a `Result`, so wrap them in `try`/`catch`:

- `assetService.isSodaAsXSodaInPool()` — `[isSodaDepositToXSoda] Spoke token not found for asset …`
- `assetService.getTokenWrapAction()` / `getTokenUnwrapAction()` — `[withdrawData] Hub asset not found`
- `clService.getAssetsForPool()` — throws `SodaxError<'VALIDATION_FAILED'>` via `dexInvariant`
- `ClService.sqrtBigInt()` — `sqrtBigInt: negative input`

### `context` fields

DEX populates `phase` (`validate` | `intentCreation` | `approve` | `lookup`), `method` (on
`LOOKUP_FAILED`), and `method` (on lookup failures). It does **not** set `relayCode` —
that field only exists on modules whose relay failures go through `mapRelayFailure`.

## Usage Flow

1. **Check allowance** using `assetService.isAllowanceValid()`
2. **Approve** using `assetService.approve()` if needed (trustlines are handled automatically for Stellar as source)
3. **For Stellar destination chains**: check and establish trustlines manually (see [Stellar Trustline Requirements](https://docs.sodax.com/developers/how-to/stellar_trustline))
4. **Deposit** using `assetService.deposit()` to wrap tokens into StatAToken pool-token balances
5. **Supply liquidity** using `clService.supplyLiquidity()` (or increase an existing position)
6. **Retrieve tokenId** from the mint event using `clService.getMintPositionEvent(dstChainTxHash)` if needed for subsequent operations
7. **Manage position** using `increaseLiquidity` / `decreaseLiquidity` / `claimRewards`
8. **Withdraw** using `assetService.withdraw()` to unwrap StatATokens back to the original asset

## Runnable example

[`apps/demo`](https://github.com/icon-project/sodax-sdks/tree/main/apps/demo/src/pages/dex) —
`pnpm dev:demo`, then `/dex`. It walks the eight steps above in order, so it is the fastest way to
see which of them need an approval and which return a position `tokenId`.

There is no backend counterpart in
[`apps/node`](https://github.com/icon-project/sodax-sdks/tree/main/apps/node) for the DEX module
yet.
