# Connectors

A connector is the adapter between a specific wallet (Hana, MetaMask, Phantom, Xverse…) and the SODAX store. Every connector implements `IXConnector`, the public contract every hook in `wallet-sdk-react` consumes. The base abstract class `XConnector` provides default `isInstalled` / `installUrl` semantics that subclasses override per wallet.

Concrete connector and service classes are **not** exported from the package barrel — they live behind sub-path imports under `@sodax/wallet-sdk-react/xchains/<chain>` to prevent accidental coupling.

## Table of contents

1. [`IXConnector` interface](#ixconnector-interface)
2. [`XConnector` abstract base](#xconnector-abstract-base)
3. [Sub-path imports — concrete classes](#sub-path-imports--concrete-classes)
4. [Per-chain connector reference](#per-chain-connector-reference)
5. [Discovery — EIP-6963 vs adapter vs window probe](#discovery--eip-6963-vs-adapter-vs-window-probe)
6. [`sortConnectors` — display ordering](#sortconnectors--display-ordering)
7. [Custom connectors](#custom-connectors)

---

## `IXConnector` interface

Defined in [`src/types/interfaces.ts`](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/src/types/interfaces.ts):

```typescript
export interface IXConnector {
  readonly xChainType: ChainType;
  readonly name: string;            // 'Hana', 'MetaMask', 'Xverse', …
  readonly _id: string;             // unique connector id (e.g. 'io.metamask')
  readonly _icon?: string;          // raw icon URL (or undefined)

  readonly id: string;              // public getter — same as _id
  readonly icon: string | undefined; // public getter

  readonly isInstalled: boolean;    // wallet extension presence (read at getter call time)
  readonly installUrl: string | undefined;

  connect(): Promise<XAccount | undefined>;
  disconnect(): Promise<void>;
}
```

Code that reads connectors — hook results, component props — should type against **`IXConnector`** rather than a concrete class, which keeps it chain-implementation-agnostic. Connectors you author and pass to `SodaxWalletConfig` must extend the `XConnector` base class; see [Custom connectors](#custom-connectors).

`isInstalled` reads `window.*` at getter-call time — no extra subscription is installed. Components get fresh values through normal React render triggers (store updates, parent re-renders).

---

## `XConnector` abstract base

The default class subclasses extend ([`src/core/XConnector.ts`](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/src/core/XConnector.ts)):

```typescript
export abstract class XConnector implements IXConnector {
  public readonly xChainType: ChainType;
  public readonly name: string;
  public readonly _id: string;
  public readonly _icon?: string;

  constructor(xChainType: ChainType, name: string, id: string) { ... }

  abstract connect(): Promise<XAccount | undefined>;
  abstract disconnect(): Promise<void>;

  get id(): string { return this._id; }
  get icon(): string | undefined { return this._icon; }

  /** Default: true. Override in subclasses backed by extension injection. */
  get isInstalled(): boolean { return true; }
  get installUrl(): string | undefined { return undefined; }
}
```

The `isInstalled = true` default is correct for **provider-managed chains** (EVM via EIP-6963, Solana via wallet-adapter discovery, Sui via dapp-kit) — if the connector exists in the store, the underlying extension was found by the native SDK.

Browser-extension chains (Bitcoin, ICON, Stacks) override `isInstalled` with a `window.unisat` / `window.hanaWallet` / `window.LeatherProvider` probe, plus an `installUrl` to point users to the Chrome Web Store entry.

---

## Sub-path imports — concrete classes

The package barrel `@sodax/wallet-sdk-react` deliberately omits concrete classes — only types/interfaces and hooks are exported. To get a concrete class for `instanceof` checks or chain-specific methods, deep-import:

```typescript
// ✅ Normal usage — barrel
import { useXConnect, useXAccount, type IXConnector } from '@sodax/wallet-sdk-react';

// ✅ Advanced — concrete class
import { XverseXConnector } from '@sodax/wallet-sdk-react/xchains/bitcoin';

if (connector instanceof XverseXConnector) {
  connector.setAddressPurpose('segwit'); // BtcWalletAddressType — 'taproot' | 'segwit'
}
```

`setAddressPurpose` maps `'taproot'` to sats-connect's `AddressPurpose.Ordinals` and `'segwit'` to `AddressPurpose.Payment`, and persists the choice to localStorage — the connector reads it back on construction, so switching takes effect on the next connect.

The `package.json` `exports` field maps `./xchains/*` to `./dist/xchains/*/index.d.ts` (`types`) and `./dist/xchains/*/index.mjs` (`import`); `typesVersions` adds the legacy node10 resolution fallback. The package is ESM-only — there is no `require` condition and no `.cjs` output.

### Sub-path map

| Sub-path | Exports |
|----------|---------|
| `@sodax/wallet-sdk-react/xchains/evm` | `EvmXService`, `EvmXConnector`, `createWagmiConfig` (alias `createWagmi`) |
| `@sodax/wallet-sdk-react/xchains/solana` | `SolanaXService`, `SolanaXConnector` |
| `@sodax/wallet-sdk-react/xchains/sui` | `SuiXService`, `SuiXConnector` |
| `@sodax/wallet-sdk-react/xchains/bitcoin` | `BitcoinXService`, `BitcoinXConnector`, `UnisatXConnector`, `XverseXConnector`, `OKXXConnector`, `BitcoinHanaXConnector`, `useBitcoinXConnectors`, type `BtcWalletAddressType` |
| `@sodax/wallet-sdk-react/xchains/stellar` | `StellarXService`, `StellarWalletsKitXConnector` |
| `@sodax/wallet-sdk-react/xchains/injective` | `InjectiveXService`, `InjectiveXConnector` |
| `@sodax/wallet-sdk-react/xchains/icon` | `IconXService`, `IconHanaXConnector`, `CHAIN_INFO`, `SupportedChainId` |
| `@sodax/wallet-sdk-react/xchains/near` | `NearXService`, `NearXConnector` |
| `@sodax/wallet-sdk-react/xchains/stacks` | `StacksXService`, `StacksXConnector`, `STACKS_PROVIDERS`, `useStacksXConnectors`, type `StacksProviderConfig` |

None of these are re-exported from the barrel, not even as types — `import type { XverseXConnector } from '@sodax/wallet-sdk-react'` fails to resolve. A type-only reference comes from the same sub-path as the runtime class. `BtcWalletAddressType` originates in `@sodax/types`, so it can also be imported from there.

---

## Per-chain connector reference

| Chain | Connector class(es) | Discovery | Native SDK |
|-------|---------------------|-----------|------------|
| EVM | `EvmXConnector` | EIP-6963 + wagmi connectors | `wagmi` + `viem` |
| Solana | `SolanaXConnector` | `@solana/wallet-adapter-react` | `@solana/web3.js` |
| Sui | `SuiXConnector` | `@mysten/dapp-kit-react` | `@mysten/sui` |
| Stellar | `StellarWalletsKitXConnector` | async — `walletsKit.getSupportedWallets()` | `@creit.tech/stellar-wallets-kit` |
| Injective | `InjectiveXConnector` × 3 (MetaMask, Keplr, Leap) | wallet-base wallet types | `@injectivelabs/sdk-ts` |
| ICON | `IconHanaXConnector` | `window.hanaWallet` probe | `icon-sdk-js` |
| Bitcoin | `UnisatXConnector`, `XverseXConnector`, `OKXXConnector`, `BitcoinHanaXConnector` | `window.unisat`, `window.BitcoinProvider`, `window.okxwallet.bitcoin`, `window.hanaWallet.bitcoin` | `sats-connect` (Xverse, Hana), connector-specific (Unisat, OKX) |
| NEAR | `NearXConnector` | `@hot-labs/near-connect` | `near-api-js` |
| Stacks | `StacksXConnector` × N (one per registered provider) | provider list + `window.LeatherProvider` probe | `@stacks/connect` |

The `BitcoinXConnector` is an abstract base declaring `connect`, `disconnect`, `getWalletProvider` and `recreateWalletProvider`; the concrete subclasses (Unisat, Xverse, OKX, Hana) implement those four plus the `isInstalled` / `installUrl` / `icon` overrides. The message-signing methods `signEcdsaMessage` / `signBip322Message` are defined on the `IBitcoinWalletProvider` implementations that live in the same files (`UnisatWalletProvider`, `XverseWalletProvider`, `OKXWalletProvider`, `BitcoinHanaWalletProvider`) and are handed out through `getWalletProvider()` / `recreateWalletProvider()`. `chainRegistry`'s Bitcoin `signMessage` resolves that provider first and runs its `hasSignBip322` / `hasSignEcdsa` checks against it, so a connector must hand out a provider carrying those methods for the dispatch to succeed — putting them on the connector has no effect. See [`SIGN_MESSAGE.md`](./SIGN_MESSAGE.md) for the dispatch logic.

---

## Discovery — EIP-6963 vs adapter vs window probe

Connectors land in the store via three discovery patterns:

**Synchronous default list** (most chains) — `chainRegistry.<CHAIN>.defaultConnectors()` returns a static array at `initChainServices()` time. Bitcoin always registers Unisat + Xverse + OKX + Hana; Injective registers MetaMask + Keplr + Leap.

**Async discovery** — Stellar's connectors come from `walletsKit.getSupportedWallets()` which probes for installed Stellar wallets at runtime. Implemented via `chainRegistry.STELLAR.discoverConnectors`, called as a side-effect during init.

**Native SDK adapter** — EVM, Solana, Sui delegate to wagmi / wallet-adapter / dapp-kit. The adapter discovers wallets via EIP-6963 announcements (EVM) or vendor-specific extension protocols, and the chain's Hydrator reads the discovered list and writes it to the store.

Once in the store, all three patterns surface uniformly through `useXConnectors({ xChainType })` — consumers can't tell them apart.

---

## `sortConnectors` — display ordering

Pure utility for ranking connectors in lists. Stable sort by:

1. Position in `preferred[]` (earlier wins)
2. `isInstalled === true`
3. Original index

```typescript
import { useXConnectors, sortConnectors } from '@sodax/wallet-sdk-react';

const PREFERRED = ['hana', 'metamask'];

function ConnectorList() {
  const raw = useXConnectors({ xChainType: 'EVM' });
  const sorted = sortConnectors(raw, { preferred: PREFERRED });
  // Hana first if present, then MetaMask, then any other installed wallets, then uninstalled.
}
```

`preferred` matches by exact `connector.id`. For substring/case-insensitive matching across chains (matches the batch-operation API), use [`useIsWalletInstalled`](./CHAIN_DETECTION.md#useiswalletinstalled--install-detection) instead.

---

## Custom connectors

A connector passed to the SDK must extend the abstract `XConnector` class. `chainRegistry` narrows the `connectors` override with an `instanceof XConnector` check and drops every entry that only implements `IXConnector` structurally, logging `[chainRegistry] <CHAIN> connector "<id>" must extend XConnector — skipping.` for each. `IXConnector` is the type the config and hook signatures are written against, not an implementation contract for registry connectors.

```typescript
import { XConnector } from '@sodax/wallet-sdk-react'; // base class is exported from barrel
import type { XAccount } from '@sodax/wallet-sdk-react';

class MyIconConnector extends XConnector {
  constructor() {
    super('ICON', 'My Wallet', 'com.mycompany.wallet');
  }

  override get isInstalled(): boolean {
    return typeof window !== 'undefined' && 'mywallet' in window;
  }

  override get installUrl(): string {
    return 'https://chrome.google.com/webstore/detail/...';
  }

  async connect(): Promise<XAccount | undefined> {
    const address = await window.mywallet.requestAddress();
    return address ? { address, xChainType: 'ICON' } : undefined;
  }

  async disconnect(): Promise<void> {
    await window.mywallet.disconnect();
  }
}
```

Pass it via `SodaxWalletConfig.<CHAIN>.connectors`:

```typescript
const config: SodaxWalletConfig = {
  ICON: {
    connectors: [new MyIconConnector(), /* …or omit and the registry's defaults run instead */],
  },
};
```

The `connectors` field is read only for the chain types the SDK does not manage through a native SDK provider — Bitcoin, Injective, Stellar, ICON, NEAR and Stacks. For those it **replaces** the registry defaults for that chain, so include the SDK's defaults in the array if you want them alongside your custom one.

EVM, Solana and Sui are provider-managed and ignore the field: `createChainServices` skips the override branch for them, and each chain's Hydrator overwrites the store's connector list from wagmi / wallet-adapter / dapp-kit, so a connector passed there never reaches `useXConnectors`. Register an EVM wallet through wagmi instead — the `walletConnect` slot field, a custom wagmi connector, or `privy` for Privy email login ([`WALLET_PRIVY.md`](./WALLET_PRIVY.md)). A connector's `isAuthorized()` decides whether wagmi restores it on reload: it must never throw (wagmi does not catch it) and must answer quickly without waiting on a slow SDK.

Bitcoin adds a second class gate: `useBitcoinXConnectors`, the registry's `signMessage`, and its wallet-provider lookup all narrow with `instanceof BitcoinXConnector`, so a Bitcoin connector must extend that subclass. Once that gate passes, `chainRegistry` resolves the connector's `IBitcoinWalletProvider` — `getWalletProvider()`, falling back to `recreateWalletProvider(xAccount)` — picks the signing scheme by address type, and runs the `hasSignBip322` / `hasSignEcdsa` boolean checks against **that provider**. A custom connector therefore has to return a provider implementing `signBip322Message` and `signEcdsaMessage`; defining them on the connector itself is never consulted.

---

## Related docs

- [Configure SodaxWalletProvider](./CONFIGURE_PROVIDER.md) — `connectors` slot field for overriding defaults
- [Connect Flow](./CONNECT_FLOW.md) — how `useXConnectors` returns these connectors
- [Sign Message](./SIGN_MESSAGE.md) — Bitcoin connector subclass dispatch (BIP-322 vs ECDSA)
- [Batch Operations](./BATCH_OPERATIONS.md) — identifier-based connector matching
- [Wallet Modal](./WALLET_MODAL.md) — `selectWallet(connector)` consumes `XConnector`
- [SDK Wallet Providers Reference](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/WALLET_PROVIDERS.md) — the `IXxxWalletProvider` interfaces these connectors back into
