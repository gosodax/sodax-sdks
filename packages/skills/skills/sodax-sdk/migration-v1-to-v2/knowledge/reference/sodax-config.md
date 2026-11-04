# `SodaxConfig` constructor reshape

The v2 `Sodax` constructor accepts a `SodaxOptions` (`DeepPartial<SodaxDefaultConfig> & SodaxOptionalConfig`). Several config fields renamed, moved, or were added between v1 and v2; if your project passed a custom config, check these.

## v2 config data shape (`SodaxDefaultConfig`, source of truth)

Defined in `@sodax/types` (`packages/types/src/sodax-config/sodax-config.ts`). This is the static data contract the backend serves and the packaged defaults are built from; `SodaxConfig` is the merged result (`SodaxDefaultConfig & SodaxOptionalConfig`):

```ts
type SodaxDefaultConfig = {
  chains: Record<SpokeChainKey, SpokeChainConfig>;   // per-spoke-chain config (rpcUrl + tx polling + chain-specific shape)
  swaps: SwapsDefaultConfig;                         // supported swap tokens per chain (+ per-feature partnerFee override)
  moneyMarket: MoneyMarketDefaultConfig;             // money market service config (+ per-feature partnerFee override)
  bridge: BridgeDefaultConfig;                       // bridge partner-fee override
  dex: DexDefaultConfig;                             // DEX service config
  leverageYield: LeverageYieldDefaultConfig;         // leverage-yield ERC-4626 vault registry (+ per-feature partnerFee override)
  hub: HubConfig;                                    // hub-chain (Sonic) provider config
  api: ApiConfig;                                    // backend API endpoint
  solver: SolverConfig;                              // intent solver endpoint + contracts
  relay: RelayConfig;                                // intent-relay endpoint
};
```

A matching default `sodaxConfig` const is exported from the same module — `new Sodax()` deep-merges your `DeepPartial<SodaxDefaultConfig>` over it.

The `new Sodax(...)` argument is actually `SodaxOptions = DeepPartial<SodaxDefaultConfig> & SodaxOptionalConfig`, where `SodaxOptionalConfig` carries the client-side options `{ logger?; fee? }` plus the per-feature option objects. The global partner `fee` and `logger` are **client-side options, NOT `SodaxDefaultConfig` data fields**: the integrator sets them, they are resolved once, and they are never fetched from or overwritten by the backend config. Read the resolved global fee back via `sodax.config.fee`. It is the **fallback applied to any feature whose own `partnerFee` is unset** (effective fee = `featureFee ?? fee`, via `sodax.config.swapPartnerFee` / `moneyMarketPartnerFee` / `bridgePartnerFee` / `leverageYieldPartnerFee`). (Per-feature partner-fee overrides — `swaps.partnerFee`, `moneyMarket.partnerFee`, `bridge.partnerFee`, `leverageYield.partnerFee` — live on the feature options.)

## v1 shape (for reference)

```ts
// v1 — packages/sdk/src/shared/entities/Sodax.ts
type SodaxConfig = {
  swaps?: SolverConfigParams;                    // { intentsContract, solverApiEndpoint, protocolIntentsContract?, partnerFee? }
  moneyMarket?: MoneyMarketConfigParams;
  migration?: MigrationServiceConfig;
  bridge?: BridgeServiceConfig;
  dex?: DexServiceConfig;
  hubProviderConfig?: EvmHubProviderConfig;      // { hubRpcUrl, chainConfig }
  relayerApiEndpoint?: HttpUrl;                  // single URL string
  backendApiConfig?: BackendApiConfig;
  partners?: PartnerServiceConfig;
  sharedConfig?: typeof defaultSharedConfig;
};
```

All v1 fields were **optional**. v1 had **no** top-level `rpcConfig` on `SodaxConfig` — RPC URLs were a separate prop accepted by the framework-layer `SodaxProvider` (alongside the `config` prop carrying `SodaxConfig`); the `Sodax` class constructor itself never received `rpcConfig`.

## v1 → v2 field map

