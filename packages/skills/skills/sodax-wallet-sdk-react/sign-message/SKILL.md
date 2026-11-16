---
name: sodax-wallet-sdk-react-sign-message
description: 'Granular skill for the @sodax/wallet-sdk-react v2 message-signing surface only — useXSignMessage, a React Query mutation that signs an arbitrary message with the connected wallet across chain types (Bitcoin auto-detects BIP-322 vs ECDSA). Use when a React dapp needs to prove wallet ownership or sign a login/SIWE-style challenge — e.g. "useXSignMessage", "sign a message in React", "wallet signature for auth", "per-chain message signing". Covers BOTH integration (write new v2 code) and migration (port v1 — single-object params). Picks via Step 1. Links into the parent sodax-wallet-sdk-react knowledge tree. For signing actual SODAX transactions use the bridge-to-sdk skill (useWalletProvider) instead.'
license: MIT
metadata:
  version: '0.0.1'
  author: sodax
---

# Sign message (`wallet-sdk-react` granular skill)

Granular skill for `useXSignMessage` — arbitrary message signing with the connected wallet. Source-of-truth reference lives in the parent broad skill's knowledge tree; this file is the focused workflow only.

## Step 1 — Clarify with user before coding

1. **New code or v1 → v2 port?** New → § Integration. Port v1 → § Migration.
2. **Message signing, not transaction signing?** `useXSignMessage` signs an arbitrary message (auth / proof-of-ownership). To sign a SODAX *transaction*, use `useWalletProvider` (the bridge-to-sdk skill) instead.
3. **Which chain?** The return type varies by family — see the per-chain matrix in the recipe.

## Integration workflow (new v2 code)

1. [`../integration/knowledge/ai-rules.md`](../integration/knowledge/ai-rules.md) — DO / DON'T (read first).
2. [`../integration/knowledge/recipes/setup.md`](../integration/knowledge/recipes/setup.md) — prerequisite: provider mounted, chain slot enabled.
3. [`../integration/knowledge/recipes/sign-message.md`](../integration/knowledge/recipes/sign-message.md) — usage + per-chain signature matrix.
4. Lookups → [`../integration/knowledge/reference/hooks.md`](../integration/knowledge/reference/hooks.md) (sign-message section).

### Sign-message-specific anti-patterns

- **Treating `useXSignMessage` as a plain function.** It's a React Query mutation — call `mutateAsync({ xChainType, message })`.
- **Assuming a single return type.** The result is a union — `` `0x${string}` | Uint8Array | string | undefined `` — depending on chain; handle accordingly.
- **Expecting one Bitcoin scheme.** Bitcoin signing auto-detects BIP-322 vs ECDSA — don't hard-code one.
- **Calling it with a disabled or unsupported chain.** The mutation does *not* reject — it resolves `undefined` (with a `console.warn`) for chains that don't implement `signMessage` or aren't in `walletConfig`. Branch on the `undefined` result; don't rely on a thrown error.

## Migration workflow (port v1 → v2)

1. [`../migration-v1-to-v2/knowledge/ai-rules.md`](../migration-v1-to-v2/knowledge/ai-rules.md) — DO / DON'T (read first).
2. [`../migration-v1-to-v2/knowledge/breaking-changes.md`](../migration-v1-to-v2/knowledge/breaking-changes.md) — single-object hook params.
3. Symbol lookups → [`../migration-v1-to-v2/knowledge/reference/hooks.md`](../migration-v1-to-v2/knowledge/reference/hooks.md).

## Verification

1. `pnpm tsc --noEmit` exits clean.
2. The signature union is handled (not assumed to be a string).
3. `mutateAsync({ xChainType, message })` shape (single object), not positional args (migration only).

## Related skills (same family)

- [`../bridge-to-sdk/SKILL.md`](../bridge-to-sdk/SKILL.md) — for signing SODAX transactions (not arbitrary messages).
- [`../connect/SKILL.md`](../connect/SKILL.md) — connect the wallet first.

For multi-feature work, load the broad [`sodax-wallet-sdk-react` skill](../SKILL.md).
