## Summary
<!-- Required. 1–3 sentences: what changed and why. Lead with user-visible effect. Add a screenshot or diagram only if it explains faster than prose. -->

**Issue (required, exactly one):**
<!-- The "Issue linked" check fails unless the body has "Closes #N" (or Fixes/Resolves #N) or the PR carries the no-issue label. One line per issue. -->
Closes #
- [ ] No issue: the `no-issue` label is applied. Reason: ______
<!-- e.g. typo or docs-only fix, dependency bump, release chore, follow-up to #N. "N/A" is not a reason. -->

## Evidence
<!-- Concrete proof, not claims. Paste real output; never write "tests pass" without the command. -->
**Before:** <!-- Prior behavior, failing test, or screenshot. "N/A" for new features. -->
**After:** <!-- Passing test/output, screenshot, or other observable result. -->
**Validation:**
<!-- Exact commands and outcomes, e.g.
- `pnpm checkTs` — pass
- `cd packages/sdk && pnpm test` — 412 passed
- `pnpm check:ai` — pass (if packages/skills changed) -->

## Merge Danger
**Door:** <!-- two-way (revert is safe) | one-way (published API, on-chain/contract address, persisted data, release) -->
**Blast radius:** <!-- Packages, chains, or features affected if this is wrong, and who notices (partners, dapp users, internal only). -->

## Documentation
<!-- Docs Drift gate: needs a mapped file, a mapped root docs/ guide listing the package, the package README, or packages/<pkg>/docs/. JSDoc and packages/skills do not count. See CONTRIBUTING.md#documentation. -->
- [ ] Published module docs in `packages/sdk/docs/` (mapped in `scripts/docs-pages-map.json`: ______)
- [ ] A mapped root-level `docs/` guide whose `pkgs` lists the package
- [ ] Package `README.md` or `packages/<pkg>/docs/`
- [ ] None needed (needs the `docs-not-needed` label). Reason: ______
<!-- e.g. "internal refactor, public API unchanged". A new export in the diff means docs are expected. -->

## Checklist
- [ ] Self-reviewed; diff is scoped to this change
- [ ] Tests added or updated for the changed behavior
- [ ] PR title follows [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) (it becomes the squash commit)
- [ ] Added/renamed/removed a published doc → `scripts/docs-pages-map.json` and `docs/docs.json` nav updated
- [ ] Changed a public API partners call → `packages/skills` updated and `pnpm check:ai` passes

## Notes
<!-- Write "None" rather than deleting. Otherwise list:
- Breaking (type-level): removed/renamed exports, changed signatures
- Breaking (runtime behavior): same types, different behavior
- Migration or deployment steps, follow-ups, related PRs -->