| v1 location | v2 location | Notes |
|---|---|---|
| `SodaxConfig.swaps` (`SolverConfigParams` — `{ intentsContract, solverApiEndpoint, protocolIntentsContract?, partnerFee? }`) | **Split into two:** `SodaxConfig.solver: SolverConfig` (`{ intentsContract, solverApiEndpoint, protocolIntentsContract }`) and `SodaxConfig.swaps: SwapsConfig` (supported tokens per chain — new in v2). | v1 partner-fee inside `SolverConfigParams` moves to the global `SodaxOptions.fee` option or per-feature configs. |
| `SodaxConfig.hubProviderConfig` (`EvmHubProviderConfig` — `{ hubRpcUrl, chainConfig }`) | **`SodaxConfig.hub`** (`HubConfig` — full hub addresses + native token + bnUSD + polling + RPC URL). | Field renamed `hubProviderConfig` → `hub`. Shape expanded: v1 just had RPC URL + chain config; v2 ships the full hub-contract address map. |
| `SodaxConfig.moneyMarket` (`MoneyMarketConfigParams`) | `SodaxConfig.moneyMarket` (`MoneyMarketConfig` — required, shape changed). | Reshape, see `@sodax/types/src/common/common.ts` MoneyMarketConfig. |
| `SodaxConfig.bridge` (`BridgeServiceConfig`) | `SodaxConfig.bridge` (`BridgeConfig` — `{ partnerFee }`). | Reshape; smaller. Client-side option `bridge.useBackendSubmitTx` (default **on**) selects the backend submit-tx path. |
| `SodaxConfig.dex` (`DexServiceConfig`) | `SodaxConfig.dex` (`DexConfig`). | Reshape. |
| `SodaxConfig.relayerApiEndpoint: HttpUrl` (string) | **`SodaxConfig.relay`** (`RelayConfig` — object with relayer URL + chain-id map). | Renamed + reshaped from string to object. |
| `SodaxConfig.backendApiConfig` (`BackendApiConfig`) | **`SodaxConfig.api`** (`ApiConfig`). | Renamed. |
| (Separate `rpcConfig` prop on the framework-layer SodaxProvider, NOT a `SodaxConfig` field) | **`SodaxConfig.chains`** (`Record<SpokeChainKey, SpokeChainConfig>`). | v2 absorbs RPC URLs + polling + chain-specific extras into the `SodaxConfig.chains` mapped type. v1's separate `rpcConfig` provider prop is gone. The standalone `RpcConfig` type still ships from `@sodax/types` for utility use (e.g. the demo's `providers.tsx` declares a local `RpcConfig` then maps values into `chains`), but it is not a `SodaxConfig` field. |
| `SodaxConfig.migration` (`MigrationServiceConfig`) | **Removed.** Migration service runs with hard-coded defaults. | No replacement on `SodaxConfig`. v2 surfaces customization via per-method params on `sodax.migration.*`, not constructor config — see [`../features/migration.md`](../features/migration.md). |
| `SodaxConfig.partners` (`PartnerServiceConfig`) | **Removed.** Partner service runs with defaults. | Per-claim partner-fee config now flows via call-level params on `sodax.partners.*` methods. |
| `SodaxConfig.sharedConfig` (`typeof defaultSharedConfig`) | **Removed.** | Absorbed into `ConfigService` + per-chain `SpokeChainConfig`. Override individual chains via `SodaxConfig.chains[key]`. |
| (none in v1) | **`SodaxOptions.fee?: PartnerFee`** (new — a client-side option, NOT a `SodaxConfig` data field). | Global partner fee, set via `new Sodax({ fee })` and read back on `sodax.config.fee`. A client option like `logger` — never fetched from or overwritten by the backend. Per-feature overrides still live on `SodaxConfig` (`bridge.partnerFee`, `swaps.partnerFee`, `moneyMarket.partnerFee`). |
| (v1 had no top-level `configService` injection slot on `SodaxConfig` — `ConfigService` was always constructed internally from `backendApiConfig` + `sharedConfig`.) | Same — `ConfigService` is internal. v2 does **not** expose a typed slot to inject a custom `IConfigApi` either. To swap the backend in tests, point `SodaxConfig.api.baseURL` at a mock server. | See Pitfall below. |

**Within v2, too:** `swaps.useBackendSubmitTx` / `bridge.useBackendSubmitTx` (client-side options, default **on**)
replace the earlier `swapsOptions` / `bridgeOptions` keys (`SwapsClientOptions` / `BridgeClientOptions`). The old keys
are deprecated, honoured only when the new flag is omitted, and removed in v3, where the only form is
`swaps: { partnerFee, useBackendSubmitTx }` / `bridge: { partnerFee, useBackendSubmitTx }`. Do not generate the old
keys; an explicit `false` on the new key keeps the fully client-side relay path. A `SwapService` built directly
(not through `new Sodax`) also still accepts a deprecated `useBackendSubmitTx` constructor field, which wins over the
configured value; it is removed in v3 too.

