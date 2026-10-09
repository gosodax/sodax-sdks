---
name: sodax-sdk-bridge
description: 'Granular skill for the @sodax/sdk v2 bridge feature only — cross-chain token transfer via vault. Use when the task is specifically bridging (e.g. "bridge tokens cross-chain with Sodax", "Sodax bridge", "transfer USDC from Arbitrum to Stellar via Sodax", "check bridgeable amount"). The bridge() method returns `TxHashPair = { srcChainTxHash, dstChainTxHash }` for every cross-chain mutation. Covers BOTH integration (new v2 code) and migration (port v1 BridgeService). Skill links into the parent sodax-sdk knowledge tree. For React dapps, prefer sodax-dapp-kit.'
license: MIT
metadata:
  version: '0.0.1'
  author: sodax
---

# Bridge (Core SDK granular skill)

Granular skill for `BridgeService` — `sodax.bridge`. Feature tag: `'bridge'`.

## Step 1 — Clarify with user before coding

1. **New code or v1 → v2 port?**
2. **Signed flow (frontend) or unsigned-tx (backend)?**
3. **Need a bridgeable-amount precheck?** Vault deposit limits may cap the transfer; `getBridgeableAmount` (or equivalent) read tells you the cap before submitting.
4. **Source / destination chains** — confirm both are supported spoke chains, and the destination address format matches the chain (vd Stellar address starts with `G`, Solana base58, Bitcoin specific encodings).

## Integration workflow

1. [`../integration/knowledge/ai-rules.md`](../integration/knowledge/ai-rules.md).
2. [`../integration/knowledge/features/bridge.md`](../integration/knowledge/features/bridge.md) — API surface, `TxHashPair` return shape, bridgeable-amount reads.
3. Path-specific recipe:
   - Signed → [`../integration/knowledge/recipes/signed-tx-flow.md`](../integration/knowledge/recipes/signed-tx-flow.md)
   - Unsigned → [`../integration/knowledge/recipes/raw-tx-flow.md`](../integration/knowledge/recipes/raw-tx-flow.md)
4. Destination-chain quirks (Stellar trustline, BTC PSBT, Solana PDA) → [`../integration/knowledge/chain-specifics.md`](../integration/knowledge/chain-specifics.md).
5. Errors (`feature: 'bridge'`) → [`../integration/knowledge/reference/error-codes.md`](../integration/knowledge/reference/error-codes.md).

### Bridge-specific anti-patterns

- **Destructuring the return as an array or single hash.** v2 ALWAYS returns `{ srcChainTxHash, dstChainTxHash }` for cross-chain mutations — destructure by name.
- **Skipping the bridgeable-amount check.** Submitting an amount over the vault cap returns `EXECUTION_FAILED`; cheaper to check first.
- **Reporting a bridge as lost, or calling `bridge()` again, on a post-broadcast failure.** `TX_VERIFICATION_FAILED` and the relay codes carry `error.context.srcTxHash` — the deposit is on-chain and may still deliver, so keep polling `getDetailedStatus` with it. A second `bridge()` is a second deposit.

## Migration workflow (v1 → v2)

1. [`../migration-v1-to-v2/knowledge/ai-rules.md`](../migration-v1-to-v2/knowledge/ai-rules.md).
2. [`../migration-v1-to-v2/knowledge/features/bridge.md`](../migration-v1-to-v2/knowledge/features/bridge.md) — v1 `bridge()` returned a string; v2 returns `TxHashPair`. Update all destructuring sites.
3. v1 `BridgeError` → v2 `SodaxError<C>` with `feature: 'bridge'`.

## Verification

1. `pnpm tsc --noEmit` clean.
2. Every `await sodax.bridge.<method>(...)` has `if (!result.ok)`.
3. No string-typed return destructuring at `bridge()` call sites.

## Related granular skills (same family)

- [`../swap/SKILL.md`](../swap/SKILL.md) — for intent-based cross-chain swaps (different from a direct bridge: swap goes via a solver).
- [`../recovery/SKILL.md`](../recovery/SKILL.md) — `RecoveryService` for stuck assets on the hub.

For multi-feature tasks, load the broad [`sodax-sdk` skill](../SKILL.md).
