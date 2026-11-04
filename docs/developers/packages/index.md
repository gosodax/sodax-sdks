---
title: "SDKs"
sidebarTitle: "Overview"
description: Software development kits available to the integrators.
icon: screwdriver-wrench
---

Use these package references to look up TypeScript methods, types, and configuration.
For a first integration, start with [Your first swap](/quickstart); for a specific task, use
[How To](/developers/how-to). Choose a [product](/) before selecting packages if you are still exploring.

<Note>
  **Building with an AI coding agent?** Install [`@sodax/skills`](/ai-integration-guide) so it writes
  v2-correct code against these packages, and add the [Builders MCP](/builders-mcp) so it can read the
  live chain and token lists, quote a real pair, and search these docs as it goes.
</Note>

**1. The Foundation:** [sdk](/developers/packages/foundation/sdk/index)

This is the core logic layer that powers the entire ecosystem. It provides the raw functional modules required to build with SODAX programmatically.

* **Functional Modules:**
  * `Swaps`: Quote and execute cross-network intents. SODAX routes and settles; solvers fill.
  * `Lend/Borrow`: Interact directly with the SODAX money market logic.
  * `Leverage Yield`: Leveraged yield vaults on the Sonic hub.
  * `Bridge`: Core bridging primitives for asset transfer.
  * `Staking`: Management of SODA staking and governance positions.
  * `Migration`: Utilities for migrating ICX to SODA tokens.
* **Tooling Modules:**
  * `Backend API`: Provides useful data points for each feature
  * `Intent Relay API`: Direct access to the intent propagation network.

**2. The Connection Layer**

Sitting above the core SDK, this package manages the complexity of connecting user wallets across heterogeneous chains (EVM, SVM, non-EVM). It is available in two flavors:

* [wallet-sdk-core](/developers/packages/connection/wallet-sdk-core) **Core (TypeScript)**: A pure TypeScript implementation of wallet providers. Use this if you are building a custom frontend framework or a non-React application.
* [wallet-sdk-react](/developers/packages/connection/wallet-sdk-react) **React Adapter**: An opinionated wrapper optimized for React applications, providing pre-built context providers and state management for wallet connections.

**3. The Experience Layer:** [dapp-kit](/developers/packages/experience/dapp-kit)

The fastest way to build with SODAX. This is an opinionated collection of UI components, hooks, and utilities that leverages the layers below it.

* **Under the Hood:** It automatically implements `@sodax/wallet-sdk` for connection and `@sodax/sdk` for execution.
* **What it offers:** React based hooks, contexts, and utilities for SODAX features
