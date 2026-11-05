---
name: write-docs
description: 'Use when writing or updating a hand-written docs.sodax.com page — a guide, how-to, quickstart, network page, blog post or example under docs/ — so it cannot drift from the SDK: TypeScript comes from compiled examples in apps/docs-examples, existing SDK docs are linked rather than restated, and every claim that can go stale has a check. Triggers on "write a guide", "add a docs page", "document how to", "add an example to the docs", "write a blog post for the docs", "update the docs page". Also the rules developers follow when writing package docs (packages/sdk/docs, READMEs).'
---

# Writing a docs.sodax.com page

> Anything that can drift will drift. A page is done when every claim it makes either comes from
> a source that CI checks, or is a link to one. Read `docs/AGENTS.md` for the site's
> non-negotiables (paths, nav, frontmatter, MDX); this skill covers what goes *on* the page.

## 0. Check the lane
The content lane covers hand-written `docs/` pages (no `generatedFrom` frontmatter key), their
`docs/docs.json` entries and images, and `apps/docs-examples`. If the page has a `generatedFrom`
key, edit the source it names instead. If the page can only be correct after a change to a
package or another app, stop and open an issue describing what's missing. Don't patch the SDK.

## 1. The three rules
1. **No pasted TypeScript.** Every `ts` / `tsx` / `typescript` block is copied from a region of a
   compiled file in `apps/docs-examples/src`. CI (`pnpm check:docs-examples`) fails on anything else.
2. **Link, don't restate.** Parameters, types, return shapes, error codes, defaults and rationale
   already live in the code, its types and JSDoc, package `README.md` files, `packages/sdk/docs`
   and package `AGENTS.md` files. A page states the reader's **goal**, the **sequence** of steps,
   and **when to use which API**, then links to those sources for the rest.
3. **Every drift-prone claim has a guard.** Find the guard for each claim in the table below. If
   a claim has no guard, cut it or turn it into a link.

## 2. Claim → guard
| The page says… | Guard |
| --- | --- |
| Code the reader runs or copies | Region embed from `apps/docs-examples` (compiled; asserted when deterministic) |
| A behaviour the code shows ("a failed network comes back as `null`") | A test beside the example asserting exactly that |
| Networks, tokens, addresses, counts | A `data-sodax-config` element (`docs/README.md`, *Live config tables*), never typed |
| What a parameter, type, error or default means | A link to the source file or package doc that defines it |
| Why the SDK works this way | A link to the package `AGENTS.md` or `packages/sdk/docs` page |
| Another docs page | Root-relative, extensionless link (`/developers/faq`); `pnpm docs:validate` checks it |
| "Available since x.y", "currently", "new", refresh intervals, internal mechanisms | Nothing can guard these, so leave them out |

## 3. Workflow
- [ ] **Find the existing page first.** Update in place and keep its headings. Only a genuinely
      new topic gets a new page.
- [ ] **Outline:** goal, then the steps in order, then pitfalls the reader can't see from the types.
- [ ] **Write each example** in `apps/docs-examples/src/<page-topic>/`, following
      `apps/docs-examples/AGENTS.md`. Import public entry points only. Declare values the reader
      supplies (`declare const userAddress: …`) *outside* the region.
- [ ] **Wrap the shown part** in `// #region <name>` … `// #endregion <name>`.
- [ ] **Test what the prose claims.** If the page asserts behaviour and the example can run
      without a network, add `<name>.test.ts` beside it with mocks.
- [ ] **Embed it.** On the line directly above the fence, put `{/* example: <page-topic>/<file>#<name> */}`,
      then run `pnpm docs:sync-examples`. Never edit the code inside a marked fence; edit the example instead.
- [ ] **Opt out only for pseudocode** that cannot compile: `{/* example: none — <reason> */}`.
- [ ] **Register a new page** in `docs/docs.json` and give it a `title` and an `icon`.
- [ ] **Run the gates** and read their output:
  ```bash
  pnpm --filter docs-examples checkTs && pnpm --filter docs-examples test
  pnpm check:docs-examples
  pnpm check:docs-nav && pnpm check:docs-pages
  pnpm docs:validate
  ```
- [ ] **Self-review** with `.claude/skills/review-docs/` before opening the pull request.

## 4. Cut these on sight
- A table or list of parameters, fields or error codes (the type already says it).
- A paragraph explaining a mechanism the SDK hides ("the SDK batches via multicall3…"), unless
  the reader must act on it.
- A summary of a package doc you could link instead.
- Copies of the same snippet on several pages. Embed one region from all of them.

## Package docs (developer lane)
Developers writing `packages/sdk/docs` pages or package READMEs follow the same three rules.
The embed gate covers hand-written `docs/` pages only, so in package docs, prefer linking to a
runnable file (`apps/node`, tests) over pasting long code.
