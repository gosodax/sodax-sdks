# @sodax/assets

Static brand assets for the SODAX SDKs. **Not published to npm and never bundled
into a runtime package** — these files exist only to be served as links so the
SDK (`@sodax/types`) can reference default logos by URL without bloating the
package with binary data.

## chain/

One logo per supported chain, named by its `ChainKeys` value (e.g.
`sonic.png`, `0x2105.base.png`, `injective-1.png`). All files are PNG.

Logos were sourced from CoinGecko's asset-platform / coin image CDN.

### How they're consumed

`@sodax/types` exposes each chain's logo as a `logo` URL on `baseChainInfo`,
built from `CHAIN_LOGO_BASE_URL`, which points at this directory on the `main`
branch via `raw.githubusercontent.com`:

```
https://raw.githubusercontent.com/icon-project/sodax-sdks/main/packages/assets/chain/<chainKey>.png
```

So adding a chain logo is two steps: drop `<chainKey>.png` here, and add the
`logo` field to that chain's `baseChainInfo` entry in `@sodax/types`.

> Note: a logo URL only resolves once these files are merged to `main`. On a
> feature branch, swap `main` for the branch name to preview.

Both directories are gated in CI by `packages/types/src/chains/logo-assets.test.ts`:
a chain or token with no logo file fails the build, and so does a PNG that no chain
or token claims — the latter is what catches a filename that does not match the
`ChainKeys` value or `tokenLogoSlug(symbol)`.

## token/

One logo per token, named by the token's **slugified symbol** — the symbol
lowercased with every run of non-alphanumeric characters collapsed to a single
`-` (e.g. `USDC` → `usdc.png`, `AVAX.LL` → `avax-ll.png`, `bnUSD (legacy)` →
`bnusd-legacy.png`). All files are PNG.

### How they're consumed

`@sodax/types` exposes `tokenLogo(symbol)`, built from `TOKEN_LOGO_BASE_URL`,
which points at this directory on the `main` branch via `raw.githubusercontent.com`:

```
https://raw.githubusercontent.com/icon-project/sodax-sdks/main/packages/assets/token/<slug>.png
```

The `<slug>` is `tokenLogoSlug(symbol)` from `@sodax/types`. So adding a token
logo is two steps: compute the slug for the symbol, and drop `<slug>.png` here.
Consumers resolve the URL with `tokenLogo(token.symbol)` — they must not
hardcode token icon paths.

Logos were sourced from CoinGecko's coin image CDN. Most hub vaults carry their base
asset's symbol on-chain (`BTC`, `weETH`), so they resolve to the base asset's file.
Variant tokens with their own symbol (`sodaETH`-style vaults, `*.LL` bridged, `r*`
relay, `lsoda*` staked) currently reuse their base asset's icon — replace any with
branded art by dropping a new `<slug>.png` here.

> Same as chains: a token logo URL only resolves once merged to `main`; swap
> `main` for the branch name to preview on a feature branch.
