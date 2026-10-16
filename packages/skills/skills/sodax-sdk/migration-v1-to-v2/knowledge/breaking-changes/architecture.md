# Architecture breaking changes — v1 → v2

The structural changes that reshaped the SDK at the service / runtime layer. Read after [`type-system.md`](type-system.md) — by the time you arrive here, your imports should compile and the rest is wiring.

The four load-bearing shifts:

1. **Per-chain `*SpokeProvider` classes are deleted.** Routing is by chain key, dispatched internally by `SpokeService`.
2. **Static lookup tables — `hubAssets` deleted; `moneyMarketSupportedTokens`, `SodaTokens`, `supportedSpokeChains` still exported as packaged defaults but should yield to `sodax.config.*` so backend updates take effect.** See § 2 below for the per-symbol status table.
3. **Relay flow is centralised.** Two functions (`relayTxAndWaitPacket`, `submitTransaction`) and one mapper (`mapRelayFailure`) replace per-feature relay helpers.
4. **Invariants and guards are unified.** `sodaxInvariant` + per-feature aliases (`swapInvariant`, `mmInvariant`, etc.) and `isSodaxError` / `isFeatureError` replace ad-hoc throws and module-specific type guards.

---

## 1. Spoke-provider deletion

### What's gone

These v1 classes and their union are **deleted**:

- `EvmSpokeProvider`
- `SonicSpokeProvider`
- `SolanaSpokeProvider`
- `SuiSpokeProvider`
- `IconSpokeProvider`
- `InjectiveSpokeProvider`
- `StellarSpokeProvider`
- `StacksSpokeProvider`
- `BitcoinSpokeProvider`
- `NearSpokeProvider`
- The union type `SpokeProvider`
- The instance-test functions: `isEvmSpokeProvider`, `isSolanaSpokeProvider`, `isBitcoinSpokeProvider`, `isStellarSpokeProvider`, `isIconSpokeProvider`, `isSuiSpokeProvider`, `isInjectiveSpokeProvider`, `isStacksSpokeProvider`, `isNearSpokeProvider`, `isSonicSpokeProvider`.

### What replaces them

A single internal router, `SpokeService`, owned by the `Sodax` instance. It holds one per-chain-family service (`EvmSpokeService`, `SolanaSpokeService`, …) and exposes `getSpokeService(chainKey)` for internal feature services. **Consumers never construct or hold a reference to a spoke service.** They pass `walletProvider` and a `srcChainKey` literal, and the SDK dispatches.

### Migration mechanics

#### v1: construct + pass

```ts
// v1
const evmWp = new EvmWalletProvider({ privateKey: '0x…', rpcUrl: '…' });
const sourceProvider = new EvmSpokeProvider({ walletProvider: evmWp, chainConfig: ARBITRUM_MAINNET_CONFIG });

await sodax.swaps.createIntent({ intentParams, spokeProvider: sourceProvider });
```

#### v2: pass directly

```ts
// v2
const evmWp = new EvmWalletProvider({ privateKey: '0x…', rpcUrl: '…' });

await sodax.swaps.createIntent({
  params: { ...intentParams, srcChainKey: ChainKeys.ARBITRUM_MAINNET, srcAddress },
  raw: false,
  walletProvider: evmWp,
});
```

The chain config is no longer something the consumer constructs — it's loaded by `ConfigService` from the backend (with a fallback to packaged defaults). The chain key on the payload tells the SDK which spoke service to route to.

### Replacing instance tests with chain-key guards

```diff
- if (isBitcoinSpokeProvider(provider)) { /* … */ }
+ if (chainKey === ChainKeys.BITCOIN_MAINNET) { /* … */ }

- if (provider instanceof StellarSpokeProvider) { /* … */ }
+ if (chainKey === ChainKeys.STELLAR_MAINNET) { /* … */ }

- if (isEvmSpokeProvider(provider)) { /* … */ }
+ if (getChainType(chainKey) === 'EVM') { /* … */ }
```

`getChainType(chainKey)` (from `@sodax/sdk`) returns `'EVM' | 'BITCOIN' | 'SOLANA' | 'STELLAR' | 'SUI' | 'ICON' | 'INJECTIVE' | 'STACKS' | 'NEAR'` and is the canonical chain-family discriminator.

Family-level helper guards (`isEvmChainKeyType`, `isBitcoinChainKeyType`, `isSolanaChainKeyType`, etc.) are also exported from `@sodax/sdk` for cases where you want a typed boolean.

### Replacing reads from a spoke-provider instance

If your v1 code reached into a spoke provider for chain config or wallet info, those reads now have direct sources:

