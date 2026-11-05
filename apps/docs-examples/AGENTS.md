# apps/docs-examples

TypeScript shown on hand-written docs.sodax.com pages. A page never holds code of its own: a
`{/* example: <file>#<region> */}` marker above a fence names a region here, and
`pnpm docs:sync-examples` (root) copies it in. CI typechecks every file, runs the tests, and fails
a page whose copy no longer matches (`pnpm check:docs-examples`). Writing rules for the pages are in
`.claude/skills/write-docs/`.

## Layout

- `src/<page-topic>/<name>.ts(x)`: one folder per docs page or topic, named after the page.
- `// #region <name>` … `// #endregion <name>` marks what the page shows. Regions may nest; nested
  markers are stripped from the copy. A name used for several segments is joined in order.
- `<name>.test.ts` beside an example asserts the behaviour the page's prose claims.

## Rules

- Import `@sodax/*` public entry points only, as a reader would. No deep imports into `src/` or `dist/`.
- Declare reader-supplied values (`declare const userAddress: …`) outside the region, so the shown
  code reads naturally and still compiles.
- An example a test imports must have no top-level side effects. Take dependencies (`sodax`) as
  parameters and mock them with `vi.spyOn`.
- No network in tests. An example that needs live services is typechecked only.
- No `any`, `@ts-ignore`, non-null `!` or unsafe casts to make an example compile. If it doesn't
  compile, the page is wrong.
- Edit the example, never the fenced copy on the page; then run `pnpm docs:sync-examples` from the root.

## Verify

```bash
pnpm --filter docs-examples checkTs
pnpm --filter docs-examples test
pnpm check:docs-examples
```
