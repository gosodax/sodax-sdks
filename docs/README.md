# docs.sodax.com

This directory **is** the published documentation site. Mintlify's GitHub App builds it
straight from this repo (its monorepo root is set to `/docs`), so a page merged to `main`
is live without any sync step, and a page pushed to a branch gets a preview URL on the
**Mintlify Deployment** check of your PR.

Mintlify is not a build gate: it publishes with warnings. The checks below are what catch
mistakes, so run them before you push.

Agent-facing version of the same rules: [`AGENTS.md`](AGENTS.md).

## Paths become URLs

`docs/` is stripped, and so is the extension:

| File | URL |
| --- | --- |
| `docs/introduction.md` | `/introduction` |
| `docs/developers/faq.md` | `/developers/faq` |
| `docs/swap/index.mdx` | `/swap` (and `/swap/index`) |

Renaming or moving a file changes its URL. When you do, add a `redirects` entry in
`docs.json` so inbound links keep working. `pnpm check:docs-nav` resolves every redirect
destination, and holds a frozen list of URLs with real inbound traffic that must keep
working — it fails if a rename strands one of them.

## Adding a page

1. **Create the file.** `.mdx` if you want Mintlify components, `.md` for plain prose.
   Both are published.
2. **Add frontmatter.** `title` is what the sidebar and browser tab show; `description`
   is the SEO summary; `icon` is optional. All fields are technically optional, but a page
   without a `title` gets one generated from its filename.
   ```yaml
   ---
   title: "Sponsored activation on Stellar"
   description: "Activate a Stellar account for a user who holds no XLM."
   icon: star
   ---
   ```
3. **Register it in `docs.json`, under exactly one tab.** A page listed under two tabs renders
   under the first one, so the other tab's navbar link switches straight back and reads as
   broken. The same goes for its neighbours: put a page in a different tab from its folder-mates
   and Mintlify serves the folder's URL from whichever was listed first, which quietly costs the
   later tab its navbar link. A page missing from `navigation` is still published and
   still reachable by URL — it is just absent from the sidebar, site search, the sitemap
   and `llms.txt`, which is almost never what you want. `pnpm check:docs-nav` fails on all three.
4. **Preview and check** (below).
5. **Push.** The Mintlify check comments the preview URL on the PR.

Every page carries a `title` and an `icon`: without a title Mintlify invents one from the
filename ("Ai integration guide"), and a page without an icon looks broken next to its
siblings. Icons are Font Awesome names — reuse one already in the sidebar for the same
concept rather than introducing a second glyph for it.

If a file must live here without being published — a contributor doc, a draft — add it to
[`.mintignore`](.mintignore). That removes it from the site completely rather than leaving
it reachable by URL.

## Generated pages

Package READMEs and the `packages/sdk/docs/` module docs stay with their package, because
npm publishes them from there. `scripts/docs-pages-map.json` maps each one to its page
path, and the copy under `docs/` is generated:

```bash
pnpm docs:sync-pages          # regenerate after editing a source
pnpm check:docs-pages         # CI: fails when a copy has drifted
```

Every generated file names its source in a `generatedFrom` frontmatter key. **Edit the source,
never the copy** — the next sync overwrites it. Adding a page this way means adding a map entry
with its `dest`, `title` and `icon`, then a `docs.json` nav entry for that dest.

## Live config tables

Networks, tokens, addresses and their counts are never typed into a page. They are read in
the browser from the backend config API — `GET https://api.sodax.com/v2/be/config/all` — by
[`config-tables.js`](config-tables.js), which Mintlify injects on every page.

The backend is the source of truth deliberately: a published SDK version can list a token
before the backend serves it, so a page mirroring the SDK advertises support that is not
fillable yet. Reading the API means a network or token shows up when the backend config
version bumps, and not before.

A page opts in with a `data-sodax-config` element. Whatever you put inside it is the
fallback and survives a failed request, so make it a pointer to the endpoint — never a copy
of the table, which is the drift this replaces.

