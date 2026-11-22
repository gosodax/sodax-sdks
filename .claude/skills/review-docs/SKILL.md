---
name: review-docs
description: 'Use when reviewing a change, diff or PR that adds or edits hand-written docs.sodax.com content — guides, how-tos, quickstarts, network pages, blog posts, or examples in apps/docs-examples — for drift risk: pasted TypeScript, restated SDK knowledge, claims with no check, lane violations and site hygiene. Triggers on "review this docs PR", "review the guide", "is this page ready", "check the docs change", "review the blog post". The counterpart of write-docs; SDK code changes go to review-core-sdk.'
---

# Reviewing a docs.sodax.com change

> Pass a page only when nothing on it can go stale unnoticed. Default to skeptical: every
> finding cites `file:line`, and a finding you cannot point at a line for is not a finding.
> The writing rules this enforces are in `.claude/skills/write-docs/`.

## 1. Scope and lane
`git diff origin/main...HEAD --stat`, then read every hunk.
- A content-lane change touches only hand-written `docs/` pages, `docs/docs.json`, `docs/images/`
  and `apps/docs-examples`. Anything else (packages, other apps, scripts, CI) is **must-fix: out
  of lane**. Split it into its own issue.
- An edit to a page with a `generatedFrom` key is must-fix. Edit the source it names instead.
- Restructured nav, renamed pages or changed headings that the task did not ask for are must-fix
  scope creep.

## 2. Run the gates (read real output)
```bash
pnpm --filter docs-examples checkTs && pnpm --filter docs-examples test
pnpm check:docs-examples --base origin/main
pnpm check:docs-nav && pnpm check:docs-pages
pnpm docs:validate
```
Any red gate is must-fix. If the diff touches `scripts/docs-examples-allowlist.json`, the only
legitimate change is an entry lowered or removed. An added or raised entry is must-fix, even
when the local check passes without `--base`.

## 3. Walk each changed page, claim by claim
- **Code is sourced.** Every `ts` / `tsx` / `typescript` fence has an `example:` marker. Each
  `example: none` has a real reason: it must be pseudocode that cannot compile, not
  inconvenient code.
- **Examples are honest.** They import public entry points only. Reader-supplied values are
  `declare`d outside the region, not faked inside it. Nothing uses `any`, `@ts-ignore`, `!` or
  `as unknown as` to force a compile.
- **Behaviour claims are tested.** When prose asserts what the code does ("returns `null`",
  "reports `0n`") and the example runs without a network, a test beside it asserts that
  exact claim. Otherwise, flag it.
- **Nothing is restated.** For each factual sentence, search the source
  (`packages/*/src`, JSDoc, package `README.md`, `packages/sdk/docs`, package `AGENTS.md`). If it
  already says this, the sentence should be a link. Parameter, field and error-code tables and
  explanations of internal mechanisms are findings.
- **No unguarded volatile facts.** Typed chain or token names, counts or addresses (they need a
  `data-sodax-config` element), "since x.y", "currently", "new", intervals and defaults copied
  from code are all findings.
- **Prose matches source.** Verify every remaining claim against current `src/`, not memory.
  A claim the source contradicts is must-fix.
- **Site hygiene** (`docs/AGENTS.md`): `title` and `icon` frontmatter, body starts at `##`,
  `{/* */}` comments only, root-relative extensionless links, a new page listed in `docs/docs.json`,
  images with alt text.

## 4. Verdict
Group findings as **must-fix** (gate failure, out of lane, unsourced code, contradiction with
source, unguarded volatile fact) and **nits** (restated knowledge that is still correct, wording,
a missing test for a minor claim). Give each finding its `file:line`, the rule it breaks, and the
concrete fix (the link to use, the region to create, or the sentence to cut). End with
*ready* or *not ready*.
