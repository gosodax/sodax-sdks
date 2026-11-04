---
name: review-core-sdk
description: 'Use when reviewing a change, diff, or PR to the SODAX core SDK (packages/sdk plus the type and wallet packages it touches) — checking correctness, scope, architecture, types/safety, tests, source-derived config, secrets, and AI-doc faithfulness before it lands. Triggers on "review this SDK change", "review the diff/PR", "code review for the sdk", "is this ready to merge", "check this against the working rules". Operationalizes the root AGENTS.md Working Rules as a concrete review pass backed by the repo gates.'
---

# Reviewing a Core SDK Change

> Operationalizes the **Working Rules** in root `AGENTS.md` as a review pass. Verify every claim
> against current `src/` and trust real command output over assumption. Default to skeptical — a
> finding you cannot reproduce against the diff is not a finding.

## 1. Scope the diff
`git diff origin/main...HEAD --stat`, then read the hunks. Anything outside the stated task — an unrelated refactor, rename, or restyle — is a defect; the change should be scoped.

## 2. Run the gates (read real output, don't assume)
- `pnpm checkTs` · `pnpm lint` · `pnpm --filter @sodax/sdk test` (add `pnpm --filter @sodax/sdk test:e2e` if cross-chain logic changed; run the `apps/node` smoke script for the affected chain when relevant).
- `pnpm check:ai-dev-files`, and `pnpm check:ai` if `packages/skills` changed.
- `pnpm check:doc-links` if the diff touches a doc listed in `scripts/docs-pages-map.json` (`packages/sdk/docs/**`, package READMEs, `docs/ai-integration-guide.md`).
- Docs Drift (job **Docs ship with code**): each package whose `src/` changed needs a *related* mapped doc (`packages/<pkg>/…` in `scripts/docs-pages-map.json`, a mapped `packages/sdk/docs/` page, or a mapped root-level `docs/` guide whose `pkgs` array lists the package), the package README, or `packages/<pkg>/docs/` (non-sdk). JSDoc, `unpublished` sdk/docs pages, `packages/skills`, an unrelated mapped file, and deleting a README or docs file do not count; moving source out of `src/` still counts as a source change. A new `packages/sdk/docs/` page must be on the map's `mirrored` or `unpublished` list even without an `src/` change, a renamed published page must take its map entry with it, and every mapped src must exist and be a `.md`/`.mdx` page. The `docs-not-needed` label is the only skip.
- The Security workflow runs gitleaks + Semgrep — a new hardcoded `0x`+64-hex key or other secret is a hard reject.

## 3. Review dimensions
Walk the diff against each:
- **Source-verified** — every behavioral claim matches `src/`; no stale references to refactored-away symbols.
- **Architecture & boundaries** — dependency direction intact (`@sodax/types` ← sdk ← dapp-kit); chain-specific work routes through `this.spoke.getSpokeService(chainKey)`, not new chain providers; feature services stay lean (reusable/chain-specific logic moved to `utils/`, entities, or spoke services).
- **Types & safety** — no `any` / `@ts-ignore` / non-null `!` / unsafe casts; public ops return `Result<T>` and fail via `SodaxError` (discriminate on `feature` / `code`); validation, amount/decimal, address, and signing surfaces are not weakened (financial code).
- **Source-derived config** — no chain/token lists hardcoded in feature code; config flows through `ConfigService` / `@sodax/types`.
- **Tests** — new behavior has meaningful tests beside it (flows, invariants, edge cases, chain/feature matrix); no `.only` / `.skip` (lint blocks these); a new EVM spoke is added to `TEST_CHAINS`.
- **Established pattern** — token / chain / wallet / feature work used the matching skill (`add-token` / `add-chain` / `add-wallet-provider` / `add-feature`), not ad-hoc wiring.
- **AI docs faithful** — public behavior, imports, signatures, examples, chains, or tokens changed ⇒ `packages/skills` updated (partner-agent surface, not Docs Drift) and `pnpm check:ai` green.
- **docs.sodax.com links** — in a doc generated into the Mintlify site under `docs/`, a relative link is only valid when the target lands in the same directory under the same name; anything else needs an absolute `sodax-sdks/blob/main/…` URL, never a `sodax-document` one.

## 4. Verdict
Report against the **definition of done** (root `AGENTS.md`): scoped diff · behavior verified vs `src/` · relevant gates green · `packages/skills` updated when public behavior changed · no unrelated refactor. Cite `file:line` per finding and separate must-fix (correctness, safety, gate failures) from nits.
