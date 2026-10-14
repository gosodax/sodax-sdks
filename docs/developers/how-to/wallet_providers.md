---
title: "Wallet Providers"
icon: wallet
generatedFrom: packages/sdk/docs/WALLET_PROVIDERS.md
---

The SODAX SDK does not force you to use a specific wallet library. Instead, SDK calls accept an
`IWalletProvider` implementation that you supply — either by using the ready-made implementations
in `@sodax/wallet-sdk-core`, or by writing your own against the interface contracts in
`@sodax/sdk`.

## Table of Contents

1. [Supported provider interfaces](#1-supported-provider-interfaces)
2. [WalletProviderSlot: compile-time enforcement](#2-walletproviderslot-compile-time-enforcement)
3. [wallet-sdk-core: ready-to-use implementations](#3-wallet-sdk-core-ready-to-use-implementations)
   - [BaseWalletProvider](#basewalletprovider)
   - [chainType discriminant](#chaintype-discriminant)
   - [Dual config modes (private-key vs browser-extension)](#dual-config-modes-private-key-vs-browser-extension)
   - [Provider reference](#provider-reference)
4. [Config type reference per chain](#4-config-type-reference-per-chain)
5. [React integration: useWalletProvider](#5-react-integration-usewalletprovider)
6. [Custom implementations](#6-custom-implementations)

---

## 1. Supported provider interfaces

Every chain family has a named interface that `@sodax/sdk` exports:

| Interface | `chainType` literal | Chains covered |
|---|---|---|
| `IEvmWalletProvider` | `'EVM'` | Sonic (hub), Ethereum, Arbitrum, Base, BSC, Optimism, Polygon, Avalanche, HyperEVM, Lightlink, Redbelly, Kaia, Hedera, Robinhood |
| `ISolanaWalletProvider` | `'SOLANA'` | Solana |
| `ISuiWalletProvider` | `'SUI'` | Sui |
| `IIconWalletProvider` | `'ICON'` | ICON |
| `IInjectiveWalletProvider` | `'INJECTIVE'` | Injective |
| `IStellarWalletProvider` | `'STELLAR'` | Stellar |
| `IStacksWalletProvider` | `'STACKS'` | Stacks |
| `IBitcoinWalletProvider` | `'BITCOIN'` | Bitcoin |
| `INearWalletProvider` | `'NEAR'` | NEAR |

All interfaces extend `WalletAddressProvider` (from `@sodax/sdk`), which requires:

```ts
getWalletAddress(): Promise<string>;
```

The full union of all nine interfaces is `IWalletProvider`. `GetWalletProviderType<K>` maps a
chain key or `ChainType` literal to the appropriate specific interface.

---

## 2. WalletProviderSlot: compile-time enforcement

Every SDK method that executes a transaction uses `WalletProviderSlot<K, Raw>` (defined in
`packages/types/src/common/common.ts`) to enforce the pairing between `raw` mode and the presence
of a wallet provider at compile time:

```ts
export type WalletProviderSlot<K extends SpokeChainKey | ChainType, Raw extends boolean = false> =
  Raw extends true
    ? { raw: true; walletProvider?: never }
    : { raw?: false; walletProvider: GetWalletProviderType<K> };
```

Three rules enforced by TypeScript:

1. **`raw: true`** — `walletProvider` is forbidden (`?: never` makes any value a type error). The
   SDK returns an unsigned transaction payload (`TxReturnType<K, true>`, e.g. `EvmRawTransaction`).

2. **`raw: false` (or omitted)** — `walletProvider` is required and is chain-narrowed to the
   exact interface for `K` via `GetWalletProviderType<K>`. The SDK signs and broadcasts, returning
   a transaction hash (`TxReturnType<K, false>`, e.g. `Hash`).

3. **Chain narrowing flows from the chain key** — when the caller passes a literal chain key such
   as `ChainKeys.ETHEREUM_MAINNET`, TypeScript preserves that as a value type, resolving
   `GetWalletProviderType<typeof ChainKeys.ETHEREUM_MAINNET>` to `IEvmWalletProvider`
   automatically.

```ts
// Raw — walletProvider is a compile error if passed
const rawTx = await sodax.swaps.createIntent({ params, raw: true });

// Signed — walletProvider is required; passing an ISolanaWalletProvider here is a compile error
const result = await sodax.swaps.createIntent({
  params,
  raw: false,
  walletProvider: evmWalletProvider,   // must be IEvmWalletProvider
});
```

---

## 3. wallet-sdk-core: ready-to-use implementations

Install the package:

```bash
npm install @sodax/wallet-sdk-core
# or
yarn add @sodax/wallet-sdk-core
# or
pnpm add @sodax/wallet-sdk-core
```

The package is dependency-free from React and can be used directly in Node.js scripts, bots, and
server environments, as well as in browser dApps.

Each chain provider lives under `src/wallet-providers/<chain>/`:

```
wallet-providers/
├── BaseWalletProvider.ts      # Abstract base
├── evm/                       # EvmWalletProvider + types
├── solana/                    # SolanaWalletProvider + types
├── sui/                       # SuiWalletProvider + types
├── icon/                      # IconWalletProvider + types
├── injective/                 # InjectiveWalletProvider + types
├── stellar/                   # StellarWalletProvider + types
├── stacks/                    # StacksWalletProvider + types
├── bitcoin/                   # BitcoinWalletProvider + types
└── near/                      # NearWalletProvider + types
```

### BaseWalletProvider

All nine provider classes extend `BaseWalletProvider<TDefaults>`:

```ts
abstract class BaseWalletProvider<TDefaults extends object> {
  protected readonly defaults: TDefaults;

  abstract getWalletAddress(): Promise<string>;

  // Merge per-call options over defaults[key] (used for per-method defaults groups, e.g. EVM)
  protected mergePolicy<K extends keyof TDefaults>(key: K, options?: …): …

  // Merge per-call options over the entire defaults object (used for flat defaults, e.g. ICON)
  protected mergeDefaults(options?: Partial<TDefaults>): TDefaults
}
```

Subclass constructors call `super(config.defaults)`. Per-call overrides shallow-merge over the
stored defaults at invocation time — nested objects replace wholesale rather than deep-merging.

### chainType discriminant

Every `I*WalletProvider` interface declares `readonly chainType` as a string literal. This lets
both the SDK and application code discriminate at runtime without `instanceof`:

```ts
// Discriminate without instanceof
if (walletProvider.chainType === 'EVM') {
  // walletProvider is narrowed to IEvmWalletProvider
}
if (walletProvider.chainType === 'SOLANA') {
  // walletProvider is narrowed to ISolanaWalletProvider
}
```

Valid `chainType` values: `'EVM'`, `'BITCOIN'`, `'SOLANA'`, `'STELLAR'`, `'SUI'`, `'ICON'`,
`'INJECTIVE'`, `'STACKS'`, `'NEAR'`.

`packages/sdk/src/shared/guards.ts` also exposes named guards for the most common cases:

```ts
isEvmWalletProviderType(wp)      // IEvmWalletProvider
isStellarWalletProviderType(wp)  // IStellarWalletProvider
isBitcoinWalletProviderType(wp)  // IBitcoinWalletProvider
```

### Dual config modes (private-key vs browser-extension)

Every provider accepts a discriminated-union config: one variant for server-side/script usage
(private key) and one for dApp usage (pre-built client from a browser wallet). Discriminant
mechanism varies by chain:

| Mechanism | Chains |
|---|---|
| **Field presence** — `privateKey` field present vs. absent | EVM, ICON, Solana, Sui (uses `mnemonics`), NEAR |
| **Explicit `type` field** (`'PRIVATE_KEY'` / `'BROWSER_EXTENSION'`) | Bitcoin, Stellar |
| **`secret` nested object** (`{ privateKey }` or `{ mnemonics }`) vs. `msgBroadcaster` | Injective |
| **Field presence** — `privateKey` present vs. absent | Stacks |

All config types include an optional `defaults` field for per-method behavioral overrides.

### Provider reference

| Chain | Provider class | Native SDK | `chainType` |
|---|---|---|---|
| EVM | `EvmWalletProvider` | viem | `'EVM'` |
| Solana | `SolanaWalletProvider` | @solana/web3.js | `'SOLANA'` |
| Sui | `SuiWalletProvider` | @mysten/sui | `'SUI'` |
| ICON | `IconWalletProvider` | icon-sdk-js | `'ICON'` |
| Injective | `InjectiveWalletProvider` | @injectivelabs/sdk-ts | `'INJECTIVE'` |
| Stellar | `StellarWalletProvider` | @stellar/stellar-sdk | `'STELLAR'` |
| Stacks | `StacksWalletProvider` | @stacks/transactions | `'STACKS'` |
| Bitcoin | `BitcoinWalletProvider` | bitcoinjs-lib (PSBT) | `'BITCOIN'` |
| NEAR | `NearWalletProvider` | near-api-js | `'NEAR'` |

---

## 4. Config type reference per chain

### EVM (`EvmWalletProvider`)

```ts
// Private-key mode (scripts / bots)
new EvmWalletProvider({
  privateKey: '0x…',              // hex private key
  chainId: ChainKeys.ARBITRUM_MAINNET,
  rpcUrl: 'https://…',           // optional; falls back to viem default
  defaults?: EvmWalletDefaults,
});

// Browser-extension mode (dApps — wagmi supplies the clients)
new EvmWalletProvider({
  walletClient: viemWalletClient,  // WalletClient<Transport, Chain, Account>
  publicClient: viemPublicClient,
  defaults?: EvmWalletDefaults,
});
```

`EvmWalletDefaults` accepts: `sendTransaction`, `waitForTransactionReceipt`, `waitForCallsStatus`,
`publicClient`, `walletClient`, `transport` (all optional; applied per-call via `mergePolicy`).

In browser-extension mode the provider also implements the optional EIP-5792 methods
(`getAtomicBatchSupport`, `sendAtomicBatch`, `waitForBatch`) over viem's `getCapabilities`, `sendCalls`
(with `forceAtomic`) and `waitForCallsStatus`. A private-key account reports `'unsupported'`: a plain RPC
endpoint has no `wallet_sendCalls`. A `waitForBatch` timeout of `0` gives up at once rather than waiting forever.
A failed status read does not end the wait: `waitForBatch` reads again within the timeout, up to three reads in
all, where viem's own wait stops at the first error.

### Solana (`SolanaWalletProvider`)

```ts
// Private-key mode
new SolanaWalletProvider({
  privateKey: Uint8Array,   // raw keypair bytes
  endpoint: 'https://…',
  defaults?: SolanaWalletDefaults,
});

// Browser-extension mode
new SolanaWalletProvider({
  wallet: walletContextState,  // { publicKey, signTransaction }
  endpoint: 'https://…',
  defaults?: SolanaWalletDefaults,
});
```

`SolanaWalletDefaults` accepts: `connectionCommitment`, `connectionConfig`, `sendOptions`,
`confirmCommitment`.

### Sui (`SuiWalletProvider`)

```ts
// Private-key mode (mnemonic-derived)
new SuiWalletProvider({
  grpcUrl: 'https://fullnode.mainnet.sui.io',
  mnemonics: 'word1 word2 …',
  defaults?: SuiWalletDefaults,
});

// Browser-extension mode — the provider builds its own client; you supply the signer
new SuiWalletProvider({
  grpcUrl: 'https://fullnode.mainnet.sui.io',
  address: walletAccount.address,
  signTransaction: async txn =>
    dAppKit.signTransaction({ transaction: await txn.toJSON(), account: walletAccount }),
  defaults?: SuiWalletDefaults,
});
```

The endpoint must speak gRPC-web; `rpcUrl` still works as a deprecated alias for `grpcUrl`, and
the two are mutually exclusive. `signTransaction` takes the transaction positionally, so an
options-shaped signer such as `dAppKit.signTransaction` needs the wrapper above rather than a
direct assignment; `walletAccount` is dApp Kit's `UiWalletAccount`, and naming it stops the wallet
signing with whichever account happens to be connected.

`SuiWalletDefaults` accepts: `signAndExecuteTxn` (dry-run toggle), `getCoins` (pagination limit).

### ICON (`IconWalletProvider`)

```ts
// Private-key mode
new IconWalletProvider({
  privateKey: '0x…',
  rpcUrl: 'https://…',
  defaults?: IconWalletDefaults,
});

// Browser-extension mode (Hana Wallet)
new IconWalletProvider({
  walletAddress?: '0xhx…',   // optional pre-known address
  rpcUrl: 'https://…',
  defaults?: IconWalletDefaults,
});
```

`IconWalletDefaults` accepts: `stepLimit`, `version`, `timestampProvider`, `jsonRpcId`.

> **Note:** `rpcUrl` is typed as `` `http${string}` `` (template literal), not a bare `string`. EVM and Injective `rpcUrl` fields have the same constraint. If you pass a `string` from an environment variable, either narrow it explicitly (e.g. `process.env.RPC_URL as \`http${string}\``) or validate at the boundary.

### Injective (`InjectiveWalletProvider`)

```ts
// Private-key / mnemonic mode (credentials nested under `secret`)
new InjectiveWalletProvider({
  secret: { privateKey: '0x…' },   // OR { mnemonics: 'word1 word2 …' }
  chainId: ChainId.Mainnet,
  network: Network.Mainnet,
  defaults?: InjectiveWalletDefaults,
});

// Browser-extension mode
new InjectiveWalletProvider({
  msgBroadcaster: msgBroadcaster,   // MsgBroadcaster from @injectivelabs/wallet-core
  defaults?: InjectiveWalletDefaults,
});
```

`InjectiveWalletDefaults` accepts: `defaultFunds`, `defaultMemo`, `sequence`, `accountNumber`.

### Stellar (`StellarWalletProvider`)

```ts
// Private-key mode (explicit `type` field)
new StellarWalletProvider({
  type: 'PRIVATE_KEY',
  privateKey: 'S…',                // Stellar secret key (S-prefixed), typed as `Hex` string alias
  network: 'PUBLIC',               // or 'TESTNET'
  rpcUrl?: 'https://…',
  defaults?: StellarWalletDefaults,
});

// Browser-extension mode
new StellarWalletProvider({
  type: 'BROWSER_EXTENSION',
  walletsKit: stellarWalletsKit,   // StellarWalletsKit interface
  network: 'PUBLIC',
  rpcUrl?: 'https://…',
  defaults?: StellarWalletDefaults,
});
```

`StellarWalletDefaults` accepts: `pollInterval`, `pollTimeout`, `networkPassphrase`.

### Stacks (`StacksWalletProvider`)

```ts
// Private-key mode
new StacksWalletProvider({
  privateKey: 'string',
  endpoint?: 'https://…',
  defaults?: StacksWalletDefaults,
});

// Browser-extension mode
new StacksWalletProvider({
  address: 'string',
  endpoint?: 'https://…',
  provider?: stacksProvider,   // StacksProvider from @stacks/connect
  defaults?: StacksWalletDefaults,
});
```

`StacksWalletDefaults` accepts: `network` (`'mainnet'` | `'testnet'`), `postConditionMode`.

### Bitcoin (`BitcoinWalletProvider`)

```ts
// Private-key mode (explicit `type` field)
new BitcoinWalletProvider({
  type: 'PRIVATE_KEY',
  privateKey: '0x…',
  network: 'MAINNET',            // or 'TESTNET'
  addressType?: BtcAddressType,  // 'P2PKH' | 'P2SH' | 'P2WPKH' | 'P2TR'
  defaults?: BitcoinWalletDefaults,
});

// Browser-extension mode
new BitcoinWalletProvider({
  type: 'BROWSER_EXTENSION',
  walletsKit: bitcoinWalletsKit,  // BitcoinWalletsKit interface
  network: 'MAINNET',
  defaults?: BitcoinWalletDefaults,
});
```

`BitcoinWalletDefaults` accepts: `defaultFinalize` (whether to finalize PSBTs before returning).

### NEAR (`NearWalletProvider`)

```ts
// Private-key mode
new NearWalletProvider({
  rpcUrl: 'https://…',
  accountId: 'alice.near',
  privateKey: 'ed25519:…',
  defaults?: NearWalletDefaults,
});

// Browser-extension mode
new NearWalletProvider({
  wallet: nearConnector,   // NearConnector from @hot-labs/near-connect
  defaults?: NearWalletDefaults,
});
```

`NearWalletDefaults` accepts: `throwOnFailure`, `waitUntil`, `gasDefault`, `depositDefault`.

---

## 5. React integration: useWalletProvider

`packages/wallet-sdk-react` provides `useWalletProvider` — a hook that reads the chain-appropriate
provider from the Zustand store and returns it typed to the correct `I*WalletProvider` interface.

```ts
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/sdk';

// By chain key — return type is narrowed to IEvmWalletProvider | undefined
const walletProvider = useWalletProvider({ xChainId: ChainKeys.ETHEREUM_MAINNET });

// By chain type — return type is IEvmWalletProvider | undefined
const walletProvider = useWalletProvider({ xChainType: 'EVM' });
```

Pass `xChainId` **or** `xChainType`, never both — the hook asserts this at runtime and the
overloads enforce it at compile time.

The returned provider is ready to pass directly into any SDK call's `walletProvider` slot:

```ts
const result = await sodax.swaps.createIntent({
  params: { srcChainKey: ChainKeys.ETHEREUM_MAINNET, … },
  raw: false,
  walletProvider,   // typed as IEvmWalletProvider; compile error if chain mismatch
});
```

Wallet providers are populated into the store by:

- **Provider-managed chains (EVM, Solana, Sui)** — Hydrator components (`EvmHydrator`,
  `SolanaHydrator`, `SuiHydrator`) sync the native SDK state into the store as the sole writers.
- **Non-provider chains (Bitcoin, ICON, Injective, Stellar, NEAR, Stacks)** — providers are
  created as a side-effect of `setXConnection()` in the store, triggered when a user connects a
  wallet through `ChainActions`.

Configure which chains are active by passing a `config` prop to `SodaxWalletProvider`:

```ts
import { SodaxWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/sdk';

<SodaxWalletProvider config={{
  EVM: {
    chains: {
      [ChainKeys.ARBITRUM_MAINNET]: { rpcUrl: 'https://…' },
      [ChainKeys.BASE_MAINNET]:     { rpcUrl: 'https://…' },
    },
    // EVM adapter also supports:
    walletConnect: { projectId: 'YOUR_WC_PROJECT_ID' }, // enables WalletConnect-based wallets (Fireblocks, Ledger Live, etc.)
    ssr: true, // safe SSR hydration when rendering in Next.js
  },
  SOLANA: { chains: { [ChainKeys.SOLANA_MAINNET]: { rpcUrl: 'https://…' } } },
  BITCOIN: {},   // mount with SDK defaults
}}>
  {children}
</SodaxWalletProvider>
```

Omit a chain-type key entirely to skip mounting that adapter. `useWalletProvider` will return
`undefined` for disabled chains and emit a one-time console warning.

---

## 6. Custom implementations

You can implement the SDK interfaces directly without using `@sodax/wallet-sdk-core`. Each
interface is defined in `@sodax/sdk` (e.g. `IEvmWalletProvider` in `@sodax/sdk`):

```ts
import type {
  IEvmWalletProvider,
  EvmRawTransaction,
  EvmRawTransactionReceipt,
  EvmSendTransactionOptions,
} from '@sodax/sdk';
import type { Hash } from 'viem';

class MyCustomEvmProvider implements IEvmWalletProvider {
  readonly chainType = 'EVM' as const;   // required literal — used as runtime discriminant

  async getWalletAddress(): Promise<string> { … }
  async sendTransaction(tx: EvmRawTransaction, options?: EvmSendTransactionOptions): Promise<Hash> { … }
  async waitForTransactionReceipt(hash: Hash): Promise<EvmRawTransactionReceipt> { … }
}
```

Requirements for a valid custom implementation:

1. **Declare `readonly chainType = '<CHAIN>' as const`** — the SDK and `useWalletProvider` both
   read this field for runtime dispatch. The value must exactly match the `chainType` literal of
   the target interface.
2. **Implement every method on the interface** — TypeScript will flag missing methods at
   compile time.
3. **No base class required** — extending `BaseWalletProvider` is optional; it only provides the
   `defaults` storage and merge helpers from `@sodax/wallet-sdk-core`.
4. **EVM providers must honor `options.expectedChainId`** — refuse to broadcast when the wallet's
   active chain id differs; ignoring it silently disables the SDK's wrong-chain protection. A provider
   that already declares its own second options parameter must widen it to
   `YourOptions & EvmSendTransactionOptions` to keep satisfying the interface.
5. **EIP-5792 batch methods are optional** — `getAtomicBatchSupport`, `sendAtomicBatch` and
   `waitForBatch` let `sodax.swaps.swapWithApproval` and `sendApprovalBatch` (the swaps API lane) send
   approve + deposit as one atomic batch. Omit all three and the SDK falls back to separate transactions. Implement them only together:
   `getAtomicBatchSupport(chainId)` reports the wallet's `atomic` capability (`'supported'`, `'ready'`
   or `'unsupported'`), `sendAtomicBatch` must request atomic execution and send the batch for
   `options.expectedChainId` only, and `waitForBatch(batchId, { timeout })` resolves to the batch's receipts once
   it is terminal and throws if it is not by then. The SDK always passes a positive `timeout`, and reads the
   receipts as the batch's transaction when they all carry one hash (extra calls the wallet adds are fine), or —
   right after sending — as one per call in call order; any other shape is treated as unconfirmed.
