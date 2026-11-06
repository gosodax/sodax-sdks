---
title: API & SDK
sidebarTitle: API & SDK
description: Use the SODAX HTTP API from any language, or the open-source TypeScript SDK for full programmatic control.
icon: layer-group
---

The HTTP API is the main path for new integrations. It works from any language and platform, with no SDK install required. The open-source SDK layers TypeScript types and abstractions on top for teams that want them.

## HTTP API

Quote, build intents, submit transactions, and check status over standard REST. Get your API key at [portal.sodax.com](https://portal.sodax.com) to get started.

<CardGroup cols={2}>
  <Card title="Swaps API" icon="rotate" href="/developers/http-api/swaps">
    Quote, build intent, submit-tx, status — the full swap lifecycle over REST.
  </Card>
  <Card title="Leverage Yield API" icon="money-bill-trend-up" href="/developers/http-api/leverage">
    Open and close leveraged yield positions.
  </Card>
  <Card title="Oracle API" icon="chart-line" href="/developers/http-api/oracle">
    Live token prices.
  </Card>
  <Card title="Stats API" icon="chart-bar" href="/developers/http-api/stats">
    Protocol statistics.
  </Card>
</CardGroup>

The intent flow over REST: call **quote** → **build-intent** → **submit-tx** → poll **status**. The intent payload from build-intent passes directly to submit-tx. Your server never holds a user private key.

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
