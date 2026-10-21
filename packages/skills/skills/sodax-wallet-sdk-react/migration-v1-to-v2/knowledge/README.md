# Migration: v1 → v2 (Human-readable overview)

This folder documents how to migrate an app from v1 to v2 of `@sodax/wallet-sdk-react`. The package name did not change — the breaking changes are in the API surface (provider config, hook signatures, store name, chain class imports). It is the **human-facing** entry point for migration. If you are a coding agent, read [`ai-rules.md`](./ai-rules.md) first.

---

## What changed at a high level

v2 is a near-rewrite of v1 with a focus on three goals:

1. **Configurable chain opt-in** — v1 always mounted every chain adapter. v2 lets you opt in per chain by including only the slots you need on `SodaxWalletConfig`.
2. **Single source of truth for chain config** — v1 spread chain config across `rpcConfig`, `options`, and `initialState`. v2 collapses these into one `config` object on `SodaxWalletProvider`.
3. **Store-first hooks** — v2 hooks all read from a central Zustand store; no chain-specific React context coupling. This makes hooks composable and testable in isolation.

The persisted localStorage key (`xwagmi-store`) is **unchanged** — existing user connections survive the migration boundary.

> Full prose on motivations and behavior changes lives in [`breaking-changes.md`](./breaking-changes.md).

---

## Read order

If you are migrating by hand, read in this order:

1. [`breaking-changes.md`](./breaking-changes.md) — every breaking change with the WHY behind it.
2. [`reference/imports.md`](./reference/imports.md) — package and path renames (mechanical).
3. [`reference/config.md`](./reference/config.md) — `SodaxWalletProvider` config shape (this is the biggest single change).
4. [`reference/hooks.md`](./reference/hooks.md) — hook signature and rename map.
5. [`reference/components.md`](./reference/components.md) — component / provider renames.
6. [`recipes/`](./recipes/) — paired before/after for common patterns (connect button, multi-chain modal, SSR, WalletConnect).
7. [`checklist.md`](./checklist.md) — final verification pass; tick each item before declaring done.

If you are letting a coding agent drive the migration, point it at [`ai-rules.md`](./ai-rules.md) — that file gives the agent its workflow, stop conditions, and verification protocol.

---

## What is NOT covered here

- **Other SODAX packages** (`@sodax/sdk`, `@sodax/dapp-kit`). They have their own migration skills in `@sodax/skills` (`sodax-sdk` (migration mode), `sodax-dapp-kit` (migration mode)).
- **Behavioral migration of business logic** that isn't tied to wallet hooks — out of scope.
- **App framework upgrades** (Next.js, Vite versions) — out of scope.

---

## Getting help

If you hit a v1 pattern not covered in `reference/` or `recipes/`, please [open an issue](https://github.com/gosodax/sodax-sdks/issues) with the v1 code snippet — we'll add it to the docs.

For internal SODAX maintainers: see `../CLAUDE.md` for architecture context.
