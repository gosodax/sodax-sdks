---
name: changelog-from-prs
description: 'Use when drafting curated release notes for a STABLE `@sdks@X.Y.Z` release of the @sodax/* packages (e.g. 2.1.0 → 2.2.0) from the pull requests merged since the previous stable tag. Splits type-level breaking changes from runtime behavior changes. Returns copyable Markdown in chat for the GitHub Release body and the Discord announcement; never writes files, tags, or releases. Triggers on "release notes for 2.2.0", "changelog since the last release", "what shipped since 2.1.0", "summarize PRs for the release", "draft the GitHub release notes".'
---

# Release Notes from Merged PRs

> Turns the squash-merged pull requests between two **stable** `@sdks@` tags into reader-facing
> release notes for `@sodax/*` consumers. `pnpm release` already writes a raw, commit-grouped
> `release-notes.md` (see [`packages/RELEASE_INSTRUCTIONS.md`](https://github.com/icon-project/sodax-sdks/blob/main/packages/RELEASE_INSTRUCTIONS.md));
> this skill is the curated version a human pastes over it before `gh release create`.

## Output contract

- Return the complete notes in **one** fenced `markdown` code block in chat. Keep commentary outside it to a few lines.
- Do not create, edit, or save any file (`release-notes.md`, `CHANGELOG.md`, or otherwise). Do not tag, push, or publish.
- Header is `## @sdks@<target> — <YYYY-MM-DD>`. If the target version is not given and no newer stable tag exists, use `## @sdks@Unreleased`; never invent a number.
- Omit empty sections. Never invent a change or a migration step — see [Uncertain PRs](#uncertain-prs).

## 1. Fix the range (stable → stable only)

Release candidates (`@sdks@X.Y.Z-rc.N`) are **not** range boundaries: notes for `2.2.0` cover everything since `2.1.0`, including all of its RCs. Per-package backport tags (`@sodax/<pkg>@…`) are ignored.

```bash
git fetch origin --tags main release
# A shallow clone (CI, cloud sessions) breaks merge-base below; deepen it first.
[ "$(git rev-parse --is-shallow-repository)" = true ] && git fetch --unshallow origin main release
# Newest stable tags, highest first. rc tags filtered out.
git tag -l '@sdks@*' | grep -Ev -- '-rc\.' | sort -t@ -k3 -V -r | head -3
```

- **Lower bound** — the newest stable tag *below* the target (`@sdks@2.1.0` for a `2.2.0` release).
- **Upper bound** — the target tag if it already exists (`@sdks@2.2.0`); otherwise `origin/release` once `main` has been merged into it, else `origin/main`.

Stable tags sit on the `release` branch, and `main` is merged into `release` with `--no-ff`, so measure `main`'s history from the merge base — exactly as `scripts/release.mjs` does:

```bash
FROM='@sdks@2.1.0'; TO='origin/release'   # or the target tag / origin/main
BASE=$(git merge-base origin/main "$FROM")
# PRs that landed on main (first-parent = one squash commit per PR):
git log --first-parent --reverse --format='%h%x09%s%x09%an <%ae>%x09%(trailers:key=Co-authored-by,valueonly,separator=; )' "$BASE..origin/main"
# Fixes committed directly on release (cherry-picks, hotfixes) since the last stable tag:
git log --no-merges --format='%h%x09%s%x09%an <%ae>%x09%(trailers:key=Co-authored-by,valueonly,separator=; )' "$TO" ^origin/main "^$FROM"
```

If `TO` is a tag, replace `origin/main` in the first command with `$(git merge-base origin/main "$TO")`. Skip `Merge branch 'main' … into release` merges and version-bump commits (`chore: release @sdks@…`, `chore: bump … to <version>`); the release-only list is usually just those.

## 2. Collect the PRs

Every PR is squash-merged with a validated conventional title, so each subject reads `type(scope)!: summary (#<n>)`. The number in the trailing `(#<n>)` is the PR. Fetch details only where the subject is not enough to classify or describe the change:

```bash
gh pr view <n> --repo icon-project/sodax-sdks --json title,body,labels,files,url,author
```

(Without `gh`, use the GitHub MCP `pull_request_read` tool.) Read the body for `BREAKING CHANGE`, migration notes, and the actual user impact. Read `files` when the scope is missing or vague.

## 2b. Record contributors (every PR in range)

Credit is collected **before** filtering, from every PR in range, including the apps, CI, and docs PRs that step 3 drops from the notes. For each PR keep:

- **Author** — the PR's GitHub login (`author.login` from `gh pr view`). Without `gh`, take the login from a `<id>+<login>@users.noreply.github.com` commit email; otherwise keep the git name as plain text. Never guess an `@handle` from a name.
- **Co-authors** — the commit's `Co-authored-by:` trailers, resolved the same way.
- **Drop bots and AI tools** — `[bot]` logins (dependabot, renovate, github-actions), Mintlify, and AI co-author trailers such as `noreply@anthropic.com`. They are not contributors.

**Reverts cancel out.** A `revert(...)` PR and the PR it reverts are both dropped when both are in range; a "reapply" PR is described on its own merits.

## 3. Keep only consumer-facing changes

The audience is integrators installing the published `@sodax/*` packages. Determine what is published from source, not memory — a package is published when its `packages/<dir>/package.json` is not `"private": true`:

```bash
for p in packages/*/package.json; do node -e "const m=require('./$p'); m.private||console.log(m.name)"; done
```

- **Include:** changes under a published package's `src/` (or its public exports, build output, or peer deps) — features, fixes, behavior changes, new tokens/chains, removed or renamed exports, dependency bumps that change consumer requirements.
- **Include in one line, not per-PR:** notable `@sodax/skills` updates and new docs.sodax.com guides, only if a consumer would go looking for them.
- **Omit:** `apps/*` (demo, playground, examples), CI, repo tooling, tests, internal refactors, AI dev files, and docs-only PRs that do not announce a feature.

When a PR touches both a published package and an app, describe only the package change.

## 4. Classify

Order of evidence: the `!` / `BREAKING CHANGE` marker → the conventional type → the PR body → the diff. Labels are rarely used here; honor `breaking` / `security` labels when present.

Each section heading carries a fixed icon. Use exactly these headings, in this order:

| Heading | Goes here |
| --- | --- |
| `### 🚨 Breaking Changes` | Unchanged consumer code **fails to typecheck, build, or import** against the new version: a removed or renamed export, subpath, or package; a changed function/hook signature; a new required parameter or field; a narrowed or changed parameter/return type; a changed enum or union member; a raised required peer dependency or Node engine. Removals of deprecated API go here too. |
| `### ⚠️ Behavior Changes` | Unchanged consumer code **still compiles and builds, but behaves differently at runtime**: a changed default (e.g. a flag now on by default), different returned values or units, a different endpoint or network call, stricter validation that now rejects inputs it accepted, a different error thrown, a changed side effect or ordering. |
| `### 🚀 Features` | `feat` — new capability, new hook/service/method, new chain or tokens. |
| `### ⚡ Improvements` | `perf`, `refactor`, or `chore` with a visible effect for consumers (faster, smaller bundle, better errors) that is not a new capability. |
| `### 🐞 Bug Fixes` | `fix` that changes published runtime behavior back to what was documented or intended. |
| `### 🔒 Security` | Vulnerability fixes and security-relevant dependency bumps. |
| `### 🗑️ Deprecations` | Newly `@deprecated` public API that still works. |
| `### ❓ Uncertain — needs review` | See [Uncertain PRs](#uncertain-prs). |

### Telling 🚨 from ⚠️

A `!` or `BREAKING CHANGE` marker says *something* breaks, not which kind. Decide from the diff of the published package's public surface (its `src/index.ts` barrel and every exported type, signature, and default it reaches):

```bash
git diff "$FROM" "$TO" -- 'packages/<pkg>/src/**' ':!**/*.test.ts'
```

Ask one question: **would a consumer's unchanged code still pass `tsc` and their build?** No → 🚨. Yes, but the same call now does something different → ⚠️. A PR that does both is split: the type-level part under 🚨, the runtime part under ⚠️, each with its own migration line and the same PR link. An unmarked change that meets either definition still goes in its section — call it out in the commentary outside the block. A bug fix that *also* changes behavior people may rely on goes under ⚠️, not 🐞.

## 5. Write the entries

- One bullet per change, past tense, starting with what the consumer gets: "Added…", "Fixed…", "`useX` now…".
- Prefix with the package(s) in bold when it is not obvious: `**@sodax/dapp-kit** — …`. Derive the package from the scope or the changed files, not the title alone.
- Name public symbols in backticks exactly as exported; verify against `src/` when you mention one.
- 🚨 entries state the **code migration**: the compile error a consumer will hit and what to change, from → to. ⚠️ entries state **what now happens differently** and how to keep the old behavior if an opt-out exists. Take both from the PR body or diff; if the PR does not support a concrete step, say "see PR" rather than inventing one.
- End each bullet with the PR link and its human authors: `([#<n>](https://github.com/icon-project/sodax-sdks/pull/<n>)) by @<login>`, joining co-authors with `and`. Fold several PRs that ship one feature into a single bullet with all links and every distinct author.
- Do not list exact chain or token counts unless you counted them from the diff.

## 6. Order and assemble

Sections in the table order above: 🚨, ⚠️, 🚀, ⚡, 🐞, 🔒, 🗑️, ❓. Within a section, most impactful first, not PR order. `❤️ Contributors` lists every distinct human from step 2b, alphabetically, once each, even when none of their PRs made the notes. Close with the contributors, the compare link, and the bump check:

```markdown
### ❤️ Contributors

@<login>, @<login>, <Plain Name>

**Full changelog:** https://github.com/icon-project/sodax-sdks/compare/@sdks@<from>...@sdks@<target>
```

## 7. Check the version bump

All publishable packages share one version. Recommend: any 🚨 entry → major; any ⚠️ entry → major under strict semver, but say which entries drive it so the human can judge whether a minor is defensible (e.g. an opt-out exists or the old behavior was a bug); any 🚀 → minor; otherwise → patch. Put the recommendation as a final blockquote inside the code block. If it disagrees with the requested target, say so plainly **outside** the block as well — the human decides.

## Uncertain PRs

If a PR's impact is ambiguous after reading its body and files, list it under `### ❓ Uncertain — needs review` with its original title and link, and one line on what is unclear. Never guess its impact.

## Example

**Input** — target `2.2.0`, range `@sdks@2.1.0` → `origin/release`, with authors from step 2b:

```text
feat(sdk,dapp-kit): add leverage-yield service and hooks (#<a>)   @alice, co-author @bob
feat(leverage-yield)!: submit-tx on by default, per-action API key (#<b>)   @alice, co-author Claude -> AI, not credited
fix(sdk): retry relay status on 429 (#<c>)   @carol
fix(demo): make every demo page usable on phones (#<d>)   @dave -> omitted (apps), still credited
ci(docs): remove the marketing docs auto-merge lane (#<e>)   dependabot[bot] -> omitted (ci), bot not credited
```

**Answer:**

```markdown
## @sdks@2.2.0 — 2026-10-12

### 🚨 Breaking Changes
- **@sodax/sdk** — Leverage-yield actions now require a per-action API key; calls without it no longer typecheck. Pass the key on each action call. ([#<b>](https://github.com/icon-project/sodax-sdks/pull/<b>)) by @alice

### ⚠️ Behavior Changes
- **@sodax/sdk** — Leverage-yield actions now submit through the backend by default instead of broadcasting from the client. Opt out with the flag described in the PR. ([#<b>](https://github.com/icon-project/sodax-sdks/pull/<b>)) by @alice

### 🚀 Features
- **@sodax/sdk, @sodax/dapp-kit** — Added the leverage-yield service and matching React hooks. ([#<a>](https://github.com/icon-project/sodax-sdks/pull/<a>)) by @alice and @bob

### 🐞 Bug Fixes
- **@sodax/sdk** — Relay status polling now retries when rate-limited instead of failing. ([#<c>](https://github.com/icon-project/sodax-sdks/pull/<c>)) by @carol

### ❤️ Contributors

@alice, @bob, @carol, @dave

**Full changelog:** https://github.com/icon-project/sodax-sdks/compare/@sdks@2.1.0...@sdks@2.2.0

> Recommended bump: major — the per-action API key breaks existing calls at type level. Requested 2.2.0 is a minor; confirm before release.
```
