---
title: "1. The Foundation"
description: >-
  This is the core logic layer that powers the entire ecosystem. It provides the
  raw functional modules required to build with SODAX programmatically.
icon: cup-straw
---

## Main SDK

The SODAX SDK provides a comprehensive interface for interacting with the SODAX protocol, enabling cross-chain swaps, money market, cross-chain bridging, migration and staking SODA token.

<Card title="@sodax/sdk" icon="cup-straw" href="/developers/packages/foundation/sdk/index" horizontal arrow>
  Core `Sodax` facade, hub-and-spoke services, and intent relay.
</Card>

#### Functional Modules inside [sdk](/developers/packages/foundation/sdk/index)

<CardGroup cols={2}>
  <Card title="Swaps" icon="rotate" href="/developers/packages/foundation/sdk/functional-modules/swaps" horizontal arrow>
    Quote and execute intent-based swaps across networks.
  </Card>
  <Card title="Lend / Borrow (Money Market)" icon="sack-dollar" href="/developers/packages/foundation/sdk/functional-modules/money_market" horizontal arrow>
    Supply, borrow, withdraw, repay, and reserve data.
  </Card>
  <Card title="Leverage Yield" icon="money-bill-trend-up" href="/developers/packages/foundation/sdk/functional-modules/leverage_yield" horizontal arrow>
    Deposit, withdraw, APR, and vault position data.
  </Card>
  <Card title="Bridge" icon="bridge-suspension" href="/developers/packages/foundation/sdk/functional-modules/bridge" horizontal arrow>
    Spoke to hub, hub to spoke, and spoke to spoke transfers.
  </Card>
  <Card title="Staking" icon="seedling" href="/developers/packages/foundation/sdk/functional-modules/staking" horizontal arrow>
    Stake and unstake SODA, claim rewards, and read staking data.
  </Card>
  <Card title="Migration" icon="truck" href="/developers/packages/foundation/sdk/functional-modules/migration" horizontal arrow>
    Migrate ICX/wICX, legacy bnUSD, and BALN, and their reverse operations.
  </Card>
</CardGroup>

#### Tooling Modules inside [sdk](/developers/packages/foundation/sdk/index)

<CardGroup cols={2}>
  <Card title="Backend API" icon="plug" href="/developers/packages/foundation/sdk/tooling-modules/backend_api" horizontal arrow>
    HTTP client for intent lookup, swap submission, solver orderbook, money market data, and runtime config.
  </Card>
  <Card title="Intent Relay API" icon="envelope" href="/developers/packages/foundation/sdk/tooling-modules/intent_relay_api" horizontal arrow>
    Submit transactions and retrieve transaction packets across chains.
  </Card>
</CardGroup>
