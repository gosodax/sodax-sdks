# packages/assets

Static brand assets (chain and token logos) served by URL, not imported. This
package is a **file host only** — it ships no JavaScript and is `private` (never
published to npm). Its sole purpose is to keep binary logos out of the runtime
packages while still giving `@sodax/types` stable default logo URLs.

## Structure

```
chain/<chainKey>.png   # one logo per chain, filename === the ChainKeys value
token/<slug>.png       # one logo per token, filename === tokenLogoSlug(symbol)
```

All files are PNG, sourced from CoinGecko or approved issuer artwork.

## How it wires up

- **Chains:** `@sodax/types` holds `CHAIN_LOGO_BASE_URL` (pointing at the `chain/`
  directory on `main` via `raw.githubusercontent.com`) and sets each chain's
  `logo` field on `baseChainInfo` to `${CHAIN_LOGO_BASE_URL}/<chainKey>.png`.
  Consumers read `baseChainInfo[key].logo`.
- **Tokens:** `@sodax/types` holds `TOKEN_LOGO_BASE_URL` (pointing at the `token/`
  directory) and exposes `tokenLogo(symbol)` → `${TOKEN_LOGO_BASE_URL}/<slug>.png`,
  where `<slug>` is `tokenLogoSlug(symbol)`. Consumers resolve icons with
  `tokenLogo(token.symbol)`.
- Consumers (demo, web app) must not hardcode chain or token icon paths.

## Rules

- **No runtime dependencies and no source code.** Images only.
- **Chain filename must equal the `ChainKeys` value**, and **token filename must
  equal `tokenLogoSlug(symbol)`**, so the base-URL + key convention in
  `@sodax/types` resolves.
- **Don't import these files** into app/package code — reference the URL from
  `@sodax/types` instead. Importing would re-bundle the binary, defeating the
  purpose of hosting them.
- **Every chain and token needs a file here, and every file needs a claimant.**
  [`packages/types/src/chains/logo-assets.test.ts`](../types/src/chains/logo-assets.test.ts)
  fails CI for a `CHAIN_KEYS` entry or a token in `spokeChainConfig[*].supportedTokens`
  with no PNG, for a PNG no chain or token claims (how a misspelled filename is caught),
  and for a file that is empty or not really a PNG. Adding a token to `@sodax/types`
  without its logo is a red build, not a follow-up.
- A new logo only resolves after it is merged to `main` (raw.githubusercontent
  serves the branch you point at).