```mdx
<div data-sodax-config="swap-tokens" />          {/* add data-chain="solana" for one network */}
<div data-sodax-config="money-market-tokens" />
<div data-sodax-config="chains" />
<span data-sodax-config="chain-names" data-type="EVM" data-exclude="sonic">Ethereum, …</span>
<span data-sodax-config="count" data-metric="networks">22</span>
<span data-sodax-config="version">—</span>
```

`data-metric` takes `networks`, `reserve-assets`, `swap-tokens`, `money-market-tokens`, and
the per-network `chain-swap-tokens` / `chain-money-market-tokens` with `data-chain`. The
chain views also accept `data-type` (`EVM` / `non-EVM`) and a comma-separated `data-exclude`.

Two consequences worth knowing: live values are not in the search index or `llms.txt`, so
keep the surrounding prose meaningful on its own; and agents should be sent to the config
API or [Builders MCP](/builders-mcp) rather than to the page.

## Editing in the Mintlify dashboard

Two lanes write to this site, and they are not equivalent.

**In a pull request** — engineers, and anyone changing a page that is generated from a
source file. Reviewed, and every check below runs against it.

**In the Mintlify dashboard** — the docs and marketing team, on the hand-written pages.
`main` requires a pull request, so Publish opens one from a `sodax/draft-*` branch and the
checks below run there, before anything is live. It then needs an engineer's approval and is
merged by hand like any other pull request; tag someone in the SODAX team when it is urgent.

Which branch the dashboard targets is a setting there, recorded nowhere in this repo. Pointed
at a branch that does not require a pull request, Publish commits straight to it, and the
push-triggered checks report after the page is already live.

Commits arrive authored as `usr-icon-foundation` ("Updated mintlify pages") — one shared account
for everyone, so a page's history does not say who changed it. An editor who authorizes GitHub at
`app.mintlify.com/settings/account` publishes under their own identity from then on, which is
also what a rule requiring commits attributed to a GitHub user needs.

Site settings publish into this repo too. Navigation, Analytics, canonical URL and SEO, Redirects
and Branding all write to `docs.json`, so changing any of them in the dashboard commits the same
file `pnpm check:docs-nav` gates — a redirect edited there can strand one of the pinned URLs that
check holds. Only the dashboard's own Settings pages (domain, auth, add-ons, privacy, search) live
outside git.

Dashboard editing is still a normal way to work — with one exception. The 26 pages listed
below are copies. Each is generated from a file that lives next to the code it documents,
and `pnpm docs:sync-pages` rewrites the copy from that file. An edit typed into one of
these pages survives only until the next sync, and until then `pnpm check:docs-pages`
fails, which blocks everyone else's work too.

**Do not edit these pages here.** The change has to go into the source they come from:

- `/developers/packages/foundation/sdk`, `/developers/packages/foundation/swaps-api` and
  `/developers/packages/foundation/bridge-api`
- `/developers/packages/foundation/sdk/functional-modules/` — `swaps`, `money_market`,
  `bridge`, `staking`, `migration`, `leverage_yield`, `leverage_yield_apr`
- `/developers/packages/foundation/sdk/tooling-modules/` — `backend_api`,
  `intent_relay_api`
- `/developers/packages/connection/wallet-sdk-core` and
  `/developers/packages/connection/wallet-sdk-react`
- `/developers/packages/experience/dapp-kit` and `/developers/packages/experience/skills`
- `/developers/packages/sdk/docs/installation/nextjs`
- `/developers/how-to/` — `configure_sdk`, `estimate_gas`, `how_to_make_a_swap`,
  `monetize_sdk`, `wallet_providers`, `stellar_trustline`, `bitcoin-integration`
- `/developers/deployments/relayer-api-endpoints` and
  `/developers/deployments/solver-api-endpoints`

Each of those pages also names its source in a `generatedFrom` frontmatter key, but the dashboard
editor renders frontmatter as the page title and icon and shows no keys, so **nothing in the
editor marks a page as generated** — that key is there for the sync tooling, and this list is the
only warning an editor gets. Everything else on the site
— including the rest of Deployments and How To, and all of Home, Get Started, Solana and
Resources — is written here and safe to edit.