Migration:

```diff
- // v1 — typical SodaxConfig literal
- const sodaxConfig = {
-   hubProviderConfig: { hubRpcUrl: 'https://…', chainConfig: getHubChainConfig() },
-   moneyMarket: getMoneyMarketConfig(hubChainId),
-   swaps: {
-     intentsContract: '0x…',
-     solverApiEndpoint: 'https://…',
-     protocolIntentsContract: '0x…',
-     partnerFee: { address: '0x…', percentage: 10 },
-   },
-   relayerApiEndpoint: 'https://relay.example.com',
- } satisfies SodaxConfig;
- // RPC URLs were passed as a SEPARATE prop on the framework-layer SodaxProvider
- // (alongside the sodaxConfig). The Sodax constructor itself never saw rpcConfig.

+ // v2 — SodaxOptions (DeepPartial<SodaxDefaultConfig> & client options) passed directly to new Sodax(...)
+ const sodax = new Sodax({
+   hub: { /* HubConfig — usually omit, default ships full hub addresses */ },
+   solver: {
+     intentsContract: '0x…',
+     solverApiEndpoint: 'https://…',
+     protocolIntentsContract: '0x…',
+   },
+   swaps: {
+     supportedTokens: { /* per-chain table */ },
+   },
+   relay: { /* RelayConfig — relayer URL + chain-id map */ },
+   fee: { address: '0x…', percentage: 10 },  // global partner fee — a SodaxOptions client option (not SodaxConfig data)
+   chains: {
+     [ChainKeys.SONIC_MAINNET]: { rpcUrl: 'https://…' },
+     [ChainKeys.ARBITRUM_MAINNET]: { rpcUrl: 'https://…' },
+     [ChainKeys.BITCOIN_MAINNET]: { /* BitcoinSpokeChainConfig shape */ },
+     // …
+   },
+ });
+ await sodax.config.initialize();
```

## Per-chain `SpokeChainConfig` shape

`SodaxConfig.chains` is keyed by `SpokeChainKey`; each entry's value type varies by chain family. The user-overridable surface (`rpcUrl`, polling config, chain-specific extras) is the same set of fields `RpcConfig` covers in v1, but nested inside `SpokeChainConfig` rather than flat. Inspect the type at:

- `packages/types/src/chains/chains.ts` — `SpokeChainConfig` discriminated union
- `packages/types/src/common/common.ts` — `BitcoinRpcConfig`, `StellarRpcConfig`, `InjectiveRpcConfig` (used inside the EVM-non-EVM branches)

See [`../breaking-changes/type-system.md`](../breaking-changes/type-system.md) § 5 for the chain-family-specific entry shapes.

### Pitfall

If you previously injected a custom `ConfigService` for testing (a v1 escape hatch), v2 doesn't accept one at the top level — and unlike what earlier doc versions claimed, **v2 also doesn't expose a typed slot to inject a custom `IConfigApiV1`**. The realistic options:

- Point `SodaxConfig.api.baseURL` at a local mock backend server.
- Construct your own `BackendApiService`-compatible object in your app/test bootstrap and swap it in where you control the `Sodax` instance.

The `SodaxConfig.api` field is `ApiConfig` (`{ baseURL, timeout, headers }`) — there is no `api.api` sub-field for IConfigApiV1 injection.

### Pitfall — module-scope reads

If your code reads hub addresses or default configs **before** the `Sodax` instance exists (module-scope constants), use the re-exported defaults from `@sodax/types` (also flow through `@sodax/sdk` since it re-exports the entire types surface):

```ts
import { hubConfig, sodaxConfig } from '@sodax/sdk';

const HUB_WALLET = hubConfig.addresses.hubWallet;     // module-scope OK
const DEFAULT_RELAY = sodaxConfig.relay;              // module-scope OK
```

`hubConfig` / `sodaxConfig` are the **packaged defaults** — the same values `ConfigService` falls back to if the backend is unreachable. Once you have a `Sodax` instance, prefer `sodax.config.getHubChainConfig()` / `sodax.config.*` so backend-driven updates take effect.

---


## Cross-references

- [`README.md`](README.md) — migration reference index.
- [`../README.md`](../README.md) — migration overview.
- [`../checklist.md`](../checklist.md) — top-level migration checklist.
- [`../breaking-changes/type-system.md`](../breaking-changes/type-system.md) § 5 — per-chain config entry shapes.
- [`deleted-exports.md`](deleted-exports.md) — `getHubChainConfig()` and other deleted symbols.
