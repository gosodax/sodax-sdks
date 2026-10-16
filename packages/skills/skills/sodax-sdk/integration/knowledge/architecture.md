# Architecture — `@sodax/sdk` v2

Every v2 design concept the SDK rests on, in a single TOC-navigable file. Read end-to-end if you're new to v2; skim by section if you're solving a specific problem.

## Section index

1. [Hub-and-spoke model](#1-hub-and-spoke-model) — Sonic is the hub; 20 spoke chains route through it.
2. [`SpokeService` router](#2-spokeservice-router) — single internal dispatcher; no per-chain provider classes.
3. [`Sodax` facade and service graph](#3-sodax-facade-and-service-graph) — one instance owns every feature service.
4. [`ConfigService`](#4-configservice) — dynamic config from backend with packaged-defaults fallback.
5. [`ChainKeys` and chain-key narrowing](#5-chainkeys-and-chain-key-narrowing) — `GetChainType<K>`, `GetWalletProviderType<K>`.
6. [`WalletProviderSlot<K, Raw>`](#6-walletproviderslotk-raw) — discriminated union for signed vs raw flows.
7. [`Result<T, SodaxError<C>>`](#7-resultt-sodaxerrorc) — every async public method returns this.
8. [`SodaxError<C>` and the 13-code vocabulary](#8-sodaxerrorc-and-the-13-code-vocabulary) — canonical error class.
9. [Relay layer: `relayTxAndWaitPacket` and `mapRelayFailure`](#9-relay-layer-relaytxandwaitpacket-and-mapfailrelay) — cross-chain coordination.

---

## 1. Hub-and-spoke model

SODAX is a cross-chain DeFi platform built on a hub-and-spoke architecture. **Sonic is the hub chain.** Every cross-chain operation flows through it:

```
spoke chain (e.g. Arbitrum)
    │
    │  spoke transaction (deposit / approve / send)
    ▼
SpokeService (in @sodax/sdk)
    │
    │  submitTransaction (from intentRelay module)
    ▼
relay layer
    │
    │  relayTxAndWaitPacket → packet 'executed' on hub
    ▼
EvmHubProvider
    │
    │  hub-side contracts (vault, asset manager, wallet abstraction)
    ▼
destination spoke (e.g. Stellar)
```

For most consumers, this whole pipeline is one method call (`sodax.swaps.swap(...)`, `sodax.bridge.bridge(...)`, etc.). The result is a `Result<TxHashPair>` where `TxHashPair = { srcChainTxHash, dstChainTxHash }` — the spoke transaction hash on the source chain and the relayed hub transaction hash. The relay state in between is handled internally.

**You will hit "the relay" surface area** when:

- An operation fails partway through and the error is a relay code (`'TX_SUBMIT_FAILED'`, `'RELAY_TIMEOUT'`, `'RELAY_POLLING_FAILED'`) — see § 9.
- You build a custom orchestration on top of `relayTxAndWaitPacket` directly (rare; usually a feature service is the right abstraction).
- You need to recover assets stuck in a hub wallet — use `RecoveryService`.

### Supported chains

22 total. EVM (14): Sonic (hub), Ethereum, Arbitrum, Base, BSC, Optimism, Polygon, Avalanche, HyperEVM, Lightlink, Redbelly, Kaia, Hedera, Robinhood Chain. Non-EVM (8): Solana, Sui, Stellar, ICON, Injective, NEAR, Stacks, Bitcoin. See [`reference/`](reference/) § "Chain keys" for the full table with relay IDs and address-type mapping.

---

## 2. `SpokeService` router

The SDK does not require callers to construct per-chain provider classes. There is no `EvmSpokeProvider`, `SolanaSpokeProvider`, etc. for consumers to construct.

Instead, the SDK has **one** `SpokeService` instance (owned by `Sodax`) which holds one per-chain-family service internally:

```
SpokeService
 ├── EvmSpokeService        (handles all 14 EVM chains)
 ├── SonicSpokeService      (special-cased for the hub)
 ├── SolanaSpokeService
 ├── SuiSpokeService
 ├── StellarSpokeService
 ├── IconSpokeService
 ├── InjectiveSpokeService
 ├── StacksSpokeService
 ├── BitcoinSpokeService
 └── NearSpokeService
```

Public entry: `sodax.spoke.getSpokeService(chainKey)` (typed). Feature services route to the right family by calling this internally — consumer-side code never does.

### How the router uses chain keys

The chain key on the request payload (e.g. `srcChainKey: ChainKeys.ETHEREUM_MAINNET`) does two things at once:

1. **Type-level narrowing** — TypeScript preserves the literal in the generic `K`. From `K`, the type system derives:
   - `GetChainType<K>` → chain family (`'EVM' | 'BITCOIN' | 'SOLANA' | …`)
   - `GetWalletProviderType<K>` → chain-specific wallet provider interface (`IEvmWalletProvider`, …)
   - `TxReturnType<K, Raw>` → chain-specific tx return shape
2. **Runtime dispatch** — `getChainType(chainKey)` (the runtime helper) resolves the family at runtime, and `SpokeService` calls the right family service.

The chain key is the bridge between the type system and runtime routing.

### ERC-20 approval can take two transactions

A few ERC-20s of the 2017 TetherToken lineage reject an allowance change from one non-zero value to
another, so a wallet holding a stale allowance cannot approve at all until the allowance is zeroed.
Before a signed approval, `SpokeService` simulates the approve and, when it reverts, sends
`approve(0)` first, waits for it to be mined, then sends the real approval. The user signs twice.

Detection is behavioural — the simulated approve either reverts or it does not — never a token list,
so a token added or upgraded later is handled without a code change. Consumer impact:

- **Signed flows (`raw: false`)** are unchanged. Every feature `approve` still resolves to a single
  transaction hash: the hash of the **last** transaction. Show step progress in the UI if you want,
  but nothing breaks if you do not.
- **Unsigned flows (`raw: true`)** still return exactly one transaction from `approve`, which cannot
  express a two-step plan. Use `sodax.swaps.buildApproveTxs({ params, raw: true })` — or
  `sodax.bridge.buildApproveTxs` for a bridge — instead; both return `{ approveTx, resetTx? }`.
  `resetTx` is present only for a guarded token holding a stale allowance — broadcast it and wait for
  it to be mined first, because `approveTx` is not valid until the reset has landed. Each feature
  resolves its own spender (a bridge on the hub approves the caller's hub wallet router, a swap the
  solver's intents contract), so call the one matching the action you are about to take.

---

## 3. `Sodax` facade and service graph

The `Sodax` class is the public entry point. It constructs and wires every service once at construction time, then reuses them across calls:

```ts
const sodax = new Sodax(/* optional SodaxOptions */);
await sodax.config.initialize();   // fetch dynamic config; fall back to packaged defaults

// All feature services accessed off the instance:
await sodax.swaps.createIntent({ params, raw: false, walletProvider });
await sodax.moneyMarket.supply({ params, raw: false, walletProvider });
await sodax.bridge.bridge({ params, raw: false, walletProvider });
```

### Service graph

```
Sodax
 ├── swaps           — SwapService            (intent-based swaps via solver)
 ├── moneyMarket     — MoneyMarketService     (cross-chain lending/borrowing)
 ├── bridge          — BridgeService          (cross-chain token transfers)
 ├── staking         — StakingService         (SODA/xSoda staking)
 ├── dex             — DexService             (concentrated liquidity, AMM)
 ├── migration       — MigrationService       (ICX/bnUSD/BALN migration)
 ├── partners        — PartnerService         (partner fee claiming)
 ├── recovery        — RecoveryService        (withdraw stuck hub-wallet assets)
 ├── backendApi      — BackendApiService      (intent lookup, orderbook, money-market reads, config fetching)
 ├── api             — alias for backendApi; `api.swaps` is SwapsApiService (typed Swaps API client)
 ├── config          — ConfigService          (dynamic config; see § 4)
 ├── hubProvider     — HubProvider            (hub contract interactions; concrete impl `EvmHubProvider`)
 └── spoke           — SpokeService           (per-chain-family router; see § 2)
```

All feature services receive `{ hubProvider, config, spoke }` via constructor injection. You don't instantiate them directly — accessing `sodax.<feature>` is the public API.

### Constructor

```ts
import { Sodax, type SodaxOptions } from '@sodax/sdk';

new Sodax(config?: SodaxOptions): Sodax;
```

`SodaxOptions` is `DeepPartial<SodaxDefaultConfig> & { logger?: SodaxLoggerOption; fee?: PartnerFee }` — a deep-partial override of the `SodaxDefaultConfig` data contract, plus the client-side options (`logger` sink + global partner `fee`) kept off `SodaxDefaultConfig` itself: the integrator sets them, they are resolved once, and the backend never fetches or overwrites them. Read the resolved global fee back via `sodax.config.fee`. The global `fee` is the **default applied to any feature whose own `partnerFee` is unset** — the effective fee is `featureFee ?? fee`, resolved via `sodax.config.swapPartnerFee` / `moneyMarketPartnerFee` / `bridgePartnerFee` / `leverageYieldPartnerFee`. (See [`recipes/logging.md`](recipes/logging.md) for the `logger` precedent.)

`SodaxDefaultConfig` has exactly **10 fields** (all required at the type level, but `DeepPartial` makes every leaf optional):

- `chains: Record<SpokeChainKey, SpokeChainConfig>` — per-spoke-chain config. Each entry carries `rpcUrl`, polling config, and chain-family-specific extras (`BitcoinSpokeChainConfig`, `StellarSpokeChainConfig`, etc.). EVM hub/Sonic entries also accept an optional `rpcUrls` failover list (see [`recipes/initialize-sodax.md`](recipes/initialize-sodax.md)).
- `swaps: SwapsConfig` — supported solver tokens per chain (+ optional per-feature `partnerFee` override).
- `moneyMarket: MoneyMarketConfig` — money market contracts + supported tokens (+ optional per-feature `partnerFee` override).
- `bridge: BridgeConfig` — bridge `{ partnerFee }` override.
- `dex: DexConfig` — DEX pool/asset config.
- `leverageYield: LeverageYieldConfig` — registry of leverage-yield ERC-4626 vaults on the hub.
- `hub: HubConfig` — hub-chain (Sonic) full address map + RPC URL + polling config. Accepts an optional `rpcUrls` failover list (and `rpcOptions` tuning) — see [`recipes/initialize-sodax.md`](recipes/initialize-sodax.md).
- `api: ApiConfig` — backend API config: flat `BackendApiConfig` (`{ baseURL, basePath?, timeout, headers }`, shared by `sodax.backendApi` and the swaps client `sodax.api.swaps`) or nested `CustomApiConfig` (`{ baseApiConfig?, swapsApiConfig? }`) to point the swaps API at its own endpoint. `baseURL` is the gateway root; each service appends its own path below it.
- `solver: SolverConfig` — `{ intentsContract, solverApiEndpoint, protocolIntentsContract }`.
- `relay: RelayConfig` — intent relay endpoint + chain-id map.

> **Not config slots** — `staking`, `migration`, `partner`/`partners`, `recovery` are services on the `Sodax` instance (`sodax.staking`, etc.) but they are **not** configurable via `SodaxConfig`. They run on packaged defaults; per-call params handle customization.

In production, the packaged defaults are sufficient — pass nothing and call `await sodax.config.initialize()` to load fresh data from the backend.

---

## 4. `ConfigService`

Replaces every static lookup table that v1 exported as a global (`hubAssets`, `moneyMarketSupportedTokens`, `solverSupportedTokens`, `SodaTokens`, etc.). Loads from the backend API on `initialize()`; falls back to packaged defaults from `@sodax/types` if the backend is unreachable.

### Lifecycle

```ts
const sodax = new Sodax();
await sodax.config.initialize();   // network call + cache; fall back on failure

// After init:
sodax.config.isValidSpokeChainKey(chainKey);
sodax.config.findSupportedTokenBySymbol(chainKey, 'USDC');
sodax.config.getSupportedTokensPerChain();
sodax.config.getOriginalAssetAddress(chainKey, hubAsset);   // (chainId, hubAsset) → original spoke-side address
sodax.config.getMoneyMarketReserveAssets();
sodax.config.getMoneyMarketToken(chainKey, tokenAddress);   // resolve a hub-asset address → XToken
sodax.config.getSupportedSwapTokensByChainId(chainKey);     // solver-supported tokens for one chain
sodax.config.getSpokeChainKeyFromIntentRelayChainId(BigInt(...));
```

Every feature service consumes `ConfigService` internally. The data flows through `XToken` (which now carries `vault` and `hubAsset` directly per token) and through service-method wrappers like `sodax.moneyMarket.getSupportedTokens()`.

### Why dynamic

Chain configs (vault addresses, supported tokens, fee parameters) change between SDK releases. Dynamic loading means the SDK can pick up new chains and tokens without a version bump. The packaged defaults are a fallback for offline / sandbox / pre-release conditions.

### Custom backend

Point at a custom backend URL via `SodaxConfig.api`. `baseURL` is the gateway root; the data API's `/be`
mount is appended below it, so a sandbox serving `/config/*` at its bare origin needs `basePath: ''`:

```ts
const sodax = new Sodax({
  api: { baseApiConfig: { baseURL: 'https://sandbox-api.example.com', basePath: '' } },
});
```

`SodaxConfig.api` is `ApiConfig` — the flat `BackendApiConfig` (`{ baseURL, basePath?, timeout, headers }`) shared by both backend clients, or the nested `CustomApiConfig` (`{ baseApiConfig?, swapsApiConfig? }`) to point the swaps API (`sodax.api.swaps`) at its own endpoint. `baseURL` is the gateway root and every service appends its own path below it (`/be`, `/swaps`, `/bridge`, `/sponsorships/stellar`), so it must never carry a service segment; `basePath` overrides the data API's mount for a non-gateway deployment. Pass any subset via `DeepPartial`. v2 does not provide a typed slot to inject a custom `IConfigApiV1` implementation at construction; if you need to mock the backend for tests, point `baseURL` at a local mock server (with `basePath: ''` when it serves the routes at its origin), or construct your own `BackendApiService`-compatible mock and inject it where you control the `Sodax` instance (e.g. dependency-injected in your app layer).

---

## 5. `ChainKeys` and chain-key narrowing

`ChainKeys` is a `const` object with one string property per chain. The values form the `ChainKey` union (full chain set, including hub) and `SpokeChainKey` (spoke chains only — no hub).

```ts
import { ChainKeys, type ChainKey, type SpokeChainKey } from '@sodax/sdk';

ChainKeys.SONIC_MAINNET            // 'sonic'
ChainKeys.ETHEREUM_MAINNET         // 'ethereum'
ChainKeys.ARBITRUM_MAINNET         // '0xa4b1.arbitrum'
ChainKeys.ICON_MAINNET             // '0x1.icon'
ChainKeys.BITCOIN_MAINNET          // 'bitcoin'
// …
```

The full table with values + chain family + relay id is in [`reference/`](reference/) § "Chain keys".

### Narrowing

When a literal `srcChainKey` flows into a generic method, TypeScript preserves it as a value type. From that one literal:

```ts
type K = typeof ChainKeys.ETHEREUM_MAINNET;     // '0xa4b1...' (the literal)

GetChainType<K>           // 'EVM'
GetWalletProviderType<K>  // IEvmWalletProvider
TxReturnType<K, false>    // Hash (the EVM signed-tx return)
TxReturnType<K, true>     // EvmRawTransaction
```

This is what allows `sodax.swaps.createIntent({ params: { srcChainKey: ChainKeys.ETHEREUM_MAINNET, ... }, raw: false, walletProvider: <evm-provider> })` to enforce at compile time that `walletProvider` is `IEvmWalletProvider` and not a Solana or Bitcoin one — there's no runtime check; the type system does it.

### Runtime helpers

```ts
import { getChainType, isEvmChainKeyType, isSolanaChainKeyType, isBitcoinChainKeyType, /* … */ } from '@sodax/sdk';

getChainType(chainKey);        // 'EVM' | 'BITCOIN' | 'SOLANA' | 'STELLAR' | 'SUI' | 'ICON' | 'INJECTIVE' | 'STACKS' | 'NEAR'
isEvmChainKeyType(chainKey);   // boolean (with type guard)
```

Use these for runtime branching — the typed helpers are friendlier than ad-hoc string equality and they don't go stale when new chains are added (they consult the central registry).

---

## 6. `WalletProviderSlot<K, Raw>`

The discriminated union that distinguishes signed-execution from raw-tx-building at compile time.

```ts
type WalletProviderSlot<K extends ChainKey, Raw extends boolean> =
  Raw extends true
    ? { raw: true; walletProvider?: never }
    : { raw: false; walletProvider: GetWalletProviderType<K> };
```

### Three rules

1. **`raw: true`** — `walletProvider` is **forbidden** (`?: never` rejects any value). The method returns a raw, unsigned tx payload (`TxReturnType<K, true>` — `EvmRawTransaction`, `SolanaRawTransaction`, etc.).
2. **`raw: false`** — `walletProvider` is **required** and chain-narrowed via `GetWalletProviderType<K>`. The method signs and broadcasts; returns a tx hash (`TxReturnType<K, false>`).
3. **Mandatory discriminator** — without `raw: true` or `raw: false` in the literal, TypeScript can't pick a branch. Forgetting the discriminator surfaces as: `Object literal may only specify known properties, and 'walletProvider' does not exist in type ...`.

### Usage in service methods

Every signed-execution method accepts `WalletProviderSlot<K, false>` (intersected into the action params type). Every raw-tx-building method accepts `WalletProviderSlot<K, true>` (sometimes both, via the `Raw extends boolean` generic).

```ts
// Signed:
sodax.swaps.createIntent({ params, raw: false, walletProvider });

// Raw:
sodax.swaps.createIntent({ params, raw: true });

// Compile errors:
sodax.swaps.createIntent({ params, walletProvider });          // missing 'raw'
sodax.swaps.createIntent({ params, raw: true, walletProvider }); // walletProvider forbidden when raw: true
sodax.swaps.createIntent({ params, raw: false });              // walletProvider required when raw: false
```

### When to pick which

- **`raw: false`** — your app holds the wallet (Node script with private key, browser dApp with extension). Default for most flows.
- **`raw: true`** — your app builds the tx but a different system signs it (gnosis safe, hardware wallet across an isolation boundary, custom multi-sig). The returned payload is chain-specific; submit it via your own signing infra.

### Read-only methods

Some read-only methods (`isAllowanceValid`, `getDeposit`) intersect with `WalletProviderSlot<K, Raw>` even though they don't actually consult the wallet provider. The underlying read doesn't need a wallet — but the method signature is unified with write methods. Use `{ params, raw: true }` for these; no wallet provider needed:

```ts
const result = await sodax.dex.assetService.isAllowanceValid({ params, raw: true });
```

---

## 7. `Result<T, SodaxError<C>>`

Every async public method returns this. There is no `throw` across a service boundary in v2.

### Shape

```ts
type Result<T, E = Error | unknown> =
  | { ok: true; value: T }
  | { ok: false; error: E };
```

Defined in `@sodax/types`, re-exported from `@sodax/sdk`.

### Branching

```ts
const result = await sodax.swaps.createIntent({ params, raw: false, walletProvider });
if (!result.ok) {
  // result.error: SodaxError<C> for the narrow code union of createIntent
  return;
}
const { tx, intent, relayData } = result.value;
```

### Sub-Result propagation

Inside SDK code (and useful for consumer wrappers):

```ts
async function myWorkflow(): Promise<Result<MyOutput, SodaxError<MyCodes>>> {
  const sub = await this.subOperation();
  if (!sub.ok) return sub;   // forward as-is; narrower code unions are structurally assignable

  // success path
  return { ok: true, value: /* … */ };
}
```

Narrower code unions (e.g. `'INTENT_CREATION_FAILED' | 'VALIDATION_FAILED'`) are structurally assignable to wider unions, so forwarding a sub-Result without re-wrapping typechecks.

### No helpers like `toResult` / `tryCatch`

There's no `safeCall` wrapper. Explicit `try/catch` at each public method boundary is the deliberate convention — see `packages/sdk/CLAUDE.md` (internal) for the full pattern. Consumer-side code does the same: branch on `result.ok` and let success and failure paths diverge cleanly.

### Pitfall

A `try { await sodax.<method>(...) } catch` block does **not** catch `Result` `{ ok: false }` — the SDK doesn't throw. The `catch` only fires for synchronous wrapper exceptions (e.g. missing `walletProvider`). Always branch on `result.ok`.

---

## 8. `SodaxError<C>` and the 13-code vocabulary

The canonical error class. Every SDK-emitted error is a `SodaxError<C>` parameterised by a code from a closed 13-element union.

### Shape

```ts
class SodaxError<C extends SodaxErrorCode = SodaxErrorCode> extends Error {
  readonly code: C;                 // closed 13-code reason union
  readonly feature: SodaxFeature;   // 'swap' | 'moneyMarket' | 'bridge' | 'staking' | 'migration' | 'dex' | 'partner' | 'recovery' | 'backend' | 'leverageYield'
  readonly cause?: unknown;
  readonly context?: SodaxErrorContext;

  toJSON(): SodaxErrorJSON<C>;      // canonical logger surface
}
```

### The 13 codes

The closed code vocabulary is the same 13 names across every feature — see [`reference/error-codes.md`](reference/error-codes.md) for the full table, per-code semantics, common `context` field shapes, per-feature narrow unions, and retry guidance.

### `(feature, code)` discrimination

The pair `(error.feature, error.code)` is the canonical discriminator. Use it for both logging tags and switch statements:

```ts
import { isSodaxError } from '@sodax/sdk';

if (!result.ok && isSodaxError(result.error)) {
  if (result.error.feature === 'moneyMarket' && result.error.code === 'INTENT_CREATION_FAILED') {
    /* show "couldn't build supply" */
  }
  if (result.error.code === 'RELAY_TIMEOUT') {
    /* retry */
  }
}
```

### Per-method narrow unions

Public methods declare narrow code unions via `Extract<SodaxErrorCode, ...>`:

```ts
type CreateSupplyIntentErrorCode = Extract<
  SodaxErrorCode,
  'USER_REJECTED' | 'VALIDATION_FAILED' | 'INTENT_CREATION_FAILED' | 'UNKNOWN'
>;
```

Switch exhaustively over the narrow union when you know which method emitted the error. The full per-method catalogue is in [`reference/`](reference/) § "Per-method error codes".

### Context fields

The `error.context` field carries per-error metadata. Reserved keys:

| Key | Type | Used by |
|---|---|---|
| `action` | string | Discriminates user-facing operation (e.g. `'supply'`, `'stake'`, `'migrateBaln'`). |
| `phase` | `SodaxPhase` | Orchestration phase (`'validate'`, `'intentCreation'`, `'verify'`, `'submit'`, `'relay'`, `'destinationExecution'`, `'execution'`, `'postExecution'`, `'approve'`, `'allowanceCheck'`, `'gasEstimation'`, `'lookup'`). |
| `srcChainKey`, `dstChainKey` | `ChainKey` strings | Chain-related errors. |
| `relayCode` | `'SUBMIT_TX_FAILED' \| 'RELAY_TIMEOUT' \| 'RELAY_POLLING_FAILED' \| 'UNKNOWN'` | Relay-layer errors (mirror of the lower-level relay code). |
| `api` | `'solver' \| 'backend'` | `EXTERNAL_API_ERROR` only. |
| `method` | string | `LOOKUP_FAILED` only. Names the failing read method. |
| `direction` | `'forward' \| 'reverse'` | Migration's `migratebnUSD` only. |
| `field`, `reason` | string | `VALIDATION_FAILED`. Names the precondition that tripped. |
| `[key: string]` | unknown | Open at the index signature for feature-specific metadata. |

### `toJSON()` and logger integration

`JSON.stringify(error)` calls `toJSON()` automatically. The serializer:

- Coerces `bigint` to string anywhere in `context`.
- Walks `cause` chains up to depth 3.
- Stringifies `Date`, `Map`, `Set`, `Error`, and class instances safely.
- Bounds depth at 5 to prevent cycles.

Consumer-side:

```ts
// Sentry
Sentry.captureException(err, {
  tags: { feature: err.feature, code: err.code, action: err.context?.action },
});

// Pino
logger.error({ err }, 'sodax operation failed');
```

### `isSodaxError` (preferred over `instanceof`)

```ts
import { isSodaxError, isFeatureError } from '@sodax/sdk';

if (isSodaxError(e)) {
  // e: SodaxError<SodaxErrorCode>
}

const isSwapError = isFeatureError('swap');
if (isSwapError(e)) {
  // e: SodaxError with feature: 'swap'
}
```

Use these in cross-bundle code (apps with mixed ESM/CJS resolution, monorepos with multiple package copies). `instanceof SodaxError` returns `false` when `@sodax/sdk` is loaded twice in the same bundle — `isSodaxError` walks structural shape and works regardless.

---

## 9. Relay layer: `relayTxAndWaitPacket` and `mapRelayFailure`

Cross-chain coordination is exposed as two top-level functions (re-exported from `@sodax/sdk`'s barrel):

- `submitTransaction(payload, apiUrl)` — TWO positional args: `payload: IntentRelayRequest<'submit'>` and `apiUrl: HttpUrl` (not an options object). POSTs the spoke transaction to the relay submit endpoint and resolves the relay's first-stage acknowledgement.
- `relayTxAndWaitPacket({ srcTxHash, data, chainKey, relayerApiEndpoint, timeout, pollTxHash? })` — `RelayAndWaitParams`: `data` is the whole `RelayExtraData` / `OnDemandRelayData` object and `chainKey` is the source `SpokeChainKey`. Runs `submitTransaction` and then polls until the destination packet reaches `executed`.

These functions are **not** exposed on the `Sodax` instance. Consumers don't call them directly — every feature service (`swaps.swap`, `bridge.bridge`, `staking.stake`, …) wraps the spoke→hub leg internally. If you genuinely need custom relay orchestration (rare), import `relayTxAndWaitPacket` / `submitTransaction` from `@sodax/sdk` and pass the same `relayerApiEndpoint` your `Sodax` instance uses.

### Relay-layer error contract

The relay layer keeps a stable string vocabulary of its own (separate from the 13 `SodaxErrorCode`s):

```ts
type RelayCode =
  | 'SUBMIT_TX_FAILED'      // POST to relay submit endpoint failed
  | 'RELAY_TIMEOUT'         // Poll loop exhausted timeout
  | 'RELAY_POLLING_FAILED'  // Relay endpoint outage / unrecognised response
  | 'UNKNOWN';              // Anything else
```

These codes appear on `error.context.relayCode` of the `SodaxError` that surfaces to consumers.

### `mapRelayFailure`

The single shared mapper from a relay-layer error to a `SodaxError`. Every feature service uses it internally — exported for custom orchestration:

```ts
import { mapRelayFailure, relayTxAndWaitPacket } from '@sodax/sdk';

try {
  await relayTxAndWaitPacket({ /* srcTxHash, data, chainKey, relayerApiEndpoint, timeout, pollTxHash? */ });
} catch (e) {
  const sodaxError = mapRelayFailure(e, {
    feature: 'swap',
    action: 'createIntent',
    srcChainKey,
    dstChainKey,
    // phase: 'destinationExecution',  // optional override; used by migration's bnUSD secondary watcher
  });
  return { ok: false, error: sodaxError };
}
```

Maps to one of: `'TX_SUBMIT_FAILED'`, `'RELAY_TIMEOUT'`, `'RELAY_FAILED'`, or `'EXECUTION_FAILED'`.

### When to use the relay layer directly

Almost never. The right abstraction is a feature service — `sodax.swaps.swap(...)`, `sodax.bridge.bridge(...)`, `sodax.staking.stake(...)` — which internally builds the spoke tx, calls `relayTxAndWaitPacket`, runs hub-side post-execution, and returns the unified `Result<TxHashPair>`.

You drop down to the relay layer only when:

- You're building custom orchestration not represented by a feature service.
- You're testing relay behavior (E2E test that intentionally drops the destination tx).
- You're writing a custom feature on top of the SDK primitives.

### Cross-references

- `RecoveryService` for pulling stuck hub-wallet assets back to a spoke chain: see [`features/recovery.md`](features/recovery.md).
- Per-feature error codes related to relay (e.g. `'TX_SUBMIT_FAILED'`, `'RELAY_TIMEOUT'`): [`reference/`](reference/) § "Error codes".

---

## Cross-references

- Quickstart (install + initialize): [`quickstart.md`](quickstart.md).
- Lookup tables (chain keys, error codes, public API surface): [`reference/`](reference/).
- Recipes (init, result handling, raw vs signed, narrowing, testing): [`recipes/`](recipes/).
- Per-feature usage: [`features/`](features/).
- Non-EVM chain quirks: [`chain-specifics.md`](chain-specifics.md).
- v1 → v2 porting context: [`README.md`](../../migration-v1-to-v2/knowledge/README.md).

### RWA classification and token logos

`XToken.isRwa === true` marks a registered tokenized stock, ETF or commodity,
including registered cross-chain representations. An omitted flag means no RWA
classification is declared; it is not a general-purpose crypto/stablecoin taxonomy.
Chain membership and symbol spelling do not determine RWA status.

Use `isRealWorldAsset({ chainKey, address })` to resolve metadata from the packaged
SDK registry when your token data comes from an API without the flag. It returns
false for unknown chains or addresses, ignores symbols, and compares EVM addresses
case-insensitively while preserving non-EVM identifier casing. It does not read
custom constructor config or validate swap/money-market support. New registry
metadata requires an SDK update; it does not automatically update backend payloads.

```typescript
import { ChainKeys, getSupportedSolverTokens, isRealWorldAsset, tokenLogo } from '@sodax/sdk';

const tokens = getSupportedSolverTokens(ChainKeys.ROBINHOOD_MAINNET);
const rwaTokens = tokens.filter(isRealWorldAsset);
const rows = tokens.map(token => ({
  symbol: token.symbol,
  isRwa: isRealWorldAsset(token),
  logo: tokenLogo(token.symbol),
}));
```

For API responses using `xChainId`, pass it as `chainKey` alongside the token's
on-chain `address`. Resolve each chain/address before grouping directory rows;
keep feature support and UI visibility filters separate from classification.

`tokenLogo(symbol)` serves shared PNGs from the SDK repository's `main` branch.
Robinhood equity/ETF entries use the Robinhood mark; xStocks retain their own
artwork. Image replacements become available after merge, subject to caching,
without an SDK release. Consumers must use these URLs to receive the replacements.
