# Tron — `TronWalletProvider`

No upstream chain SDK: TronWeb is typed structurally (`TronWebLike`) and `viem` does the hashing and signing. The provider signs and broadcasts; it does not build transactions.

| | |
|---|---|
| Class | `TronWalletProvider` |
| Interface | `ITronWalletProvider` (from `@sodax/types`) |
| Discriminant style | **Field presence** (no `type` field) |
| Underlying SDK | none (`viem` for hashing and signing) |

---

## Config

The config union and the structural `TronWebLike` / `TronProviderLike` shapes are in [`tron/types.ts`](https://github.com/gosodax/sodax-sdks/blob/main/packages/wallet-sdk-core/src/wallet-providers/tron/types.ts); [`TronWalletProvider.test.ts`](https://github.com/gosodax/sodax-sdks/blob/main/packages/wallet-sdk-core/src/wallet-providers/tron/TronWalletProvider.test.ts) constructs both variants.

| Mode discriminant | How to detect |
|---|---|
| Private-key | `'privateKey' in config` |
| Browser-extension | `'tronWeb' in config` |

In browser-extension mode the provider signs with the first TronWeb that has an account, trying `getProvider()`, then `provider`, then the injected `tronWeb`, and throws a reconnect error when none has one. Pass `getProvider` returning the provider the wallet announced over TIP-6963: its TronWeb is the connected one, while a captured `provider` can go stale.

---

## `TronWalletDefaults`

Holds `rpcUrl`, read once in the constructor; no method takes per-call options. Every node call (broadcast, receipt polling, balance) goes to `endpoint`, else `defaults.rpcUrl`, else TronGrid, in both modes — not through the wallet's TronWeb.

---

## Methods

| Method | Signature | Returns |
|---|---|---|
| `getWalletAddress` | `() => Promise<string>` | base58 `T…` address |
| `signTransaction` | `(tx: TronUnsignedTransaction) => Promise<TronSignedTransaction>` | the tx with `signature` attached |
| `signMessage` | ``(hash: `0x${string}`) => Promise<`0x${string}`>`` | 65-byte `r‖s‖v` hex — see Gotchas |
| `sendTransaction` | `(signedTx: TronSignedTransaction) => Promise<string>` | tx id; throws with the node's message if rejected |
| `waitForTransactionReceipt` | `(txHash: string) => Promise<TronRawTransactionReceipt>` | receipt, once the tx is in a block |
| `getBalance` | `(address?: string) => Promise<bigint>` | TRX balance in sun (class-only, not on the interface) |

---

## Public fields

| Field | Type | Notes |
|---|---|---|
| `chainType` | `'TRON'` (literal) | Discriminant. |

Everything else is private.

---

## Gotchas

- **`signMessage` signs the hash's hex text, not its bytes.** It follows `signMessageV2` (scheme 1): the digest covers the lowercased 66-character `0x…` string under the TRON message prefix. A custom `ITronWalletProvider` must sign the same digest — TronWeb's `trx.signMessageV2` does, its other message APIs use a different prefix — or the signature recovers to a different address; the test's `scheme1Digest` is the reference. Pass a 32-byte hash, not encoded text: the private-key path fixes the length in the prefix.
- **The SDK signs Tron deposits through `signTransaction` and withdrawals through `signMessage`.** It builds, broadcasts and polls deposits itself, so a custom provider can leave out the optional `sendTransaction`.
- **`waitForTransactionReceipt` resolves on inclusion, not success.** A reverted call still returns; check the receipt's `receipt?.result` (absent for plain TRX transfers).
---

## See also

- [`recipes/setup-private-key.md`](../recipes/setup-private-key.md)
- [`recipes/setup-browser-extension.md`](../recipes/setup-browser-extension.md)
- [`recipes/sign-and-broadcast.md`](../recipes/sign-and-broadcast.md)
