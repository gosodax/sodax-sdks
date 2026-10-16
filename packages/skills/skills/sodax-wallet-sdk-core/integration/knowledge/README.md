# Integration: First-time setup (Human-readable overview)

This folder helps you integrate `@sodax/wallet-sdk-core` into a fresh project — most commonly a Node script, a backend service, or a custom non-React frontend. It is the **human-facing** entry point for new integrations. If you are a coding agent, read [`ai-rules.md`](./ai-rules.md) first.

If you are upgrading from an older version of the package instead, see [`sodax-wallet-sdk-core` (migration mode)](../../migration-v1-to-v2/knowledge/).

---

## What this package does

`@sodax/wallet-sdk-core` is a **low-level multi-chain wallet provider layer**. For each of the 9 chain families that SODAX supports it ships **one provider class** that:

- Accepts a **discriminated union config** — `PrivateKey*WalletConfig | BrowserExtension*WalletConfig`.
- Extends a small `BaseWalletProvider` to merge per-call options over a typed `defaults` shape.
- Implements the chain-specific `IXxxWalletProvider` interface from `@sodax/types`, so it can be passed straight into `@sodax/sdk` calls.

It is intentionally framework-agnostic — Node ≥ 20.12, browser, edge runtimes are all supported (tsup `esbuildOptions.platform: 'neutral'`).

| Chain family | Provider class | Underlying chain SDK |
|---|---|---|
| EVM (14 chains)        | `EvmWalletProvider`       | `viem` |
| Solana                 | `SolanaWalletProvider`    | `@solana/web3.js` |
| Sui                    | `SuiWalletProvider`       | `@mysten/sui` |
| Bitcoin                | `BitcoinWalletProvider`   | `bitcoinjs-lib` (+ `ecpair`, `secp256k1`) |
| Stellar                | `StellarWalletProvider`   | `@stellar/stellar-sdk` |
| ICON                   | `IconWalletProvider`      | `icon-sdk-js` |
| Injective              | `InjectiveWalletProvider` | `@injectivelabs/sdk-ts` + `@injectivelabs/wallet-core` |
| NEAR                   | `NearWalletProvider`      | `near-api-js` + `@hot-labs/near-connect` |
| Stacks                 | `StacksWalletProvider`    | `@stacks/transactions` + `@stacks/connect` |

---

## Recommended path (in order)

If this is your first time using the package:

1. [`architecture.md`](./architecture.md) — read once before any recipe. Explains `BaseWalletProvider`, the `defaults` shallow-merge model, dual-config discriminants, and the `library-exports` indirection. Picking the wrong config variant is the most common mistake — the mental model prevents it.
2. [`quickstart.md`](./quickstart.md) — minimal end-to-end example for the chain you need. Copy, edit, run.
3. [`features/<chain>.md`](./features/) — chain-specific config table, methods, and gotchas (one file per chain).
4. Pick the right recipes:
   - [`recipes/setup-private-key.md`](./recipes/setup-private-key.md) — server-side / CI flow.
   - [`recipes/setup-browser-extension.md`](./recipes/setup-browser-extension.md) — consumer dApp flow.
   - [`recipes/bridge-to-sdk.md`](./recipes/bridge-to-sdk.md) — hand off the provider to `@sodax/sdk` calls.
   - [`recipes/defaults-and-overrides.md`](./recipes/defaults-and-overrides.md) — merge semantics for the `defaults` config.
   - [`recipes/library-exports.md`](./recipes/library-exports.md) — re-importing upstream chain-SDK types without a direct dep.
   - [`recipes/sign-and-broadcast.md`](./recipes/sign-and-broadcast.md) — typical send-transaction flow per chain.
   - [`recipes/testing.md`](./recipes/testing.md) — mocking providers in unit tests.
5. Reference docs (lookup as needed):
   - [`reference/public-api.md`](./reference/public-api.md) — every named export from the package root.
   - [`reference/provider-classes.md`](./reference/provider-classes.md) — provider × config × interface table.
   - [`reference/interfaces.md`](./reference/interfaces.md) — `IXxxWalletProvider` method signatures.
   - [`reference/chain-support.md`](./reference/chain-support.md) — chain family → spoke chain keys.
   - [`reference/glossary.md`](./reference/glossary.md) — terms used across the docs.

---

## Install

```bash
pnpm add @sodax/wallet-sdk-core @sodax/types
```

Most consumers will also need `@sodax/sdk` (for the hub/spoke services that accept the wallet provider) and one or more chain SDKs (for browser-extension wallet objects). Re-export the types you need via `library-exports` — see [`recipes/library-exports.md`](./recipes/library-exports.md).

---

## Two configuration modes

Every provider class supports **two** construction modes. Picking the wrong one is the most common integration mistake.

| Mode | When to use | Discriminant style |
|---|---|---|
| **Private-key** | Node scripts, CI tests, indexers, bots — anywhere you possess the raw key | Either field presence (EVM, Solana, Sui, ICON, Injective, NEAR, Stacks) OR `type: 'PRIVATE_KEY'` (Bitcoin, Stellar) |
| **Browser-extension** | Consumer dApps where a wallet extension provides a pre-built client / signer | Either field presence (different fields from PK variant) OR `type: 'BROWSER_EXTENSION'` (Bitcoin, Stellar) |

For a chain-by-chain breakdown of the exact discriminant shape, see [`features/`](./features/) and [`architecture.md`](./architecture.md) § "Discriminant variants".

---

## Pair with `@sodax/sdk` and `@sodax/wallet-sdk-react`

The most common stack:

```
@sodax/sdk              ← business logic (swaps, lending, staking, …)
@sodax/wallet-sdk-react ← React layer that surfaces a typed IXxxWalletProvider via hooks
@sodax/wallet-sdk-core  ← this package — concrete provider classes
@sodax/types            ← shared type definitions
```

In a React dApp you usually consume this package **indirectly** — `useWalletProvider({ xChainId })` (from `@sodax/wallet-sdk-react`) returns a typed `IXxxWalletProvider` that comes from a `wallet-sdk-core` instance under the hood. You only construct provider classes from `wallet-sdk-core` directly when running scripts, tests, or non-React clients.

---

## Conventions worth knowing

- **`defaults` is optional but powerful.** Every provider accepts a `defaults` config slice; per-call options shallow-merge over it. Use it to encode env-level fixed choices (RPC commitment, default gas, default memo) once.
- **Shallow merge, not deep.** Nested objects in `defaults` are **replaced wholesale** by per-call options of the same key. See `src/utils/merge.ts` and [`recipes/defaults-and-overrides.md`](./recipes/defaults-and-overrides.md).
- **`library-exports` removes upstream deps.** You can `import type { WalletClient } from '@sodax/wallet-sdk-core'` instead of taking a direct dep on `viem`. See [`recipes/library-exports.md`](./recipes/library-exports.md).
- **The barrel is the source of truth.** Internal utilities (`shallowMerge`, helper functions) are **not** exported. If something isn't on `@sodax/wallet-sdk-core`'s root, do not deep-import it.
- **No `as unknown as` casts.** The discriminated unions are precise — if TypeScript complains, your config is wrong, not the type.

---

## Getting help

- API surface lookup: [`reference/`](./reference/).
- Bug or missing feature: [open an issue](https://github.com/icon-project/sodax-sdks/issues).
