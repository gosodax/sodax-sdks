# apps/recipes

Working code behind the use-case recipes on docs.sodax.com. A recipe page explains the goal and links here; the code and its test live here so CI catches drift instead of a reader.

- `src/<network>/<recipe>.ts`: the recipe, written against the public `@sodax/*` API only.
- `src/<network>/<recipe>.test.ts`: proves each claim the page makes (vitest, no network: SDK calls are spied, token config is real).
- The page in `docs/<network>/recipes/` holds no code blocks. It links the two files as `https://github.com/gosodax/sodax-sdks/blob/main/apps/recipes/src/...`.

## Adding a network

Copy `src/base/` to `src/<network>/`, change the chain keys and symbols, and keep the tests green. Then copy `docs/base/recipes/` to `docs/<network>/recipes/`, point its links at the new files, and register the pages under the network's nav group in `docs/docs.json` in a "Recipes" subgroup, as Base does. Resolve every token from SDK config; never hard-code an address, decimals or a count.

## Verify

```bash
pnpm --filter recipes checkTs
pnpm --filter recipes test
pnpm check:docs-nav && pnpm docs:validate
```
