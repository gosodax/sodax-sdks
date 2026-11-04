# Interview guide

The branching question tree the `sodax-build` workflow drives. Goal: turn a vague idea into a single, well-scoped Phase-1 product without making the user learn DeFi.

## Rules (apply throughout)

- **One question at a time.** Never batch.
- **Always offer a recommended default** the user can accept ("Most people start with X — sound right?"), especially for Tier A.
- **Reflect the goal back in the user's own words** before mapping it to a feature.
- **Product language before jargon.** Ask about behavior ("move money to a friend on another chain"), not features ("bridge"). Gloss a term only when you must, per [`glossary.md`](./glossary.md).
- **Converge, don't expand.** Drive toward ONE primary goal (+ at most one secondary). Park everything else in "out of scope (v1)".
- **Honesty-gate** unsupported chains/assets and unknown exact values against [`chains-and-assets.md`](./chains-and-assets.md) — fetch live source rather than guess.

## Stage 0 — Tech-comfort gate (sets the tier)

First question. Set a persistent tier that controls vocabulary and question count:

- **A — non-coder:** "I am not a developer" / business or product framing.
- **B — semi-technical:** builds apps, new to DeFi/crypto.
- **C — developer:** names languages, frameworks, or SDKs → likely belongs in a dev skill (re-check the SKILL.md STOP gate).

Soft-detect from their phrasing too; re-check at every stage.

## Stage 1 — Goal in their own words

Open-ended: *"In one or two sentences, what do you want people to be able to do?"* Classify into an archetype internally, but **confirm it back in their words**. Lock a single primary goal.

## Stage 2 — Map goal → feature (the branching core)

Each archetype opens 1–3 disambiguating questions phrased about **product behavior**, never requiring the user to name a feature. Mapping table:

| User says (plain English) | Disambiguator | SODAX feature |
|---|---|---|
| "move money / pay someone / send to another chain" | Same coin on the other side? | **Bridge** |
| "let people trade / convert one coin to another" | Different coin out? | **Swap** |
| "earn / savings / put money to work" | Lend out their own assets? | **Money market** (supply) |
| "earn by locking SODA" | Lock the SODA token? | **Staking** |
| "borrow against what they hold" | Use collateral? | **Money market** (borrow) |
| "provide liquidity / market-make" | Run an LP position? | **DEX** (concentrated liquidity) |
| "leveraged / amplified yield" (advanced — Tier B/C only) | Understands leverage risk? | **Leverage yield** (see [`feature-catalog.md`](./feature-catalog.md); never offer Tier A as "savings") |
| "move a legacy ICON-era token over" | Which token — ICX / BALN / bnUSD? | **Token migration** (else honesty-gate) |
| "launch a brand-new token" | — | **Honesty-gate**: SODAX does not mint new tokens |
| "get back funds stuck on the hub" | — | **Recovery** (usually secondary) |

> **Lead with cross-chain — it is SODAX's edge.** Swap vs Bridge is about the *coin*, not the chain: Swap = the output token differs (most powerfully **across chains**); Bridge = the *same* token moved to another chain. A same-chain conversion is still a Swap (not a Bridge); lead with the cross-chain angle — that is SODAX's strength.

Always plant the **monetization seed** here: *"Do you want to earn from this — now, later, or keep it free?"* (detail deferred to Stage 4).

See [`feature-catalog.md`](./feature-catalog.md) for the plain-English description of each feature, and [`use-case-gallery.md`](./use-case-gallery.md) for worked combinations.

## Stage 3 — Users, chains, assets

- **Who uses it** and **on which chains**. Tier A gets a recommended default to confirm (e.g. "start with a small number of EVM chains — one major chain plus one lower-fee chain"). Confirm against [`chains-and-assets.md`](./chains-and-assets.md).
- **Honesty-gate** any unsupported chain.
- **Flag non-EVM assets**: if the product touches **any non-EVM chain**, note that it pulls in a chain-specific wallet provider — this changes the handoff (a matching chain skill in `sodax-wallet-sdk-core`). Confirm which chains are non-EVM against live source if it matters.

## Stage 4 — Monetization detail (only if not "free")

Frame against [`monetization.md`](./monetization.md). Capture: percentage vs fixed; which actions carry the fee; where fees go (default: defer the fee address). **Treat the exact percentage cap as policy-sensitive** — prefer low, transparent fees; fetch live source before quoting an exact cap.

## Stage 5 — Converge on scope + playback

- Force **one** Phase-1 tracer-bullet (the smallest end-to-end slice that delivers the core value).
- Capture an explicit **out-of-scope (v1)** list.
- Infer the **build shape**: browser + wallet UI → React path; service/bot → backend path; existing v1 code detected → migration mode. This drives [`handoff.md`](./handoff.md).
- **Playback:** restate the whole thing as plain bullets and ask for a single confirmation. Only after the user confirms, assemble the brief from [`brief-template.md`](./brief-template.md).
