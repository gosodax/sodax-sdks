# Migration: v1 → v2 (Human-readable overview)

This folder documents how to upgrade an app from **v1** of `@sodax/wallet-sdk-core` (the legacy `sodax-frontend` codebase) to **v2** (this repo). The package name did not change — and **the public surface is intentionally backwards-compatible**. v1 consumer code drops in unchanged.

This folder is the **human-facing** entry point for the upgrade. If you are a coding agent, read [`ai-rules.md`](./ai-rules.md) first. If you are integrating for the first time, see [`sodax-wallet-sdk-core` (integration mode)](../../integration/knowledge/) instead.

---

## Scope

v1 (`sodax-frontend/packages/wallet-sdk-core`) and v2 (current) share:

- **Identical class names**: `EvmWalletProvider`, `InjectiveWalletProvider`, `BitcoinWalletProvider`, … (all 9).
- **Identical config-type names**: `PrivateKeyEvmWalletConfig`, `SecretInjectiveWalletConfig`, `BrowserExtension*WalletConfig`, …
- **Identical config shapes**: same required fields, same discriminants, same Injective `secret: { privateKey | mnemonics }` nesting.
- **Identical public method signatures**: `getWalletAddress`, `sendTransaction`, `signAndExecuteTxn`, …

What v2 **added** (all optional, all additive):

1. **`defaults` config** — every `*WalletConfig` gained an optional `defaults?: *WalletDefaults` field. Used to encode env-level constants (default gas, default commitment, …) once at construction.
2. **`library-exports`** — types and a few runtime enums re-exported from `@sodax/wallet-sdk-core`. Lets consumers drop direct deps on `viem`, `@mysten/sui`, `@stellar/stellar-sdk`, etc. for type-only usage.
3. **`BaseWalletProvider<TDefaults>`** — abstract base class shared by every provider. Holds `defaults` and exposes shallow-merge helpers. Internal — consumer code does not extend it.
4. **`*WalletDefaults` and `*Policy` types** — exported alongside each chain's config types.
5. **Folder-per-chain source layout** — `wallet-providers/evm/EvmWalletProvider.ts` (v2) replaced `wallet-providers/EvmWalletProvider.ts` (v1). Only matters if you deep-imported from `src/`.

What was **removed** or **renamed**: **nothing**. There is no mandatory edit.

---

## Read order

If you are upgrading by hand, read in this order:

1. [`ai-rules.md`](./ai-rules.md) — workflow + stop conditions. **Drop-in upgrade is the default**; only adopt new features if you want them.
2. [`breaking-changes/README.md`](./breaking-changes/README.md) — every additive change, with a `Why:` line each.
3. [`recipes/`](./recipes/) — paired before/after **only** for optional cleanup tasks (adopt `defaults`, adopt `library-exports`).
4. [`checklist.md`](./checklist.md) — verification pass.

If you are letting a coding agent drive the upgrade, point it at [`ai-rules.md`](./ai-rules.md) — that file gives the agent its workflow and verification protocol.

---

## TL;DR for the impatient

```bash
# 1. Update version in package.json
pnpm add @sodax/wallet-sdk-core@latest

# 2. Type-check — expect zero errors from wallet-sdk-core surface
pnpm exec tsc --noEmit | grep -iE "wallet-sdk-core|WalletProvider|WalletConfig"
# (errors here indicate either v1 deep imports or a real bug — file an issue)

# 3. Done.  Optional cleanups in recipes/ when you have time.
```

---

## What is NOT covered here

- **Other SODAX packages** (`@sodax/sdk`, `@sodax/types`, `@sodax/wallet-sdk-react`, `@sodax/dapp-kit`). They each have their own migration docs and **real** v1→v2 breaks.
- **Upstream chain-SDK upgrades** (viem 2.x → 3.x, etc.) — out of scope.
- **App framework upgrades** (Node, Vite, Next.js) — out of scope.

---

## Tip: typecheck-driven verification

Running `pnpm exec tsc --noEmit` across your codebase reveals breaking changes — but for wallet-sdk-core specifically, **none of those errors come from this package**. If you see `wallet-sdk-core` in the error output, it's most likely:

- A deep import from `src/...` (never supported; the v2 source layout differs).
- Indirect — a broken `@sodax/sdk` / `@sodax/types` signature that includes a wallet-provider type.

```bash
# Filter to wallet-sdk-core specifically
pnpm exec tsc --noEmit | grep -iE "from '@sodax/wallet-sdk-core'|@sodax/wallet-sdk-core/"
```

That filtered output is your work list. In a typical project the list is empty.

---

## Getting help

If you do hit a v1 pattern that doesn't compile against v2, [open an issue](https://github.com/gosodax/sodax-sdks/issues) with the source snippet — that means we missed a backwards-compat case and the migration scope needs to grow.
