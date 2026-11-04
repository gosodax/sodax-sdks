# Reference: `SodaxWalletProvider` Config Map

The biggest single change in v2. v1 spread chain configuration across three props (`rpcConfig`, `options`, `initialState`); v2 collapses them into one `config` prop. See [`../breaking-changes.md`](../breaking-changes.md) §1 for the WHY.

---

## ⚠️ First, fix the provider stack (silent runtime crash otherwise)

**v1 created `QueryClient` internally; v2 expects the consumer to provide one.** If you only swap the prop shape without adding `QueryClientProvider`, the app crashes at runtime — React Query hooks throw "No QueryClient set". This is **not** a typecheck error; it surfaces only when a wallet hook mounts.

```tsx
// @ai-snippets-skip
// v1 ❌ — QueryClientProvider was internal
<SodaxWalletProvider rpcConfig={...} options={...}>{children}</SodaxWalletProvider>

// v2 ✅ — caller wraps with QueryClientProvider
<QueryClientProvider client={queryClient}>
  <SodaxWalletProvider config={walletConfig}>{children}</SodaxWalletProvider>
</QueryClientProvider>
```

Add `@tanstack/react-query 5.x` as a direct dependency if your app didn't already have it. See [`../breaking-changes.md`](../breaking-changes.md) §2.

When dapp-kit is also in use, the full provider stack is:

```tsx
// @ai-snippets-skip
<SodaxProvider config={sodaxConfig}>
  <QueryClientProvider client={queryClient}>           {/* required wrapper */}
    <SodaxWalletProvider config={walletConfig}>
      <YourApp />
    </SodaxWalletProvider>
  </QueryClientProvider>
</SodaxProvider>
```

---

## Top-level shape

```tsx
// @ai-snippets-skip
// v1 ❌
<SodaxWalletProvider
  rpcConfig={rpcConfig}
  options={{ wagmi, solana, sui }}
  initialState={wagmiState}
>
  {children}
</SodaxWalletProvider>

// v2 ✅
<SodaxWalletProvider config={walletConfig}>{children}</SodaxWalletProvider>
```

The v2 `config` is `SodaxWalletConfig`. Top-level keys are **chain-type slots** (`EVM`, `SOLANA`, `SUI`, `BITCOIN`, `STELLAR`, `ICON`, `INJECTIVE`, `NEAR`, `STACKS`). **Omit a slot to skip mounting that adapter**; pass `{}` to mount with SDK defaults.

---

## v1 `rpcConfig` → v2 per-chain `rpcUrl`

v1 took a flat dictionary keyed by some chain string:

```ts
// @ai-snippets-skip
// v1 ❌
const rpcConfig: RpcConfig = {
  'sonic': 'https://rpc.soniclabs.com',
  '0x1.eth': 'https://ethereum-rpc.publicnode.com',
  'solana': 'https://api.mainnet-beta.solana.com',
  // ...
};
```

v2 nests RPC URLs under `<ChainTypeSlot>.chains[ChainKey].rpcUrl`:

```ts
// v2 ✅
import { ChainKeys } from '@sodax/types';
import type { SodaxWalletConfig } from '@sodax/wallet-sdk-react';

const walletConfig: SodaxWalletConfig = {
  EVM: {
    chains: {
      [ChainKeys.SONIC_MAINNET]: { rpcUrl: 'https://rpc.soniclabs.com' },
      [ChainKeys.ETHEREUM_MAINNET]: { rpcUrl: 'https://ethereum-rpc.publicnode.com' },
    },
  },
  SOLANA: {
    chains: {
      [ChainKeys.SOLANA_MAINNET]: { rpcUrl: 'https://api.mainnet-beta.solana.com' },
    },
  },
};
```

**Per-chain entry shape varies** by chain type:

| Slot | Per-chain entry |
|---|---|
| `EVM`, `SOLANA`, `ICON`, `NEAR` | `{ rpcUrl?, defaults? }` |
| `SUI` | `{ grpcUrl?, defaults? }` — `rpcUrl` is a deprecated alias; pass one or the other, never both |
| `BITCOIN`, `STELLAR`, `INJECTIVE` | extends their `*RpcConfig` type with `{ defaults? }` |
| `STACKS` | preset name (string) **or** `StacksNetworkLike & { defaults? }` |

The single source of truth for the per-chain shape is `ChainMeta` in `src/types/config.ts` — `SodaxWalletConfig`, `ChainEntry<K>`, `WalletDefaultsByKey<K>` derive from it.

---

## v1 `options.wagmi` → v2 `EVM.*`

```ts
// @ai-snippets-skip
// v1 ❌
options: {
  wagmi: {
    reconnectOnMount: false,
    ssr: true,
  },
}
```

```ts
// @ai-snippets-skip
// v2 ✅
EVM: {
  ssr: true,
  reconnectOnMount: true,
  chains: { ... },
}
```

| v1 | v2 | Notes |
|---|---|---|
| `options.wagmi.ssr` | `EVM.ssr` | Defaults: v1 `true`, v2 not set (caller decides). For Next.js, set `true`. |
| `options.wagmi.reconnectOnMount` | `EVM.reconnectOnMount` | Still supported, default `false`. Moved into the `EVM` slot. See [`migration/recipes/ssr-setup.md`](../recipes/ssr-setup.md) for the SSR-aware flow. |

---

## v1 `options.solana` → v2 `SOLANA.*`

```ts
// @ai-snippets-skip
// v1 ❌
options: {
  solana: { autoConnect: true },
}
```

```ts
// @ai-snippets-skip
// v2 ✅
SOLANA: {
  autoConnect: true,
  chains: {
    [ChainKeys.SOLANA_MAINNET]: { rpcUrl: '...' },
  },
}
```

