---
name: sodax-wallet-sdk-core
description: 'Sign and broadcast SODAX transactions from a backend, script, CI, bot, or non-React app with @sodax/wallet-sdk-core — one wallet-provider class per chain family (EVM, Solana, Sui, Bitcoin, Stellar, ICON, Injective, NEAR, Stacks). INTEGRATION (write NEW code) — each class accepts a private-key config (Node scripts, CI, bots, indexers) or a browser-extension config (custom non-React browser flows). Use whenever non-React code must instantiate a wallet provider directly. Triggers on "instantiate EvmWalletProvider", "sign a tx from a Node script", "wallet provider for backend", "private-key signing", "wallet-sdk-core setup", any `*WalletProvider` class name. For React dapps prefer `sodax-wallet-sdk-react` — React consumers get a typed `IXxxWalletProvider` via `useWalletProvider(...)`. MIGRATION (port v1 → v2) — changes are additive (same class, config-type and config-shape names). The only mechanical step is replacing deep imports from v1''s flat `wallet-providers/<chain>.ts` layout with barrel imports, plus optionally adopting the new `defaults` field and re-imported library types. Triggers on imports from `@sodax/wallet-sdk-core/wallet-providers/…`, bumping from an older RC, or adopting `defaults` / `*WalletDefaults` / `*Policy` fields. Most projects need no wallet-sdk-core migration — the real target is usually `@sodax/sdk` or `@sodax/types`. Load this skill if EITHER applies; the body gates by mode.'
license: MIT
metadata:
  version: '0.0.1'
  author: sodax
---

# When to use this skill

AGENTS.md routes you here when you're working with `@sodax/wallet-sdk-core` v2 — either writing new code or upgrading an older project.

**Pick your mode:**

- Writing NEW v2 code (greenfield wallet provider setup, no v1 deep imports)? → § **Integration mode** below.
- Upgrading EXISTING code (deep imports from `@sodax/wallet-sdk-core/wallet-providers/…`, bumping from an older RC)? → § **Migration mode** below. **Headline: v1 code drops in unchanged at the wallet-sdk-core surface** — if compile errors appear here, the real migration target is almost certainly `@sodax/sdk` or `@sodax/types` (load `sodax-sdk` skill instead).

For React consumers → use `sodax-wallet-sdk-react` (they get the typed wallet provider via `useWalletProvider(...)` and pass it to `@sodax/sdk` calls).

## Prefer a granular skill if the chain is known

If the task targets one chain family, load its granular skill instead of this broad one. It covers that provider's config, methods and gotchas, for both integration and migration.

| Chain family | Granular skill | Trigger phrases |
|---|---|---|
| EVM (Sonic hub + every EVM spoke) | [`./evm/SKILL.md`](./evm/SKILL.md) | "instantiate EvmWalletProvider", "viem wallet for Sonic / Base / Arbitrum" |
| Solana | [`./solana/SKILL.md`](./solana/SKILL.md) | "SolanaWalletProvider", "sign a Solana tx from Node" |
| Sui | [`./sui/SKILL.md`](./sui/SKILL.md) | "SuiWalletProvider", "Sui signing from a script" |
| Bitcoin (PSBT) | [`./bitcoin/SKILL.md`](./bitcoin/SKILL.md) | "BitcoinWalletProvider", "sign a PSBT" |
| Stellar | [`./stellar/SKILL.md`](./stellar/SKILL.md) | "StellarWalletProvider", "Stellar signing from a backend" |
| ICON | [`./icon/SKILL.md`](./icon/SKILL.md) | "IconWalletProvider", "Hana wallet relay" |
| Injective | [`./injective/SKILL.md`](./injective/SKILL.md) | "InjectiveWalletProvider", "Injective MsgBroadcaster" |
| NEAR | [`./near/SKILL.md`](./near/SKILL.md) | "NearWalletProvider", "NEAR signing from Node" |
| Stacks | [`./stacks/SKILL.md`](./stacks/SKILL.md) | "StacksWalletProvider", "Stacks signing from a script" |

Load this broad skill (keep reading below) when the task spans several chain families or the chain is undecided.

---

## Integration mode (writing new v2 code)

Direct usage of `@sodax/wallet-sdk-core` is the right choice for:

