# Architecture — Mental Model

This file explains **why** `@sodax/wallet-sdk-core` is shaped the way it is. Read it once before applying recipes — knowing the model lets you handle ambiguous user code without guessing.

If you are looking for "how do I do X", go to [`recipes/`](./recipes/) or [`features/`](./features/). This file is purely conceptual.

---

## The shape of the package

`@sodax/wallet-sdk-core` is a **uniform low-level wallet layer over heterogeneous chain SDKs**. For each of the 9 chain families that SODAX supports, the package ships:

1. A `*WalletProvider` **class** that implements a chain-specific interface (`IEvmWalletProvider`, `ISolanaWalletProvider`, …) imported from `@sodax/types`.
2. A discriminated-union **config type** (`*WalletConfig = PrivateKey* | BrowserExtension*`).
3. A `*WalletDefaults` type — the per-method default option shape merged into each call.

Each provider class extends a small abstract `BaseWalletProvider<TDefaults>`. That base holds the `defaults` reference and exposes two helpers:

- `mergePolicy(key, options)` — shallow-merges per-call options over `defaults[key]`. Used when defaults are grouped per method (e.g. `defaults.sendTransaction`).
- `mergeDefaults(options)` — shallow-merges per-call options over the entire flat `defaults`. Used when defaults are not grouped.

Subclasses do three things on top:

1. Declare a `chainType` literal (`'EVM' as const`, `'BITCOIN' as const`, …).
2. Discriminate the config and initialize chain-specific state (viem client, Solana `Connection`, `SuiClient`, …).
3. Implement the chain-specific interface methods (`sendTransaction`, `signTransaction`, …).

Consumers only ever see the public surface: construct the class with one of the union variants, call its methods, and hand the instance to `@sodax/sdk` via its `IXxxWalletProvider` interface.

---

## File-system tour

```
src/
├── index.ts                          # Barrel: re-exports wallet-providers + types
├── types/
│   ├── index.ts                      # Re-exports library-exports
│   └── library-exports.ts            # Re-exported types (and a few enums) from upstream chain SDKs
├── utils/                            # Internal — shallowMerge; NOT re-exported
│   ├── index.ts
│   ├── merge.ts
│   └── merge.test.ts
└── wallet-providers/
    ├── index.ts                      # Barrel: re-exports every provider folder
    ├── BaseWalletProvider.ts         # Abstract base class
    ├── evm/
    │   ├── EvmWalletProvider.ts
    │   ├── EvmWalletProvider.test.ts
    │   ├── types.ts
    │   └── index.ts
    ├── solana/   { …same shape… }
    ├── sui/      { …same shape… }
    ├── bitcoin/  { …same shape… }
    ├── stellar/  { …same shape… }
    ├── icon/     { …same shape… }
    ├── injective/{ …same shape… }
    ├── near/     { …same shape… }
    └── stacks/   { …same shape… }
```

Three things to internalize:

1. **The package root is the only public surface.** `src/utils/*` is internal — `shallowMerge` etc. are deliberately not re-exported.
2. **Each chain is folder-isolated.** Adding a new chain means creating a folder under `src/wallet-providers/<chain>/` and listing it in `wallet-providers/index.ts`. Nothing else changes.
3. **`types/library-exports.ts` is the indirection point** between upstream chain SDKs and consumers. Re-exporting from here means consumer apps don't need direct deps on `viem`, `@mysten/sui`, etc. for type-only usage.

---

## `BaseWalletProvider` and the `defaults` model

```ts
abstract class BaseWalletProvider<TDefaults extends object> {
  protected readonly defaults: TDefaults;

  constructor(defaults: TDefaults | undefined) {
    this.defaults = (defaults ?? {}) as TDefaults;
  }

  abstract getWalletAddress(): Promise<string>;

  protected mergePolicy<K extends keyof TDefaults>(key: K, options?: …): … { /* shallowMerge */ }
  protected mergeDefaults(options?: Partial<TDefaults>): TDefaults { /* shallowMerge */ }
}
```

Three rules govern the `defaults` model:

1. **Every field of `TDefaults` is optional.** The constructor falls back to `{}` if the consumer omits `defaults` entirely. Required fields would silently arrive as `undefined` at runtime without TypeScript catching it — see the JSDoc comment in `BaseWalletProvider.ts`.
2. **Merge is shallow.** Top-level keys merge; nested objects are **replaced wholesale**. If `defaults.sendTransaction = { gas: 3_000_000n, nonce: 0 }` and the caller passes `{ gas: 5_000_000n }`, the merged policy is `{ gas: 5_000_000n }` — `nonce` is dropped. See `src/utils/merge.ts`. The behaviour is intentional: deep merge would silently smuggle stale fields across call sites.
3. **`undefined` layers and `undefined` values are skipped.** Passing `{ field: undefined }` does **not** override an earlier layer — the merge treats `undefined` as "no opinion".

Two helpers exist because chains group their defaults differently:

- **Per-method grouping** — `mergePolicy('sendTransaction', options)` looks up `defaults.sendTransaction` and merges `options` over it. Used by EVM (`sendTransaction`, `waitForTransactionReceipt`), Sui (`signAndExecuteTxn`, `getCoins`).
- **Flat grouping** — `mergeDefaults(options)` merges `options` over the whole `defaults` object. Used by chains whose `defaults` is a flat record (Bitcoin's `{ defaultFinalize }`, Stellar's `{ pollInterval, pollTimeout, networkPassphrase }`).

For a concrete worked example see [`recipes/defaults-and-overrides.md`](./recipes/defaults-and-overrides.md).

---

## Discriminant variants

Every chain supports two construction modes — but the discriminant **looks different per chain**. The rule of thumb:

| Discriminant style | Chains | Example |
|---|---|---|
| **Field presence** (no `type` field) | EVM, Solana, Sui, ICON, Injective, NEAR, Stacks | EVM: `privateKey + chainId` → private-key. `walletClient + publicClient` → browser-extension. |
| **Explicit uppercase `type`** | Bitcoin, Stellar | `{ type: 'PRIVATE_KEY', … }` vs `{ type: 'BROWSER_EXTENSION', … }` |

Why the inconsistency: the field-presence form is shorter for the common case but only works when the two variants share **zero** required-field overlap. Bitcoin and Stellar have shared required fields (`network`, `walletsKit` shapes that overlap with PK fields) that would make field presence ambiguous, so they use explicit `type`.

Two more wrinkles to know about:

- **Sui uses `mnemonics`, not `privateKey`.** The library derives an Ed25519 keypair from the mnemonic phrase. There is no raw-secret-key option.
- **Injective uses a nested `secret` object.** Because Injective can be constructed from **either** a private key **or** a BIP-39 mnemonic, the private-key variant nests credentials under `secret: { privateKey } | { mnemonics }` instead of placing them at the top level. The type is named `SecretInjectiveWalletConfig` (not `PrivateKey*`) to reflect this.

For chain-by-chain breakdowns see [`features/`](./features/).

---

## `library-exports` — the upstream-SDK indirection

`src/types/library-exports.ts` re-exports a curated set of types (and a few runtime values) from each upstream chain SDK:

```ts
// viem types
export type { Account, Address, Chain, Transport, PublicClient, WalletClient,
              HttpTransportConfig, PublicClientConfig, WalletClientConfig,
              SendTransactionParameters, WaitForTransactionReceiptParameters,
              TransactionReceipt } from 'viem';

// Sui types
export type { Transaction, TransactionArgument } from '@mysten/sui/transactions';

// Solana types
export type { Commitment, ConnectionConfig, SendOptions } from '@solana/web3.js';

// Injective types
export type { Network } from '@injectivelabs/networks';
export type { ChainId, EvmChainId } from '@injectivelabs/ts-types';
export type { MsgBroadcaster } from '@injectivelabs/wallet-core';

// Stellar (also re-exports the `Networks` runtime value)
export { Networks } from '@stellar/stellar-sdk';

// Stacks (also re-exports the `PostConditionMode` enum)
export { PostConditionMode } from '@sodax/libs/stacks/core';
export type { ClarityValue, PostConditionModeName } from '@sodax/libs/stacks/core';
export type { StacksNetwork } from '@sodax/libs/stacks/core';
export type { StacksProvider } from '@sodax/libs/stacks/connect';

// Near
export type { KeyPairString } from 'near-api-js';
export type { NearConnector } from '@hot-labs/near-connect';

// Bitcoin
export type { Network as BitcoinJsNetwork } from 'bitcoinjs-lib/src/networks.js';
```

