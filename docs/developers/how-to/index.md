---
title: "How To"
sidebarTitle: "Overview"
description: Practical, task-based guides for integrating SODAX — HTTP API routes, SDK configuration, swaps, wallets, and more.
icon: book
---

Task guides for common integration work. For product pickers, start from a [solution hub](/introduction). Network-specific onboarding lives under [Get Started](/introduction#or-start-from-your-context).

**Most guides here use `@sodax/sdk`.** Where a task also has an HTTP path, the card says which one you are getting — and the [Swap hub](/swap) puts the two side by side if you have not picked yet.

## Task guides

<CardGroup cols={2}>
  <Card title="Make a swap (SDK)" icon="repeat" href="/developers/how-to/how_to_make_a_swap">
    Init, quote, execute, and error handling in TypeScript.
  </Card>
  <Card title="Make a swap (HTTP)" icon="server" href="/developers/http-api/swaps#bot-flow-create-submit-tx-poll">
    The same flow over REST, from any language.
  </Card>
  <Card title="Integrate Leverage Yield" icon="money-bill-trend-up" href="/developers/how-to/integrate_leverage_yield">
    Deposit into and withdraw from LST vaults, over the SDK or the HTTP API.
  </Card>
  <Card title="API keys" icon="key" href="/developers/how-to/api-keys">
    Create, deploy and rotate a partner portal key.
  </Card>
  <Card title="API key good practices" icon="lock" href="/developers/how-to/api-key-good-practices">
    Keep the key off the client, with a worked backend proxy for browser dApps.
  </Card>
  <Card title="Payout wallet" icon="wallet" href="/developers/how-to/payout-wallet">
    Set the address your partner fees are paid to, and claim them.
  </Card>
  <Card title="Configure the SDK" icon="sliders" href="/developers/how-to/configure_sdk">
    Networks, RPCs, and partner settings.
  </Card>
  <Card title="Logging" icon="file-lines" href="/developers/how-to/logging">
    Silence SDK diagnostics or forward them to Sentry, Datadog or a JSON sink.
  </Card>
  <Card title="Install with Next.js" icon="box" href="/developers/packages/sdk/docs/installation/nextjs">
    Create a Next.js app and install `@sodax/sdk`.
  </Card>
  <Card title="Monetize" icon="coins" href="/developers/how-to/monetize_sdk">
    Partner fees and claiming.
  </Card>
  <Card title="Wallet providers" icon="wallet" href="/developers/how-to/wallet_providers">
    Connect wallets across networks.
  </Card>
  <Card title="Estimate gas" icon="gas-pump" href="/developers/how-to/estimate_gas">
    Gas estimation patterns in the SDK.
  </Card>
  <Card title="Stellar trustline" icon="link" href="/developers/how-to/stellar_trustline">
    Trustline setup for Stellar assets.
  </Card>
  <Card title="Stellar sponsoring" icon="star" href="/developers/how-to/stellar-sponsoring-getting-started">
    Activate a new Stellar account with the Sponsoring API.
  </Card>
  <Card title="Bitcoin integration" icon="bitcoin" href="/developers/how-to/bitcoin-integration">
    Use Bitcoin as a source or destination network.
  </Card>
  <Card title="Testnet" icon="flask" href="/developers/how-to/testnet">
    What “testnet” means for SODAX today.
  </Card>
</CardGroup>

## Reference, not guides

These live in other tabs. They document a surface rather than walking a task.

<CardGroup cols={2}>
  <Card title="HTTP API overview" icon="server" href="/developers/http-api">
    Base URLs, route prefixes, and which API to use.
  </Card>
  <Card title="Swaps API reference" icon="rotate" href="/developers/http-api/swaps">
    Every `/v1/swaps/*` route, plus the submit-tx walkthrough.
  </Card>
  <Card title="Builders MCP" icon="plug" href="/builders-mcp">
    Live chains, tokens, quotes and docs, inside your AI coding agent.
  </Card>
  <Card title="SDK modules" icon="cup-straw" href="/developers/packages/foundation/sdk/functional-modules">
    Per-feature API reference for `@sodax/sdk`.
  </Card>
</CardGroup>
