---
title: Why Build With SODAX
description: What you can build, proof points, and ecosystem reach across networks, liquidity venues, and money market assets.
icon: chart-line
---

SODAX is a modular execution system. Integrate each SDK module on its own, or combine them.

### What you can build

| Partner Type | What you can build with SODAX |
| --- | --- |
| **Wallets** | Use **Swaps** to offer cross-network intents in your UI, plus **Bridge** primitives where needed for asset transfer. Use **Lend / Borrow (Money Market)** to integrate lending primitives. |
| **DEXs & Aggregators** | Use **Swaps** to quote and execute cross-network intents and expand beyond single-network liquidity. |
| **Lending Protocols** | Use **Lend / Borrow (Money Market)** to integrate lending primitives and support multi-network user flows around collateral and borrowing. |
| **Perp DEXs / Yield Apps** | Use **Swaps** to accept deposits from other networks via swap-into-your-asset flows, then complete the deposit inside your app. Use **Lend / Borrow (Money Market)** to enable borrowed asset deposits with user collateral on other networks. |
| **New Networks** | Integrate SODAX to provide builders with ready-made cross-network execution capabilities and liquidity access from day one. |

<Card title="Partner with SODAX" icon="handshake" href="https://sodax.com/partners" horizontal arrow>
  Partner integrations and how to get in touch.
</Card>

### Why it fits

* **Execution beyond routing.** Routes move assets. SODAX routes and settles; solvers fill so swaps, borrows, and deposits can complete across networks.
* **One SDK, modular usage.** Integrate @sodax/sdk once, then use only the modules you need.
* **Built for real execution conditions.** Asynchronous by nature, with explicit timeouts and clear completion or failure handling.
* **Your control preserved.** You keep ownership of user experience, pricing logic, and risk parameters.
* **Proven in production.** Live cross-network flows across heterogeneous networks, settled by the protocol and filled by independent solvers.

### Ecosystem reach

Every figure below refreshes from the public backend config API (`api.sodax.com/v2/be/config/all`):

* **Networks:** <span data-sodax-config="count" data-metric="networks">22</span> spanning EVM and non-EVM — <span data-sodax-config="chain-names">Sonic, Arbitrum, Avalanche, Base, Bitcoin, BNB Chain, Ethereum, Hedera, Hyper, ICON, Injective, Kaia, LightLink, Near, Optimism, Polygon, Redbelly, Robinhood Chain, Solana, Stacks, Stellar, SUI</span>.
* **Money market:** <span data-sodax-config="count" data-metric="reserve-assets">30</span> reserve assets available for lending and borrowing across networks.
* **Swap tokens:** <span data-sodax-config="count" data-metric="swap-tokens">140</span> distinct symbols supported for intent swaps.
* **Audits:** 8 published reports — see [Audit reports](/developers/audits).
* **Liquidity access:** SODAX protocol venues — the money market, the AMM, and the intent contracts — are infrastructure that approved solvers can access when they fill. Solvers source and commit their own capital (see [solver-compatible assets](/developers/deployments/swaps-compatible-assets)).
* **Infrastructure compatibility:** designed to work alongside major messaging standards (GMP) for secure intent propagation, not replace them.

Together, SODAX provides the execution infrastructure required for modern money across networks.
