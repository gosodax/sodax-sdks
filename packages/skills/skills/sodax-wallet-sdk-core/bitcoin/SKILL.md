---
name: sodax-wallet-sdk-core-bitcoin
description: 'Granular skill for the @sodax/wallet-sdk-core v2 Bitcoin wallet provider only — `BitcoinWalletProvider` (PSBT signing via bitcoinjs-lib + ecpair + bip322-js). Use when a backend / Node script / CI / bot / non-React browser flow needs to instantiate a Bitcoin provider directly and sign PSBTs / messages — e.g. "instantiate BitcoinWalletProvider", "sign a PSBT in Node", "BIP-322 vs ECDSA message signing", "private-key Bitcoin signing". Covers BOTH integration (write new v2 code) and migration (port v1 — almost a no-op at this surface: deep-import → barrel). Picks via Step 1. Links into the parent sodax-wallet-sdk-core knowledge tree. For React dapps use the sodax-wallet-sdk-react skill instead (get the typed provider via useWalletProvider).'
license: MIT
metadata:
  version: '0.0.1'
  author: sodax
---

# Bitcoin (`wallet-sdk-core` granular skill)

Granular skill for `BitcoinWalletProvider` — the low-level Bitcoin wallet for backend / Node / non-React flows. Source-of-truth reference lives in the parent broad skill's knowledge tree; this file is the focused workflow only.

## Step 1 — Clarify with user before coding

1. **New code or v1 → v2 port?** New → § Integration. Port v1 → § Migration (almost always a no-op here).
2. **Private-key or browser-extension config?** Bitcoin discriminates by an **explicit uppercase `type`** (`'PRIVATE_KEY'` | `'BROWSER_EXTENSION'`) — not field presence. PK = `{ type: 'PRIVATE_KEY', privateKey, network, addressType? }`; browser-extension = `{ type: 'BROWSER_EXTENSION', walletsKit, network }`.
3. **Which message-signing scheme?** `signBip322Message` (modern, structured) vs `signEcdsaMessage` (legacy `signmessage`) — pick based on what the verifier expects.

## Integration workflow (new v2 code)

1. [`../integration/knowledge/ai-rules.md`](../integration/knowledge/ai-rules.md) — DO / DON'T (read first).
2. [`../integration/knowledge/architecture.md`](../integration/knowledge/architecture.md) — `BaseWalletProvider`, dual-config discriminants, shallow `defaults` merge, library-exports.
3. [`../integration/knowledge/features/bitcoin.md`](../integration/knowledge/features/bitcoin.md) — full config union, `BitcoinWalletDefaults`, `BitcoinWalletsKit` shape, methods (`signTransaction` / `signEcdsaMessage` / `signBip322Message` / `sendBitcoin`), gotchas.
4. Setup recipe → [`../integration/knowledge/recipes/setup-private-key.md`](../integration/knowledge/recipes/setup-private-key.md) or [`../integration/knowledge/recipes/setup-browser-extension.md`](../integration/knowledge/recipes/setup-browser-extension.md); then [`../integration/knowledge/recipes/sign-and-broadcast.md`](../integration/knowledge/recipes/sign-and-broadcast.md), [`../integration/knowledge/recipes/defaults-and-overrides.md`](../integration/knowledge/recipes/defaults-and-overrides.md).
5. Lookups → [`../integration/knowledge/reference/provider-classes.md`](../integration/knowledge/reference/provider-classes.md), [`interfaces.md`](../integration/knowledge/reference/interfaces.md), [`chain-support.md`](../integration/knowledge/reference/chain-support.md).

### Bitcoin-specific anti-patterns

- **Forgetting the `type` discriminant.** Bitcoin and Stellar use an **uppercase `type` field** — every other chain uses field presence. Easy to confuse.
- **Passing PSBT as hex to `signTransaction`.** Inputs are **base64**-encoded; in browser-extension mode the same base64 is forwarded to `walletsKit.signPsbt` (whose param is misleadingly named `psbtHex`).
- **Calling `sendBitcoin` unconditionally.** It's optional on the wallet kit — guard on its presence (Xverse / Unisat implement it; others don't).
- **Assuming the `addressType` default is network-dependent.** Optional in PK mode; when omitted the provider defaults it to `P2WPKH` (a constant — same on testnet and mainnet). Set it explicitly for P2TR / P2SH / P2PKH.
- **Mixing PK + browser-extension fields.** Discriminated union — don't `as`.

## Migration workflow (port v1 → v2)

1. [`../migration-v1-to-v2/knowledge/ai-rules.md`](../migration-v1-to-v2/knowledge/ai-rules.md) — headline: **v1 code drops in unchanged at this surface**.
2. Only mechanical change: deep-import → barrel ([`../migration-v1-to-v2/knowledge/breaking-changes/folder-layout.md`](../migration-v1-to-v2/knowledge/breaking-changes/folder-layout.md)). Optionally adopt `defaults` ([`defaults-config.md`](../migration-v1-to-v2/knowledge/breaking-changes/defaults-config.md)) / re-imported library types ([`library-exports.md`](../migration-v1-to-v2/knowledge/breaking-changes/library-exports.md)).
3. Compile errors on `@sodax/sdk` / `@sodax/types` symbols → not this migration; load the `sodax-sdk` skill (migration mode).

## Verification

1. `pnpm tsc --noEmit` exits clean.
2. Config sets `type` and uses exactly one variant; PSBTs are base64.
3. No v1 deep imports from `@sodax/wallet-sdk-core/wallet-providers/` (migration only).

## Related skills (same family)

Sibling chain skills follow the same shape — evm, solana, sui, stellar, icon, injective, near, stacks, tron. For multi-chain or undecided work, load the broad [`sodax-wallet-sdk-core` skill](../SKILL.md).

## Passing the provider into the SDK (different package family)

This skill *builds* the provider. For the concrete handoff, see [`../integration/knowledge/recipes/bridge-to-sdk.md`](../integration/knowledge/recipes/bridge-to-sdk.md). To execute SODAX operations, **also load the `sodax-sdk` skill (integration mode)** and pass it as `{ raw: false, walletProvider }`. React dapps get the provider via `useWalletProvider(...)` — **load the `sodax-wallet-sdk-react` skill** instead.
