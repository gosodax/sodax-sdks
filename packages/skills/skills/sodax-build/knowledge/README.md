# sodax-build knowledge — index

Reference material for the `sodax-build` front-door skill. The SKILL.md workflow points at these files in order; do not read them top-to-bottom.

| File | Use it to… |
|---|---|
| [`interview-guide.md`](./interview-guide.md) | Drive the tiered, branching interview (Stage 0–5) + map plain-English goals to SODAX features. |
| [`example-sessions.md`](./example-sessions.md) | Style reference: two worked interview transcripts (a Tier-A and a Tier-C session) end to end. |
| [`feature-catalog.md`](./feature-catalog.md) | Explain, in plain English, what each SODAX capability lets an end-user *do*. |
| [`use-case-gallery.md`](./use-case-gallery.md) | Borrow worked product ideas → the features + chains they use. |
| [`glossary.md`](./glossary.md) | Gloss DeFi jargon for non-technical users (tiered). |
| [`chains-and-assets.md`](./chains-and-assets.md) | Talk about supported chains/assets qualitatively; honesty-gate the unsupported. |
| [`monetization.md`](./monetization.md) | Frame partner-fee monetization honestly. |
| [`brief-template.md`](./brief-template.md) | Assemble the 9-section product brief. |
| [`handoff.md`](./handoff.md) | Route the finished brief to the exact developer skill(s) + scaffolding steps. |

## Source & freshness policy (read once; applies to every file here)

This skill is **self-contained** — it needs no network to run the interview. But the facts it cites are **derived from** the SODAX repository, and some of them drift between releases. Apply this rule everywhere:

- **Qualitative facts are baked in and stable** — what a feature *does*, the hub-and-spoke model, the intent/solver swap model, archetype → feature mappings. Use them directly.
- **Enumerable / exact values are NOT baked in — fetch live before quoting.** This includes the supported chains, token symbols/addresses, fee numbers/caps, and any config value. When a user needs a precise value, open the current source and quote *that*, not memory.

**Where to look** — navigate the current source by package + area, not a hard path (exact filenames move between releases):

- Chains, tokens, and config → the **`@sodax/types`** package source.
- Fees, and which feature services exist → the **`@sodax/sdk`** package source.

Repo: `https://github.com/gosodax/sodax-sdks` (the `@sodax/*` packages live under `packages/`). Other files here point back to this policy rather than repeating paths.

## Honesty rules

- Never invent a supported chain, token, or exact fee number. If unsure, say so and fetch the source.
- Never promise yields, returns, or price outcomes. This skill designs **products**, not investments — keep risk/disclosure framing separate from product design.
- Never write app code here. The deliverable is a brief + a handoff naming the developer skill that writes code.
