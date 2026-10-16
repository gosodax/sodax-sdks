---
title: How Execution Works
description: Intent-based execution, unified liquidity access, and smart wallet abstraction — how SODAX routes and settles while solvers fill.
icon: gears
---

Cross-network execution is asynchronous by nature, depends on liquidity fragmented across networks, and is exposed to volatility and partial completion. Asset transfers can succeed while the action they were meant to enable fails: collateral arrives but the borrow does not fill, a quoted price cannot be filled when execution begins.

SODAX is non-custodial cross-network execution infrastructure. It **routes and settles**. Independent solvers on the marketplace **fill**. Three protocol components make that possible.

### Intent-based execution

You express an intent — a desired outcome. SODAX routes and settles it; solvers fill it. Users do not hand-route transactions.

* **Solver fills.** Solvers on the SODAX marketplace decide how to fill across networks — pricing, venue selection, and capital — within your builder-defined parameters. SODAX provides the routing and settlement rails they access.
* **Outcome-oriented settlement.** Quotes come from solvers accessing coordinated liquidity venues; execution settles explicitly once approved.
* **Explicit asynchronous handling.** Multi-step execution, partial completion, and recovery paths are handled deliberately, so flows that cannot complete atomically still complete with a clear terminal status.

### Unified liquidity access

SODAX treats liquidity **access** as one system across networks — not isolated pools you integrate per chain. Solvers source and commit capital when they fill; SODAX does not trade or take custody.

* **Protocol venues and rails.** Money market, AMM, intents, and related contracts are SODAX infrastructure that approved solvers can access.
* **Solver-accessed at execution time.** Solvers draw on that access when planning and executing fills. Inventory, rebalancing, and capital commitment stay with the solver.
* **Less fragmentation risk.** Execution no longer depends on the right liquidity sitting on a specific network only because you integrated that venue yourself.

### Smart wallet abstraction

SODAX coordinates cross-network account state as part of the execution layer, rather than relying on separate wallets per network.

* **Deterministic execution wallets.** Users get deterministic smart wallets that act as one consistent execution identity across networks.
* **Unified execution account.** Apps execute cross-network actions through a single wallet context, not separate accounts and approvals per network.
* **Simplified coordination.** SODAX handles wallet creation and execution routing, so you focus on what happens after execution.

<CardGroup cols={2}>
  <Card title="Intents architecture" icon="bullseye" href="/developers/technical-overview/intents">
    The contracts behind intent-based execution.
  </Card>
  <Card title="Hub Wallet Abstraction" icon="wallet" href="/developers/technical-overview/hub-wallet-abstraction">
    How deterministic hub wallets work under the hood.
  </Card>
</CardGroup>
