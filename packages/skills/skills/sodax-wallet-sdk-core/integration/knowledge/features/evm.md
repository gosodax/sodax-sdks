# EVM — `EvmWalletProvider`

Backed by [viem](https://viem.sh). One class covers **every** SODAX EVM spoke chain via `getEvmViemChain()` (see the table below).

| | |
|---|---|
| Class | `EvmWalletProvider` |
| Interface | `IEvmWalletProvider` (from `@sodax/types`) |
| Discriminant style | **Field presence** (no `type` field) |
| Underlying SDK | `viem` |
| Supported chains | Sonic (hub), Ethereum, Arbitrum, Base, BSC, Optimism, Polygon, Avalanche, HyperEVM, Lightlink, Redbelly, Kaia, Hedera, Monad |

---

## Config

```ts
type EvmWalletConfig = PrivateKeyEvmWalletConfig | BrowserExtensionEvmWalletConfig;

type PrivateKeyEvmWalletConfig = {
  privateKey: `0x${string}`;
  chainId: EvmChainKey;                // ChainKeys.SONIC_MAINNET, …
  rpcUrl?: `http${string}`;            // defaults to viem chain's first public RPC
  defaults?: EvmWalletDefaults;
};

type BrowserExtensionEvmWalletConfig = {
  walletClient: WalletClient<Transport, Chain, Account>; // pre-built by wagmi / consumer
  publicClient: PublicClient;
  defaults?: EvmWalletDefaults;
};
```

| Mode discriminant | How to detect |
|---|---|
| Private-key | `'privateKey' in config` AND `config.privateKey.startsWith('0x')` |
| Browser-extension | `'walletClient' in config` AND `'publicClient' in config` |

Helper predicates `isPrivateKeyEvmWalletConfig` and `isBrowserExtensionEvmWalletConfig` are exported.

---

## `EvmWalletDefaults`

```ts
type EvmWalletDefaults = {
  publicClient?: Partial<Omit<PublicClientConfig, 'transport' | 'chain'>>;
  walletClient?: Partial<Omit<WalletClientConfig, 'transport' | 'chain' | 'account'>>;
  transport?: HttpTransportConfig;
  sendTransaction?: EvmSendTransactionPolicy;      // Omit<Partial<SendTransactionParameters>, keyof EvmRawTransaction>
  waitForTransactionReceipt?: EvmWaitForTransactionReceiptPolicy; // Partial<Omit<WaitForTransactionReceiptParameters, 'hash'>>
};
```

| Default slice | Used by | Effective only in |
|---|---|---|
| `publicClient`, `walletClient`, `transport` | constructor | Private-key mode |
| `sendTransaction` | `sendTransaction()` | Both modes |
| `waitForTransactionReceipt` | `waitForTransactionReceipt()` | Both modes |

> In browser-extension mode, `publicClient` / `walletClient` / `transport` defaults are **ignored** — the provider logs a one-time `console.warn`. Pass them only in private-key mode.

---

## Methods

| Method | Signature | Returns | Default slice merged |
|---|---|---|---|
| `getWalletAddress` | `() => Promise<Address>` | viem `Address` (`` `0x${string}` ``) | — |
| `sendTransaction` | `(txData: EvmRawTransaction, options?: EvmSendTransactionPolicy) => Promise<Hash>` | viem `Hash` | `defaults.sendTransaction` |
| `waitForTransactionReceipt` | `(txHash: Hash, options?: EvmWaitForTransactionReceiptPolicy) => Promise<EvmRawTransactionReceipt>` | bigint-stringified receipt | `defaults.waitForTransactionReceipt` |

The serialised receipt converts all `bigint` fields to `string` so it can be `JSON.stringify`'d safely. This is enforced at the type level — `EvmRawTransactionReceipt` (from `@sodax/types`) is the stringified shape.

---

## Public fields

| Field | Type | Notes |
|---|---|---|
| `chainType` | `'EVM'` (literal) | Discriminant for `IXxxWalletProvider` unions. |
| `publicClient` | `PublicClient` | Either built from `rpcUrl` (PK mode) or the caller's instance (browser mode). |

`walletClient` is private — call `sendTransaction()` instead of touching it directly.

---

## Gotchas

- **`getEvmViemChain` is exhaustive.** If `@sodax/types` adds a new `EvmChainKey`, this function fails to typecheck until the case is added — by design.
- **HyperEVM is defined inside this package.** `viem/chains` does not ship a HyperEVM config; `wallet-providers/evm/EvmWalletProvider.ts` exports `hyper` via `defineChain`. You shouldn't need it directly — `getEvmViemChain(ChainKeys.HYPEREVM_MAINNET)` returns it.
- **`rpcUrl` falls back to the viem chain's first public RPC.** Fine for testing — replace with a private RPC for production.
- **No nonce management.** The provider does not auto-increment / serialise sends. If you fire multiple txs in parallel from the same account, manage nonces yourself via `defaults.sendTransaction.nonce` or per-call `options.nonce`.

---

## See also

- [`recipes/setup-private-key.md`](../recipes/setup-private-key.md)
- [`recipes/setup-browser-extension.md`](../recipes/setup-browser-extension.md)
- [`recipes/sign-and-broadcast.md`](../recipes/sign-and-broadcast.md)
- [`recipes/defaults-and-overrides.md`](../recipes/defaults-and-overrides.md)
