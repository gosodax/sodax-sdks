---
name: sodax-wallet-sdk-core-injective
description: 'Granular skill for the @sodax/wallet-sdk-core v2 Injective wallet provider only — `InjectiveWalletProvider` (backed by @injectivelabs/sdk-ts + @injectivelabs/wallet-core MsgBroadcaster). Use when a backend / Node script / CI / bot / non-React browser flow needs to instantiate an Injective provider directly and build + broadcast msgs — e.g. "instantiate InjectiveWalletProvider", "Injective signing from a private key or mnemonic", "getRawTransaction then execute", "MsgBroadcaster setup". Covers BOTH integration (write new v2 code) and migration (port v1 — almost a no-op at this surface: deep-import → barrel). Picks via Step 1. Links into the parent sodax-wallet-sdk-core knowledge tree. For React dapps use the sodax-wallet-sdk-react skill instead (get the typed provider via useWalletProvider).'
license: MIT
metadata:
  version: '0.0.1'
  author: sodax
---

# Injective (`wallet-sdk-core` granular skill)

Granular skill for `InjectiveWalletProvider` — the low-level Injective wallet for backend / Node / non-React flows. Source-of-truth reference lives in the parent broad skill's knowledge tree; this file is the focused workflow only.

## Step 1 — Clarify with user before coding

1. **New code or v1 → v2 port?** New → § Integration. Port v1 → § Migration (almost always a no-op here).
2. **Secret (key/mnemonic) or browser-extension config?** Injective discriminates by **field presence**, but the credential variant is `SecretInjectiveWalletConfig`: `{ secret: { privateKey } | { mnemonics }, chainId, network }`; browser-extension = `{ msgBroadcaster }`. The credential is **nested under `secret`** — there is no top-level `privateKey`.
3. **Account state correct?** Override `defaults.sequence` / `defaults.accountNumber` when the on-chain account differs from the zero defaults (else broadcasting fails with "incorrect account sequence").

## Integration workflow (new v2 code)

1. [`../integration/knowledge/ai-rules.md`](../integration/knowledge/ai-rules.md) — DO / DON'T (read first).
2. [`../integration/knowledge/architecture.md`](../integration/knowledge/architecture.md) — `BaseWalletProvider`, dual-config discriminants, shallow `defaults` merge, library-exports.
3. [`../integration/knowledge/features/injective.md`](../integration/knowledge/features/injective.md) — full config union, `InjectiveWalletDefaults`, methods (`getRawTransaction` / `execute`), gotchas.
4. Setup recipe → [`../integration/knowledge/recipes/setup-private-key.md`](../integration/knowledge/recipes/setup-private-key.md) or [`../integration/knowledge/recipes/setup-browser-extension.md`](../integration/knowledge/recipes/setup-browser-extension.md); then [`../integration/knowledge/recipes/sign-and-broadcast.md`](../integration/knowledge/recipes/sign-and-broadcast.md), [`../integration/knowledge/recipes/defaults-and-overrides.md`](../integration/knowledge/recipes/defaults-and-overrides.md).
5. Lookups → [`../integration/knowledge/reference/provider-classes.md`](../integration/knowledge/reference/provider-classes.md), [`interfaces.md`](../integration/knowledge/reference/interfaces.md), [`chain-support.md`](../integration/knowledge/reference/chain-support.md).

### Injective-specific anti-patterns

- **Passing a top-level `privateKey`.** Not accepted — wrap it as `{ secret: { privateKey } }` (or `{ secret: { mnemonics } }`). This was always the shape, in v1 too.
- **Treating `chainId` as endpoint selection.** `chainId` is required by the config type but is never consumed for network/endpoint selection — only `network` drives endpoints. A mismatch does not itself cause a runtime RPC failure; still pass a coherent pair (`Mainnet` + `injective-1`, `Testnet` + `injective-888`).
- **Relying on the zero `sequence` / `accountNumber` defaults.** Override when the on-chain account state differs.
- **Expecting `evmOptions` to do anything.** It's reserved/unused — declared to keep the config shape stable.
- **Mixing secret + browser-extension fields.** Discriminated union — don't `as`.

## Migration workflow (port v1 → v2)

1. [`../migration-v1-to-v2/knowledge/ai-rules.md`](../migration-v1-to-v2/knowledge/ai-rules.md) — headline: **v1 code drops in unchanged at this surface**.
2. Only mechanical change: deep-import → barrel ([`../migration-v1-to-v2/knowledge/breaking-changes/folder-layout.md`](../migration-v1-to-v2/knowledge/breaking-changes/folder-layout.md)). Optionally adopt `defaults` ([`defaults-config.md`](../migration-v1-to-v2/knowledge/breaking-changes/defaults-config.md)) / re-imported library types ([`library-exports.md`](../migration-v1-to-v2/knowledge/breaking-changes/library-exports.md)).
3. Compile errors on `@sodax/sdk` / `@sodax/types` symbols → not this migration; load the `sodax-sdk` skill (migration mode).

## Verification

1. `pnpm tsc --noEmit` exits clean.
2. Credential is nested under `secret`; both `chainId` and `network` are present (pass a coherent pair — only `network` selects endpoints).
3. No v1 deep imports from `@sodax/wallet-sdk-core/wallet-providers/` (migration only).

## Related skills (same family)

Sibling chain skills follow the same shape — evm, solana, sui, bitcoin, stellar, icon, near, stacks, tron. For multi-chain or undecided work, load the broad [`sodax-wallet-sdk-core` skill](../SKILL.md).

## Passing the provider into the SDK (different package family)

This skill *builds* the provider. For the concrete handoff, see [`../integration/knowledge/recipes/bridge-to-sdk.md`](../integration/knowledge/recipes/bridge-to-sdk.md). To execute SODAX operations, **also load the `sodax-sdk` skill (integration mode)** and pass it as `{ raw: false, walletProvider }`. React dapps get the provider via `useWalletProvider(...)` — **load the `sodax-wallet-sdk-react` skill** instead.