| v1 access | v2 source |
|---|---|
| `provider.chainConfig.chain.name` | `baseChainInfo[chainKey].name` (from `@sodax/sdk`) |
| `provider.chainConfig.chain.type` | `getChainType(chainKey)` |
| `provider.walletProvider.getWalletAddress()` | The wallet provider you passed in — call `walletProvider.getWalletAddress()` directly. |
| `provider.publicClient` (EVM only) | If you absolutely need it: `sodax.hubProvider.publicClient` exists for hub-side reads. Spoke-side public clients aren't surfaced — use the typed read methods on each feature service instead. |

### Pitfall

If your project's v1 wrapper code instantiated `*SpokeProvider` classes, don't try to recreate that wrapper in v2 — it intentionally doesn't exist. Pass `walletProvider` directly into each SDK call payload.

---

## 2. ConfigService replaces static lookups

### What's gone

| v1 global | v2 replacement |
|---|---|
| `hubAssets[chainId][address]` (vault lookup) | `token.vault` directly (added to `XToken` — see [`type-system.md`](type-system.md) § 4) |
| `hubAssets[chainId][address]` (hub-asset address) | `token.hubAsset` directly |
| `baseChainInfo[chain].id` | `baseChainInfo[chain].key` (field renamed) |

### Static defaults — still exported, prefer the service API

These v1 names still ship through `@sodax/sdk` (re-exported from `@sodax/types`), so a v1 `import { ... } from '@sodax/sdk'` will not break. Once you call `await sodax.config.initialize()`, the dynamic config from the backend supersedes the packaged defaults — read through the service API to see runtime updates (new tokens, fee parameters). Without `initialize()`, both paths return the same packaged values.

| v1 export | v2 status | Preferred v2 API |
|---|---|---|
| `moneyMarketSupportedTokens[chainId]` | Still exported (`packages/types/src/moneyMarket/moneyMarket.ts`) | `sodax.moneyMarket.getSupportedTokensByChainId(chainKey)` |
| `Object.entries(moneyMarketSupportedTokens)` (walk pattern) | Const still exported | `sodax.moneyMarket.getSupportedTokens()` (returns `Record<SpokeChainKey, XToken[]>`) |
| `SodaTokens` (hub-vault registry — feature-neutral, **not** the reserve list) | Still exported (`packages/types/src/chains/tokens.ts`) | `sodax.config.getMoneyMarketReserveAssets()` or `sodax.moneyMarket.getSupportedReserves()` for reserves; `sodax.config.getSupportedSwapTokensByChainId('sonic')` for swaps |
| `swapSupportedTokens[chainId]` (v1 had no `solverSupportedTokens`) | Still exported (`packages/types/src/swap/swap.ts`) | `sodax.config.getSupportedSwapTokensByChainId(chainKey)` |
| `getSupportedSolverTokens(chainId)` (free function) | Still exported (`packages/types/src/swap/swap.ts`) | `sodax.config.getSupportedSwapTokensByChainId(chainKey)` |
| `supportedSpokeChains` (`SpokeChainKey[]`) | Still exported (`packages/types/src/chains/chains.ts`) | `sodax.config.isValidSpokeChainKey(chainKey)` for validation, or read `sodaxConfig.chains` at module scope |

### What replaces them

`ConfigService` is a stateful service owned by `Sodax`. It loads chain/token config from the backend API on `await sodax.config.initialize()` and falls back to packaged defaults from `@sodax/types` if the backend is unreachable. After init, every lookup goes through the service:

```ts
const sodax = new Sodax(/* optional config override */);
await sodax.config.initialize();   // fetch from backend, fall back on failure

// Token lookups
const usdc = sodax.config.findSupportedTokenBySymbol(ChainKeys.ARBITRUM_MAINNET, 'USDC');
const supportedOnChain = sodax.config.getSupportedTokensPerChain();

// Hub-asset / vault lookups (when the XToken doesn't carry it)
const original = sodax.config.getOriginalAssetAddress(chainKey, hubAddress);

// Chain validity
const isValid = sodax.config.isValidSpokeChainKey(chainKey);
```

Feature services (`SwapService`, `MoneyMarketService`, …) receive `ConfigService` via constructor injection and use it internally — consumer-side code reads the same data through `sodax.config.*` or feature-specific wrappers like `sodax.moneyMarket.getSupportedTokens()`.

### Migration mechanics

```diff
- import { hubAssets, moneyMarketSupportedTokens } from '@sodax/types';
- const vault = hubAssets[chainId]?.[token.address]?.vault;
+ const vault = token.vault;  // baked into XToken in v2

- const supplyTokens = moneyMarketSupportedTokens[chainId];
+ const supplyTokens = sodax.moneyMarket.getSupportedTokensByChainId(chainKey);
```

