# Configure SDK

Learn how to configure the SODAX SDK for your application. The SDK supports Swaps (intent-based solver swaps), Money Market (cross-chain lending and borrowing), and many other cross-chain DeFi services. All feature configurations are optional—you can use just the features you need.

`new Sodax(...)` accepts [`SodaxOptions`](https://github.com/icon-project/sodax-sdks/blob/main/packages/types/src/sodax-config/sodax-config.ts) — a deep-partial override of the static [`SodaxDefaultConfig`](https://github.com/icon-project/sodax-sdks/blob/main/packages/types/src/sodax-config/sodax-config.ts) data shape plus client-side options (`logger`, global `fee`, and per-feature `partnerFee` options). The merged result is [`SodaxConfig`](https://github.com/icon-project/sodax-sdks/blob/main/packages/types/src/sodax-config/sodax-config.ts) (exposed as `sodax.instanceConfig`). All three live in `@sodax/types` and are re-exported from `@sodax/sdk`.

## Basic Configuration

### Default Configuration

Initialize the SDK with default Sonic mainnet configurations (no fees):

```typescript
import { Sodax } from '@sodax/sdk';

const sodax = new Sodax();
```

The constructor signature is `new Sodax(config?: SodaxOptions)`, where `SodaxOptions = DeepPartial<SodaxDefaultConfig> & SodaxOptionalConfig` — a deep-partial override of the `SodaxDefaultConfig` data contract plus the client-side options: the `logger` sink (see [LOGGING.md](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/LOGGING.md)), the opt-in `analytics` tracker (see [Analytics](#analytics)), the global partner `fee`, per-feature options on `swaps` / `bridge` / `moneyMarket` / `leverageYield` (including `partnerFee` and `useBackendSubmitTx` — see [Backend submit-tx 2-step](#backend-submit-tx-2-step-swapsusebackendsubmittx)), and `radfi` (see [RadFi/Bound request signer](#radfibound-request-signer-radfisignrequest)). The `logger`, `analytics`, global `fee`, and `radfi` are kept off the data contract: they are resolved once and never fetched from or overwritten by the backend config. `useBackendSubmitTx` lives on the feature option slots (`swaps` / `bridge` / `leverageYield`) alongside `partnerFee`; the effective value is resolved on `ConfigService` — `sodax.config.swapUseBackendSubmitTx` / `sodax.config.bridgeUseBackendSubmitTx` / `sodax.config.leverageYieldUseBackendSubmitTx` (all default `true`). When called with no arguments the SDK merges your overrides with the packaged static defaults ([`sodaxConfig`](https://github.com/icon-project/sodax-sdks/blob/main/packages/types/src/sodax-config/sodax-config.ts)) using a recursive `deepMerge`. Omitted keys keep their default values.

### Dynamic Configuration

Read effective configuration from `sodax.config`, which includes packaged defaults and constructor overrides. `initialize()` is available for the initialization lifecycle:

```typescript
const initResult = await sodax.initialize();
if (!initResult.ok) {
  console.error('Initialization failed:', initResult.error);
}
```

`initialize()` returns `Promise<Result<void>>`. The current implementation returns success without fetching backend configuration; it preserves the constructor-merged configuration. Do not use it as a token-support refresh. A direct import of `spokeChainConfig` is only the packaged snapshot and does not include your overrides.

## SodaxConfig overview

Top-level keys of the consolidated `SodaxConfig` — the `SodaxDefaultConfig` data contract plus the per-feature client-side options merged over it. The feature rows are typed `SwapsConfig` / `BridgeConfig` / … (`<Feature>DefaultConfig & <Feature>Options`), so `partnerFee` and `useBackendSubmitTx` appear there even though neither is part of `SodaxDefaultConfig` and neither is ever fetched from the backend:

| Key | Type (summary) | Role |
|-----|----------------|------|
| `chains` | `Record<SpokeChainKey, SpokeChainConfig>` | Per-spoke chain addresses, tokens, RPC settings, polling. |
| `swaps` | `SwapsConfig` | Per-chain solver-supported token lists, plus optional per-feature `partnerFee` and `useBackendSubmitTx` (default ON). |
| `moneyMarket` | `MoneyMarketConfig` | Lending pool addresses, reserve assets, supported tokens, plus an optional per-feature `partnerFee`. |
| `bridge` | `BridgeConfig` | Optional bridge per-feature `partnerFee` and `useBackendSubmitTx` (default ON). |
| `dex` | `DexConfig` | Concentrated liquidity contract set and pool keys (Sonic hub). |
| `leverageYield` | `LeverageYieldConfig` | Registry of leverage-yield ERC-4626 vaults on the hub, plus optional per-feature `partnerFee` and `useBackendSubmitTx` (default ON). |
| `hub` | `HubConfig` | Hub chain (Sonic) metadata, contract addresses, and `rpcUrl` used by `EvmHubProvider`. |
| `api` | `ApiConfig` | Backend API config — flat `BackendApiConfig` (`{ baseURL, basePath?, timeout, headers }`, shared by `sodax.api.swaps`) or `CustomApiConfig` to point swaps at its own endpoint. |
| `solver` | `SolverConfig` | Intents contract addresses and solver HTTP API endpoint. |
| `relay` | `RelayConfig` | Relayer HTTP endpoint and spoke-to-intent relay chain ID map. |

The global partner `fee` is **not** a data key — it is a `SodaxOptions` client-side option (like `logger`). Set it via `new Sodax({ fee })` and read the resolved value back on `sodax.config.fee`. It is the default applied to any feature whose own `partnerFee` is unset (see [Partner Fees](#partner-fees)).

### Partner Fees

Set a global `fee` once, override it per feature, or both. The effective fee for a feature is `featureFee ?? fee` — a feature's own `partnerFee` wins, otherwise the global `fee` applies. Services read the resolved value through `ConfigService` getters: `SwapService` reads `config.swapPartnerFee`, `MoneyMarketService` reads `config.moneyMarketPartnerFee`, `BridgeService` reads `config.bridgePartnerFee`, and `LeverageYieldService` reads `config.leverageYieldPartnerFee`. See [Monetize SDK](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/MONETIZE_SDK.md) for usage details and per-request overrides.

```typescript
import { Sodax, PartnerFee } from '@sodax/sdk';

const partnerFee: PartnerFee = {
  address: '0x0000000000000000000000000000000000000000',
  percentage: 100, // basis points: 100 = 1%, 10_000 = 100%
};

// Global fee applied to every feature that has no per-feature override
const sodaxWithGlobalFee = new Sodax({ fee: partnerFee });
```

```typescript
import { Sodax, PartnerFee } from '@sodax/sdk';

const partnerFee: PartnerFee = {
  address: '0x0000000000000000000000000000000000000000', // fee recipient (hub / EVM address)
  percentage: 100, // basis points: 100 = 1%, 10_000 = 100%
};

// Fee on swaps only
const sodaxWithSwapFees = new Sodax({
  swaps: { partnerFee },
});

// Fee on money market only
const sodaxWithMoneyMarketFees = new Sodax({
  moneyMarket: { partnerFee },
});

// Fee on bridge only
const sodaxWithBridgeFees = new Sodax({
  bridge: { partnerFee },
});

// Fees on multiple features
const sodaxWithFees = new Sodax({
  swaps: { partnerFee },
  moneyMarket: { partnerFee },
  bridge: { partnerFee },
});
```

### Partner fee shapes

Partner fees are either percentage-based or amount-based (`PartnerFee` is a discriminated union—use one shape per fee object).

```typescript
import { PartnerFee } from '@sodax/sdk';

const partnerFeePercentage: PartnerFee = {
  address: '0x0000000000000000000000000000000000000000',
  percentage: 100, // basis points: 100 = 1%, 10_000 = 100%
};

const partnerFeeAmount: PartnerFee = {
  address: '0x0000000000000000000000000000000000000000',
  amount: 1000n, // fixed amount in token base units (decimals of the token being charged)
};
```

### API key

The backend guards its API-keyed routes (starting with the Swaps API, `POST /swaps/*`) with an `x-api-key` header check; keys are minted through the partner portal. There is **one** key for every backend request — set it once at construction and the SDK sends it as `x-api-key` on the data API, the swaps API, the bridge API, the solver API, and the backend submit-tx legs of `sodax.swaps.swap()` / `sodax.bridge.bridge()`:

```typescript
// Server-side only — a key in a browser bundle is public
import { Sodax } from '@sodax/sdk';

const sodax = new Sodax({ apiKey: process.env.SODAX_API_KEY });
```

Per request, pass `apiKey` in the trailing `RequestOverrideConfig` of any `sodax.api.*` method, or in `extras` on the high-level swap / bridge actions:

```typescript
// Server-side only, like the instance-wide key
await sodax.api.getIntentByTxHash(txHash, { apiKey: 'per-request-key' });

await sodax.api.swaps.getQuote(quoteBody, undefined, { apiKey: 'per-request-key' });

await sodax.swaps.swap({
  params: createIntentParams,
  extras: { apiKey: 'per-request-key' }, // applies to the backend submit-tx leg
  walletProvider,
});

await sodax.bridge.bridge({
  params: createBridgeIntentParams,
  raw: false,
  extras: { apiKey: 'per-request-key' }, // applies to the backend submit-tx leg
  walletProvider,
});
```

Precedence, highest first: per-request explicit `headers['x-api-key']` (any casing) → per-request `apiKey` → configured explicit `x-api-key` header (`api.headers` / `setHeaders`) → the configured `apiKey`. That full order is what the `sodax.api.*` transports resolve — tiers 1 and 3 exist only there, so the solver (below) carries the configured `apiKey` alone. An empty `apiKey` counts as unset and falls back; an explicit raw `x-api-key` header is authoritative and sent verbatim, a blank one included. The configured value is readable on `sodax.config.apiKey`.

Sponsoring is the one exception. Its own slice key (`api.sponsoringApiConfig.apiKey`) is the credential for that service and wins wherever the slice points. The global key is only *inherited* by sponsoring when the call actually targets a SODAX gateway — the packaged sponsoring default or the resolved shared root — and that check is made per request against the effective target, so a per-call `baseURL` override cannot carry the global key off-gateway. A custom sponsoring origin never receives it.

The solver API (`solver.solverApiEndpoint`, `https://api.sodax.com/v1/intent` by default) receives the configured key on `/quote`, `/execute`, and `/status`. It is the configured-`apiKey` tier only — those requests have no per-call override surface and no configured-header slot, so tiers 1–3 never apply to them. Solver auth failures surface through the solver's own `SolverErrorResponse` contract rather than as an `EXTERNAL_API_ERROR`, so `isAuthFailure` does not recognize them.

Rotating a key at runtime with `backendApi.setHeaders({ 'x-api-key': next })` reaches the data, swaps, and bridge clients only: sponsoring keeps its slice or inherited key (rotate it through `sodax.api.sponsoring.setHeaders`), and the solver keeps reading the configured `ConfigService.apiKey`.

**Security note.** The configured key follows the roots you configure — the data / swaps / bridge `baseURL` and `solver.solverApiEndpoint` — and it equally follows a per-call `RequestOverrideConfig.baseURL` on data / swaps / bridge, plaintext local targets such as `http://localhost:3008` included: those three bake the key into their headers, so retargeting a single call carries it to that host. Sponsoring is the one gated exception described above. Point all of them — configured root and per-call override alike — only at trusted SODAX-related deployments.

Like the global `fee`, the global `apiKey` is a `SodaxOptions` client-side option, never part of the backend-fetched data contract. Keys bundled into a browser app are public by nature — to keep one server-side while the SDK runs in a browser, point `api.baseURL` and `solver.solverApiEndpoint` at your own proxy, as shown in [API key good practices](https://docs.sodax.com/developers/how-to/api-key-good-practices). Auth failures come back as `EXTERNAL_API_ERROR` results with `context.status` `401` (missing/invalid key) or `403` (suspended organisation / missing scope) — terminal until the key is fixed — while the transient verification `503` is retried automatically by the wire client.
## Analytics

The SDK can emit **structured, opt-in user-action events** to a tracker you supply. This is separate from `logger`: `logger` is developer-facing free-form diagnostics that is **on by default** (`console`), whereas `analytics` is a product-facing event stream that is **off by default** — the SDK emits nothing (and never even builds an event payload) unless you enable it.

`analytics` is a `SodaxOptions` client-side option (like `logger` and `fee`): it is resolved once at construction and never fetched from or overwritten by the backend config. Enable it by passing an `AnalyticsConfig`; omit it (or pass `false`) to stay disabled.

```typescript
import { Sodax } from '@sodax/sdk';

const sodax = new Sodax({
  analytics: {
    // Required: called once per emitted event; forward it to your analytics backend.
    tracker: (event) => amplitude.track(event.action, event.data),
    // Optional: highest detail level to emit. Defaults to 'basic'; 'detailed' adds richer `data` payloads.
    level: 'detailed',
    // Optional allowlist of features/actions to track. Omit to track everything.
    features: {
      swap: true,                                     // all swap actions
      moneyMarket: { actions: ['supply', 'borrow'] }, // only these actions
      // a feature omitted from the object is OFF
    }, // or the array shorthand: features: ['swap', 'moneyMarket']
  },
});
```

Each event carries `feature` + `action` + `phase` (`'start' | 'success' | 'failure'`) + `level` + an optional `data` payload — the same `(feature, action)` taxonomy the error layer uses, so events line up with `SodaxError`s downstream. The `tracker` is treated as fire-and-forget: it is not awaited, and any **synchronous** exception it throws is swallowed, so a throwing tracker cannot break a feature flow. The `AnalyticsTracker` contract requires the tracker to be cheap and non-throwing — if your adapter is `async`, handle rejections inside it, because the SDK does not observe the returned promise. Types (`AnalyticsConfig`, `AnalyticsTracker`, `AnalyticsEvent`, `AnalyticsFeatures`, `AnalyticsOption`) live in [`@sodax/types`](https://github.com/icon-project/sodax-sdks/blob/main/packages/types/src/shared/analytics.ts).

## Custom configuration

### Solver (`solver`)

Intent-based swaps use the top-level **`solver`** block (not nested under `swaps`). Defaults match [`solverConfig`](https://github.com/icon-project/sodax-sdks/blob/main/packages/types/src/common/constants.ts) in `@sodax/types`.

```typescript
import { Sodax, getSolverConfig, type SolverConfig } from '@sodax/sdk';

// Packaged defaults: omit `solver` on `new Sodax()`, or pass `getSolverConfig()` explicitly (same object as `solverConfig`)
new Sodax({ solver: getSolverConfig() });

const customSolver: SolverConfig = {
  intentsContract: '0x6382D6ccD780758C5e8A6123c33ee8F4472F96ef',
  solverApiEndpoint: 'https://api.sodax.com/v1/intent',
  protocolIntentsContract: '0xaFf2EDb3057ed6f9C1dA6c930b8ddDf2beE573A5',
};

const sodax = new Sodax({ solver: customSolver });
```

`getSolverConfig()` takes no parameters and returns the same object as the exported `solverConfig` constant from `@sodax/sdk`.

Partner fees for swaps belong in **`swaps.partnerFee`**, not inside `solver`.

### Swaps token lists (`swaps.supportedTokens`)

`SwapsConfig` includes `supportedTokens: Record<SpokeChainKey, readonly XToken[]>`. Normally you rely on the packaged lists. If you override them, remember that **`deepMerge` replaces arrays wholesale**—provide the full list for any chain you touch, or omit `supportedTokens` to keep defaults.

### Backend submit-tx 2-step (`swaps.useBackendSubmitTx`)

`useBackendSubmitTx` on `swaps` is a **client-side runtime option** on `SodaxOptions` (same slot as `swaps.partnerFee`) — it is NOT part of the backend-fetched `SodaxDefaultConfig`. Default `true`: after `createIntent` broadcasts the intent tx on the source chain, `sodax.swaps.swap()` hands the tx hash to the backend swaps API (`sodax.api.swaps.submitTx`), which relays and post-executes server-side; the SDK polls submit-tx status and returns the same `SwapResponse`. The SDK does **not** verify the tx on-chain first — the backend runs its own verification, so `verifyTxHash` would only delay every backend success. It runs on the client-side path only. Set `false` to force the fully client-side relay path.

```typescript
// Default — backend submit-tx ON
const sodax = new Sodax();

// Opt out
const sodaxClientSide = new Sodax({ swaps: { useBackendSubmitTx: false } });
```

The earlier `swapsOptions` / `bridgeOptions` keys (`SwapsClientOptions` / `BridgeClientOptions`) are **deprecated but still honoured** in v2, so an existing explicit opt-out keeps working; they apply only when the matching `swaps` / `bridge` flag is omitted. **v3 removes them**: from v3 the flag lives only in the feature slot, next to `partnerFee`. Move now:

```diff
- new Sodax({ swaps: { partnerFee }, swapsOptions: { useBackendSubmitTx: false } });
+ new Sodax({ swaps: { partnerFee, useBackendSubmitTx: false } });

- new Sodax({ bridge: { partnerFee }, bridgeOptions: { useBackendSubmitTx: false } });
+ new Sodax({ bridge: { partnerFee, useBackendSubmitTx: false } });
```

Read the effective value back from `sodax.config.swapUseBackendSubmitTx` (or `sodax.swaps.useBackendSubmitTx`), never from the raw `swaps` slot, which stays `undefined` when the flag is omitted. A `SwapService` constructed directly (rather than through `new Sodax`) still accepts the deprecated `useBackendSubmitTx` constructor field in v2, which wins over the configured value; v3 removes it too.

If the backend path does not reach `solved` for **any** reason (submission rejected, terminal `failed`/abandoned status, or poll timeout), `swap()` automatically falls back to the fully client-side relay + post-execution so the swap still completes — **safely**, because re-relaying / re-posting an already-processed swap is idempotent (no double-fill; verified by `e2e-tests/e2e-relay.test.ts`). `timeout` is a **per-attempt** budget: the backend attempt gets it, and the fallback relay then gets a fresh one that starts after on-chain verification, so neither a stalled backend nor a slow source-chain confirmation shortens the client-side wait, and raising `timeout` grows both. It does not bound intent creation, verification (the source chain's `pollingConfig.maxTimeoutMs`) or post-execution. See [SWAPS.md](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/SWAPS.md#backend-2-step-submit) for the flow and [How `timeout` bounds each attempt](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/SWAPS.md#how-timeout-bounds-each-attempt) for the full breakdown.

### Backend submit-tx (`bridge.useBackendSubmitTx`)

`useBackendSubmitTx` on `bridge` is the bridge counterpart — same slot as `bridge.partnerFee`, resolved live via `config.bridgeUseBackendSubmitTx`. Default `true`: `sodax.bridge.bridge()` routes the spoke-deposit through the backend bridge API (`sodax.api.bridge.submitTx`), which relays server-side; the SDK polls submit-tx status and returns the same `TxHashPair`. Set `false` to force the client-side `relayTxAndWaitPacket` path.

```typescript
// Default — backend submit-tx ON
const sodax = new Sodax();

// Opt out
const sodaxClientSide = new Sodax({ bridge: { useBackendSubmitTx: false } });
```

On any non-success (submission rejected, terminal `failed`/abandoned, or poll timeout) `bridge()` falls back to the client-side `relayTxAndWaitPacket` flow so the bridge still completes — safe because re-relaying an already-relayed bridge tx is idempotent. `timeout` is per-attempt on the [same terms as swaps](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/SWAPS.md#how-timeout-bounds-each-attempt): the backend attempt gets it and the fallback relay gets a fresh one. Bridge has no solver post-execution, so unlike swaps there is no `'posting_execution'` step. See [BRIDGE_API.md](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/BRIDGE_API.md) for the API client.

### Backend submit-tx (`leverageYield.useBackendSubmitTx`)

`useBackendSubmitTx` on `leverageYield` is the leverage-yield counterpart — same slot as `leverageYield.partnerFee`, resolved live via `config.leverageYieldUseBackendSubmitTx`. Default `true`, like the other two: `sodax.leverageYield.vaultSwap()` (so `deposit` / `withdraw` too) routes the broadcast intent through the Leverage Yield API (`sodax.api.leverageYield.submitTx`, carrying the required `operation: 'deposit' | 'withdraw'`), which relays and post-executes server-side; the SDK polls submit-tx status until `solved` and returns the same `VaultSwapResponse`. Set `false` to force the fully client-side relay path. Unlike `swaps` / `bridge` there is no deprecated `leverageYieldOptions` key — leverage yield arrived after those were already deprecated.

```typescript
// Backend submit-tx is the default
const sodax = new Sodax();

// Opt out — fully client-side relay + notify-solver
const sodaxClientSide = new Sodax({ leverageYield: { useBackendSubmitTx: false } });
```

`POST /leverage-yield/submit-tx` declares an API-key scope (`swaps:write`) where `GET /leverage-yield/submit-tx/status` declares none. Key enforcement is a per-deployment setting, so whether a keyless submit is actually rejected depends on the deployment you point at; where it is enforced, a keyless caller spends one rejected attempt per vault swap before the client-side fallback completes it. Configure `apiKey`, pass `extras.apiKey` per call, or set `useBackendSubmitTx: false` to skip the attempt. `swaps.useBackendSubmitTx` declares the same scope and has defaulted on since it shipped, so this is not specific to leverage yield.

On any non-success (submission rejected, a 200 the backend did not accept, terminal `failed`/abandoned, a rejected API key, or poll timeout) `vaultSwap()` falls back to the client-side verify → relay → notify-solver flow so the vault swap still completes — safe because re-relaying / re-posting an already-processed vault swap is idempotent. `timeout` is per-attempt on the [same terms as swaps](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/SWAPS.md#how-timeout-bounds-each-attempt): the backend attempt gets it and the fallback relay gets a fresh one. A vault swap IS a solver swap, so unlike bridge the terminal status is `'solved'` and the `'posting_execution'` step applies. See [LEVERAGE_YIELD.md](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/LEVERAGE_YIELD.md#completion-paths-and-timeout) for the flow and [LEVERAGE_YIELD_API.md](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/LEVERAGE_YIELD_API.md) for the API client.

### RadFi/Bound request signer (`radfi.signRequest`)

`radfi` is a **client-side runtime option** on `SodaxOptions` (like `logger`) — never part of the backend-fetched `SodaxConfig`. The SDK calls `signRequest` once per outbound Bound Exchange (RadFi) request on **any** routed host — `svc.bound.exchange`, `auth.bound.exchange` or `api.radfi.co` — and merges the returned headers onto it, so a server-to-server caller can attach Bound's `x-api-signature` HMAC header without the SDK ever holding the credential. The context carries `baseUrl`, so a signer that must scope its credential per origin can branch on it. UMS calls (`/wallets/balance`, `/utxos`) bypass this and are never signed.

```typescript
import { createHmac } from 'node:crypto';

const sodax = new Sodax({
  radfi: {
    signRequest: () => {
      const ts = `${Date.now()}`;
      const signature = createHmac('sha256', secretKey).update(`${secretWord}_${ts}`).digest('hex');
      return { 'x-api-signature': `${signature}_${ts}` };
    },
  },
});
```

**Server-side only** — the closure holds a service credential, so never ship one in a browser bundle. Omit `radfi` and requests go out exactly as before.

The signer receives `{ method, path, baseUrl }` — `baseUrl` is the resolved Bound host for that call, so a signer that must scope its credential per origin can branch on it. It may be async, and is invoked per request (Bound's signature embeds a timestamp valid for 60 s, so a cached one would replay). Its headers are merged **last**, so it must not return `Authorization`: that carries the per-user Bound access token, which is separate and passed per call via `extras.bound.accessToken`.

### Money market (`moneyMarket`)

`MoneyMarketConfig` includes `lendingPool`, `uiPoolDataProvider`, `poolAddressesProvider`, `bnUSD`, `bnUSDVault`, `bnUSDAToken`, `supportedTokens`, `supportedReserveAssets`, and `partnerFee`. The packaged default is [`moneyMarketConfig`](https://github.com/icon-project/sodax-sdks/blob/main/packages/types/src/moneyMarket/moneyMarket.ts).

```typescript
import { Sodax, moneyMarketConfig, type MoneyMarketConfig } from '@sodax/sdk';

// Start from defaults and override specific fields
const sodax = new Sodax({
  moneyMarket: {
    ...moneyMarketConfig,
    lendingPool: '0x553434896D39F867761859D0FE7189d2Af70514E',
    partnerFee: {
      address: '0x0000000000000000000000000000000000000000',
      percentage: 50,
    },
  } satisfies MoneyMarketConfig,
});
```

### Hub (`hub`)

The hub is a single **`HubConfig`**: chain metadata, hub contract addresses, and **`rpcUrl`** used when creating the hub JSON-RPC client. Override RPC or addresses with a partial under `hub`:

```typescript
import { Sodax } from '@sodax/sdk';

const sodax = new Sodax({
  hub: {
    rpcUrl: 'https://rpc.soniclabs.com',
  },
});
```

After construction, the merged hub is **`sodax.instanceConfig.hub`** (and `sodax.hubProvider.chainConfig`). **`sodax.config.getHubChainConfig()`** returns the static packaged hub snapshot, not the merged instance config—if you customize `hub`, treat `instanceConfig.hub` as the source of truth for your overrides.

### Per-chain RPC and endpoints (`chains`)

There is no separate `sharedConfig`. Spoke RPC URLs and chain-specific settings live on each entry in **`chains[SpokeChainKey]`**. Partial objects are merged into the defaults for that key:

```typescript
import { Sodax, ChainKeys } from '@sodax/sdk';

const sodax = new Sodax({
  chains: {
    [ChainKeys.STELLAR_MAINNET]: {
      horizonRpcUrl: 'https://horizon.stellar.org',
      sorobanRpcUrl: 'https://rpc.ankr.com/stellar_soroban',
    },
  },
});
```

EVM spokes use `rpcUrl` on their spoke config; Stellar uses `horizonRpcUrl` and `sorobanRpcUrl`; Sui uses `grpc_url` because it speaks gRPC-web rather than JSON-RPC (`rpc_url` is still accepted as a deprecated alias and wins when set — the packaged default always supplies `grpc_url`, so precedence rather than an either/or guard is what keeps overrides working — but the endpoint must serve gRPC; the packaged default is Sui's public fullnode, which is rate-limited per IP, so override it for server-side traffic); Bitcoin includes `radfi` and related fields—mirror the shape of the default `SpokeChainConfig` for the chain you change.

### Backend API (`api`)

[`ApiConfig`](https://github.com/icon-project/sodax-sdks/blob/main/packages/types/src/common/constants.ts) controls `baseURL`, `timeout`, and `headers` for `BackendApiService` (the configuration service currently does not fetch through `initialize()`). It is either a flat `BackendApiConfig` (shown below — shared by `sodax.backendApi`, the swaps client `sodax.api.swaps`, and the bridge client `sodax.api.bridge`) or a nested `CustomApiConfig` (`{ baseApiConfig?, swapsApiConfig?, sponsoringApiConfig? }`) to point an individual client at its own endpoint.

#### How a request URL is composed

```
request URL  =  baseURL  +  service path  +  route
                └─ gateway root: origin plus the deployment's version prefix
                            └─ owned by the service — never put it in baseURL
```

`baseURL` is the **gateway root**. Every service appends its own path below it — and the base API, swaps
and bridge all resolve the same root, so one value moves all three. Sponsoring is the exception: it
defaults to the same root but reaches it independently, so retargeting `baseURL` does **not** move it (see
the slice table below).

| Service | Path | Default URL for one route |
|---|---|---|
| `sodax.backendApi` | `/be` (`basePath`, overridable) | `https://api.sodax.com/v1/be/config/all` |
| `sodax.api.swaps` | `/swaps` | `https://api.sodax.com/v1/swaps/submit-tx` |
| `sodax.api.bridge` | `/bridge` | `https://api.sodax.com/v1/bridge/submit-tx` |
| `sodax.api.sponsoring` | `/sponsorships/stellar` | `https://api.sodax.com/v1/sponsorships/stellar/config` |

The version prefix is **deployment-owned**, which is why it lives in `baseURL` rather than in the SDK's
service paths: that is what lets a locally-run service be reached by swapping the host alone
(`http://localhost:3008` mounts `/swaps/*` at its bare origin, with no version prefix at all). The
corollary is that `https://api.sodax.com` on its own is an incomplete base URL — it resolves every service
one segment short (`/be/config/all`, `/swaps/tokens`) and 404s. Only the data API has a `basePath` to
compensate, so the SDK warns at construction, naming each service whose resolved root on the packaged host
omits the prefix — including one reached through a `swapsApiConfig` or `sponsoringApiConfig` slice.

So a `baseURL` must never end in a service segment. If it ends in `/be`, the SDK trims it and logs a warning — the previous packaged default was `https://api.sodax.com/v1/be`, which nested the sibling services one level too deep (`/v1/be/swaps/submit-tx`).

```typescript
import { Sodax } from '@sodax/sdk';

const sodax = new Sodax({
  api: {
    baseURL: 'https://api.sodax.com/v1',
    timeout: 30_000,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  },
});
```

Only the backend data API's path is deployment-owned, so only it is configurable. Set `basePath: ''` for a service addressed directly at its origin rather than through the gateway:

```typescript
const sodax = new Sodax({
  api: { baseApiConfig: { baseURL: 'http://localhost:4000', basePath: '' } },
});
// → http://localhost:4000/config/all
```

**Which slice moves which client.** The flat fields layer underneath every per-service slice, so a top-level `baseURL` moves all of them at once:

| Client | Resolved from | Notes |
|---|---|---|
| `sodax.backendApi` | flat fields → `baseApiConfig` | The only client that reads `basePath`. |
| `sodax.api.swaps` | flat fields → `baseApiConfig` → `swapsApiConfig` | Only client a `swapsApiConfig` slice affects. Never inherits `basePath`. |
| `sodax.api.bridge` | flat fields → `baseApiConfig` | Reached as `/bridge/*` on the shared root. Defaults to the same host as swaps, but a `swapsApiConfig` slice does **not** move it — there is no `bridgeApiConfig` slice. Never inherits `basePath`. |
| `sodax.api.sponsoring` | `sponsoringApiConfig` (own origin; only `timeout` inherits) | Base URL and headers never inherit, so base credentials can't leak to another origin — and pointing the base API at a private proxy never drags sponsoring along. |

Every client method also takes a per-call `RequestOverrideConfig` (`{ baseURL?, timeout?, headers?, apiKey? }`) as its last argument, which wins over the resolved config — useful for pointing one call at a canary host without touching app-wide config. A `baseURL` override replaces the gateway root; the calling service's own path still applies, and a legacy `/be` suffix is trimmed from it just as it is from a configured base URL. Note that a `timeout` override **replaces** the resolved value rather than capping it.

### Relayer (`relay`)

[`RelayConfig`](https://github.com/icon-project/sodax-sdks/blob/main/packages/types/src/common/constants.ts) sets `relayerApiEndpoint` and **`relayChainIdMap`** (mapping each `SpokeChainKey` to the hub intent-relay bigint ID). Override only when pointing at a different relayer or custom map.

### DEX (`dex`)

[`DexConfig`](https://github.com/icon-project/sodax-sdks/blob/main/packages/types/src/dex/dex.ts) holds concentrated-liquidity addresses and pool keys for Sonic. Most integrations keep the packaged [`dexConfig`](https://github.com/icon-project/sodax-sdks/blob/main/packages/types/src/dex/dex.ts) default.

### Complete custom configuration

Combine the pieces that matter for your deployment:

```typescript
import {
  Sodax,
  ChainKeys,
  getSolverConfig,
  moneyMarketConfig,
  type PartnerFee,
} from '@sodax/sdk';

const partnerFee = {
  address: '0x0000000000000000000000000000000000000000',
  percentage: 10,
} satisfies PartnerFee;

const sodax = new Sodax({
  solver: getSolverConfig(),
  swaps: { partnerFee },
  moneyMarket: { ...moneyMarketConfig, partnerFee },
  bridge: { partnerFee },
  hub: { rpcUrl: 'https://rpc.soniclabs.com' },
  chains: {
    [ChainKeys.STELLAR_MAINNET]: {
      horizonRpcUrl: 'https://horizon.stellar.org',
      sorobanRpcUrl: 'https://rpc.ankr.com/stellar_soroban',
    },
  },
});

const initResult = await sodax.initialize();
if (!initResult.ok) {
  console.error('Initialization failed:', initResult.error);
}
```

## Service Properties

After construction, the `Sodax` instance exposes the following read-only service properties:

| Property | Type | Description |
|----------|------|-------------|
| `sodax.swaps` | `SwapService` | Intent-based swaps via solver |
| `sodax.moneyMarket` | `MoneyMarketService` | Cross-chain lending and borrowing |
| `sodax.bridge` | `BridgeService` | Cross-chain token transfers |
| `sodax.staking` | `StakingService` | SODA token staking operations |
| `sodax.dex` | `DexService` | Concentrated liquidity / AMM |
| `sodax.leverageYield` | `LeverageYieldService` | Leveraged-yield ERC-4626 vault deposits / withdrawals on the Sonic hub |
| `sodax.migration` | `MigrationService` | ICX / bnUSD / BALN token migration |
| `sodax.partners` | `PartnerService` | Partner fee claiming and operations |
| `sodax.recovery` | `RecoveryService` | Withdraw stuck hub-wallet assets to a spoke chain |
| `sodax.backendApi` | `BackendApiService` | Raw backend API access |
| `sodax.config` | `ConfigService` | Chain/token config and lookup helpers |
| `sodax.hubProvider` | `HubProvider` | Hub chain (Sonic) contract interactions |
| `sodax.spoke` | `SpokeService` | Spoke chain routing facade |
| `sodax.instanceConfig` | `SodaxConfig` | Resolved config after merging with defaults |

## Chain Keys

All chain constants live under `ChainKeys.*` — import them from `@sodax/sdk`:

```typescript
import { ChainKeys } from '@sodax/sdk';

ChainKeys.SONIC_MAINNET;
ChainKeys.ETHEREUM_MAINNET;
ChainKeys.ARBITRUM_MAINNET;
ChainKeys.SOLANA_MAINNET;
// … and so on for all supported chains
```

The full set of chain constants is defined by [`ChainKeys`](https://github.com/icon-project/sodax-sdks/blob/main/packages/types/src/chains/chain-keys.ts) in `@sodax/types` — treat it as the source of truth rather than any fixed count here. `SpokeChainKey` is the union type of all `ChainKeys` values. Use it to type any parameter that accepts a chain identifier.

## Additional Resources

- [Monetize SDK](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/MONETIZE_SDK.md) - Detailed fee configuration guide
- [Architecture Reference](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/ARCHITECTURE_REFACTOR_SUMMARY.md) - Spoke services, raw tx handling, `Result<T>`, error conventions