**To get one of the generated pages changed**, open an issue on
[icon-project/sodax-sdks](https://github.com/icon-project/sodax-sdks/issues) with the page
URL and the wording you want, or ask an SDK engineer directly. They edit the source file and
the page follows on the next sync. Rewording, reordering and new sections are all fine — the
edit just cannot start on the page.

## Adding a network guide

Networks are uniform on purpose: each is its own nav group under **Network guides**, so a
new one slots in without reshaping the sidebar. `solana/` is the reference shape — overview,
quickstart, swaps, money market, wallets, networks and assets, FAQ. Start from the pages the
network actually supports and keep the filenames identical, so readers moving between
networks land on the same page in each one.

## The four rules that cause 404s

1. **Internal links are root-relative and extensionless.** `/developers/faq`, never
   `developers/faq`, `./faq.md` or `../faq`. Mintlify is explicit that relative paths and
   paths with extensions "do not work in production" — they resolve fine in `mint dev` and
   404 once deployed.
2. **Links to repo files are absolute GitHub URLs.** Source files, `RELEASE_INSTRUCTIONS`,
   anything outside `docs/` is not part of the site: use
   `https://github.com/icon-project/sodax-sdks/blob/main/<path>`.
3. **A nav entry needs its file.** An entry for a page that does not exist is a 404 in the
   sidebar. `mint validate` warns; `pnpm check:docs-nav` fails.
4. **Anchors follow the rendered heading.** Changing a heading changes its anchor and
   breaks inbound deep links. Set an explicit `{#stable-id}` on headings you expect others
   to link to.

## Writing conventions

- **Start the body at `##`.** The H1 comes from frontmatter `title`; a second H1 in the
  body renders as a duplicate.
- **MDX comments are `{/* ... */}`.** `<!-- ... -->` is not valid MDX and breaks the page.
- **Components need `.mdx`.** The site leans on `<CardGroup>` / `<Card>` for hub pages,
  plus `<Note>`, `<Steps>`, `<Tabs>` and `<CodeGroup>`. Copy the shape from a neighbouring
  page rather than inventing a new layout.
- **No pasted HTML with `class` attributes.** Site styling lives in `custom.css`; a
  `class` from somewhere else silently does nothing.
- **Images go in `docs/images/`** and are referenced root-relative: `/images/<file>.png`.
  Every image needs alt text.
- **Lead with working code.** A copy-pasteable snippet beats three paragraphs, and every
  parameter the caller must supply should appear in it.
- **Update in place.** When behaviour changes, fix the existing section instead of
  appending a new one.

## Check before you push

```bash
npm i -g mint@4.2.794  # once; the version CI pins in ci.yml

pnpm check:docs-nav    # nav <-> files, plus redirects and pinned URLs (no network, no CLI)
pnpm check:docs-pages  # generated copies still match their sources
pnpm docs:dev          # local preview, opens in the browser
pnpm docs:validate     # mint validate + mint broken-links
```

CI runs all of these in its **Docs site** job, reaching `mint` through `pnpm dlx` at a
pinned version rather than as a repo dependency. Run them locally anyway — a red CI run
costs you a push and several minutes. `mint validate` fails on anything the build would
warn about, including nav entries whose file is missing. `mint broken-links` resolves every
internal link on every page; it is the only check that catches rule 1, and the only one
that opens a hand-written page at all.

## What does not belong here

- **Package API reference.** Each package's `README.md` lives with the package, because npm
  publishes it from there. Reference it; do not fork it into a page here.
- **Agent skills.** `packages/skills` is the partner-facing agent bundle, validated by
  `pnpm check:ai`. It is not published to the site. The one exception is the root
  `skill.md`: Mintlify otherwise generates its own skill at `/skill.md`, so that file exists
  only to point agents at the canonical https://www.sodax.com/skill.md. Never grow it into
  a second skill.
- **Contributor and release docs.** Keep them outside `docs/`, or list them in
  `.mintignore`.
- **Notes to the docs team.** "Add embeds here as they publish", "rewrite these", who owns a
  section — every page is published, so a note like that ships to readers and tells them the
  page is unfinished. Put it in the PR description, or here. `resources/` (Videos, Blog,
  Changelog) is DevRel-owned: add an MDX page under `resources/` and register it in
  `docs.json` under the Resources tab.