If your code walked `hubAssets` to find "is this address a known vault?":

```diff
- const isKnownVault = !!hubAssets[chainId]?.[address];
+ const isKnownVault = sodax.config.getMoneyMarketReserveAssets()
+   .some(asset => asset.address === address);
```

### Pitfall

The `swaps` config field changed semantics. v1 put solver endpoints under `SodaxConfig.swaps`. v2 has two fields:

- `SodaxConfig.swaps`: `SwapsConfig` listing supported solver tokens per chain (data, not endpoints).
- `SodaxConfig.solver`: `{ intentsContract, solverApiEndpoint, protocolIntentsContract }` (the endpoint/contract config that v1 misplaced under `swaps`).

If you pass a config override to `new Sodax({ ... })`, put solver endpoints in `solver`, not `swaps`.

---

## 3. Relay flow and intent-relay reshape

### What changed

v1 had per-feature relay helpers (each feature module had its own `*WaitForRelay()` or `relay*Tx()` function). v2 centralises this into `IntentRelayApiService` with two public entry points:

- `submitTransaction(payload, apiUrl)` — TWO positional args (`payload: IntentRelayRequest<'submit'>`, `apiUrl: HttpUrl`), not an options object. POSTs the spoke transaction to the relay submit endpoint and resolves the relay's first-stage acknowledgement.
- `relayTxAndWaitPacket({ srcTxHash, data, chainKey, relayerApiEndpoint, timeout, pollTxHash? })` — `RelayAndWaitParams`: `data` is the whole `RelayExtraData` / `OnDemandRelayData` object, `chainKey` is the source `SpokeChainKey`. Runs `submitTransaction` and then polls until the destination packet reaches `executed`. Resolves with `{ srcTxHash, dstTxHash, packet }` on success.

Internally, every feature service now calls `relayTxAndWaitPacket` for the spoke→hub leg. Failures from this layer surface to consumers via `mapRelayFailure`.

### `RELAY_ERROR_CODES` — the public relay-layer contract

The relay layer keeps a stable string vocabulary on its own errors (these are **not** `SodaxErrorCode` values — they are the lower-level relay codes that get mapped):

```ts
type RelayCode =
  | 'SUBMIT_TX_FAILED'
  | 'RELAY_TIMEOUT'
  | 'RELAY_POLLING_FAILED'
  | 'UNKNOWN';
```

When a relay-layer failure surfaces as a `SodaxError`, the original relay code lives on `error.context.relayCode`.

### `mapRelayFailure` — single shared mapper

v1 had five per-feature mappers (each feature reshaped relay errors into its own typed-error union). v2 collapses them into one:

```ts
import { mapRelayFailure } from '@sodax/sdk';

const mapped = mapRelayFailure(error, {
  feature: 'swap',
  action: 'createIntent',
  srcChainKey: ChainKeys.ARBITRUM_MAINNET,
  dstChainKey: ChainKeys.STELLAR_MAINNET,
  // phase: 'destinationExecution',  // optional override; used by migration's bnUSD secondary watcher
});
```

`mapped` is a `SodaxError<C>` with code in {`'TX_SUBMIT_FAILED'`, `'RELAY_TIMEOUT'`, `'RELAY_FAILED'`, `'EXECUTION_FAILED'`} and `feature` set to the requested value. Consumers don't usually call `mapRelayFailure` directly — every feature service does this internally — but it's exported for custom orchestration code.

### Migration mechanics for consumers

If your v1 code wrapped a feature call to handle relay failures:

```diff
- try {
-   const tx = await sodax.swaps.createIntent({ intentParams, spokeProvider });
- } catch (e) {
-   if (e instanceof RelayError && e.code === 'RELAY_TIMEOUT') { /* … */ }
-   else if (e instanceof IntentError) { /* … */ }
- }

+ const result = await sodax.swaps.createIntent({ params, raw: false, walletProvider });
+ if (!result.ok) {
+   if (isSodaxError(result.error)) {
+     if (result.error.code === 'RELAY_TIMEOUT') { /* … */ }
+     else if (result.error.feature === 'swap' && result.error.code === 'INTENT_CREATION_FAILED') { /* … */ }
+   }
+ }
```

The full v1 ↔ v2 code crosswalk is in [`result-and-errors.md`](result-and-errors.md) § "v1 ↔ v2 code crosswalk".

### Pitfall

