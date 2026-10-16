# Demo app

Vite + React reference app covering the full SDK surface. Every feature service in `@sodax/sdk` has
a page here, driven through `@sodax/dapp-kit` hooks and `@sodax/wallet-sdk-react` — so it doubles as
the "how do I wire this up" answer for a React integration.

Package name: `sodax-demo-v2`. Dev server: port 3000.

## Run

```bash
pnpm install
pnpm build:packages   # the demo consumes the workspace packages
pnpm dev:demo         # → http://localhost:3000
```

No environment file is required to start. Connecting a wallet and signing needs one of the supported
browser wallets; the app falls back to public RPCs for every chain.

## Pages

Each route is a self-contained example of one feature:

| Route | Feature | Guide |
| --- | --- | --- |
| `/swaps-sdk` | Intent-based swaps via the SDK | [Swaps](https://docs.sodax.com/developers/packages/foundation/sdk/functional-modules/swaps) |
| `/swaps-api` | Backend Swaps API, called directly | [Swaps API](https://docs.sodax.com/developers/packages/foundation/swaps-api) |
| `/money-market/:chainId` | Cross-chain lend / borrow | [Lend / Borrow](https://docs.sodax.com/developers/packages/foundation/sdk/functional-modules/money_market) |
| `/bridge` | Cross-chain token transfers | [Bridge](https://docs.sodax.com/developers/packages/foundation/sdk/functional-modules/bridge) |
| `/bridge-api` | Bridge API, called directly | [`BRIDGE_API.md`](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/BRIDGE_API.md) |
| `/dex` | Concentrated liquidity | [`DEX.md`](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/DEX.md) |
| `/staking` | SODA staking | [Staking](https://docs.sodax.com/developers/packages/foundation/sdk/functional-modules/staking) |
| `/leverage-yield` | Leveraged yield positions | [Leverage Yield](https://docs.sodax.com/developers/packages/foundation/sdk/functional-modules/leverage_yield) |
| `/leverage-yield-api` | Leverage Yield API, called directly | [`LEVERAGE_YIELD_API.md`](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/LEVERAGE_YIELD_API.md) |
| `/oracle` | Oracle price reads | [`ORACLE.md`](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/ORACLE.md) |
| `/partner-fee-claim` | Claiming accrued partner fees | [Monetize SDK](https://docs.sodax.com/developers/how-to/monetize_sdk) |
| `/recovery` | Withdrawing stuck hub-wallet assets | [`RECOVERY.md`](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/RECOVERY.md) |

`/` redirects to `/swaps-sdk`, `/money-market` redirects to the Arbitrum route, and the legacy
`/solver` path still redirects to `/swaps-sdk`. Any unmatched path falls back to `/swaps-sdk`.

## The part worth copying

[`src/providers.tsx`](https://github.com/icon-project/sodax-sdks/blob/main/apps/demo/src/providers.tsx)
is the canonical provider stack: `SodaxProvider` → `QueryClientProvider` (built by
`createSodaxQueryClient`) → `SodaxWalletProvider`. Start from that file rather than assembling the
three by hand — the ordering and the shared query client both matter.

## Optional configuration

| Variable | Effect |
| --- | --- |
| `VITE_WALLETCONNECT_PROJECT_ID` | Enables the WalletConnect connector; omitted, the connector is simply absent |
| `VITE_PRIVY_APP_ID` | Adds "Email (Privy)" to the EVM wallet list (see `example.env` for the Privy app setup); the Settings modal can override it per browser. Unset in both, the Privy chunk is never loaded |
| `VITE_DD_INTAKE_URL` | Points the Datadog logger adapter at a real intake instead of the local mock |
| `VITE_SENTRY_DSN`, `VITE_SENTRY_TUNNEL` | Send to a real Sentry project |
| `VITE_ENABLE_ANALYTICS` | Analytics is **on by default**; set it to `false` to disable |

RPC URLs for each chain are read from the environment with public-RPC fallbacks, so overriding them
is optional.

## Observability harness

The demo doubles as the worked example for
[Logging](https://docs.sodax.com/developers/how-to/logging). It ships two `SodaxLogger` adapters in
[`src/lib/loggers`](https://github.com/icon-project/sodax-sdks/tree/main/apps/demo/src/lib/loggers)
and a zero-dependency mock intake, so the whole path can be exercised without DNS, a vendor account
or a paid plan:

```bash
pnpm mock-intake:demo   # terminal A — local intake on port 9009
pnpm dev:demo           # terminal B
```

The browser only ever POSTs to the same-origin path `/__intake/*`, which the Vite dev proxy forwards
to that local server — same origin means no CORS preflight, localhost means no DNS lookup. Exercise
any feature page and the SDK's internal logs arrive in terminal A.

`createDatadogLogger()` is wired by default. `createSentryLogger()` is the real `@sentry/react` path
behind a tunnel; swap it in at the `logger` assignment in `providers.tsx` to exercise it.

## Scope

This is a reference app, not production UX. It deliberately exposes raw SDK knobs a real dApp would
hide — the solver environment switcher, the recovery page, raw chain IDs — because the point is to
show the SDK surface rather than to model a finished product.

## Related

- [`apps/node`](https://github.com/icon-project/sodax-sdks/tree/main/apps/node) — the same flows as backend scripts, no React.
- [`apps/wallet-modal-example`](https://github.com/icon-project/sodax-sdks/tree/main/apps/wallet-modal-example) — the wallet modal on its own, no DeFi logic.
- [Configure SDK](https://docs.sodax.com/developers/how-to/configure_sdk) — the full `SodaxOptions` shape.
