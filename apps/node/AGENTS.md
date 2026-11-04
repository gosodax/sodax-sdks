# apps/node

Node.js scripts for E2E-testing `@sodax/sdk` against real chains. One file per chain or feature, each runnable via a `pnpm run <name>` script that builds with `tsc` then runs the compiled JS.

## Run

```bash
cd apps/node
pnpm build              # tsc → dist/
pnpm sonic              # then: node dist/sonic.js
pnpm moneyMarket
pnpm swap
# … etc — see package.json scripts
```

Or in one shot per script (each `pnpm run <x>` does `pnpm run build && node dist/<x>.js`).

### Prerequisites

Create `.env` in `apps/node/`. There is no single key that covers every script — each reads the variables for the chain it drives:

```
EVM_PRIVATE_KEY=0x…   # swap, moneyMarket, moneymarket-ops, staking, evm, flint-deposit
PRIVATE_KEY=0x…       # sonic, btc, stacks, injective, leverage-yield, evm
```

Non-EVM chains take their own (`ICON_PRIVATE_KEY`, `SOLANA_PRIVATE_KEY`, `STELLAR_PRIVATE_KEY`, `SUI_MNEMONICS`, `NEAR_PRIVATE_KEY`…), and several scripts expect extra RPC URLs, addresses or amounts — the `process.env` reads in the script you're running are the authoritative list. Public RPCs are used as fallback where possible.

`logging.ts` and `test-libs.ts` are the exceptions: they need no key, no RPC and no network. `approve-guard-check.ts` and the `*-raw-intent` / `bridge-raw` builders need no key either, but do read from mainnet.

`stellar-sponsor.ts` is the exception whose extra vars are not inferable from its imports:

```
STELLAR_ACTIVATE_SEED=S…   # THROWAWAY Stellar secret seed of the account to activate
SPONSORING_API_KEY=        # x-api-key registered with the sponsoring service
# SPONSORING_API_URL=http://localhost:3011   # optional base-URL override (version prefix included)
```

## Structure

```
src/
├── btc.ts, evm.ts, sonic.ts, sui.ts, …    # one file per chain (spoke or hub)
├── moneymarket.ts, moneymarket-actions.ts, moneymarket-ops.ts
├── swap.ts                                 # intent-based swap E2E
├── soda-staking.ts
├── bitcoin-radfi.ts                        # Bitcoin trading-wallet provider
├── stellar-sponsor.ts                      # sponsored Stellar account activation (tsx; headless)
├── logging.ts                              # custom SodaxLogger example (tsx; no key, RPC or network)
├── config.ts                               # shared config (RPC URLs, addresses)
└── tests/                                  # focused regression scripts
    ├── bnusd-migration.test.ts
    ├── estimate-gas.test.ts
    ├── backend-api.test.ts
    ├── mm-cross-chain.test.ts
    ├── bridge-limits.test.ts
    └── raw-spoke-provider.test.ts
```

The files named `*.test.ts` are *not* Vitest — they're standalone scripts run via the matching `pnpm run <…>-test` script. **All six are currently commented out in full**, so those scripts build and exit without doing anything; treat them as a record of the flow they used to exercise, and uncomment before relying on one.

## What this app is for

- Pre-release smoke testing each chain integration against mainnet.
- Reproducing partner-reported bugs with a minimal Node script.
- Reference for backend partners using `@sodax/sdk` without React.

## Scripts

```bash
pnpm build        # tsc — emits to dist/
pnpm checkTs      # tsc --noEmit
pnpm lint         # biome lint --write
pnpm pretty       # biome format --write
```

`pnpm test` is a no-op (`true`) — these scripts run interactively against real chains and aren't part of CI.

## Common pitfalls

- **Real funds.** Every keyed script signs and broadcasts to mainnet. Use a dedicated test wallet with minimal balance; never use a wallet that holds real value. The no-key scripts above are the only ones that cannot move funds — `raw: true` builds an unsigned tx and never broadcasts.
- **ICON failures aren't automatically a regression.** `icon.ts` and ICON-touching tests can fail when ICON is disabled/deprioritized in config — confirm against `spokeChainConfig` before treating it as one.
- **Type module.** `package.json` declares `"type": "module"` and tsconfig is `NodeNext`. Relative imports in source must use `.js` extensions (resolved post-build).
- **Build before run.** Every `pnpm run <x>` script already chains `pnpm build` first, but if you're iterating with `node dist/...` directly remember to rebuild after edits.
- **Don't add Vitest here.** The `tests/` directory uses `*.test.ts` naming convention but they're plain scripts. The package's `test` script is intentionally `true` — these run against live chains and aren't suited for CI.