`relayTxAndWaitPacket` is the public name; v1 had `submitTxAndWaitForPacket` and similar variants. If your v1 code imported or wrapped one of those names, the export is gone. Use `relayTxAndWaitPacket` directly, or call the feature service's higher-level method (`sodax.swaps.swap(...)`, `sodax.bridge.bridge(...)`) which wraps it.

---

## 4. Invariants and guards

### What's gone

- Per-module typed error unions and their type-guards: `MoneyMarketError`, `IntentError`, `StakingError`, `BridgeError`, `MigrationError`, `AssetServiceError`, `ConcentratedLiquidityError`, `RelayError`, plus 5 partner error types and their `is<Module>Error()` helpers. (Structural deletion — see [`type-system.md`](type-system.md) § 10.)
- Ad-hoc precondition throws (`if (!x) throw new Error('Amount must be greater than 0')`).

### What replaces them

#### `sodaxInvariant` + per-feature aliases

Every feature has a 1-line alias for `sodaxInvariant` that pre-fills the `feature` field:

```ts
// Internal SDK helpers (also exported for custom code)
import {
  sodaxInvariant,
  swapInvariant,
  mmInvariant,
  bridgeInvariant,
  stakingInvariant,
  migrationInvariant,
  dexInvariant,
  partnerInvariant,
  recoveryInvariant,
} from '@sodax/sdk';

mmInvariant(amount > 0n, 'Amount must be greater than 0');
// Throws SodaxError<'VALIDATION_FAILED'> with feature: 'moneyMarket' and the message above.
```

In your own consumer code, if you have your own preconditions, use `sodaxInvariant` directly (you pick the feature):

```ts
sodaxInvariant(
  isValidSpokeChainKey(chainKey),
  'Unsupported source chain',
  { feature: 'swap', context: { reason: 'unsupportedChain', srcChainKey: chainKey } },
);
```

#### `isSodaxError` and `isFeatureError`

```ts
import { isSodaxError, isFeatureError } from '@sodax/sdk';

if (isSodaxError(e)) {
  // e: SodaxError<SodaxErrorCode>
}

const isMmError = isFeatureError('moneyMarket');
if (isMmError(e)) {
  // e: SodaxError<SodaxErrorCode> with feature: 'moneyMarket'
}
```

`isFeatureError` is a guard factory. Use it once at module top and then as a normal type guard:

```ts
const isSwapError = isFeatureError('swap');
const isStakingError = isFeatureError('staking');
```

#### `isCodeMember` for per-method narrowing

When a public method declares a narrow code union (e.g. `useSupplyError`), there's a corresponding `isUseSupplyError` guard you can apply to discriminate within a single feature:

```ts
// Inside per-feature errors.ts files (referenced by per-method types)
const SUPPLY_CODES: ReadonlySet<SupplyErrorCode> = new Set([
  'VALIDATION_FAILED',
  'INTENT_CREATION_FAILED',
  'EXECUTION_FAILED',
  'TX_VERIFICATION_FAILED',
  'RELAY_TIMEOUT',
  // …
]);
const isSupplyError = isCodeMember(SUPPLY_CODES);
```

You can build your own `isCodeMember(codes)` guards from `@sodax/sdk` exports.

### Pitfall

Don't try to recreate a typed-error union by aliasing `SodaxError` per feature — it defeats the design. The whole point of v2's error model is that one class with `(feature, code)` discrimination covers every case, and your switch statements use those two fields. If your v1 code had `try { … } catch (e: MoneyMarketError) { ... }`, replace the catch with `if (isSodaxError(e) && e.feature === 'moneyMarket')`.

---


The two reference tables that used to live as Appendix A (deleted exports) and Appendix B (`SodaxConfig` reshape) have moved into `../reference/`:

- [`../reference/deleted-exports.md`](../reference/deleted-exports.md) — every v1 symbol removed from `@sodax/sdk` and `@sodax/types`, with its v2 replacement.
- [`../reference/sodax-config.md`](../reference/sodax-config.md) — `SodaxConfig` constructor reshape (`swaps` vs `solver`, `rpcConfig` keying, `hubProviderConfig` → `hubConfig`).

## Cross-references

- Type-level renames and shape changes: [`type-system.md`](type-system.md).
- Result/error model semantics: [`result-and-errors.md`](result-and-errors.md).
- v2 design context (architectural concepts): [`architecture.md`](../../../integration/knowledge/architecture.md).
- ConfigService usage patterns: [`recipes/`](../../../integration/knowledge/recipes/) § "Initialize Sodax".
- Public API surface: [`reference/`](../../../integration/knowledge/reference/) § "Public API surface".
