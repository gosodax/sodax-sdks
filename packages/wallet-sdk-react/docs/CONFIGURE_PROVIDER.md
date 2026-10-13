# Configure SodaxWalletProvider

Learn how to configure `<SodaxWalletProvider>` for your dApp. The provider is the root component for wallet connectivity — it mounts only the chain-type adapters you opt into, holds per-chain RPC + wallet defaults, and bridges to `@sodax/wallet-sdk-core` so SDK calls receive a typed wallet provider.

The canonical TypeScript shape is [`SodaxWalletConfig`](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/src/types/config.ts) in `@sodax/wallet-sdk-react`.

## Table of contents

1. [Quick start — minimal config](#quick-start--minimal-config)
2. [`SodaxWalletConfig` overview](#sodaxwalletconfig-overview)
3. [Chain-type slots — opt in by presence](#chain-type-slots--opt-in-by-presence)
4. [Per-chain entries (`chains[ChainKey]`)](#per-chain-entries-chainschainkey)
5. [Per-chain wallet defaults](#per-chain-wallet-defaults)
6. [WalletConnect (EVM only)](#walletconnect-evm-only)
7. [Email login with Privy (EVM only)](#email-login-with-privy-evm-only)
8. [Config is captured once on mount](#config-is-captured-once-on-mount)
9. [Single source of truth — `ChainMeta`](#single-source-of-truth--chainmeta)
10. [Breaking changes from v1](#breaking-changes-from-v1)

---

## Quick start — minimal config

Mount `<SodaxWalletProvider>` inside `<QueryClientProvider>` with the chain-type slots your dApp needs. Omit any slot you don't need — its native adapter (wagmi, `@solana/wallet-adapter`, `@mysten/dapp-kit-react`) won't be mounted.

```tsx
import { SodaxWalletProvider, type SodaxWalletConfig } from '@sodax/wallet-sdk-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChainKeys } from '@sodax/types';

const queryClient = new QueryClient();

const walletConfig: SodaxWalletConfig = {
  EVM: {
    ssr: true,
    chains: {
      [ChainKeys.SONIC_MAINNET]: { rpcUrl: 'https://rpc.soniclabs.com' },
      [ChainKeys.ETHEREUM_MAINNET]: { rpcUrl: 'https://ethereum-rpc.publicnode.com' },
    },
  },
  SOLANA: {
    chains: { [ChainKeys.SOLANA_MAINNET]: { rpcUrl: 'https://solana-mainnet.g.alchemy.com/v2/<KEY>' } },
  },
  BITCOIN: {}, // mount with SDK defaults
};

export function App({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <SodaxWalletProvider config={walletConfig}>{children}</SodaxWalletProvider>
    </QueryClientProvider>
  );
}
```

`SodaxWalletProvider` mounts the EVM (wagmi), Solana (`@solana/wallet-adapter-react`), and Sui (`@mysten/dapp-kit-react`) React providers conditionally based on which slots are present, then registers chain services for non-provider chains (Bitcoin, ICON, Injective, Stellar, NEAR, Stacks).

---

## `SodaxWalletConfig` overview

Top-level keys are `ChainType` strings — one slot per chain family. **Every slot is optional**. Omitting a slot skips mounting that adapter; passing `{}` mounts it with SDK defaults.

| Key | Mounts | Adapter fields | Per-chain entries |
|-----|--------|----------------|-------------------|
| `EVM` | wagmi (13 EVM chains) | `ssr`, `reconnectOnMount`, `initialState`, `persistKey`, `walletConnect`, `privy` | `{ rpcUrl?, defaults? }` per `EvmChainKey` |
| `SOLANA` | `@solana/wallet-adapter-react` | `autoConnect` | `{ rpcUrl?, defaults? }` per `SolanaChainKey` |
| `SUI` | `@mysten/dapp-kit-react` | `autoConnect`, `network` | `{ grpcUrl?, defaults? }` per `SuiChainKey` (`rpcUrl` is a deprecated alias) |
| `ICON` | (no React adapter) | — | `{ rpcUrl?, defaults? }` per `IconChainKey` |
| `NEAR` | (no React adapter) | — | `{ rpcUrl?, defaults? }` per `NearChainKey` |
| `STELLAR` | (no React adapter) | — | `StellarRpcConfig & { defaults? }` per `StellarChainKey` |
| `BITCOIN` | (no React adapter) | — | `BitcoinRpcConfig & { defaults? }` per `BitcoinChainKey` |
| `INJECTIVE` | (no React adapter) | — | `InjectiveRpcConfig & { defaults? }` per `InjectiveChainKey` |
| `STACKS` | (no React adapter) | — | `StacksNetworkName \| (StacksNetworkLike & { defaults? })` |

**Provider-managed vs non-provider** — EVM, Solana, and Sui need React context providers from their native SDKs (Hydrator components sync state into the Zustand store). The remaining six chains use direct browser-extension APIs and skip the React adapter layer; their actions are registered during `initChainServices()` after the provider mounts.

Every slot declares an optional `connectors?: IXConnector[]` array, but it only takes effect on the six non-provider slots (`ICON`, `NEAR`, `STELLAR`, `BITCOIN`, `INJECTIVE`, `STACKS`), where it replaces the default connectors registered by `chainRegistry`. `EVM`, `SOLANA`, and `SUI` ignore it — their connector lists are written by the Hydrators from wagmi, `@solana/wallet-adapter`, and `@mysten/dapp-kit-react`, so passing `connectors` there type-checks but has no effect. Supplied connectors must extend the abstract `XConnector` class; entries that only implement `IXConnector` are filtered out with a console warning.

---

## Chain-type slots — opt in by presence

The slot's mere presence enables the chain type. Adapter fields and per-chain entries are independent of each other — set whichever you need.

```typescript
const walletConfig: SodaxWalletConfig = {
  // Adapter fields only — wagmi mounts with the bundled chain set, no custom RPCs
  EVM: { ssr: true },

  // Per-chain entries only — @solana/wallet-adapter-react uses defaults (autoConnect: true)
  SOLANA: { chains: { [ChainKeys.SOLANA_MAINNET]: { rpcUrl: 'https://...' } } },

  // Both
  SUI: {
    network: 'mainnet',
    autoConnect: true,
    chains: { [ChainKeys.SUI_MAINNET]: { grpcUrl: 'https://fullnode.mainnet.sui.io' } },
  },

  // Empty object — opt in with SDK defaults
  BITCOIN: {},
};
```

To **disable** a chain type, omit the slot entirely. `useEnabledChains()` reads back the slots that were set, and hooks like `useWalletProvider({ xChainType: 'EVM' })` return `undefined` for disabled chains (with a one-time console warning).

---

## Per-chain entries (`chains[ChainKey]`)

Each slot's `chains` field is keyed by `ChainKey` constants. The entry shape varies by chain family:

### Simple chains — `{ rpcUrl?, defaults? }`

EVM, Solana, Sui, ICON, NEAR and Bitcoin share the simple shape — single RPC URL plus optional wallet provider defaults.

```typescript
import { ChainKeys } from '@sodax/types';

const walletConfig: SodaxWalletConfig = {
  EVM: {
    chains: {
      [ChainKeys.ARBITRUM_MAINNET]: {
        rpcUrl: 'https://arb1.arbitrum.io/rpc',
        defaults: { waitForTransactionReceipt: { confirmations: 1 } },
      },
      [ChainKeys.BASE_MAINNET]: { rpcUrl: 'https://base.drpc.org' },
    },
  },
  ICON: {
    chains: { [ChainKeys.ICON_MAINNET]: { rpcUrl: 'https://ctz.solidwallet.io/api/v3' } },
  },
  BITCOIN: {
    chains: {
      [ChainKeys.BITCOIN_MAINNET]: {
        rpcUrl: 'https://mempool.space/api',
        defaults: { defaultFinalize: true },
      },
    },
  },
};
```

Bound Exchange hosts are **not** configured here — they live on `chains[BITCOIN_MAINNET].radfi` in
the SDK config. See [Bitcoin Integration](https://docs.sodax.com/developers/how-to/bitcoin-integration#bound-hosts).

### Multi-field RPC — Stellar, Injective

Stellar (Horizon + Soroban) and Injective (gRPC + indexer) extend their existing `*RpcConfig` types from `@sodax/types`. Mirror the full shape:

```typescript
import { ChainKeys } from '@sodax/types';

const walletConfig: SodaxWalletConfig = {
  STELLAR: {
    chains: {
      [ChainKeys.STELLAR_MAINNET]: {
        horizonRpcUrl: 'https://horizon.stellar.org',
        sorobanRpcUrl: 'https://rpc.ankr.com/stellar_soroban',
        defaults: { pollInterval: 1_000 },
      },
    },
  },
};
```

### Stacks — preset name OR network object

Stacks accepts either a `StacksNetworkName` preset string (`'mainnet' | 'testnet' | 'devnet' | 'mocknet'`) or a full `StacksNetworkLike` object:

```typescript
import { PostConditionMode } from '@sodax/wallet-sdk-core';

const walletConfig: SodaxWalletConfig = {
  STACKS: {
    chains: {
      [ChainKeys.STACKS_MAINNET]: 'mainnet', // preset
    },
  },
};

// Or with full network object:
const advanced: SodaxWalletConfig = {
  STACKS: {
    chains: {
      [ChainKeys.STACKS_MAINNET]: {
        // StacksNetworkLike fields...
        defaults: { network: 'mainnet', postConditionMode: PostConditionMode.Deny },
      },
    },
  },
};
```

---

## Per-chain wallet defaults

The `defaults` field on each chain entry forwards directly to `wallet-sdk-core`'s provider classes — these are the per-method defaults applied when the SDK calls `walletProvider.sendTransaction(...)` etc.

| Slot | `defaults` shape |
|------|------------------|
| `EVM` | `EvmWalletDefaults` — `sendTransaction`, `waitForTransactionReceipt`, `publicClient`, `walletClient`, `transport` |
| `SOLANA` | `SolanaWalletDefaults` — `connectionCommitment`, `connectionConfig`, `sendOptions`, `confirmCommitment` |
| `SUI` | `SuiWalletDefaults` — `signAndExecuteTxn`, `getCoins` |
| `ICON` | `IconWalletDefaults` — `stepLimit`, `version`, `timestampProvider`, `jsonRpcId` |
| `INJECTIVE` | `InjectiveWalletDefaults` — `defaultFunds`, `defaultMemo`, `sequence`, `accountNumber` |
| `STELLAR` | `StellarWalletDefaults` — `pollInterval`, `pollTimeout`, `networkPassphrase` |
| `STACKS` | `StacksWalletDefaults` — `network`, `postConditionMode` |
| `BITCOIN` | `BitcoinWalletDefaults` — `defaultFinalize` |
| `NEAR` | `NearWalletDefaults` — `throwOnFailure`, `waitUntil`, `gasDefault`, `depositDefault` |

Defaults merge **shallowly** — top-level keys only. Nested objects (e.g. `sendTransaction: { gas, maxFeePerGas }`) are replaced wholesale, not deep-merged. See [`packages/sdk/docs/WALLET_PROVIDERS.md`](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/WALLET_PROVIDERS.md) for full per-chain config reference.

---

## WalletConnect (EVM only)

Default EVM discovery uses [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963) — only browser-extension wallets. Partners using enterprise custody (Fireblocks, Ledger, etc.) cannot install browser extensions and need WalletConnect protocol.

The `walletConnect` field on the `EVM` slot extends wagmi's `WalletConnectParameters` directly — every wagmi option is available:

```typescript
const walletConfig: SodaxWalletConfig = {
  EVM: {
    ssr: true,
    chains: { [ChainKeys.SONIC_MAINNET]: { rpcUrl: 'https://rpc.soniclabs.com' } },
    walletConnect: {
      projectId: '<your-walletconnect-cloud-project-id>',
      // showQrModal, isNewChainsStale, qrModalOptions, etc.
    },
  },
};
```

When `walletConnect` is provided, a WalletConnect connector is added to the wagmi config and `EvmHydrator` discovers it automatically — no UI changes needed.

**Restrict modal to specific wallets** — pass `qrModalOptions` to filter the WalletConnect Explorer list:

```typescript
walletConnect: {
  projectId: '...',
  qrModalOptions: {
    explorerRecommendedWalletIds: ['<fireblocks-wallet-id>'],
    explorerExcludedWalletIds: 'ALL', // hides everything except recommended
  },
}
```

If `projectId` is missing, the WalletConnect connector is silently skipped and a warning is logged. See [`WALLETCONNECT.md`](./WALLETCONNECT.md) for the partner integration guide.

---

## Email login with Privy (EVM only)

The `privy` field adds an "Email (Privy)" wallet: email one-time-code login and a Privy embedded wallet. Build its value with `privy()` from the `@sodax/wallet-sdk-react/privy` sub-path and install `@privy-io/react-auth` (an optional peer):

```typescript
import { privy } from '@sodax/wallet-sdk-react/privy';

const config: SodaxWalletConfig = {
  EVM: {
    privy: privy({ appId: process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? '' }),
  },
};
```

The connector (id `privy`) joins the same EVM list as injected wallets and WalletConnect, and the SDK mounts `PrivyProvider` around your app. Without the field no Privy code is loaded. See [`WALLET_PRIVY.md`](./WALLET_PRIVY.md) — it covers custody, recovery and availability trade-offs to read before enabling it.

---

## Config is captured once on mount

`SodaxWalletProvider` freezes the `config` prop on the **first render** via `useRef`. Subsequent re-renders with a new reference have **no effect** on the underlying providers, store, or wagmi config:

```tsx
// ❌ Dynamic config — RPC change is ignored after first render
const walletConfig: SodaxWalletConfig = useMemo(() => ({
  EVM: { chains: { [ChainKeys.BSC_MAINNET]: { rpcUrl: dynamicRpc } } },
}), [dynamicRpc]);

return <SodaxWalletProvider config={walletConfig}>{children}</SodaxWalletProvider>;
```

To swap config at runtime, **remount** the provider with a new `key`:

```tsx
return (
  <SodaxWalletProvider key={configVersion} config={walletConfig}>
    {children}
  </SodaxWalletProvider>
);
```

This avoids subtle bugs where Zustand persistence, wagmi reconnect, and Hydrator state-syncing diverge from a mid-flight config change.

---

## Single source of truth — `ChainMeta`

When adding a new chain type to the package, the only file you edit is [`ChainMeta`](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/src/types/config.ts):

```typescript
export type ChainMeta = {
  EVM: { keys: EvmChainKey; entry: EvmChainEntry; defaults: EvmWalletDefaults; adapter: EvmAdapterFields };
  // ... one entry per ChainType
};
```

`SodaxWalletConfig`, `ChainTypeConfig<T>`, `ChainEntry<K>`, `WalletDefaultsByKey<K>` all derive automatically from `ChainMeta`. See [`ADDING_A_NEW_CHAIN.md`](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/ADDING_A_NEW_CHAIN.md) for the full chain-onboarding workflow.

---

## Breaking changes from v1

The v2 config is **not backward-compatible** with v1's flat shape. If you're upgrading:

### `rpcConfig` removed

```tsx
// ❌ v1 — flat per-chain RPC map
<SodaxWalletProvider rpcConfig={{
  sonic: 'https://rpc.soniclabs.com',
  '0x38.bsc': 'https://bsc-dataseed1.binance.org',
  solana: 'https://...',
}}>

// ✅ v2 — chain-type slots with nested per-chain entries
<SodaxWalletProvider config={{
  EVM: {
    chains: {
      [ChainKeys.SONIC_MAINNET]: { rpcUrl: 'https://rpc.soniclabs.com' },
      [ChainKeys.BSC_MAINNET]: { rpcUrl: 'https://bsc-dataseed1.binance.org' },
    },
  },
  SOLANA: { chains: { [ChainKeys.SOLANA_MAINNET]: { rpcUrl: 'https://...' } } },
}}>
```

### `options` removed — fields moved to slot adapter fields

| v1 prop | v2 location |
|---------|-------------|
| `options.ssr` | `config.EVM.ssr` |
| `options.reconnectOnMount` | `config.EVM.reconnectOnMount` |
| `options.solanaAutoConnect` | `config.SOLANA.autoConnect` |
| `options.suiAutoConnect` | `config.SUI.autoConnect` |
| `options.suiNetwork` | `config.SUI.network` |
| `options.walletConnect` | `config.EVM.walletConnect` |

### `initialState` removed — moved to slot

```tsx
// ❌ v1
<SodaxWalletProvider rpcConfig={...} initialState={wagmiInitialState}>

// ✅ v2
<SodaxWalletProvider config={{ EVM: { initialState: wagmiInitialState, ... } }}>
```

### `chains: { EVM, SOLANA, ... }` wrapper removed

```tsx
// ❌ v1
<SodaxWalletProvider config={{ chains: { EVM: { ... }, SOLANA: { ... } } }}>

// ✅ v2 — chain-type slots are top-level
<SodaxWalletProvider config={{ EVM: { ... }, SOLANA: { ... } }}>
```

### Persisted `xConnections` for now-disabled chains are cleaned up

If a previous session connected a chain that is no longer in `config`, the persisted connection in `localStorage` (key: `xwagmi-store`) is removed automatically by `cleanupDisabledConnections()` after persist hydration. No consumer action required.

---

## Related docs

- [Connect Flow](./CONNECT_FLOW.md) — discover connectors, connect, read account, disconnect
- [Wallet Provider Bridge](./WALLET_PROVIDER_BRIDGE.md) — `useWalletProvider` → typed `IXxxWalletProvider` for SDK calls
- [WalletConnect](./WALLETCONNECT.md) — enterprise/custody wallet setup (Fireblocks, etc.)
- [Adding a New Chain](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/ADDING_A_NEW_CHAIN.md) — `ChainMeta` extension and chain registry
- [SDK Wallet Providers Reference](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/WALLET_PROVIDERS.md) — per-chain `defaults` shape reference
