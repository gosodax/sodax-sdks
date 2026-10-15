# Contributing to the SODAX ecosystem

Thanks for taking the time to contribute !

- Before opening a pull request, please read the [contributing guidelines](https://github.com/icon-project/sodax-sdks/blob/master/CONTRIBUTING.md) first
- If your PR is work in progress, open it as `draft`
- Before requesting a review, all the CI checks need to pass
- Explain what your PR does

## Setup

Install the dependencies

```shell
pnpm i
pnpm dev
```

Don't forget to setup your IDE with `biome.js`.

## Tests

Run tests with `pnpm test`.

## Documentation

Docs ship with code — every feature PR includes its documentation. This repo is
the source of truth for everything on docs.sodax.com: docs are written here,
next to the code, and Mintlify publishes them from `main`.

Two lanes write to the site, and they are not equivalent:

- **In a pull request** — engineers, and anyone changing a page that is
  generated from a source file. Reviewed, and every check below runs against
  it. This is the lane the rest of this section describes.
- **In the Mintlify dashboard** — the docs and marketing team, on hand-written
  pages. Publishing there **commits straight to whichever branch the dashboard
  is pointed at, with no pull request and none of the checks below** — they are
  all `pull_request`-triggered, so nothing runs. Whether an edit is allowed is
  decided entirely by the dashboard's own settings, not by this repo.

Dashboard commits arrive authored as `usr-icon-foundation` ("Updated mintlify
pages") — one shared account for everyone, so a page's history does not say who
changed it. An editor who authorizes GitHub at
`app.mintlify.com/settings/account` publishes under their own identity from then
on, which is also what a rule requiring commits attributed to a GitHub user
needs.

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
  `https://github.com/icon-project/sodax-sdks/blob/main/…` URL.
- **Adding, renaming, or removing a published doc?** Add, rename, or remove the
  entry in `scripts/docs-pages-map.json` — that is what gets the page
  published. **A page under `docs/` also needs its own entry in navigation**
  (`docs/docs.json`). A page with no nav entry is live but absent from the
  sidebar and from search. Docs Drift does not check nav. A new
  `packages/sdk/docs/` page that is on neither list in the map, a rename that
  drops a published page off the map, or a mapped src that no longer exists,
  fails Docs Drift.

The map's **`unpublished`** array holds the `packages/sdk/docs/` pages that
deliberately do not publish yet (`DEX.md`, `SPONSORING.md`, `SWAPS_API.md`,
`BRIDGE_API.md`, `ARCHITECTURE_REFACTOR_SUMMARY.md`). Editing one
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

A bug is a _demonstrable problem_ that is caused by the code in the repository.
Good bug reports are extremely helpful - thank you!

Guidelines for bug reports:

1. **Use the GitHub issue search** &mdash; check if the issue has already been
   reported.

2. **Check if the issue has been fixed** &mdash; try to reproduce it using the
   latest `master` or development branch in the repository.

3. **Isolate the problem** &mdash; create a [reduced test
   case](http://css-tricks.com/reduced-test-cases/) and a live example (optional).

4. **Add attachments** &mdash; add photos or videos

A good bug report shouldn't leave others needing to chase you up for more
information. Please try to be as detailed as possible in your report. What is
your environment? What steps will reproduce the issue? What browser(s) and OS
experience the problem? What would you expect to be the outcome? All these
details will help people to fix any potential bugs.

Template:

```
**Environment:**
Device and OS:
Browser:
Reproducibility rate:

**Steps to reproduce:**
1.
2.
3.

**Expected result:**
```

A good bug report shouldn't leave others needing to chase you up for more.

## Git workflow

Merge strategy:

1. Feature branches → `main`: **squash merge**
2. `main` → `staging`: **normal merge**
3. `staging` → `production`: **normal merge**

Every pull request links an issue: the **Issue linked** check (`.github/workflows/issue-link.yml`)
fails unless the PR body contains `Closes #N`, `Fixes #N` or `Resolves #N`, or the PR carries the
`no-issue` label. Use the label only for work with no issue to point at (typo, dependency bump,
release chore, Mintlify `sodax/draft-*` publish) and give the reason in the PR Summary. The check
re-runs when the body or labels change, so fix it by editing the PR, not by pushing.
