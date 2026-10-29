---
name: sodax-wallet-sdk-core-evm
description: 'Granular skill for the @sodax/wallet-sdk-core v2 EVM wallet provider only — `EvmWalletProvider` (backed by viem), one class covering all 14 SODAX EVM chains — the Sonic hub plus 13 EVM spoke chains (Ethereum, Arbitrum, Base, BSC, Optimism, Polygon, Avalanche, HyperEVM, Lightlink, Redbelly, Kaia, Hedera, Robinhood Chain). Use when a backend / Node script / CI / bot / non-React browser flow needs to instantiate an EVM provider directly and sign + broadcast — e.g. "instantiate EvmWalletProvider", "private-key EVM signing in Node", "EVM wallet provider for a bot", "sendTransaction from a script". Covers BOTH integration (write new v2 code) and migration (port v1 — almost a no-op at this surface: deep-import → barrel). Picks via Step 1. Links into the parent sodax-wallet-sdk-core knowledge tree. For React dapps use the sodax-wallet-sdk-react skill instead (get the typed provider via useWalletProvider).'
license: MIT
metadata:
  version: '0.0.1'
  author: sodax
---

# EVM (`wallet-sdk-core` granular skill)

Granular skill for `EvmWalletProvider` — the low-level EVM wallet for backend / Node / non-React flows. One class covers all 14 SODAX EVM chains — the Sonic hub plus 13 EVM spoke chains — via `getEvmViemChain()`. Source-of-truth reference lives in the parent broad skill's knowledge tree; this file is the focused workflow only.

## Step 1 — Clarify with user before coding

1. **New code or v1 → v2 port?** New → § Integration. Port v1 → § Migration (almost always a no-op here).
2. **Private-key or browser-extension config?** EVM discriminates by **field presence** (no `type`): PK = `{ privateKey, chainId, rpcUrl? }` (Node / CI / bots); browser-extension = `{ walletClient, publicClient }` (pre-built by wagmi / the consumer). Mutually exclusive — pick one.
3. **Which chain?** One `EvmWalletProvider` covers all 14 EVM chains (the Sonic hub plus 13 EVM spokes) via `chainId: EvmChainKey` (`ChainKeys.SONIC_MAINNET`, …).

## Integration workflow (new v2 code)

1. [`../integration/knowledge/ai-rules.md`](../integration/knowledge/ai-rules.md) — DO / DON'T (read first).
2. [`../integration/knowledge/architecture.md`](../integration/knowledge/architecture.md) — `BaseWalletProvider`, dual-config discriminants, shallow `defaults` merge, library-exports.
3. [`../integration/knowledge/features/evm.md`](../integration/knowledge/features/evm.md) — full config union, `EvmWalletDefaults`, methods (`getWalletAddress` / `sendTransaction` / `waitForTransactionReceipt`, plus the EIP-5792 batch trio `getAtomicBatchSupport` / `sendAtomicBatch` / `waitForBatch`), gotchas.
4. Setup recipe → [`../integration/knowledge/recipes/setup-private-key.md`](../integration/knowledge/recipes/setup-private-key.md) (Node) or [`../integration/knowledge/recipes/setup-browser-extension.md`](../integration/knowledge/recipes/setup-browser-extension.md); then [`../integration/knowledge/recipes/sign-and-broadcast.md`](../integration/knowledge/recipes/sign-and-broadcast.md), [`../integration/knowledge/recipes/defaults-and-overrides.md`](../integration/knowledge/recipes/defaults-and-overrides.md), [`../integration/knowledge/recipes/library-exports.md`](../integration/knowledge/recipes/library-exports.md).
5. Lookups → [`../integration/knowledge/reference/provider-classes.md`](../integration/knowledge/reference/provider-classes.md), [`interfaces.md`](../integration/knowledge/reference/interfaces.md), [`chain-support.md`](../integration/knowledge/reference/chain-support.md).

### EVM-specific anti-patterns

- **Mixing PK + browser-extension fields.** The config is a discriminated union — don't `as` across variants.
- **Expecting `defaults` to deep-merge.** It's shallow — top-level keys overwrite wholesale.
- **Passing `publicClient` / `walletClient` / `transport` defaults in browser-extension mode.** They're ignored (provider logs a one-time warn); supply them only in PK mode.
- **Adding `viem` as a direct dep** when `WalletClient` / `PublicClient` etc. re-export from `@sodax/wallet-sdk-core`.
- **Assuming nonce management.** There is none — fire parallel sends and you collide; set `defaults.sendTransaction.nonce` or per-call `nonce`.
- **Expecting EIP-5792 batches from a private-key provider.** `getAtomicBatchSupport` is always `'unsupported'` there and `sendAtomicBatch` throws — batching needs a connected wallet (browser-extension mode).
- **Skipping `expectedChainId` on chain-specific sends.** Without it the tx goes to whatever chain the wallet is on; with it a mismatch throws and nothing is sent.

## Migration workflow (port v1 → v2)

1. [`../migration-v1-to-v2/knowledge/ai-rules.md`](../migration-v1-to-v2/knowledge/ai-rules.md) — headline: **v1 code drops in unchanged at this surface** (class / config names identical).
2. The only mechanical change is deep-import → barrel: [`../migration-v1-to-v2/knowledge/breaking-changes/folder-layout.md`](../migration-v1-to-v2/knowledge/breaking-changes/folder-layout.md). Optionally adopt `defaults` ([`defaults-config.md`](../migration-v1-to-v2/knowledge/breaking-changes/defaults-config.md)) and re-imported library types ([`library-exports.md`](../migration-v1-to-v2/knowledge/breaking-changes/library-exports.md)).
3. If compile errors mention `@sodax/sdk` / `@sodax/types` symbols, it's **not** this migration — load the `sodax-sdk` skill (migration mode).

## Verification

1. `pnpm tsc --noEmit` exits clean.
2. Config uses exactly one discriminant variant (no PK + browser mixing).
3. No deep imports from v1's flat `wallet-providers/<chain>.ts` layout (migration only): `grep -rE "from '@sodax/wallet-sdk-core/wallet-providers/" src/` is empty.

## Related skills (same family)

Sibling chain skills follow the same shape — bitcoin, solana, sui, stellar, icon, injective, near, stacks. For multi-chain or undecided work, load the broad [`sodax-wallet-sdk-core` skill](../SKILL.md).

## Passing the provider into the SDK (different package family)

This skill *builds* the provider. For the concrete handoff, see [`../integration/knowledge/recipes/bridge-to-sdk.md`](../integration/knowledge/recipes/bridge-to-sdk.md). To execute SODAX operations with it, **also load the `sodax-sdk` skill (integration mode)** and pass the provider in the SDK call payload (`{ raw: false, walletProvider }`). React dapps should get the provider via `useWalletProvider(...)` — **load the `sodax-wallet-sdk-react` skill** instead.
