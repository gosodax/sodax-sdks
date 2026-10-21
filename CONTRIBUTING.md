# Contributing to the SODAX SDKs

Thanks for taking the time to contribute!

This repository is the `@sodax/*` SDK monorepo (pnpm + Turborepo): the packages under `packages/`,
the example and regression apps under `apps/`, and the docs.sodax.com site under `docs/`. Start
with [`AGENTS.md`](./AGENTS.md) for the package map and dependency direction, then read the
`AGENTS.md` of the package or app you are changing — it holds that subtree's patterns and pitfalls.

Found a security vulnerability? Do not open an issue — follow [`SECURITY.md`](./SECURITY.md).

## Setup

Requirements: Node.js `>=22.12.0` (CI runs 24.x) and pnpm `10.32.1` — the version pinned in
`package.json` under `packageManager`, so `corepack enable` picks it up.

```shell
pnpm i                # install, and install the husky git hooks
pnpm build:packages   # apps resolve the packages from their built dist/, so build them first
pnpm dev:demo         # run the demo app (or `pnpm dev` for every package and app in watch mode)
```

Biome is the only formatter and linter — there is no ESLint or Prettier config. The repo's
`.vscode/` settings recommend the Biome extension and format on save; set up the equivalent in
other editors.

To try unreleased packages in a project outside this repo, use `pnpm pack:local` rather than
`pnpm pack` — see [`docs/local-package-testing.md`](./docs/local-package-testing.md).

## Checks

Run these before you push:

```shell
pnpm lint             # Biome lint (auto-fixes)
pnpm pretty           # Biome format — local only, CI does not check formatting
pnpm checkTs          # typecheck
pnpm test             # unit tests, plus the release and CI script tests
pnpm check:ai         # when you change packages/skills
```

CI runs more than this: `check:circular-deps`, `check:knip`, `check-exports`, the package and app
builds, and the docs gates (`check:doc-links`, `check:docs-nav`, `check:docs-pages`,
`check:ai-dev-files`, plus `pnpm docs:validate`). See
[`.github/workflows/ci.yml`](./.github/workflows/ci.yml) for the full list, and run the ones that
cover what you changed.

For one package: `cd packages/<pkg> && pnpm test` (or `npx vitest run path/to/file.test.ts`).
`pnpm test:e2e` hits live mainnet services; in CI it runs on pull requests only and is advisory, so
run it locally when you touch a flow it covers.

The git hooks run on every commit:

- **pre-commit** scans the staged changes for secrets with `gitleaks` (skipped with a warning if
  it is not installed — install it, CI's `Security` workflow is the hard gate), then runs
  `pnpm checkTs`, `pnpm build` and `pnpm test`.
- **commit-msg** runs commitlint against the
  [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) config.

Do not bypass them with `--no-verify`. If a check fails, fix the cause.

## Pull requests

Who pushes where:

- **People with write access** — including people working through a coding agent they direct —
  branch in this repository.
- **Autonomous agents and bots** (standalone agents with no human directing the session) work
  through a fork: push to the fork and open the pull request from it. They do not get write access
  to this repository, and must not push here or push tags even if their credentials allow it.
  Workflows on a fork pull request wait for a maintainer's approval, and the
  [AI drift audit](#ai-files-drift-check) is skipped (a maintainer runs it on a branch here).
- Everyone else (external contributors) forks too.

Then:

- Branch from `main` and open the pull request against `main`. If it is work in progress, open it
  as a draft.
- Fill in the [pull request template](./.github/PULL_REQUEST_TEMPLATE.md): what the change does,
  which issue it closes, and which docs it updated (see [Documentation](#documentation)).
- Every pull request links an issue: the **Issue linked** check (`.github/workflows/issue-link.yml`)
  fails unless the PR body contains `Closes #N`, `Fixes #N` or `Resolves #N`, or the PR carries the
  `no-issue` label. Use the label only for work with no issue to point at (typo, dependency bump,
  release chore, Mintlify `sodax/draft-*` publish) and give the reason in the PR Summary. The check
  re-runs when the body or labels change, so fix it by editing the PR, not by pushing.
- The PR title must be a conventional commit (`feat(sdk): …`, `fix(wallet-sdk-react): …`,
  `docs: …`). `Lint PR` checks it, and while the PR has a single commit, checks that the commit
  message matches the title.
- Keep the change scoped to the task — no drive-by refactors or renames.
- Cover new code with tests beside the changed code.
- Every required check is green before you request a review. Changes to `.github/workflows/`,
  `.github/scripts/`, the docs gates and release scripts in `scripts/`, and `docs/` need a
  code-owner review — [`CODEOWNERS`](./.github/CODEOWNERS) lists the exact paths.
- Pull requests are **squash merged** into `main`, so the PR title becomes the commit subject on
  `main` — and the input to the next release's notes.

Releases are cut from the `release` branch by maintainers; see
[`packages/RELEASE_INSTRUCTIONS.md`](./packages/RELEASE_INSTRUCTIONS.md).

## Documentation

Docs ship with code — every feature PR includes its documentation. This repo is
the source of truth for everything on docs.sodax.com: docs are written here,
next to the code, and Mintlify publishes them from `main`.

Two lanes write to the site, and they are not equivalent:

- **In a pull request** — engineers, and anyone changing a page that is
  generated from a source file. Reviewed, and every check below runs against
  it. This is the lane the rest of this section describes.
- **In the Mintlify dashboard** — the docs and marketing team, on hand-written
  pages. Publishing there pushes a `sodax/draft-*` branch and opens a pull
  request against `main`, which is reviewed and merged by hand like any other —
  never by automation. `Lint PR` skips these branches, because the dashboard's
  commit message is always "Updated mintlify pages"; whoever merges sets a
  conventional squash subject.

Dashboard commits arrive authored as `usr-icon-foundation` — one shared account
for everyone, so a page's history does not say who changed it. An editor who
authorizes GitHub at `app.mintlify.com/settings/account` publishes under their
own identity from then on, which is also what a rule requiring commits
attributed to a GitHub user needs.

Site settings publish into this repo too. Navigation, Analytics, canonical URL
and SEO, Redirects and Branding all write to `docs/docs.json`, so changing any
of them in the dashboard commits the same file `pnpm check:docs-nav` gates — a
redirect edited there can strand one of the pinned URLs that check holds. Only
the dashboard's own Settings pages (domain, auth, add-ons, privacy, search) live
outside git.

Never edit a copy of a page instead of the source it came from — generated pages
name their source in a `generatedFrom` frontmatter key. The next sync overwrites
your edit, and CI is red for everyone until it does.

Creating a page is two steps — the file, and its entry in `docs/docs.json`.
Skip the second and the page is live and reachable by URL but absent from the
sidebar, from search and from `llms.txt`. Docs Drift does not check nav.

### Where docs live

| You changed…                                                          | Update…                                                                    |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| A functional module (swaps, money market, bridge, staking, migration, leverage yield) | The matching *published* file in `packages/sdk/docs/` (e.g. `SWAPS.md`, listed in `scripts/docs-pages-map.json`) |
| The public API of `sdk`, `swaps-api`, `bridge-api`, `wallet-sdk-core`, `wallet-sdk-react`, or `dapp-kit` | That package's `README.md` — these publish, so the README alone is a real docs signal |
| The public API of `types`, `libs`, or `assets`                          | Their READMEs are **not** on the publish map. The gate accepts them (and `packages/<pkg>/docs/`), but prefer a page that goes live: any mapped `packages/sdk/docs/` page satisfies these packages, so update the feature page the change surfaces in |
| A flow with a root-level `docs/` guide (e.g. Stellar sponsoring)       | That guide — it satisfies Docs Drift for the packages its `pkgs` entry lists in `scripts/docs-pages-map.json` |
| Exported types or function signatures                                  | JSDoc on the exports themselves (does not satisfy Docs Drift)               |

`packages/skills` is **not** where we introduce a feature. It is the partner-facing agent bundle — how integrators' coding agents call APIs we already shipped. Update it when a public API, example, or chain/token surface changes so their agents stay correct, then run `pnpm check:ai`. That does not publish to docs.sodax.com and does not satisfy Docs Drift. How *we* add features lives in `.claude/skills/` (`add-feature`, `add-chain`, …).

### How to write

- **Lead with working code.** A copy-pasteable snippet beats three paragraphs.
  Every parameter a user must supply should appear in an example.
- **Document behavior, not implementation.** What does the caller get, what can
  fail, and what does failure look like? Skip internal mechanics.
- **Update, don't append.** If your change alters existing behavior, fix the
  existing section rather than adding a new one at the bottom.
- **Keep headings stable.** Inbound links and search results rely on them.
  If you must rename one, call it out in your PR description.
- **JSDoc is still required on public exports**, but it does **not** satisfy
  CI. If a user would need to read source to use the feature, it needs a
  markdown page that is listed in `scripts/docs-pages-map.json`.

### Published docs and docs.sodax.com

`scripts/docs-pages-map.json` maps each authored source — package `README.md`
files and `packages/sdk/docs/` pages — to the path it publishes at on
docs.sodax.com. It is the copy list, and both Docs Drift and
`pnpm check:doc-links` read it. For those files:

- **Don't add frontmatter** (titles, icons, descriptions) — publishing injects it.
- **Avoid raw HTML.** Mintlify compiles pages as MDX; HTML attributes like
  `class` fail to render. Stick to plain markdown.
- **Links follow the published-doc rule** enforced by `pnpm check:doc-links`:
  relative links are only allowed to targets that publish into the same
  destination directory; everything else needs an absolute
  `https://github.com/gosodax/sodax-sdks/blob/main/…` URL.
- **Adding, renaming, or removing a published doc?** Add, rename, or remove the
  entry in `scripts/docs-pages-map.json` — that is what gets the page
  published. **A page under `docs/` also needs its own entry in navigation**
  (`docs/docs.json`). A page with no nav entry is live but absent from the
  sidebar and from search. Docs Drift does not check nav. A new
  `packages/sdk/docs/` page that is on neither list in the map, a rename that
  drops a published page off the map, or a mapped src that no longer exists,
  fails Docs Drift.

The map's **`unpublished`** array holds the `packages/sdk/docs/` pages that
deliberately do not publish yet — read the map for the current list. Editing one
does not satisfy Docs Drift, and renaming one needs no map entry. A new page
there goes on one of the two lists: `mirrored` to publish it now, `unpublished`
to hold it back and publish it as its own change. On neither list, it fails
Docs Drift.

### What CI enforces

- The **Docs Drift** check (job name **Docs ship with code**) fails any PR
  that changes package `src/` without a *related* publishable docs signal: a
  mapped file under that package, a mapped `packages/sdk/docs/` page, a mapped
  root-level `docs/` guide whose `pkgs` array lists the package, the package
  `README.md`, or `packages/<pkg>/docs/` (non-sdk). JSDoc, `unpublished`
  sdk/docs pages, `packages/skills`, an unrelated mapped file (for example
  touching `packages/skills/README.md` while changing `@sodax/sdk`), and
  *deleting* a README or docs file do not count. Moving a source file out of
  `src/` — or into a test path — is still a source change. A newly added
  `packages/sdk/docs/` page (`.md` or `.mdx`), including one moved in from
  elsewhere, must be on the map's `mirrored` or `unpublished` list even if
  `src/` did not change; renaming a published page must move its map entry with
  it; every mapped src must exist and be a `.md`/`.mdx` page; and every name in
  a `pkgs` array must be a real package directory. If your PR genuinely has no
  user-facing change, ask a maintainer to apply the `docs-not-needed` label.
- `pnpm check:ai` validates that snippets and imports in `packages/skills`
  match the real source (partner-agent docs, separate from Docs Drift).
- `pnpm check:doc-links` validates links in published docs.

docs.sodax.com publishes from this repo — nothing goes live until your PR is
merged.

### When docs genuinely aren't needed

Refactors, test-only changes, and internal tooling don't need docs. Say so
explicitly in the PR's Documentation section — "no user-facing change" is a
perfectly good answer — and get the `docs-not-needed` label. Silence isn't.

## AI files drift check

Agents implement against this repository's `AGENTS.md` files, the dev skills in `.claude/skills/`,
and the knowledge trees in `packages/skills` — which ship to integrators as `@sodax/skills`. A
compiler catches stale code; nothing catches stale prose, so a pull request that changes behaviour
without updating the guidance that describes it leaves an agent confidently generating wrong code.

The `AI Files Drift Check` workflow closes that gap. It works out which AI files your change could
affect, has a read-only agent compare them against the source, and then re-reads every citation the
agent produced before acting on any of it.

It reports two things:

- **Contradictions**: an AI file asserts something the current source disproves. Each one names the
  passage and the source line that disproves it — fix the passage, or the code if the passage was
  right.
- **Coverage gaps** are advisory: your change adds public surface no audited AI file mentions.
  Worth documenting, never a blocker.

Findings whose quotes do not resolve in the files they cite are discarded automatically and listed
as discarded, so you can see what the check threw away. The comment also names any scoped file the
auditor did not open, so a partial audit never reads as a clean one.

**The check does not fail a build yet.** Contradictions are reported and nothing more until the
`AI_DRIFT_ENFORCE` repository variable is set to `true`. Promote it once the audit has run for a
cycle and its verdicts hold steady across re-runs of the same pull request; until then, treat a
contradiction as a review comment that happens to come from CI.

If a contradiction is wrong, add the **`no-ai-drift`** label to skip the job. Please say why in the
PR thread so the prompt can be tightened. Pull requests from forks skip the audit; a maintainer
runs it on a branch in this repository instead.

Three cases where no audit happens. The first two say so in the PR comment; the third costs nothing
and stays quiet:

- **Your PR edits the check itself** — its workflow, its prompt, or either of its scripts. The prompt
  and the scripts run from your branch, so an audit that read them would be one you wrote the rules
  for; the job skips it and says so. (A workflow edit never gets that far: the action refuses a
  workflow whose content differs from the default branch.) Review such a PR's AI files by hand.
- **The audit step did not complete** — a provider outage, an expired credential, the job timeout. An
  incident elsewhere is not evidence that your change drifted, so the job stays green and says why.
- **Nothing you changed is described by an AI file.** The job exits before spending anything.

## Issue reports

Use the [issue templates](https://github.com/gosodax/sodax-sdks/issues/new/choose) (bug
report, feature request, task, epic). A bug is a _demonstrable problem_ caused by the code in this
repository. Good bug reports are extremely helpful — thank you!

1. **Search the issues** — check whether it has already been reported.
2. **Check it still happens on `main`** — or on the latest published `@sodax/*` release.
3. **Isolate the problem** — reduce it to the smallest snippet or script that reproduces it.

A good report doesn't leave anyone chasing you for details:

```
**Packages and versions:** e.g. @sodax/sdk 2.x.y, @sodax/dapp-kit 2.x.y
**Runtime:** Node.js version, or browser + bundler (Vite, Next.js, …)
**Chains involved:** source and destination chain, plus any tx hashes or intent hashes

**Steps to reproduce:**
1.
2.
3.

**Expected result:**
**Actual result:** (include the full error and stack trace)
```

Never paste private keys, mnemonics or RPC credentials into an issue.
