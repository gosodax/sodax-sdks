# AGENTS.md

Repository navigation hub for coding agents. Keep this file slim: it is loaded for nearly every task. Read the package or app `AGENTS.md` that owns the files you will touch before making changes.

## Project Overview

SODAX is a cross-chain DeFi SDK monorepo built around a hub-and-spoke architecture with Sonic as the hub chain. The SDK surface covers swaps, lending/borrowing, staking, bridging, concentrated-liquidity DEX flows, token migration, partner fee operations, and recovery flows across EVM and non-EVM ecosystems.

Do not hardcode supported chain counts or chain lists in agent guidance. When exact support matters, inspect the source of truth in `@sodax/types`, package source, or generated docs.

## Navigation

### Packages

| Package | Role | Guide |
| --- | --- | --- |
| `packages/types` | Shared TypeScript types, chain IDs, chain configs, wallet/API interfaces | [`packages/types/AGENTS.md`](packages/types/AGENTS.md) |
| `packages/libs` | Internal dependency isolation and stable third-party re-export subpaths | [`packages/libs/AGENTS.md`](packages/libs/AGENTS.md) |
| `packages/sdk` | Core `Sodax` facade, hub-and-spoke services, intent relay | [`packages/sdk/AGENTS.md`](packages/sdk/AGENTS.md) |
| `packages/swaps-api`, `packages/bridge-api` | Standalone type-safe HTTP clients for the backend Swaps / Bridge APIs; the wire sources the SDK's `sodax.api.swaps` / `sodax.api.bridge` wrap | [`swaps-api`](packages/swaps-api/README.md), [`bridge-api`](packages/bridge-api/README.md) |
| `packages/wallet-sdk-core` | Multi-chain wallet providers for signing and broadcasting | [`packages/wallet-sdk-core/AGENTS.md`](packages/wallet-sdk-core/AGENTS.md) |
| `packages/wallet-sdk-react` | React wallet state layer, connectors, providers, wallet modal primitives | [`packages/wallet-sdk-react/AGENTS.md`](packages/wallet-sdk-react/AGENTS.md) |
| `packages/dapp-kit` | React hooks combining SDK services, wallet providers, and React Query | [`packages/dapp-kit/AGENTS.md`](packages/dapp-kit/AGENTS.md) |
| `packages/skills` | Consumer-facing AI skills and knowledge for `@sodax/*` SDK users, plus the cross-cutting `sodax-build` front-door ideation skill | [`packages/skills/AGENTS.md`](packages/skills/AGENTS.md) |
| `packages/assets` | Static brand assets (chain logos) served by URL, never bundled into runtime packages | [`packages/assets/AGENTS.md`](packages/assets/AGENTS.md) |

### Apps

| App | Role | Guide |
| --- | --- | --- |
| `apps/demo` | Vite + React showcase for SDK and dapp-kit flows | [`apps/demo/AGENTS.md`](apps/demo/AGENTS.md) |
| `apps/node` | Node.js mainnet smoke scripts and E2E-style reproductions | [`apps/node/AGENTS.md`](apps/node/AGENTS.md) |
| `apps/node-cjs` | CommonJS interop regression harness for `@sodax/sdk` | [`apps/node-cjs/AGENTS.md`](apps/node-cjs/AGENTS.md) |
| `apps/wallet-modal-example` | Headless wallet-modal reference app for wallet-sdk-react primitives | [`apps/wallet-modal-example/AGENTS.md`](apps/wallet-modal-example/AGENTS.md) |
| `apps/swap-api-example` | Vite + React reference app driving `@sodax/swaps-api` end to end (wallet SDK for signing) | [`apps/swap-api-example/README.md`](apps/swap-api-example/README.md) |
| `apps/stellar-sponsor-example` | Vite + React reference app for the Stellar sponsored-activation journey (dapp-kit hooks), plus an offline test lab with a bundled mock backend | [`apps/stellar-sponsor-example/AGENTS.md`](apps/stellar-sponsor-example/AGENTS.md) |
| `apps/playground` | Embeddable SODAX swap widget and visual builder: quotes, wallet-backed execution, activity tracking and integration exports | [`apps/playground/AGENTS.md`](apps/playground/AGENTS.md) |

### Docs site

`docs/` is the docs.sodax.com Mintlify site, built from this repo by Mintlify's GitHub App: a page merged here is published, and one pushed to a branch gets a preview URL on the PR. Read [`docs/AGENTS.md`](docs/AGENTS.md) before adding, moving or renaming a page — paths are URLs, and `docs.json` navigation is what makes a page reachable. Gates: `pnpm check:docs-nav` and `pnpm docs:validate`.

## Dependency Direction