- Backend / Node scripts (CI tests, indexers, bots, server APIs).
- Custom browser flows that don't use React.
- Tests that need to sign with a deterministic key.

### Workflow

1. Read [`integration/knowledge/ai-rules.md`](./integration/knowledge/ai-rules.md) — DO / DON'T + workflow + stop conditions.
2. Read [`integration/knowledge/architecture.md`](./integration/knowledge/architecture.md) — mental model: `BaseWalletProvider`, dual-config discriminants (Bitcoin/Stellar via an explicit `type` field, every other chain via field presence), shallow `defaults` merge, library-exports.
3. Read [`integration/knowledge/quickstart.md`](./integration/knowledge/quickstart.md) — copy-paste minimal example for the chain you need.
4. For your chain, read [`integration/knowledge/features/`](./integration/knowledge/features/) — per-chain config table + methods + gotchas, one file per chain family: `evm.md`, `solana.md`, `sui.md`, `bitcoin.md`, `stellar.md`, `icon.md`, `injective.md`, `near.md`, `stacks.md`.
5. Task-specific recipes → [`integration/knowledge/recipes/`](./integration/knowledge/recipes/) — `setup-private-key.md`, `setup-browser-extension.md`, `sign-and-broadcast.md`, `defaults-and-overrides.md`, `library-exports.md`, `bridge-to-sdk.md` (pass provider to `@sodax/sdk`).
6. Lookups → [`integration/knowledge/reference/`](./integration/knowledge/reference/) — public API, provider classes, interfaces (`IXxxWalletProvider`), chain support, glossary.

### Conventions to follow (integration)

- **Dual-config discriminant.** **Bitcoin and Stellar** configs carry an explicit `type` discriminator (`'PRIVATE_KEY'` for Node / scripts or `'BROWSER_EXTENSION'` for consumer dApps); **every other chain** (EVM, Solana, Sui, ICON, Injective, NEAR, Stacks) discriminates by field presence (e.g. `privateKey` vs `walletClient`/`wallet`). Either way, pick ONE variant — don't merge them.
- **`defaults` is a shallow merge.** Each provider accepts a `defaults` field for per-method overrides (e.g. `waitForTransactionReceipt`, `gasPrice`). The merge into the per-call options is **shallow**, not deep. Top-level keys overwrite wholesale.
- **Use barrel imports**, not deep imports. Import classes from `@sodax/wallet-sdk-core`, not from `@sodax/wallet-sdk-core/wallet-providers/<chain>.ts`.
- **Re-import chain SDK types from the barrel.** `@sodax/wallet-sdk-core` re-exports the types you need (e.g. `WalletClient` from viem, `SuiClient` from `@mysten/sui`). Don't add the underlying SDK as a direct dep — risks version skew.
- **`IXxxWalletProvider` is the interface to pass into `@sodax/sdk`.** When bridging to the SDK, narrow with `useWalletProvider({ xChainId: ChainKeys.X })` (React) or just construct the provider directly and pass it in the SDK call payload (`{ raw: false, walletProvider }`).

### Top traps to avoid (integration)

1. **Mixing the two config variants.** `PRIVATE_KEY` and `BROWSER_EXTENSION` are mutually exclusive. Each chain's `*WalletProviderConfig` is a discriminated union — TypeScript catches mixing, but only if you don't use `as`.
2. **Adding viem / `@mysten/sui` / `@solana/web3.js` as a direct dep** when the type was importable from `@sodax/wallet-sdk-core`. See `integration/recipes/library-exports.md`.
3. **Deep-importing `@sodax/wallet-sdk-core/wallet-providers/EvmWalletProvider`**. v1's flat layout is gone; use barrel imports.
4. **Expecting `defaults` to deep-merge.** It doesn't — top-level keys overwrite wholesale.
5. **Trying to extend `BaseWalletProvider` directly** in consumer code. That's a maintainer-only path — write a thin wrapper over an existing provider instead.

### Verification (integration)

```bash
pnpm tsc --noEmit   # must exit clean
```

If errors mention `@sodax/wallet-sdk-core`, look up the symbol in `integration/knowledge/reference/`. If the symbol isn't there, stop and ask the user — don't invent classes.

---

## Migration mode (v1 → v2 porting)

Pick this mode ONLY if you see one of these patterns:

- Deep imports: `import { … } from '@sodax/wallet-sdk-core/wallet-providers/EvmWalletProvider'` (or similar per-chain file).
- Bumping `@sodax/wallet-sdk-core` from an older RC and wanting to adopt new additive features (`defaults`, `*WalletDefaults`, `*Policy` types).

The package name **did not change** across versions. Class names, config-type names, and config shapes are **identical** v1 → v2. **No mandatory edits** at the wallet-sdk-core surface — v1 code drops in unchanged.

If a project does more than the deep-import cleanup at this surface, the real migration target is almost certainly `@sodax/sdk` (chain-key renames, Result<T>, error model) or `@sodax/types`. Route to the `sodax-sdk` skill (migration mode) instead.

### Workflow

1. Read [`migration-v1-to-v2/knowledge/ai-rules.md`](./migration-v1-to-v2/knowledge/ai-rules.md) — DO / DON'T + workflow. **The headline: v1 code drops in unchanged.**
2. Read [`migration-v1-to-v2/knowledge/README.md`](./migration-v1-to-v2/knowledge/README.md) — what (additively) changed, read order, TL;DR.
3. Read the breaking-change writeups under [`breaking-changes/`](./migration-v1-to-v2/knowledge/breaking-changes/) — `folder-layout.md` (deep-import → barrel), `defaults-config.md`, `base-wallet-provider.md`, `library-exports.md`.
4. For mechanical changes, apply the recipes in [`recipes/`](./migration-v1-to-v2/knowledge/recipes/) — `adopt-defaults.md`, `adopt-library-exports.md`. **Both are optional** — they're cleanup paths, not requirements.
5. Confirm no renames / deletions exist by checking [`reference/`](./migration-v1-to-v2/knowledge/reference/) — `renamed-symbols.md` (empty), `deleted-exports.md` (empty), `added-fields.md` (additive new surface).
6. Verify with [`checklist.md`](./migration-v1-to-v2/knowledge/checklist.md).

### Top mechanical changes

1. **Deep imports → barrel imports.** Replace `import { EvmWalletProvider } from '@sodax/wallet-sdk-core/wallet-providers/EvmWalletProvider'` with `import { EvmWalletProvider } from '@sodax/wallet-sdk-core'`. The flat `wallet-providers/*.ts` layout is gone.
2. **(Optional) Re-import chain SDK types from the barrel.** Replace direct imports of `WalletClient` (viem), `SuiClient` (@mysten/sui), etc. with re-exports from `@sodax/wallet-sdk-core`. Removes the underlying SDK as a direct dep, eliminates version skew. See `recipes/adopt-library-exports.md`.
3. **(Optional) Adopt `defaults` field.** New `defaults` (shallow-merge) field on each provider's config lets you set per-method overrides centrally. See `recipes/adopt-defaults.md`.

### Top traps to avoid (migration)

1. **Treating this as a real migration.** It isn't — v1 code drops in unchanged at the wallet-sdk-core surface. If the consumer's compile errors point at this package, look one layer deeper — they're almost certainly `@sodax/types` renames bleeding through (e.g. `xChainId` → `chainKey`) and the real fix is in the `sodax-sdk` skill (migration mode).
2. **Extending `BaseWalletProvider` in consumer code.** That's a maintainer path. If a project subclasses it, scope confirmation with the user before touching anything.

### Stop conditions (defer to user)

| Signal | Why stop |
|---|---|
| Compile errors mention `@sodax/sdk` or `@sodax/types` symbols | Not this migration. Route to `sodax-sdk` skill (migration mode). |
| Project extends `BaseWalletProvider` with non-trivial logic | Maintainer-only path. Confirm scope first. |
| User wants a chain family not in `integration/knowledge/reference/chain-support.md` | Adding a new chain is a maintainer task. |

### Verification (migration)

```bash
pnpm tsc --noEmit   # must exit clean
# No leftover deep imports from v1's flat layout:
grep -rE "from '@sodax/wallet-sdk-core/wallet-providers/" src/   # empty
```

---

# Related skills

- `sodax-sdk` — pass the constructed provider into SDK calls (`{ raw: false, walletProvider }`); SDK-side v1 → v2 work happens there.
- `sodax-wallet-sdk-react` — for React dapps; this skill is only relevant if NOT using React.
