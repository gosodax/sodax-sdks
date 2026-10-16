# Node examples

Runnable `@sodax/sdk` scripts for a backend or server-side integration — no React, no wallet
extension. Each script is one file under
[`src/`](https://github.com/icon-project/sodax-sdks/tree/main/apps/node/src) driven by its own
`pnpm` script.

Most of these sign with a real key and broadcast to **mainnet**. A handful do not — they need no
key at all, and they are the place to start.

## Prerequisites

- Node.js >= 22.12.0
- pnpm

Build the workspace packages once from the repo root, then work inside this app:

```bash
pnpm install
pnpm build:packages
cd apps/node
```

Every `pnpm run <name>` below already runs `tsc` first, except the `tsx` ones, which execute the
TypeScript directly.

## Start here — no key, no funds

Two scripts need no `.env`, no key and no network access at all:

```bash
pnpm logging
pnpm test-libs
```

[`src/logging.ts`](https://github.com/icon-project/sodax-sdks/blob/main/apps/node/src/logging.ts)
points the backend base URL at a closed local port, so a real internal SDK failure travels through a
custom `SodaxLogger` immediately. See [Logging](https://docs.sodax.com/developers/how-to/logging).
[`src/test-libs.ts`](https://github.com/icon-project/sodax-sdks/blob/main/apps/node/src/test-libs.ts)
encodes addresses and payloads locally to catch a broken `@sodax/libs` dist before a consumer hits it.

These also run without a key, but do read from mainnet:

| Command | What it does |
| --- | --- |
| `pnpm approve-guard-check` | Read-only allowance check for the USDT-class approve guard |
| `pnpm bitcoin-raw-intent` | Encodes the `createIntent` calldata offline from a source address |
| `pnpm bitcoin-raw-intent-check` `pnpm stacks-raw-intent` `pnpm injective-raw-intent` `pnpm sui-raw-intent` `pnpm bridge-raw` | Build the **unsigned** source tx via `raw: true` — never signed, never broadcast |

The six regression scripts under `src/tests/` are commented out in full, so they are inert too (see
[below](#regression-scripts--currently-inert)).

Every other command needs a real key.

## Configuration

Scripts load `.env` from `apps/node/` through `dotenv`. There is no single key that covers
everything — each script reads the variables for the chain it drives:

| Variable | Used by |
| --- | --- |
| `EVM_PRIVATE_KEY` | `swap`, `moneyMarket`, `moneymarket-ops`, `staking`, `evm`, `flint-deposit` |
| `PRIVATE_KEY` | `sonic`, `btc`, `stacks`, `injective`, `leverage-yield`, `evm` |
| `ICON_PRIVATE_KEY` | `icon` |
| `SOLANA_PRIVATE_KEY` | `solana` |
| `STELLAR_PRIVATE_KEY` | `stellar` |
| `SUI_MNEMONICS` | `sui` |
| `NEAR_PRIVATE_KEY`, `NEAR_ACCOUNT_ID` | `near` |
| `BITCOIN_RADFI_PRIVATE_KEY`, `RADFI_API_KEY` | `bitcoin-radfi` |
| `IS_TESTNET` | Testnet toggle, read by most chain scripts |

Open the script before running it — several take extra RPC URLs, addresses or amounts. The
authoritative list is the `process.env` reads in that file.

> **Real funds.** Every keyed script broadcasts to mainnet unless `IS_TESTNET` says otherwise. Use a
> dedicated wallet holding only what you are willing to lose. Never paste a key into a source file
> or a log line.

## Feature flows

| Command | Source | Guide |
| --- | --- | --- |
| `pnpm swap` | `src/swap.ts` | [How to make a swap](https://docs.sodax.com/developers/how-to/how_to_make_a_swap) |
| `pnpm moneyMarket` | `src/moneymarket.ts` | [Lend / Borrow](https://docs.sodax.com/developers/packages/foundation/sdk/functional-modules/money_market) |
| `pnpm moneymarket-ops` | `src/moneymarket-ops.ts` | Supply / borrow / repay / withdraw operations |
| `pnpm staking` | `src/soda-staking.ts` | [Staking](https://docs.sodax.com/developers/packages/foundation/sdk/functional-modules/staking) |
| `pnpm leverage-yield` | `src/leverage-yield.ts` | [Leverage Yield](https://docs.sodax.com/developers/packages/foundation/sdk/functional-modules/leverage_yield) |

`leverage-yield` is parameterised by `SPOKE_CHAIN_KEY`, `SPOKE_TOKEN`, `SPOKE_RPC` and `SONIC_RPC`
rather than hardcoding a chain.

## Per-chain scripts

One file per spoke chain, each exercising deposit and withdrawal through that chain's spoke
provider:

```bash
pnpm evm        pnpm sonic      pnpm icon       pnpm near
pnpm solana     pnpm sui        pnpm stellar    pnpm stacks
pnpm injective  pnpm btc        pnpm bitcoin-radfi
```

`bitcoin-radfi` drives the RadFi trading-wallet provider and reads its secrets from the environment;
see [Bitcoin Integration](https://docs.sodax.com/developers/how-to/bitcoin-integration).
`stellar` additionally needs a funded account with the right trustline — see
[Handle Stellar Trustline](https://docs.sodax.com/developers/how-to/stellar_trustline).

## Raw intent scripts

Build an unsigned intent without the spoke-provider abstraction, for debugging a wallet or signing
integration. `raw: true` returns the transaction — these never sign and never broadcast:

```bash
pnpm bitcoin-raw-intent
pnpm bitcoin-raw-intent-check
pnpm stacks-raw-intent
pnpm injective-raw-intent
pnpm sui-raw-intent
pnpm bridge-raw
```

Swap native S on Sonic into Ethereum USDC and deposit it into the Flint RWA vault via the
`FlintDepositHook`, in one intent:

```bash
EVM_PRIVATE_KEY=0x… pnpm flint-deposit               # dry run: quote + built intent only
EVM_PRIVATE_KEY=0x… pnpm flint-deposit --execute     # submit
```

## Regression scripts — currently inert

Files under
[`src/tests/`](https://github.com/icon-project/sodax-sdks/tree/main/apps/node/src/tests) are named
`*.test.ts` but are **not** Vitest — they are standalone scripts meant to run against live chains,
which is why `pnpm test` in this app is a no-op.

All six are **commented out in full** at the moment, so `pnpm estimate-gas-test`,
`pnpm bnusd-migration-test`, `pnpm backend-api-test`, `pnpm bridge-limits-test`,
`pnpm mm-cross-chain-test` and `pnpm raw-spoke-provider-test` build and exit without doing
anything. Read them as a record of the flow they used to exercise, not as runnable examples, and
uncomment the one you need before relying on it.

## Related

- [Configure SDK](https://docs.sodax.com/developers/how-to/configure_sdk) — the full `SodaxOptions` shape.
- [SDK Architecture](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/ARCHITECTURE_REFACTOR_SUMMARY.md) — `Result<T>` and the error convention.
- [`apps/demo`](https://github.com/icon-project/sodax-sdks/tree/main/apps/demo) — the browser counterpart, same flows with a React UI.