Consumers can import the types they need directly from `@sodax/wallet-sdk-core` instead of adding `viem`, `@mysten/sui`, etc. to their `package.json`:

```ts
import type { WalletClient, PublicClient, TransactionReceipt } from '@sodax/wallet-sdk-core';
```

Note the file name: `library-exports`, not `library-types`. It deliberately re-exports a small number of **runtime** values (`Networks`, `PostConditionMode`) — hence the broader name.

For the typical reasons to use it (and when not to), see [`recipes/library-exports.md`](./recipes/library-exports.md).

---

## The `IXxxWalletProvider` interface — your handoff to `@sodax/sdk`

Each provider class implements a chain-specific interface from `@sodax/types`:

```ts
class EvmWalletProvider extends BaseWalletProvider<EvmWalletDefaults> implements IEvmWalletProvider { … }
class BitcoinWalletProvider extends BaseWalletProvider<BitcoinWalletDefaults> implements IBitcoinWalletProvider { … }
// …and so on
```

When you call `@sodax/sdk` methods, the SDK expects the **interface**, not the concrete class:

```ts
import type { IEvmWalletProvider } from '@sodax/types';

async function deposit(evmProvider: IEvmWalletProvider) { /* … */ }

const evm = new EvmWalletProvider({ … });
await deposit(evm);  // ✅ EvmWalletProvider implements IEvmWalletProvider
```

This indirection is how the SDK stays decoupled from `wallet-sdk-core`. In a React app, `useWalletProvider({ xChainId })` from `@sodax/wallet-sdk-react` returns the interface directly — the React layer constructs the concrete class internally.

For the full interface signatures, see [`reference/interfaces.md`](./reference/interfaces.md).

---

## Things that look weird until you know why

- **`InjectiveWalletConfig` is `BrowserExtensionInjectiveWalletConfig | SecretInjectiveWalletConfig`** — note the `Secret*` (not `PrivateKey*`) name. It also accepts mnemonics, hence the broader name. See [`features/injective.md`](./features/injective.md).
- **EVM in browser-extension mode ignores `defaults.transport`, `defaults.publicClient`, and `defaults.walletClient`.** Because the consumer supplied pre-built clients, these defaults are no-ops — the provider logs a one-time `console.warn`. Pass them only in private-key mode. See `EvmWalletProvider.ts`.
- **HyperEVM is defined inside this package.** `viem/chains` does not ship a HyperEVM config, so `wallet-providers/evm/EvmWalletProvider.ts` exports a `hyper` chain object via `defineChain`. You shouldn't need to import it directly — `getEvmViemChain(ChainKeys.HYPEREVM_MAINNET)` returns it.
- **`getEvmViemChain(key)` is exhaustively typed.** The default branch is a `never`-assertion — if `@sodax/types` adds a new `EvmChainKey` value, this function fails to typecheck until the case is added. That's by design.
- **Sui browser-extension mode requires THREE objects** — `client`, `wallet`, and `account`. Many wallet adapters expose the first two but not the third. See [`features/sui.md`](./features/sui.md).
- **Stellar requires `rpcUrl` in both modes** (technically optional, but defaults to a public RPC). Use a private RPC for production.
- **Bitcoin in private-key mode also takes an optional `addressType`** (P2WPKH / P2TR / …), defaulting to the `P2WPKH` constant when omitted. Browser-extension mode has no `addressType` field — the address returned by the wallet kit already has whatever type the wallet uses.

Everything else is covered by [`features/`](./features/) on a per-chain basis.
