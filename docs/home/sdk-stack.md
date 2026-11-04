---
title: API & SDK stack
sidebarTitle: API & SDK
description: Partner HTTP APIs and the open-source SDK — Foundation, Connection, and Experience layers.
icon: layer-group
---

Pick the **HTTP API** for any language, or the **open-source SDK** for TypeScript end-to-end flows. Both hit the same SODAX execution layer.

<CardGroup cols={2}>
  <Card title="HTTP API" icon="server" href="/developers/http-api">
    Quote, build intents, submit-tx, and status — partner REST surfaces.
  </Card>
  <Card title="Open-source SDK" icon="code" href="/developers/packages">
    Full reference for every layer and module.
  </Card>
</CardGroup>

### 1. Foundation: @sodax/sdk

The core logic layer that powers everything else. Raw functional modules to build with SODAX programmatically.

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

Manages connecting user wallets across heterogeneous networks (EVM, SVM, and non-EVM blockchain networks). Two flavors:

* **@sodax/wallet-sdk-core (TypeScript)** — a pure TypeScript implementation of wallet providers. Use this for a custom frontend framework or a non-React app.
* **@sodax/wallet-sdk-react (React adapter)** — an opinionated wrapper for React, with pre-built context providers and state management for wallet connections.

### 3. Experience layer: @sodax/dapp-kit

The highest-level layer, built for speed. An opinionated set of UI components, hooks, and utilities built on the layers below.

* Under the hood: automatically wires @sodax/wallet-sdk for connection and @sodax/sdk for execution.
* What it offers: React hooks, contexts, and utilities for SODAX features.
