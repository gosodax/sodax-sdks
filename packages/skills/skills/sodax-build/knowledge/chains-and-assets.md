# Chains & assets

> **Source & freshness.** The supported chains and tokens **change between releases** — never quote a definitive list from memory. Fetch the current set from live source before naming exact chains/tokens/addresses (where to look: the README *Source & freshness policy*). This file gives the **qualitative shape** only, which is safe for ideation.

## The shape (qualitative — safe to use)

SODAX is **hub-and-spoke**: **Sonic is the hub**, and a broad set of spoke chains spans **both EVM and non-EVM ecosystems**. For ideation you only need two facts:

1. **There are many EVM chains** (for example major chains like Ethereum and Base; Sonic itself is the hub). They all share one wallet-provider family, so adding a second or third EVM chain is cheap.
2. **There are several non-EVM chains** across different ecosystems (for example Solana, Sui, Bitcoin). Each non-EVM chain needs its **own** wallet provider — this is real extra work and changes the handoff.

These names are **illustrative anchors only** — do not bake the actual chain list into the brief; confirm it from live source when it matters.

**Cross-chain is the value.** SODAX's edge is moving value *between* these chains through the hub — that is the main reason to build on it. Lead the design with the cross-chain story.

## How to use this in the interview (Stage 3)

- **Recommend starting small.** For a non-technical user, a good default is **a small number of EVM chains** (e.g. one major chain plus one lower-fee chain). Confirm rather than open-question.
- **Honesty-gate unsupported chains.** If the user names a chain you cannot confirm in live source, say you need to check and do so — never assert support from memory.
- **Flag the non-EVM cost.** If the product touches **any non-EVM chain**, note in the brief that it pulls in a chain-specific wallet provider (a matching chain skill in `sodax-wallet-sdk-core`). EVM-only products avoid this.
- **Some chains carry extra constraints.** A few chains have their own integration model or readiness gates. If a product centers on one of those, flag it as needing extra validation and confirm against live source before committing.

## Assets

- Bridgeability and per-feature token support are **runtime facts**, not a fixed table. The live list comes from the backend (`sodax.api.swaps.getTokens()`, `sodax.api.bridge.getTokens()`, the bridgeable amount); the SDK's feature services accept only the tokens bundled with the installed version. Note it as a dev-time check in the brief.
- Never promise a specific token is supported without confirming live source.