- `@sodax/types` has no package dependencies.
- `@sodax/swaps-api` and `@sodax/bridge-api` each depend on `@sodax/types` (and `valibot`) — standalone wire clients with no dependency on `@sodax/sdk`.
- `@sodax/sdk` depends on `@sodax/types`, `@sodax/swaps-api`, and `@sodax/bridge-api` (its `SwapsApiService` / `BridgeApiService` wrap the two wire clients) and re-exports public shared types.
- `@sodax/wallet-sdk-core` depends on `@sodax/types`.
- `@sodax/wallet-sdk-react` depends on `@sodax/types` and `@sodax/wallet-sdk-core`.
- `@sodax/dapp-kit` depends on `@sodax/sdk` and imports wallet-provider contracts through SDK/type exports.
- `@sodax/skills` is markdown/package metadata only and must not depend on runtime SDK packages.

Respect these boundaries when adding imports. If a change seems to need a reverse dependency, stop and find the package-level pattern first.

## Common Commands

Use the package manager declared in `package.json`.

```bash
pnpm i
pnpm build:packages
pnpm build
pnpm lint
pnpm pretty
pnpm checkTs
pnpm test
pnpm check:ai
```

For a single package:

```bash
cd packages/<pkg> && pnpm test
cd packages/<pkg> && pnpm test:e2e
cd packages/<pkg> && pnpm coverage
cd packages/<pkg> && npx vitest run path/to/test.test.ts
```

To try unreleased `@sodax/*` packages in a project outside this repo, pack them into local
tarballs — plain `pnpm pack` is not enough, because it rewrites `workspace:*` to a registry
version. See [`docs/local-package-testing.md`](docs/local-package-testing.md).

```bash
pnpm pack:local --version 2.0.0-local.1 --packages @sodax/sdk
```

## Repo-Wide Rules

- Keep changes scoped to the requested task. Do not refactor, restyle, rename, or expand nearby code unless it is required for correctness.
- Read the nearest package/app `AGENTS.md` before editing under that subtree.
- SDK package sources use `.js` extensions in relative imports because dual ESM/CJS output resolves them at build time.
- Biome is the only formatter/linter. Do not add ESLint or Prettier config.
- Build order matters: packages build before apps.
- Commits must follow conventional commit format and must not include AI-tool attribution.
- Do not add exact chain counts, issue-era history, or current-state claims to agent guidance unless the statement is stable and source-of-truth-backed.

## Issue Workflow

Work starts from an issue: its body is the spec, one `<!-- sodax:plan -->` comment is the plan, and the `plan-approved` label is the go signal. Read [`.github/issue-workflow.md`](.github/issue-workflow.md) before planning or implementing.

## Working Rules (planning + code quality)

These guide every change. Where a rule maps to tooling (types, lint, tests, `check:ai-*`), CI is the backstop; the rest are review-enforced. Before reporting a change done, run the relevant check and trust its real output over assumption.

