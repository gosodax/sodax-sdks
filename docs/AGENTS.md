# AGENTS.md — docs.sodax.com

This directory is the live documentation site, built from this repo by Mintlify's GitHub
App (monorepo root `/docs`). There is no sync step and no separate docs repo: a page
merged here is published. Human-facing detail, including the writing conventions, is in
[`README.md`](README.md) — read it before authoring a page.

Mintlify publishes with warnings, so its deploy check passing does not mean the page is
correct. The commands below are the gate.

## Non-negotiables

- **Path is URL.** `docs/<path>.md|mdx` serves at `/<path>`; `index` also serves its
  directory. Moving or renaming a page changes its URL and needs a `redirects` entry in
  `docs.json`. `pnpm check:docs-nav` fails on a redirect that lands on a 404, and on any
  rename that strands one of the must-not-break URLs frozen in `scripts/check-docs-nav.mjs`.
- **Internal links are root-relative and extensionless** (`/developers/faq`). Relative
  paths and `.md`/`.mdx` extensions resolve in local preview and 404 in production.
- **Never hand-write a chain, token or count.** Networks, tokens and their addresses come
  from the backend config API through a `data-sodax-config` placeholder — the backend, not
  the SDK, decides what is live. See [`README.md`](README.md#live-config-tables).
- **Anything outside `docs/` is not a page.** Link source files and repo docs as
  `https://github.com/icon-project/sodax-sdks/blob/main/<path>`.
- **A new page is not done until it is in `docs.json` `navigation`.** Unregistered pages
  are still published and reachable by URL, but drop out of the sidebar, search, the
  sitemap and `llms.txt`.
- **Every nav entry needs its file**, or the sidebar links to a 404.
- **Every page has a `title` and an `icon`.** Without a title Mintlify derives one from the
  filename; without an icon the page looks broken beside its siblings. Icons are Font
  Awesome names — reuse the one already used for that concept.
- **Body starts at `##`** — the H1 comes from frontmatter `title`. MDX comments are
  `{/* ... */}`; HTML comments break the page. Angle-bracket autolinks (`<https://…>`) are
  not valid MDX either; use `[text](url)`.
- **Never edit a generated page.** A page carrying a `generatedFrom` frontmatter key comes from
  the package source that key names, listed in `scripts/docs-pages-map.json`; edit that source
  and run `pnpm docs:sync-pages`. `pnpm check:docs-pages` fails on drift.
- **A tab must land on a page no earlier tab lists**, or the page renders under that earlier
  tab and the navbar link goes nowhere. Repeating a page deeper in another sidebar as a
  shortcut is fine; `pnpm check:docs-nav` enforces the landing rule.
- **Every page directly under a directory belongs to one tab.** Mintlify serves `/<dir>` from
  the first page listed under it, whichever tab that is — an `index` page does not win by being
  one. Split a directory across tabs and the later tab loses its navbar link, even though every
  page is listed exactly once. A sidebar group cannot hold a bare link, so cross-section
  shortcuts go in `navigation.global.anchors`, not in a second tab's `pages`.
  `pnpm check:docs-nav` enforces this.
- **Each network is its own nav group** under Network guides, mirroring `solana/` page for
  page. Do not add a network as a loose page beside the groups.
- **Repo-internal docs do not belong here.** If one must live in this directory, add it to
  [`.mintignore`](.mintignore), which removes it from the site rather than leaving it
  reachable.

## Verify

```bash
pnpm check:docs-nav    # nav, redirects, must-not-break URLs   (CI runs this)
pnpm check:docs-pages  # generated copies match their sources  (CI runs this)
pnpm docs:validate     # mint validate + mint broken-links (needs the mint CLI)
```

Run all three after any change under `docs/`. CI runs the same three in its `Docs site` job,
reaching `mint` through `pnpm dlx` at a pinned version because the CLI is not a repo
dependency. `mint broken-links` is the only check that catches a relative link, and the only
one that opens a hand-written page — do not wait for CI to find that for you.

## Scope

Do not restructure `docs.json` navigation, rename existing pages, or change `custom.css`
as a side effect of adding content — those move published URLs and the site's visual
language. Add the page, register it, verify, stop.
