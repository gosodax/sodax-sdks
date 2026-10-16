---
title: "Swaps: Compatible Assets"
description: Assets (tokens) supported for swaps by solvers on mainnet.
icon: coins
---

The tables on this page are read live from the backend config API — `GET https://api.sodax.com/v2/be/config/all` — the same configuration solvers and the app resolve against.

That endpoint, not an SDK release, is what makes a token swappable: an SDK version can list a token before the backend serves it, so a token appears here at the moment it is actually fillable, when the backend config version bumps.

Tokens are grouped by their spoke network. The first address is the token on that network; the second is its **hub asset address on Sonic**. Price data is available through the public [Oracle HTTP API](/developers/http-api/oracle).

<Note>
  Reading this from code or an agent? Do not scrape the page. Call the config API, or read `sodax.swaps.getSupportedSwapTokens()` from the SDK. [Builders MCP](/builders-mcp) hands the same live lists to an AI coding agent.
</Note>

## Supported swap tokens

<div data-sodax-config="swap-tokens">

Live token lists load from the config API. If they have not appeared, read them from [`GET /v2/be/config/all`](https://api.sodax.com/v2/be/config/all) — `config.swaps.supportedTokens` is keyed by network — or from `sodax.swaps.getSupportedSwapTokens()` in the SDK.

</div>

## Supported networks

<div data-sodax-config="chains">

Live network list loads from the config API. If it has not appeared, read `config.chains` from [`GET /v2/be/config/all`](https://api.sodax.com/v2/be/config/all), or call `sodax.config.getSupportedSpokeChains()` in the SDK.

</div>

Deployment addresses per network are in [Mainnet Deployments](/developers/deployments/mainnet).

Served from backend config version <span data-sodax-config="version">—</span>.
