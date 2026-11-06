---
title: API
sidebarTitle: API
description: Integrate SODAX from any language over the HTTP API.
icon: server
---

## Get started

The HTTP API is the main path for new integrations. It works from any language over standard REST. Get your API key at [portal.sodax.com](https://portal.sodax.com), then pick an API:

<CardGroup cols={2}>
  <Card title="Swaps API" icon="rotate" href="/developers/http-api/swaps">
    Quote, build intent, submit-tx, status — the full swap lifecycle over REST.
  </Card>
  <Card title="Leverage Yield API" icon="money-bill-trend-up" href="/developers/http-api/leverage">
    Deposit into and withdraw from leveraged yield vaults.
  </Card>
  <Card title="Oracle API" icon="chart-line" href="/developers/http-api/oracle">
    USD price candles and live solver prices.
  </Card>
  <Card title="Stats API" icon="chart-bar" href="/developers/http-api/stats">
    Networks, partners, assets, filled-intent volume and SODA supply.
  </Card>
</CardGroup>

A swap over REST goes **quote** → **build intent** → sign and broadcast it on the source chain → **submit-tx** → poll **status**. The [bot flow](/developers/http-api/swaps#bot-flow-create-submit-tx-poll) walks through each call.

[Get an API key →](/developers/how-to/api-keys)

## Advanced: open-source SDK

The TypeScript SDK is built for teams that want full end-to-end TypeScript control — custom wallet integration, raw module access, or non-REST flows. It hits the same SODAX execution layer as the HTTP API.

### 1. Foundation: @sodax/sdk

The core logic layer. Raw functional modules to build with SODAX programmatically.

Functional modules:

* **Swaps** — quote and execute cross-network intents. SODAX routes and settles; solvers on the marketplace fill.
* **Lend / Borrow** — interact directly with the SODAX money market.
* **Leverage Yield** — leveraged yield vaults on the Sonic hub.
* **Bridge** — low-level primitives for asset transfer.
* **Staking** — manage SODA staking and governance positions.
* **Migration** — utilities for migrating ICX to SODA.

Tooling modules:

* **Backend API** — useful data points for each feature.
* **Intent Relay API** — direct access to the intent propagation network.

### 2. Connection layer

Manages connecting user wallets across heterogeneous networks (EVM, SVM, and non-EVM chains). Two flavors:

* **@sodax/wallet-sdk-core** — pure TypeScript wallet providers. Use for a custom frontend framework or a non-React app.
* **@sodax/wallet-sdk-react** — opinionated React wrapper with pre-built context providers and state management.

### 3. Experience layer: @sodax/dapp-kit

The highest-level layer. An opinionated set of UI components, hooks, and utilities built on the layers below. Automatically wires @sodax/wallet-sdk for connection and @sodax/sdk for execution.

[Full SDK reference →](/developers/packages)
