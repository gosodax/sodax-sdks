# Sui — `SuiWalletProvider`

Backed by `@mysten/sui` (gRPC transport).

| | |
|---|---|
| Class | `SuiWalletProvider` |
| Interface | `ISuiWalletProvider` (from `@sodax/types`) |
| Discriminant style | **Field presence** (no `type` field) — but uses `mnemonics`, not `privateKey` |
| Underlying SDK | `@mysten/sui` (gRPC transport) |

---

## Config

```ts
type SuiWalletConfig = PrivateKeySuiWalletConfig | BrowserExtensionSuiWalletConfig;

type PrivateKeySuiWalletConfig = {
  grpcUrl?: string;                    // gRPC-web endpoint, e.g. https://fullnode.mainnet.sui.io
  rpcUrl?: string;                     // deprecated alias — pass this OR grpcUrl, never both
  mnemonics: string;                   // BIP-39 mnemonic — NOT a raw private key
  defaults?: SuiWalletDefaults;
};

type BrowserExtensionSuiWalletConfig = {
  grpcUrl: string;
  address: string;                                      // active account address
  signTransaction: (txn: SuiTransaction) => Promise<{ bytes: string; signature: string }>;
  defaults?: SuiWalletDefaults;
};
```

| Mode discriminant | How to detect |
|---|---|
| Private-key | `'mnemonics' in config` |
| Browser-extension | `'signTransaction' in config && 'address' in config` |

Note the name — `PrivateKeySuiWalletConfig` is still called "PrivateKey" for consistency, even though the credential is a mnemonic. The library derives an Ed25519 keypair from the mnemonic phrase.

---

## `SuiWalletDefaults`

```ts
type SuiWalletDefaults = {
  signAndExecuteTxn?: {
    dryRun?: { enabled?: boolean };           // default: enabled = true
  };
  getCoins?: { limit?: number };
};
```

---

## Methods

| Method | Signature | Returns | Default slice merged |
|---|---|---|---|
| `getWalletAddress` | `() => Promise<string>` | Sui address | — |
| `signAndExecuteTxn` | `(txn: SuiTransaction, options?: SuiSignAndExecutePolicy) => Promise<string>` | digest | `defaults.signAndExecuteTxn` |
| `viewContract` | `(txn: SuiTransaction, …) => Promise<…>` | dry-run result | — |
| `getCoins` | `(address: string, token: string, options?: SuiGetCoinsPolicy) => Promise<SuiPaginatedCoins>` | coin pagination | `defaults.getCoins` |

`signAndExecuteTxn` runs a **pre-flight dry-run by default**. Disable only when paying gas for a doomed tx is acceptable:

```ts
await provider.signAndExecuteTxn(tx, { dryRun: { enabled: false } });
```

---

## Public fields

| Field | Type | Notes |
|---|---|---|
| `chainType` | `'SUI'` (literal) | Discriminant. |

The internal `client: SuiGrpcClient` and `wallet: SuiWallet` are private.

---

## Gotchas

- **Browser-extension mode takes a signer callback, not a wallet object.** The provider builds its own gRPC client and only asks you to sign.
- **The callback takes the transaction positionally — wrap, don't assign.** `dAppKit.signTransaction` from `@mysten/dapp-kit-react` takes `{ transaction, account?, network? }`, and wallet-standard's `signTransaction` feature takes `{ transaction, account, chain }`; neither is assignable to `(txn) => …`. Name the account explicitly — left out, dApp Kit signs with whichever account is currently connected, which need not be the `address` you passed. The provider builds and dry-runs the transaction against its own client before calling you, so the adapter only has to serialize it (`account` is dApp Kit's `UiWalletAccount`).

  ```ts
  // @ai-snippets-skip
  signTransaction: async txn => dAppKit.signTransaction({ transaction: await txn.toJSON(), account }),
  ```
- **Mnemonic is the only private-key option.** There is no raw-secret-key constructor. If you have a 32-byte key bytes you must convert it to a mnemonic upstream (or fork the provider).
- **Dry-run is on by default for safety.** Production scripts almost never want to disable it.
- **Sui speaks gRPC only.** Mysten's public fullnodes stopped serving JSON-RPC in July 2026, and `sui-node` drops it in October 2026, so the endpoint must serve gRPC-web. `https://fullnode.mainnet.sui.io` does, free and without an API key. The old `rpcUrl` name still resolves. Exactly one of the two must be set: neither throws, and so does both.
- **The public fullnode is rate-limited per IP.** Bursts past roughly 150 concurrent calls, or sustained load past roughly 20-25 req/s, return `RESOURCE_EXHAUSTED`; it recovers within seconds. Fine for a user's browser session. A server-side integration sharing one egress IP should pass its own node or a paid provider.

---

## See also

- [`recipes/setup-private-key.md`](../recipes/setup-private-key.md)
- [`recipes/setup-browser-extension.md`](../recipes/setup-browser-extension.md)
- [`recipes/sign-and-broadcast.md`](../recipes/sign-and-broadcast.md)
