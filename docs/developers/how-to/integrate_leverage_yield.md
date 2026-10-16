---
title: "Integrate Leverage Yield (LST vaults)"
sidebarTitle: "Integrate Leverage Yield"
description: "Add SODAX leverage-yield LST vaults to your app: what the loop earns and risks, the default @sodax/sdk and dapp-kit flow, the HTTP API alternative, and the gotchas that stop an intent from filling."
icon: money-bill-trend-up
---

Use this guide to let your users deposit into and withdraw from SODAX leverage-yield vaults. It covers the order of the steps and the rules that matter. Signatures, types and working code live in the references and source it links to, and those are what to copy from.

| Find an answer | Go to |
| --- | --- |
| What a vault does, and what can go wrong | [What it is](#what-it-is) · [Risks](#risks) |
| Which integration path to pick | [Choose a path](#choose-a-path) |
| The TypeScript and React flow | [SDK path](#sdk-path) · [dapp-kit hooks](#dapp-kit-hooks) |
| REST from any language | [API path](#api-path) |
| Why an intent never fills | [Gotchas](#gotchas) |
| Every method, type and route | [Leverage Yield (SDK)](/developers/packages/foundation/sdk/functional-modules/leverage_yield) · [Leverage yield API](/developers/http-api/leverage) |

## What it is {#what-it-is}

A leverage-yield vault loops a liquid staking token (LST). It supplies the LST as collateral, borrows a correlated asset against it, and swaps the borrowed asset back into more LST. It repeats this until the position reaches the vault's target loan-to-value. Users earn the spread between the supply side (lending rate plus staking yield) and the borrow rate, multiplied by the leverage. The loop and the multiplier are explained in [How the leverage-yield vault works](/developers/packages/foundation/sdk/functional-modules/leverage_yield#how-the-leverage-yield-vault-works), and the APR formula in [Effective APR](/developers/packages/foundation/sdk/functional-modules/leverage_yield_apr).

Three facts shape the integration:

- **A position is an ERC-4626 share token (`lsoda*`) on the Sonic hub.** The vault address is also the share-token address.
- **Deposit and withdraw are intent-based swaps.** A deposit swaps any supported token into shares, and a withdraw swaps shares back into any token. A solver fills both, so there is no vault-specific call on the user's network.
- **Shares land in the user's hub wallet**, not on the network they paid from. A later withdraw spends them from there.

Read vaults at runtime rather than hard-coding them. `sodax.leverageYield.listVaults()` returns the registry bundled with your SDK version, and `GET /vaults` returns the live list.

### Risks {#risks}

<Warning>
  Leverage multiplies the spread in both directions. Show these risks to users before they deposit.
</Warning>

- **APR can go negative.** When the borrow rate rises above the supply side, every loop loses money. The SDK returns net APR as a signed value, so a UI can show that.
- **Depeg and liquidation risk.** The position carries real debt. If the LST depegs or moves against the borrowed asset, the health factor falls. `getPosition()` returns the live health factor, LTV, collateral and debt so you can warn users early.
- **The APR is a steady-state estimate.** It assumes today's rates hold and the vault stays at its target LTV. Realised returns move with rates and with how often the vault rebalances.

## Choose a path {#choose-a-path}

| | SDK (default) | HTTP API |
| --- | --- | --- |
| Use when | TypeScript UI, React dApp, Node service | A backend or bot in any language, or you want to own every step |
| Package | `@sodax/sdk`, plus `@sodax/dapp-kit` for React | None, or the `useLeverageYieldApi*` hooks |
| Relay and settlement | `vaultSwap()` handles it | You sign, broadcast, hand off with `/submit-tx`, and poll |
| Your own partner fee on a withdraw | Yes | Not on the wire yet ([Partner fees](/developers/http-api/leverage#partner-fees)) |

## SDK path (default) {#sdk-path}

Set up `Sodax` and a wallet provider as in [Configure the SDK](/developers/how-to/configure_sdk) and [Wallet providers](/developers/how-to/wallet_providers). Then follow the same sequence in both directions:

1. **Quote** with `sodax.leverageYield.getQuote`. The vault is the destination token on a deposit and the source token on a withdraw, and it is always on Sonic.
2. **Apply your slippage** to the quoted amount to get `minOutputAmount`: `quoted × (10_000 − slippageBps) / 10_000`. Never send `0n`, which accepts any fill, and keep the action disabled until a quote arrives.
3. **Build** the payload with `deposit()` or `withdraw()`. These only build it and never broadcast.
4. **Approve**, on a deposit only. Use the swap-domain `sodax.swaps.isAllowanceValid` and `sodax.swaps.approve` on the payload's `params`. A withdraw needs no approval.
5. **Execute** with `vaultSwap({ ...built, walletProvider })`. It signs, broadcasts and hands the intent to the backend, falling back to a client-side relay; on that fallback it resolves once the solver is notified, before the fill.
6. **Track** it with `getDetailedStatus({ srcChainKey, srcTxHash })`, using the source transaction hash from the `vaultSwap` result, until a terminal status.

The complete deposit and withdraw examples, including the approval call's type parameters, are in [Flows](/developers/packages/foundation/sdk/functional-modules/leverage_yield#flows). Copy from there. [Quoting](/developers/packages/foundation/sdk/functional-modules/leverage_yield#quoting) and [Partner fee](/developers/packages/foundation/sdk/functional-modules/leverage_yield#partner-fee) cover fee precedence and how to keep the quote and the intent consistent.

`vaultSwap()` hands the broadcast transaction to the backend first and finishes the relay client-side if that doesn't complete. [Completion paths and `timeout`](/developers/packages/foundation/sdk/functional-modules/leverage_yield#completion-paths-and-timeout) documents both paths and the timeout budget. `getDetailedStatus` is a one-off read, so poll it yourself or use the React hook. Its routing and error branches are documented under [getDetailedStatus](/developers/packages/foundation/sdk/functional-modules/leverage_yield#getdetailedstatus).

For plain `@sodax/sdk` without React, the Node [leverage-yield script](https://github.com/icon-project/sodax-sdks/blob/main/apps/node/src/leverage-yield.ts) runs each step as a CLI subcommand, and the [SDK leverage-yield knowledge file](https://github.com/icon-project/sodax-sdks/blob/main/packages/skills/skills/sodax-sdk/integration/knowledge/features/leverage-yield.md) documents every `sodax.leverageYield` call shape.

### dapp-kit hooks {#dapp-kit-hooks}

Each SDK step has a matching `@sodax/dapp-kit` hook. Mutations expose `mutateAsyncSafe`, which returns a `Result` instead of throwing.

| Step | Hook |
| --- | --- |
| Quote | `useLeverageYieldQuote` |
| Build | `useLeverageYieldDeposit` · `useLeverageYieldWithdraw` |
| Approve (deposit only) | `useSwapAllowance` · `useSwapApprove` |
| Execute | `useLeverageYieldVaultSwap` |
| Track | `useLeverageYieldDetailedStatus` |
| Display | `useLeverageYieldEffectiveApr`, `useLeverageYieldPosition`, `useLeverageYieldTotalAssets`, `useLeverageYieldPreviewRedeem`, `useLeverageYieldShareBalances` |

For parameters and polling behaviour, read each hook's source; [Leverage Yield Hooks](/developers/packages/experience/dapp-kit#leverage-yield-hooks) links most of them. The [dapp-kit leverage yield recipe](https://github.com/icon-project/sodax-sdks/blob/main/packages/skills/skills/sodax-dapp-kit/integration/knowledge/recipes/leverage-yield.md) has component-level deposit, withdraw and stats snippets. The demo's [leverage-yield page](https://github.com/icon-project/sodax-sdks/blob/main/apps/demo/src/pages/leverage-yield/page.tsx) wires the full flow. It attaches SODAX's own partner fee to deposits, so don't copy its `DEPOSIT_PARTNER_FEE`: leave `partnerFee` out, or use your own receiver address.

## API path {#api-path}

Every route lives under `https://api.sodax.com/v1/leverage-yield`. Amounts are decimal strings in the token's smallest unit, and networks are SODAX chain keys. The [endpoint catalog](/developers/http-api/leverage#endpoint-catalog) lists each route.

| # | Step | Route |
| --- | --- | --- |
| 1 | Quote | `POST /quote/deposit` · `POST /quote/withdraw` |
| 2 | Check the allowance (deposit only) | `POST /allowance/check` |
| 3 | Approve (deposit only) | `POST /approve` |
| 4 | Build the intent | `POST /intents/deposit` · `POST /intents/withdraw` |
| 5 | Sign and broadcast the returned `tx` | Your wallet, on the source network |
| 6 | Hand off to the backend | `POST /submit-tx`, with `operation` |
| 7 | Poll to a terminal state | `GET /submit-tx/status` |

Steps 6 and 7 are the same submit-tx machine as swaps, so follow the [Swaps bot flow](/developers/http-api/swaps#bot-flow-create-submit-tx-poll) for the status lifecycle and failure handling. Send your API key from your server on every `POST`, as described in [API keys](/developers/how-to/api-keys).

In TypeScript, `sodax.api.leverageYield` and the `useLeverageYieldApi*` hooks wrap these routes. The [leverage-yield API knowledge file](https://github.com/icon-project/sodax-sdks/blob/main/packages/skills/skills/sodax-sdk/integration/knowledge/features/leverage-yield-api.md) documents their call shapes. The demo app's [leverage-yield API page](https://github.com/icon-project/sodax-sdks/blob/main/apps/demo/src/pages/leverage-yield-api/page.tsx) wires the API flow: its [API card](https://github.com/icon-project/sodax-sdks/blob/main/apps/demo/src/components/leverage-yield-api/LeverageCard.tsx) runs steps 1–6 end to end, and its [order status panel](https://github.com/icon-project/sodax-sdks/blob/main/apps/demo/src/components/leverage-yield-api/OrderStatus.tsx) runs step 7.

## Gotchas {#gotchas}

1. **Building is not executing.** `deposit()` and `withdraw()` return a payload. Nothing happens on-chain until `vaultSwap()` runs, or until you broadcast and call `/submit-tx`.
2. **Quote with the leverage-yield quote.** Use `sodax.leverageYield.getQuote`, `useLeverageYieldQuote`, or `/quote/deposit|withdraw`, never the swap quote (`sodax.swaps.getQuote`, `useQuote`). The swap quote deducts the swap fee, so the `minOutputAmount` it gives can exceed what the vault intent delivers, and the intent never fills.
3. **Keep the partner fee consistent, and quote the gross amount.** Pass the same `partnerFee` to the quote and the builder, or leave it out of both. The quote deducts the fee itself, so don't net the amount first.
4. **`swaps.partnerFee` never applies to vaults.** Configure `leverageYield.partnerFee`, or the global `fee`. A withdraw fee is taken in `lsoda*` shares.
5. **Only deposits need approval, and it's the swap-domain one.** `sodax.leverageYield.approve` and `isAllowanceValid` are for calling the vault directly on Sonic, and neither flow uses them. When `/approve` returns a `resetTx`, mine it before `tx`. `useLeverageYieldApiApproveAndBroadcast` handles that order for you.
6. **Withdraw from the address that deposited.** The hub wallet is derived from the network and address the user deposited from. `getShareBalanceForUser` takes that spoke address. `getShareBalance` and `/share-balance` take the hub wallet address, which `sodax.hubProvider.getUserHubWalletAddress` resolves.
7. **Size a withdraw in shares.** `inputAmount` is `lsoda*` shares, so read it from the share balance. `getMaxWithdraw*` and `/max-withdraw` return the ERC-4626 `maxWithdraw`, which is in the underlying asset's units.
8. **The headline APR is the effective APR.** Use `getEffectiveApr` or `/apr/effective`. `getApr` counts lending rates only and leaves out the staking yield. The units of each APR field are listed in [Types](/developers/packages/foundation/sdk/functional-modules/leverage_yield#types).
9. **Know the `submit-tx` body.** `relayData` takes the create response's `relayData.payload` string, and `operation` is required. Wait for the source-network receipt before you submit. Terminal success is `solved`.
10. **Track by the source transaction.** Use `getDetailedStatus` / `useLeverageYieldDetailedStatus` rather than the backend record alone, because the client-side fallback can finish a swap the backend record still shows as open.
11. **Branch on `result.ok`, and discriminate on `error.code`.** Methods that return a `Result` never throw, and error messages aren't stable. A quote error can be the solver's own response. [Error Handling](/developers/packages/foundation/sdk/functional-modules/leverage_yield#error-handling) lists the codes and guards.
12. **Keep API keys on the server.** A key in a browser bundle is public. See [API key good practices](/developers/how-to/api-key-good-practices).
13. **Show leverage as `1 + leverageMultiplierWad`.** The multiplier is the borrowed multiple, `targetLTV / (1 − targetLTV)`: 4.56× at an 82% target, while the depositor's exposure is 5.56×. `targetLtvBps` and the position `ltv` are basis points (`8200` = 82%).
14. **A vault is not a leverage position.** Leverage positions (`openLeveragePosition`, `useLeveragePosition*`) share the service but are a separate product. See [Leverage Positions](/developers/packages/foundation/sdk/functional-modules/leverage_yield#leverage-positions).

## Build it with an AI agent {#ai-agents}

Install the [`@sodax/skills`](/ai-integration-guide) bundle before you start the agent. The broad `sodax-dapp-kit` and `sodax-sdk` skills route it to the leverage-yield skills below. You don't need the Builders MCP for vaults: the SDK and hooks read live vault data, APR and quotes themselves. Then describe the task plainly, for example *"Add a deposit into a leverage-yield vault from Arbitrum with `@sodax/dapp-kit`"*. Check what the agent produces against the [Gotchas](#gotchas).

To point an agent at a skill directly, or to read one yourself:

| Skill | Use it for |
| --- | --- |
| [`sodax-sdk-leverage-yield`](https://github.com/icon-project/sodax-sdks/blob/main/packages/skills/skills/sodax-sdk/leverage-yield/SKILL.md) | The [SDK path](#sdk-path) in TypeScript or Node |
| [`sodax-dapp-kit-leverage-yield`](https://github.com/icon-project/sodax-sdks/blob/main/packages/skills/skills/sodax-dapp-kit/leverage-yield/SKILL.md) | The [dapp-kit hooks](#dapp-kit-hooks) in React |
| [`sodax-sdk-leverage-yield-api`](https://github.com/icon-project/sodax-sdks/blob/main/packages/skills/skills/sodax-sdk/leverage-yield-api/SKILL.md) | The [API path](#api-path) through `sodax.api.leverageYield` |

## Related

<CardGroup cols={2}>
  <Card title="Leverage Yield (SDK)" icon="chart-line" href="/developers/packages/foundation/sdk/functional-modules/leverage_yield">
    Every `sodax.leverageYield` method, error code and type.
  </Card>
  <Card title="Effective APR" icon="percent" href="/developers/packages/foundation/sdk/functional-modules/leverage_yield_apr">
    How the headline APR is derived, with a worked example.
  </Card>
  <Card title="Leverage yield API" icon="server" href="/developers/http-api/leverage">
    Every `/v1/leverage-yield/*` route.
  </Card>
  <Card title="AI Integration Guide" icon="robot" href="/ai-integration-guide">
    Ship v2-correct SODAX code from your coding agent.
  </Card>
</CardGroup>