| v1 | v2 |
|---|---|
| `options.solana.autoConnect` | `SOLANA.autoConnect` |

---

## v1 `options.sui` → v2 `SUI.*`

```ts
// @ai-snippets-skip
// v1 ❌
options: {
  sui: { autoConnect: true },
}
```

```ts
// @ai-snippets-skip
// v2 ✅
SUI: {
  autoConnect: true,
  network: 'mainnet',
}
```

`SUI` slot fields (per `SuiAdapterFields` in `src/types/config.ts`):

| Field | Type | Default |
|---|---|---|
| `autoConnect` | `boolean?` | `true` |
| `network` | `'mainnet' \| 'testnet'?` | `'mainnet'` |

| v1 | v2 |
|---|---|
| `options.sui.autoConnect` | `SUI.autoConnect` |

---

## v1 `initialState` → v2 `EVM.initialState`

v1 accepted a top-level `initialState` prop (`WagmiState`) for SSR hydration. v2 still accepts the same value — it just lives **inside the `EVM` slot** of the `config` prop.

```ts
// @ai-snippets-skip
// v1 ❌
<SodaxWalletProvider rpcConfig={...} options={...} initialState={wagmiState}>

// v2 ✅
<SodaxWalletProvider config={{
  EVM: {
    ssr: true,
    initialState: wagmiState,
    chains: {...},
  },
  /* ... */
}}>
```

If you previously derived `initialState` via wagmi's `cookieToInitialState(...)` in a server component, switch to `tryCookieToInitialState(...)` (from `@sodax/wallet-sdk-react/xchains/evm`, so a malformed cookie can't throw during SSR) and pass the result into `EVM.initialState` instead of the top-level prop. Build the server's `createWagmiConfig` from the **same** `chains`/`persistKey` as the client, or the SSR read hits the wrong cookie. See [`../recipes/ssr-setup.md`](../recipes/ssr-setup.md) for a full Next.js example.

---

## New in v2: per-chain `defaults`

Each chain entry can hold call-level defaults that flow to the bridged `IXxxWalletProvider`:

```ts
// @ai-snippets-skip
// v2 ✅
EVM: {
  chains: {
    [ChainKeys.ARBITRUM_MAINNET]: {
      rpcUrl: 'https://arb1.arbitrum.io/rpc',
      defaults: {
        waitForTransactionReceipt: { confirmations: 1 },
      },
    },
  },
}
```

The `defaults` shape is per-chain — the type system narrows what's valid per chain key. Inspect `WalletDefaultsByKey<K>` in `src/types/config.ts`.

---

## New in v2: `EVM.walletConnect`

WalletConnect support for EVM — extends wagmi's `WalletConnectParameters`:

```ts
// @ai-snippets-skip
// v2 ✅
EVM: {
  walletConnect: {
    projectId: 'wc-cloud-project-id', // required from cloud.walletconnect.com
    // qrModalOptions, isNewChainsStale, etc. — full WalletConnectParameters
  },
}
```

When `walletConnect` is present, a WalletConnect connector is added to the wagmi config; `useXConnectors({ xChainType: 'EVM' })` will surface it. Omitting the field preserves v1 behavior (EIP-6963 only).

See [`../recipes/walletconnect-migration.md`](../recipes/walletconnect-migration.md).

---

## New in v2: `<chainSlot>.connectors?` override

Each chain slot accepts an optional `connectors` field to override the default connector list. Most consumers don't need this — defaults work for all common wallet vendors.

---

## Frozen on first render

`SodaxWalletProvider` captures `config` once on mount and ignores prop-reference changes. To swap config at runtime, remount with a new `key`:

```tsx
// @ai-snippets-skip
// v2 ✅
<SodaxWalletProvider key={configVersion} config={walletConfig}>
  {children}
</SodaxWalletProvider>
```

Bumping `configVersion` (e.g. when the user picks a new RPC endpoint) forces a clean re-init. See [`../breaking-changes.md`](../breaking-changes.md) §12.

---

## Provider-stack order changed

Moved to the top of this file — see the ⚠️ block at the start. The summary: wrap `SodaxWalletProvider` in `QueryClientProvider`, otherwise React Query throws "No QueryClient set" at runtime.

---

## Minimal valid v2 config — every shape, side by side

```ts
// v2 ✅
import { ChainKeys } from '@sodax/types';
import type { SodaxWalletConfig } from '@sodax/wallet-sdk-react';

const walletConfig: SodaxWalletConfig = {
  // EVM — needs chains
  EVM: {
    ssr: true,
    chains: {
      [ChainKeys.SONIC_MAINNET]: { rpcUrl: 'https://rpc.soniclabs.com' },
    },
    // optional:
    // walletConnect: { projectId: '...' },
  },

  // SOLANA — chain entry + autoConnect
  SOLANA: {
    autoConnect: false,
    chains: {
      [ChainKeys.SOLANA_MAINNET]: { rpcUrl: 'https://api.mainnet-beta.solana.com' },
    },
  },

  // SUI — network preset
  SUI: { network: 'mainnet' },

  // ICON — chain entry
  ICON: {
    chains: {
      [ChainKeys.ICON_MAINNET]: { rpcUrl: 'https://ctz.solidwallet.io/api/v3' },
    },
  },

  // BITCOIN, STELLAR, INJECTIVE, NEAR, STACKS — pass {} to mount with SDK defaults
  BITCOIN: {},
  STELLAR: {},
  INJECTIVE: {},
  NEAR: {},
  STACKS: {},
};
```

Omit any slot to skip that chain entirely.
