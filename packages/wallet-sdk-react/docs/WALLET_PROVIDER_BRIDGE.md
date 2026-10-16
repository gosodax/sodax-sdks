# Wallet Provider Bridge

`@sodax/wallet-sdk-react` is the bridge between the connected browser wallet and the chain-agnostic SDK call surface in `@sodax/sdk`. After a user connects a wallet, `useWalletProvider` returns a typed `IXxxWalletProvider` (from `@sodax/types`) that you pass directly into any SDK method — the SDK signs and broadcasts via that provider.

The canonical interfaces (`IEvmWalletProvider`, `ISolanaWalletProvider`, …) are defined in [`@sodax/types`](https://github.com/icon-project/sodax-sdks/blob/main/packages/types/src/wallet/providers.ts) and re-exported by [`@sodax/sdk`](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/src/index.ts) via `export * from '@sodax/types'` — import them from either package. `@sodax/wallet-sdk-core` exports the concrete provider classes (`EvmWalletProvider`, `SolanaWalletProvider`, …), not the interfaces.

## Table of contents

1. [Why a bridge layer](#why-a-bridge-layer)
2. [`useWalletProvider` — typed provider for one chain](#usewalletprovider--typed-provider-for-one-chain)
3. [End-to-end example](#end-to-end-example)
4. [Service hooks (`useXService` / `useXServices`)](#service-hooks-usexservice--usexservices)
5. [How wallet providers are populated](#how-wallet-providers-are-populated)
6. [Disabled chains return `undefined`](#disabled-chains-return-undefined)
7. [Bypassing the bridge — when to skip `useWalletProvider`](#bypassing-the-bridge--when-to-skip-usewalletprovider)

---

## Why a bridge layer

`@sodax/sdk` is wallet-library-agnostic — it accepts any object implementing the per-chain `IXxxWalletProvider` interface (see [`packages/sdk/docs/WALLET_PROVIDERS.md`](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/WALLET_PROVIDERS.md)). The implementation can come from:

- **Browser dApp** — `@sodax/wallet-sdk-react` Hydrators wrap `wagmi` / `@solana/wallet-adapter` / `@mysten/dapp-kit-react` etc. into provider instances and store them in the Zustand store. `useWalletProvider` reads them out.
- **Server / script / bot** — `@sodax/wallet-sdk-core` exposes the same provider classes (`EvmWalletProvider`, `SolanaWalletProvider`, …) constructed directly from a private key. No React, no wallet-sdk-react.

`useWalletProvider` is the React-side bridge. It hides the per-chain construction details and gives you a typed handle that fits the SDK call slot exactly:

```typescript
// SDK call shape (signed mode)
sodax.swaps.swap({
  params: { srcChainKey: ChainKeys.BSC_MAINNET, /* ... */ },
  walletProvider, // must satisfy IEvmWalletProvider for BSC
});
```

`useWalletProvider({ xChainId: ChainKeys.BSC_MAINNET })` returns exactly `IEvmWalletProvider | undefined` — TypeScript narrows the return type from the chain key.

---

## `useWalletProvider` — typed provider for one chain

Two overloads, mutually exclusive: pass `xChainId` (a `SpokeChainKey`) **or** `xChainType` (a `ChainType`), never both.

### By chain id — narrowest typing

```typescript
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/types';

const walletProvider = useWalletProvider({ xChainId: ChainKeys.BSC_MAINNET });
// walletProvider: IEvmWalletProvider | undefined
```

The chain id (`BSC_MAINNET`, `SOLANA_MAINNET`, etc.) resolves to its family at compile time via `GetChainType<S>` and the return type is the matching `IXxxWalletProvider`.

### By chain type — family-level typing

```typescript
const evmProvider = useWalletProvider({ xChainType: 'EVM' });
// evmProvider: IEvmWalletProvider | undefined

const solProvider = useWalletProvider({ xChainType: 'SOLANA' });
// solProvider: ISolanaWalletProvider | undefined
```

Use this when the surrounding component is family-level (e.g. an EVM dashboard that doesn't care which specific EVM chain is active). For EVM specifically, one wagmi connection covers all configured EVM networks — the same provider is returned for every `xChainId` in the EVM family.

### No-arg form

```typescript
const wp = useWalletProvider();
// wp: IWalletProvider | undefined — TypeScript falls back to the full provider union
```

Both fields are optional but at least one must be set for the hook to return anything: with neither, the hook returns `undefined` on every render even though the static type stays wide. The same overload also accepts an `xChainType` that is itself `ChainType | undefined`, which is why the type cannot narrow — refine the result on the provider's `chainType` discriminant.

---

## End-to-end example

Connect once, then drive an SDK call with the resulting provider:

```tsx
import { useWalletProvider, useXAccount } from '@sodax/wallet-sdk-react';
import { useSodaxContext } from '@sodax/dapp-kit'; // or hold a Sodax instance directly
import { ChainKeys } from '@sodax/types';
import type { CreateIntentParams } from '@sodax/sdk';

function SwapButton({ params }: { params: CreateIntentParams<typeof ChainKeys.BSC_MAINNET> }) {
  const walletProvider = useWalletProvider({ xChainId: ChainKeys.BSC_MAINNET });
  const account = useXAccount({ xChainId: ChainKeys.BSC_MAINNET });
  const { sodax } = useSodaxContext();

  const handleSwap = async () => {
    if (!walletProvider) return;
    const result = await sodax.swaps.swap({
      params,
      walletProvider, // typed as IEvmWalletProvider — matches BSC src chain
    });
    if (!result.ok) {
      console.error('swap failed:', result.error);
      return;
    }
    console.log('swap submitted:', result.value);
  };

  return (
    <button onClick={handleSwap} disabled={!walletProvider || !account.address}>
      Swap
    </button>
  );
}
```

The same pattern works for every SDK feature service — `sodax.bridge.bridge`, `sodax.moneyMarket.supply`, `sodax.staking.stake`, `sodax.dex.assetService.deposit`, etc. (`sodax.dex` is a composition root exposing the `assetService` and `clService` sub-services rather than methods of its own.) See [`packages/sdk/docs/`](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/) for per-feature method signatures.

---

## Service hooks (`useXService` / `useXServices`)

Lower-level than `useWalletProvider` — these expose the chain's `XService` instance, used for:

- Reading per-chain balances (`xService.getBalance(address, xToken)`)
- Listing connectors (`xService.getXConnectors()`)
- Looking up a connector by id (`xService.getXConnectorById(id)`)
- Custom integrations against the `IXService` contract

```typescript
import { useXService, useXServices } from '@sodax/wallet-sdk-react';

const evmService = useXService({ xChainType: 'EVM' });
// evmService: XService | undefined — chain-specific instance (EvmXService)

const allServices = useXServices();
// allServices: Partial<Record<ChainType, XService>>
```

For typed access, depend on the public [`IXService`](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/src/types/interfaces.ts) interface rather than the concrete `XService` class. Concrete classes (`EvmXService`, `BitcoinXService`, …) are not exported from the package barrel; if you need a concrete class for `instanceof`, use the deep-import sub-path — see [`CONNECTORS.md`](./CONNECTORS.md).

---

## How wallet providers are populated

The store's `walletProviders` map is populated by two distinct mechanisms depending on chain type:

### Provider-managed chains (EVM, Solana, Sui)

The chain's **Hydrator** is the sole writer. It subscribes to the native SDK hooks (e.g. `useAccount` from wagmi) and writes a fresh `EvmWalletProvider` (from `@sodax/wallet-sdk-core`) into the store every time the underlying client changes:

```
wagmi connection observed  →  EvmHydrator constructs EvmWalletProvider({ walletClient, publicClient })
                                                      │
                                                      ↓
                                       store.walletProviders.EVM = provider
```

`useWalletProvider({ xChainType: 'EVM' })` reads that slot — no chain-specific switch case in user code.

### Non-provider chains (Bitcoin, ICON, Injective, Stellar, NEAR, Stacks)

The provider is created as a side-effect of `setXConnection()` inside the store. When `useXConnect` resolves a successful connection, the store's setter constructs the chain-specific provider (`BitcoinWalletProvider`, `IconWalletProvider`, …) and writes it to `walletProviders`.

In both cases, the bridge layer owns the construction — consumers never call `new EvmWalletProvider(...)` themselves in dApp code.

---

## Disabled chains return `undefined`

If `xChainType` resolves to a chain that isn't enabled in `SodaxWalletProvider` config, `useWalletProvider` returns `undefined` and logs a one-time warning per chain:

```
[useWalletProvider] chain "BITCOIN" is not enabled in SodaxWalletProvider config.chains — returning undefined
```

This is by design — `useWalletProvider` is meant to be called unconditionally inside components, and chains can be disabled without changing the call sites. Always null-check the return value:

```typescript
const walletProvider = useWalletProvider({ xChainId: ChainKeys.BITCOIN_MAINNET });
if (!walletProvider) return null; // chain disabled, or no wallet connected for that chain yet
```

The warning fires only once per chain per session — repeated disabled-chain reads don't spam the console.

---

## Bypassing the bridge — when to skip `useWalletProvider`

Skip the bridge in two cases:

**Server / Node.js scripts** — no React, no wallet-sdk-react. Use `@sodax/wallet-sdk-core` directly:

```typescript
import { Sodax } from '@sodax/sdk';
import { EvmWalletProvider } from '@sodax/wallet-sdk-core';
import { ChainKeys, type Hex } from '@sodax/types';

const privateKey = process.env.PRIVATE_KEY as Hex; // `0x…`

const sodax = new Sodax();
const walletProvider = new EvmWalletProvider({
  privateKey,
  chainId: ChainKeys.BSC_MAINNET,
  rpcUrl: 'https://bsc-dataseed.binance.org',
});
const result = await sodax.swaps.swap({ params: /* ... */, walletProvider });
```

**Raw transactions** — when you only need unsigned transaction data (for gas estimation, manual relay, or external signing). SDK methods that accept `raw: true` don't need a wallet provider:

```typescript
const result = await sodax.swaps.createIntent({
  params,
  raw: true, // no walletProvider — returns unsigned tx
});
```

See [`packages/sdk/docs/SWAPS.md`](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/SWAPS.md) for the full raw-vs-signed matrix per method.

---

## Related docs

- [Configure SodaxWalletProvider](./CONFIGURE_PROVIDER.md) — chain-type slots and per-chain wallet defaults
- [Connect Flow](./CONNECT_FLOW.md) — discover, connect, read, disconnect
- [Connectors](./CONNECTORS.md) — `IXConnector`, deep imports, custom connectors
- [SDK Wallet Providers Reference](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/WALLET_PROVIDERS.md) — `IXxxWalletProvider` interfaces, custom implementations
- [SDK Swaps](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/SWAPS.md) — example consumer of a wallet provider
- [`@sodax/wallet-sdk-core`](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-core/README.md) — Node-side provider construction