- **Verify against current source.** Confirm every claim against `src/` before writing; do not rely on memory or older commits/PRs (the codebase refactors). If a fact is unverified, mark it so or ask.
- **Don't assume — ask when ambiguous.** If a required input or the scope is missing or unclear, stop and ask the requester or the source of truth rather than guessing.
- **Use the established skill/pattern.** Adding a token or chain → use the `add-token` / `add-chain` skill (`.claude/skills/`); don't wire it ad-hoc. Start from the nearest existing implementation.
- **Branch by case; don't over-generalize.** Chain/token work differs by family and feature (e.g. EVM vs non-EVM); verify the specific case instead of copying one onto another.
- **Source-derived config.** Token/chain config is source-of-truth in `@sodax/types` / backend — never hardcode chain or token lists in feature code.
- **No escape hatches.** Don't use `any`, `@ts-ignore`, non-null `!`, or unsafe casts to silence type/quality checks; fix the underlying type. (Existing `biome.json` overrides are tracked tech debt, not a license.)
- **Never commit or hardcode secrets.** Keep private keys, mnemonics, and RPC credentials in env vars (`process.env` / git-ignored `.env`, with `.env.example` placeholders) the way the `apps/node` smoke scripts do — never inline a real key, paste one into a sample, or log it. If a task needs a secret, stop and ask.
- **Fix the gate, don't game it.** Don't skip or disable tests (`.only`, `.skip`, deleted assertions), blanket-suppress lint, or bypass the husky pre-commit / commit-msg hooks (`--no-verify`, force-push) to go green. If a check fails, fix the cause or stop and report it — silencing it just hides the regression.
- **Preserve package boundaries.** Keep dependency direction intact and put reusable logic in the package/domain that owns it; don't hide cross-package coupling in callers.
- **Add dependencies deliberately.** Don't pull in a new runtime dependency for something the repo already covers; prefer existing utilities and the curated re-export subpaths in `packages/libs`. If a third-party dep is genuinely needed, isolate it through `packages/libs` and say why.
- **Keep feature services lean.** Feature-service code stays core feature logic; move reusable utilities and chain-specific work to `utils/`, entities, wallet providers, or spoke services. Extract a helper when it is genuinely shared, not as a speculative single-use abstraction.
- **Code is the source of truth — comment sparingly.** Make the code self-explanatory (clear names, small functions) instead of explaining it in prose. Add a comment only when confidence is high that the code cannot carry the point: a non-obvious constraint, invariant, or decision — then **1 line (preferred), 2 lines max**. The only exception is a function/class/type-level doc comment, which may be longer. Never narrate what the code or config already says, never leave commented-out code, and never add multi-row inline blocks — they bloat the file and drift out of sync with the code.
- **Cover new code with meaningful tests.** Add or extend tests for core flows, invariants, edge cases, and chain/feature matrices beside the changed code; don't rely on superficial coverage.
- **Keep AI docs faithful.** `packages/skills` teaches *partner* agents how to call the public API; it is not where we introduce a feature (that is `.claude/skills/` plus `packages/sdk/docs/`). When public behavior, imports, signatures, examples, chains, tokens, or feature support change, update `packages/skills` and run `pnpm check:ai`. That does not satisfy Docs Drift.
- **Docs generated into docs.sodax.com keep absolute links.** `scripts/docs-pages-map.json` maps the READMEs and `packages/sdk/docs` pages that `pnpm docs:sync-pages` generates into `docs/`, moving and renaming them on the way. In those sources a link may stay relative only when the target lands in the same destination directory under the same filename; every other target (moved doc, ungenerated doc, source file, directory) needs an absolute `https://github.com/icon-project/sodax-sdks/blob/main/…` URL, and never a `sodax-document` URL. Gate: `pnpm check:doc-links`.
- **New published docs must also be in nav.** Every mapped `src` is published, but that alone does not make it discoverable: its `dest` needs a matching entry in `docs/docs.json`, or the page is live but absent from the sidebar and from search. Gate: `pnpm check:docs-nav` — Docs Drift does not check nav.

**Definition of done:** scoped diff · behavior verified against `src/` · relevant `test`/`checkTs`/`lint`/`check:ai` green · mapped docs when package `src/` changed · `packages/skills` updated when public behavior changed · no unrelated refactor.

To review a change against these rules, use the `review-core-sdk` skill (`.claude/skills/review-core-sdk/`).

To cut a release, follow [`packages/RELEASE_INSTRUCTIONS.md`](packages/RELEASE_INSTRUCTIONS.md). `pnpm release` prompts for the version and applies it; committing, tagging, and publishing stay human steps. For curated stable-release notes, use the `changelog-from-prs` skill (`.claude/skills/changelog-from-prs/`).

## AI File Maintenance

- `AGENTS.md` is the canonical shared agent guidance. `CLAUDE.md` files should be thin Claude-specific shims that import the sibling `AGENTS.md`.
- Dev skills are authored and committed under `.claude/skills/` (the canonical copy). The `.agents/skills/` (Codex) and `.github/skills/` (Copilot) mirrors are gitignored and regenerated locally by the Vercel `skills` CLI (`npx skills`); native Codex/Copilot auto-trigger needs that local sync, while the `AGENTS.md` skill pointers work without it. Edit the skill in `.claude/skills/`, never a generated mirror.
- Root guidance is for information every domain needs. Put package/app-specific architecture, patterns, commands, and pitfalls in that subtree's `AGENTS.md`.
- Prefer broad durable patterns over volatile enumerations. When exact values matter, point agents to source files or package docs rather than copying values.
- Validate changes to these files with `pnpm check:ai-dev-files`.
- When a pull request changes source that an AI file describes, a read-only agent compares that guidance against the source and reports guidance the current source disproves. Missing coverage is advisory, and so is the whole check until the `AI_DRIFT_ENFORCE` repository variable is set. Label a pull request `no-ai-drift` to skip it when a finding is wrong.
- When a generated doc is added, renamed, or removed, update its `scripts/docs-pages-map.json` entry — every mapped src is published — and the `docs.json` nav entry for its `dest` together, then run `pnpm docs:sync-pages`. Gates: `pnpm check:docs-pages` and `pnpm check:docs-nav`.

## CI Shape

`Build and Test`, `Docs site`, `Issue linked` and Docs Drift block a pull request; e2e, AI drift and Plan check are advisory. Bypass labels (`no-issue`, `no-plan`, `docs-not-needed`, `no-ai-drift`) are maintainer decisions. Locally run `pnpm check:ai` when changing `packages/skills`, `pnpm docs:validate` for `docs/`, and `pnpm test:e2e` when touching a flow it covers. Read [`.github/ci.md`](.github/ci.md) before changing a workflow or gate script.
