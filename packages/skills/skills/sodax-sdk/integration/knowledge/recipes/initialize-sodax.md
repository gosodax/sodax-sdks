# Initialize Sodax

The minimal init — packaged defaults, no config override:

```ts
import { Sodax } from '@sodax/sdk';

const sodax = new Sodax();
await sodax.config.initialize();   // load fresh config from backend; falls back to packaged defaults

// All feature services are wired and ready:
const result = sodax.config.isValidSpokeChainKey(ChainKeys.ARBITRUM_MAINNET);   // returns boolean (sync)
```

### With config override

```ts
import { Sodax, ChainKeys, type SodaxOptions } from '@sodax/sdk';

// `SodaxOptions` = `DeepPartial<SodaxDefaultConfig>` (the data override) plus the client-side options:
// `logger`, the global `fee`, the global `apiKey` (one instance-wide key, sent as `x-api-key` on every backend request; override per request via `RequestOverrideConfig.apiKey`; server-side only — in a browser, proxy instead, see https://docs.sodax.com/developers/how-to/api-key-good-practices), and per-feature options on `swaps` / `bridge` (e.g. `{ useBackendSubmitTx: false }` — opt out of the default-on backend 2-step flow).
const config: SodaxOptions = {
  // Per-chain overrides — merged with packaged defaults at the field level.
  chains: {
    [ChainKeys.SONIC_MAINNET]: { rpcUrl: process.env.SONIC_RPC_URL },
    [ChainKeys.ARBITRUM_MAINNET]: { rpcUrl: process.env.ARBITRUM_RPC_URL },
  },
  // Backend API override. `baseURL` is the gateway ROOT (default: https://api.sodax.com/v1); each
  // service appends its own path below it (`/be`, `/swaps`, `/bridge`, `/sponsorships/stellar`).
  // A sandbox that serves `/config/*` at its bare origin has no `/be` mount, so say so with
  // `basePath: ''` — otherwise the data API requests `<origin>/be/config/all`.
  api: {
    baseApiConfig: { baseURL: 'https://my-sandbox-backend.example.com', basePath: '' },
  },
  // Solver endpoints (default: https://api.sodax.com/v1/intent + production contracts).
  solver: {
    solverApiEndpoint: 'https://my-solver.example.com',
  },
  // SDK log sink: 'console' (default) | 'silent' | a custom SodaxLogger. See logging.md.
  logger: 'silent',
};

const sodax = new Sodax(config);
await sodax.config.initialize();
```

### Hub RPC failover (multiple endpoints)

The Sonic hub is read through two clients — the hub provider (wallet-address lookups, contract reads) and the Sonic spoke service (hub-chain allowance checks, gas estimation, intent creation). Each accepts an ordered `rpcUrls` list, wrapped internally in a viem `fallback()` transport that advances to the next endpoint on 5xx/52x/transport errors. The single `rpcUrl` stays the default; `rpcUrls` is opt-in and, when set and non-empty, takes precedence (first entry is primary). Optional `rpcOptions` tunes the fallback (`rank` / `retryCount` / `retryDelay`).

```ts
import { Sodax, ChainKeys, type SodaxOptions } from '@sodax/sdk';

const SONIC_RPCS = ['https://rpc.soniclabs.com', 'https://sonic-backup.example.com'];

const config: SodaxOptions = {
  // Hub provider failover.
  hub: {
    rpcUrls: SONIC_RPCS,
    rpcOptions: { retryCount: 3 }, // optional viem fallback() tuning
  },
  // Sonic spoke failover — same physical chain, separate client/knob.
  chains: {
    [ChainKeys.SONIC_MAINNET]: { rpcUrls: SONIC_RPCS },
  },
};

const sodax = new Sodax(config);
await sodax.config.initialize();
```

> Both knobs target the same physical chain (Sonic) but back distinct clients, so set **both** for end-to-end hub resilience — `hub.rpcUrls` covers the hub provider and `chains.[SONIC_MAINNET].rpcUrls` covers the swap/intent path. Omit them to keep the single-endpoint default (fully backward compatible). The endpoint list is read once at `new Sodax(...)` time.

### Lazy initialization

`config.initialize()` is idempotent — calling it twice is a no-op. The first call fetches; subsequent calls return cached data. Treat it as "make sure config is loaded before any feature method".

### Pitfall

`initialize()` is the only initialization step. Don't `await` it inside every feature call — call it once at app startup. If you skip it entirely, feature services fall back to packaged defaults, which may be stale relative to the latest backend config (new tokens, new chains, fee parameter changes).

## Module-scope reads (no Sodax instance needed)

Some code runs at **module-load time** — constants files, utility modules, framework-provider configs — before any `Sodax` instance exists. For those, import the packaged-default constants directly from `@sodax/sdk` (re-exported from `@sodax/types`):

```ts
import { sodaxConfig, hubConfig } from '@sodax/sdk';

// Hub address constants
export const HUB_WALLET = hubConfig.addresses.hubWallet;
export const STAKING_ROUTER = hubConfig.addresses.stakingRouter;

// Full default config (every SodaxConfig field with packaged defaults)
export const DEFAULT_SOLVER_ENDPOINT = sodaxConfig.solver.solverApiEndpoint;
export const SUPPORTED_TOKENS_PER_CHAIN = sodaxConfig.swaps.supportedTokens;
```

| Need | Module-scope import (defaults only) | Instance-scope read (with overrides) |
|---|---|---|
| Hub contract addresses (assetManager, hubWallet, stakingRouter, etc.) | `hubConfig.addresses.*` | `sodax.config.getHubChainConfig().addresses.*` |
| Full default SodaxConfig (read-only snapshot) | `sodaxConfig.*` (e.g. `sodaxConfig.hub`, `sodaxConfig.moneyMarket`) | `sodax.config.sodaxConfig` |
| Per-chain spoke config (rpcUrl, nativeToken, addresses, supportedTokens, polling) | `spokeChainConfig[ChainKeys.X_MAINNET]` (from `@sodax/types` / `@sodax/sdk`) | `sodax.config.spokeChainConfig[ChainKeys.X_MAINNET]` *or* `sodax.config.getChainConfig(ChainKeys.X_MAINNET)` |
| Money market reserve assets | `sodaxConfig.moneyMarket.supportedReserveAssets` | `sodax.config.getMoneyMarketReserveAssets()` |

> **Static vs dynamic — and the override-gap consequence.** `sodaxConfig` / `hubConfig` / `spokeChainConfig` are **packaged-default snapshots** frozen at SDK release time. They are safe at module scope but: (a) won't reflect backend-driven config updates loaded by `sodax.config.initialize()`, and (b) **won't reflect overrides passed to `new Sodax(config)`** — those merge into `sodax.config` (the `ConfigService`) but never mutate the static imports. So once a `Sodax` instance exists, prefer the instance-scope readers in the right column above — particularly `sodax.config.spokeChainConfig` over the same-named static import — or you will silently fall back to the packaged defaults for any chain you customized.


## Cross-references

- [`README.md`](README.md) — recipe index.
- [`logging.md`](logging.md) — the `logger` constructor option in depth (presets + custom sinks).
- [`../architecture.md`](../architecture.md) — concepts behind these patterns.
- [`../reference/`](../reference/) — chain keys, error codes, public API surface.
