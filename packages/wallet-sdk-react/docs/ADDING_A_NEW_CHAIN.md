# Adding a New Chain

This document is the contributor workflow for onboarding a new chain family (e.g. Aptos, Cosmos, …) into `@sodax/wallet-sdk-react`. Most steps are mechanical because the central abstractions (`ChainMeta`, `chainRegistry`, sub-path exports) auto-derive downstream types — adding a chain is mostly **filling in entries**, not rewriting hooks.

Prerequisite: read [`ARCHITECTURE.md`](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/ARCHITECTURE.md) first, especially the [Provider-managed vs non-provider](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/ARCHITECTURE.md#provider-managed-vs-non-provider-chains) split — that decision drives the rest of this guide.

## Table of contents

1. [Decision tree — provider-managed or not?](#decision-tree--provider-managed-or-not)
2. [Step 1 — types in `@sodax/types`](#step-1--types-in-sodaxtypes)
3. [Step 2 — wallet provider in `@sodax/wallet-sdk-core`](#step-2--wallet-provider-in-sodaxwallet-sdk-core)
4. [Step 3 — `XService` + `XConnector` in `xchains/<chain>/`](#step-3--xservice--xconnector-in-xchainschain)
5. [Step 4 — `xchains/<chain>/index.ts` barrel for sub-path export](#step-4--xchainschainindexts-barrel-for-sub-path-export)
6. [Step 5 — `ChainMeta` entry in `types/config.ts`](#step-5--chainmeta-entry-in-typesconfigts)
7. [Step 6 — register in `chainRegistry`](#step-6--register-in-chainregistry)
8. [Step 7 — provider-managed only — Provider/Hydrator/Actions trio](#step-7--provider-managed-only--providerhydratoractions-trio)
9. [Step 8 — barrel surface (`src/index.ts`)](#step-8--barrel-surface-srcindexts)
10. [Step 9 — tests](#step-9--tests)
11. [Verification checklist](#verification-checklist)

---

## Decision tree — provider-managed or not?

Set `providerManaged: true` if **any** of these is true:

- The chain ships a React adapter library (wagmi, `@solana/wallet-adapter-react`, `@mysten/dapp-kit-react`, etc.) that you want to use.
- The wallet-side SDK requires a long-lived React context to register handlers and survive component re-renders.
- Wallet discovery is reactive (EIP-6963 announcements, dynamic adapter registration) and you want components to re-render automatically.

Set `providerManaged: false` if:

- You can probe `window.<wallet>` synchronously per-call.
- Connection lifecycle is short-lived (call `connect()`, get an account back, no React context needed).
- The native SDK is plain TS classes/functions with no React glue (e.g. `sats-connect`, `icon-sdk-js`).

**Mixing** — you can have a non-provider chain whose `discoverConnectors` is async (Stellar). That's still `providerManaged: false` because the connectors are static after discovery; the React adapter pattern isn't used.

---

## Step 1 — types in `@sodax/types`

Add the chain's identity and types to `packages/types/src/`:

1. **Chain key** in [`packages/types/src/chains/chain-keys.ts`](https://github.com/icon-project/sodax-sdks/blob/main/packages/types/src/chains/chain-keys.ts):
   ```typescript
   export const ChainKeys = {
     ...
     APTOS_MAINNET: 'aptos',
   };
   ```
2. **Chain type** in `ChainTypeArr`:
   ```typescript
   export const ChainTypeArr = [..., 'APTOS'] as const;
   ```
3. **Chain key type alias**:
   ```typescript
   export type AptosChainKey = typeof ChainKeys.APTOS_MAINNET;
   ```
4. **Chain info entry** in [`packages/types/src/chains/chains.ts`](https://github.com/icon-project/sodax-sdks/blob/main/packages/types/src/chains/chains.ts) (`baseChainInfo`):
   ```typescript
   [ChainKeys.APTOS_MAINNET]: { type: 'APTOS', chainId: '0x1' /* or numeric */, displayName: 'Aptos' }
   ```
5. **Wallet provider interface** in `packages/types/src/aptos.ts`:
   ```typescript
   export interface IAptosWalletProvider extends WalletAddressProvider {
     readonly chainType: 'APTOS';
     // chain-specific methods: signAndSubmitTransaction, signMessage, ...
   }
   ```
6. **Add to root barrel** if you want it re-exported from `@sodax/types`, or leave as a sub-package export per [`packages/types/CLAUDE.md`](https://github.com/icon-project/sodax-sdks/blob/main/packages/types/CLAUDE.md).

The `ChainKey` and `ChainType` unions auto-derive — once these entries land, downstream code in `@sodax/sdk` and `@sodax/wallet-sdk-react` sees the new chain at the type level.

---

## Step 2 — wallet provider in `@sodax/wallet-sdk-core`

Add `packages/wallet-sdk-core/src/wallet-providers/aptos/`:

```
aptos/
├── AptosWalletProvider.ts
├── AptosWalletProvider.test.ts
├── types.ts                    # PrivateKey<chain>WalletConfig + BrowserExtension<chain>WalletConfig + AptosWalletDefaults
└── index.ts                    # Barrel re-export
```

`AptosWalletProvider` extends `BaseWalletProvider<AptosWalletDefaults>` and implements `IAptosWalletProvider`. Discriminated config — pick a discriminant pattern:

- **Field presence** (no `type` field): `privateKey` field present vs. absent. Most chains use this.
- **Explicit `type`**: `'PRIVATE_KEY'` | `'BROWSER_EXTENSION'`. Use when both modes share fields that would clash without a discriminant (Bitcoin, Stellar).

See [`packages/wallet-sdk-core/CLAUDE.md`](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-core/CLAUDE.md#config-variants-discriminants) for the canonical patterns.

Re-export from `packages/wallet-sdk-core/src/wallet-providers/index.ts`:

```typescript
export * from './aptos/index.js';
```

---

## Step 3 — `XService` + `XConnector` in `xchains/<chain>/`

Create `packages/wallet-sdk-react/src/xchains/aptos/`:

```
aptos/
├── AptosXService.ts
├── AptosXConnector.ts
├── AptosXConnector.test.ts
└── index.ts
```

### `AptosXService`

Singleton that owns the connector list and exposes balance reads. Extend the abstract `XService`:

```typescript
import type { XToken } from '@sodax/types';
import { XService } from '@/core/index.js';

export class AptosXService extends XService {
  private static instance: AptosXService | undefined;

  static getInstance(rpcConfig?: { rpcUrl?: string }): AptosXService {
    if (!AptosXService.instance) AptosXService.instance = new AptosXService(rpcConfig);
    return AptosXService.instance;
  }

  // chain-specific state (RPC client, etc.)

  async getBalance(address: string, xToken: XToken): Promise<bigint> {
    // …
  }
}
```

### `AptosXConnector`

Extend `XConnector`. The base class provides `id`, `icon`, `isInstalled = true` defaults; override `isInstalled` / `installUrl` for browser-extension-backed connectors:

```typescript
import { XConnector } from '@/core/index.js';
import type { XAccount } from '@/types/index.js';

export class AptosWalletXConnector extends XConnector {
  constructor() {
    super('APTOS', 'Aptos Wallet', 'aptos.wallet');
  }

  override get isInstalled(): boolean {
    return typeof window !== 'undefined' && 'aptos' in window;
  }

  override get installUrl(): string {
    return 'https://chrome.google.com/webstore/detail/...';
  }

  async connect(): Promise<XAccount | undefined> {
    const account = await window.aptos.connect();
    return account ? { address: account.address, xChainType: 'APTOS', publicKey: account.publicKey } : undefined;
  }

  async disconnect(): Promise<void> {
    await window.aptos.disconnect();
  }
}
```

For chains with multiple wallets (Bitcoin: Unisat / Xverse / OKX; Injective: MetaMask / Keplr / Leap), create one `XConnector` subclass per wallet and have an abstract intermediate base if shared logic exists (Bitcoin uses `BitcoinXConnector` abstract).

---

## Step 4 — `xchains/<chain>/index.ts` barrel for sub-path export

Create the barrel that powers `@sodax/wallet-sdk-react/xchains/aptos`:

```typescript
// src/xchains/aptos/index.ts
export { AptosXService } from './AptosXService.js';
export { AptosWalletXConnector } from './AptosXConnector.js';
```

`tsup.config.ts` already picks up `src/xchains/*/index.ts` via glob — **no config edit needed**. The sub-path export will resolve as `@sodax/wallet-sdk-react/xchains/aptos`.

See [`SUB_PATH_EXPORTS.md`](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/SUB_PATH_EXPORTS.md) for the export plumbing.

---

## Step 5 — `ChainMeta` entry in `types/config.ts`

[`ChainMeta`](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/src/types/config.ts) is the **single source of truth** for per-chain-type metadata. `SodaxWalletConfig`, `ChainTypeConfig<T>`, `ChainEntry<K>`, `WalletDefaultsByKey<K>` all derive from it automatically.

Add **one entry**:

```typescript
export type AptosChainEntry = SimpleChainEntry<AptosWalletDefaults>;

export type ChainMeta = {
  EVM: { ... };
  // ...
  APTOS: {
    keys: AptosChainKey;          // from @sodax/types
    entry: AptosChainEntry;       // { rpcUrl?, defaults? } (or richer if chain has multi-field RPC)
    defaults: AptosWalletDefaults;
    adapter: {};                  // {} for non-provider chains; AptosAdapterFields if provider-managed
  };
};
```

If the chain has multi-field RPC (Stellar's horizon + soroban, Injective's indexer + grpc), define a custom entry shape that extends `*RpcConfig` from `@sodax/types`:

```typescript
export type AptosChainEntry = AptosRpcConfig & { defaults?: AptosWalletDefaults };
```

If provider-managed, define `AptosAdapterFields` (one value per React provider — wagmi-config-level settings, not per-chain):

```typescript
export type AptosAdapterFields = {
  network?: 'mainnet' | 'testnet' | 'devnet';
  autoConnect?: boolean;
};
```

Add the per-chain-type alias for external typing convenience:

```typescript
export type AptosTypeConfig = ChainTypeConfig<'APTOS'>;
```

---

## Step 6 — register in `chainRegistry`

Add an entry to [`chainRegistry`](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/src/chainRegistry.ts):

### Non-provider chain

```typescript
APTOS: defineChain({
  createService: walletConfig =>
    AptosXService.getInstance({ rpcUrl: getRpcUrl(walletConfig?.APTOS?.chains?.[ChainKeys.APTOS_MAINNET]) }),
  displayName: 'Aptos',
  defaultConnectors: () => [new AptosWalletXConnector()],
  providerManaged: false,
  // Optional — provide createActions if signMessage needs custom dispatch (Bitcoin's BIP-322/ECDSA)
  createActions: (service, getStore) => ({
    ...createDefaultActions('APTOS', service, getStore),
    signMessage: async (message: string) => {
      // chain-specific signing logic
    },
  }),
  // Optional — provide createWalletProvider if the chain needs a wallet provider in `walletProviders` map
  createWalletProvider: (service, getStore) => {
    const connection = getStore().xConnections.APTOS;
    if (!connection?.xConnectorId) return undefined;
    const defaults = getEntryDefaults<typeof ChainKeys.APTOS_MAINNET>(
      getStore().walletConfig?.APTOS?.chains?.[ChainKeys.APTOS_MAINNET],
    );
    return new AptosWalletProvider({ /* ... */, defaults });
  },
  // Optional — provide discoverConnectors if connectors require async detection
  discoverConnectors: async (service, getStore) => {
    const wallets = await detectInstalledAptosWallets();
    const connectors = wallets.map(w => new AptosWalletXConnector(w));
    service.setXConnectors(connectors);
    getStore().setXConnectors('APTOS', connectors);
  },
}),
```

### Provider-managed chain

```typescript
APTOS: defineChain({
  createService: () => AptosXService.getInstance(),
  displayName: 'Aptos',
  defaultConnectors: () => [],   // ignored — connectors come from the React adapter
  providerManaged: true,
  // No createActions / createWalletProvider — the Hydrator handles both.
}),
```

---

## Step 7 — provider-managed only — Provider/Hydrator/Actions trio

Skip this step for `providerManaged: false`.

Create `packages/wallet-sdk-react/src/providers/aptos/`:

```
aptos/
├── AptosProvider.tsx          # Wraps native React adapter
├── AptosHydrator.tsx          # Sole writer of connection state + walletProviders
├── AptosActions.tsx           # Registers ChainActions (connect/disconnect/signMessage)
├── AptosHydrator.test.tsx
└── index.ts
```

### `<AptosProvider>`

Wraps the chain's native React provider:

```tsx
import { type ReactNode } from 'react';
import { AptosProvider as NativeProvider } from 'aptos-adapter-react';
import { AptosHydrator } from './AptosHydrator.js';
import { AptosActions } from './AptosActions.js';
import type { AptosTypeConfig } from '@/types/config.js';

type AptosProviderProps = {
  children: ReactNode;
  config: AptosTypeConfig;
};

export const AptosProvider = ({ children, config }: AptosProviderProps) => (
  <NativeProvider network={config.network ?? 'mainnet'} autoConnect={config.autoConnect ?? true}>
    <AptosHydrator />
    <AptosActions />
    {children}
  </NativeProvider>
);
```

### `<AptosHydrator>`

Sole writer. Subscribes to native SDK hooks; writes through `setXConnection` / `setWalletProvider`. **Never** writes inside an event handler — only inside `useEffect` reactions to native state.

```typescript
import { useAccount } from 'aptos-adapter-react';

export const AptosHydrator = () => {
  const { address, status, connector } = useAccount();
  const setXConnection = useXWalletStore(s => s.setXConnection);
  const unsetXConnection = useXWalletStore(s => s.unsetXConnection);

  useEffect(() => {
    if (status === 'connected' && address) {
      setXConnection('APTOS', { xAccount: { address, xChainType: 'APTOS' }, xConnectorId: connector.id });
    } else if (status === 'disconnected') {
      unsetXConnection('APTOS');
    }
  }, [address, status, connector]);

  // ... build wallet provider similarly via useMemo + setWalletProvider

  return null;
};
```

### `<AptosActions>`

Registers `ChainActions` using **refs** to native SDK functions, so the registered closures always call the latest function without re-registering:

```typescript
const connectRef = useRef(connectAsync);
useEffect(() => { connectRef.current = connectAsync; }, [connectAsync]);

useEffect(() => {
  registerChainActions('APTOS', {
    connect: async (id) => connectRef.current({ connector: id }),
    disconnect: async () => disconnectRef.current(),
    // ...
  });
}, []); // empty deps — register once

return null;
```

### Mount in `SodaxWalletProvider.tsx`

```tsx
{frozen.APTOS && (
  <AptosProvider config={frozen.APTOS}>
    {content}
  </AptosProvider>
)}
```

---

## Step 8 — barrel surface (`src/index.ts`)

**Do NOT** add `export * from './xchains/aptos'` to the root `src/index.ts`. Concrete classes stay behind sub-path imports.

If consumers need a **type** from the barrel for type-only ergonomics, add an explicit `export type` line:

```typescript
// src/index.ts
export type { AptosWalletAddressType } from './xchains/aptos/index.js';
```

This keeps runtime classes off the barrel but lets consumers `import type { AptosWalletAddressType } from '@sodax/wallet-sdk-react'` without going through the deep import for a type-only reference.

See [`SUB_PATH_EXPORTS.md`](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/SUB_PATH_EXPORTS.md) for why concrete classes are deep-imported.

---

## Step 9 — tests

Required test surface per `vitest.config.ts`:

- `AptosXConnector.test.ts` — connector constructor, `connect/disconnect`, `isInstalled`/`installUrl` window probes
- `AptosXService.test.ts` (or co-located) — singleton behavior, balance reads
- `AptosWalletProvider.test.ts` (in wallet-sdk-core) — config variants, defaults merge, core method dispatch
- `AptosHydrator.test.tsx` (provider-managed only) — fake adapter state → assert store writes

Pattern reference: [`EvmHydrator.test.tsx`](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/src/providers/evm/EvmHydrator.test.tsx).

---

## Verification checklist

Before opening a PR, walk through each item:

- [ ] `pnpm checkTs` passes — `SodaxWalletConfig.APTOS` is recognized; `useWalletProvider({ xChainType: 'APTOS' })` returns the right type.
- [ ] `pnpm test` passes for new files.
- [ ] `pnpm build:packages` produces `dist/xchains/aptos/index.{mjs,d.ts}`.
- [ ] `import { AptosXService } from '@sodax/wallet-sdk-react/xchains/aptos'` resolves in a consumer app.
- [ ] `import { AptosXService } from '@sodax/wallet-sdk-react'` is **not** available (intentional — concrete classes stay behind deep imports).
- [ ] Adding `APTOS: {}` to `SodaxWalletConfig` mounts the chain; omitting the slot skips it.
- [ ] `useEnabledChains()` includes `'APTOS'` only when the slot is present.
- [ ] Connect → disconnect cycle updates `xConnections.APTOS` correctly; `localStorage` persists.
- [ ] On reload, `cleanupDisabledConnections` removes `xConnections.APTOS` if the slot is later removed.
- [ ] Documentation: add an entry to the connector reference in [`CONNECTORS.md`](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/CONNECTORS.md) and the chain-type tables in [`CONFIGURE_PROVIDER.md`](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/CONFIGURE_PROVIDER.md).

---

## Related docs

- [Architecture](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/ARCHITECTURE.md) — store + registry + Hydrator pattern
- [Sub-path Exports](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/SUB_PATH_EXPORTS.md) — barrel vs deep-import boundary
- [Configure SodaxWalletProvider](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/CONFIGURE_PROVIDER.md) — config schema (auto-extends from `ChainMeta`)
- [Connectors](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/CONNECTORS.md) — IXConnector contract + sub-path map
- [`packages/wallet-sdk-core/CLAUDE.md`](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-core/CLAUDE.md) — wallet provider class patterns
- [`packages/types/CLAUDE.md`](https://github.com/icon-project/sodax-sdks/blob/main/packages/types/CLAUDE.md) — interface conventions
