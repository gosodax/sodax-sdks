# apps/wallet-modal-example

Headless wallet-modal reference app for `@sodax/wallet-sdk-react`. Exercises the package's wallet-modal primitives. No design system, no DeFi business logic — only the wallet modal flow.

Package name: `@sodax/wallet-modal-example`. Dev server port: **3002**.

## Run

```bash
pnpm install
pnpm --filter @sodax/wallet-modal-example dev
# → http://localhost:3002
```

## What it covers

| Component | Primitive demonstrated |
| --- | --- |
| `components/WalletModal.tsx` | `useWalletModal` — discriminated-union state machine |
| `components/ChainList.tsx` | `useChainGroups` — EVM as one logical chain |
| `components/WalletList.tsx` | `useXConnectors` (enriched) + `sortConnectors` + `useIsWalletInstalled` |
| `components/ConnectingView.tsx` | Renders `state.connector` from `useWalletModal` |
| `components/ErrorView.tsx` | Renders `state.error` + `retry()` from `useWalletModal` |
| `components/ConnectedChains.tsx` | `useConnectedChains` — aggregate view + `status` hydration |
| `components/BatchActions.tsx` | `useBatchConnect` + `useBatchDisconnect` (Hana scope + universal disconnect) |
| `components/ConnectionFlowDemo.tsx` | `useConnectionFlow` — standalone (no modal) |

See the app's [README.md](README.md) for full primitive ↔ component mapping and patterns.

## Structure

```
src/
├── App.tsx           # top-level layout, hosts <WalletModal /> and demo sections
├── providers.tsx     # SodaxWalletProvider + QueryClientProvider only — no SodaxProvider
├── index.tsx, index.css
└── components/       # one file per primitive (see table above)
```

Crucially this app depends on `@sodax/wallet-sdk-react` and `@sodax/types` but **not** `@sodax/sdk` or `@sodax/dapp-kit`. The wallet layer is intentionally usable standalone — this app proves it.

## What this app is for

- Reference implementation for partners building their own wallet modal on top of the headless hooks.
- Manual QA for changes to `@sodax/wallet-sdk-react` primitives.
- Living spec — if a primitive changes shape, update the corresponding component here.

## Scripts

```bash
pnpm dev          # vite dev server on :3002
pnpm build        # vite build
pnpm preview      # serve built bundle
pnpm checkTs      # tsc --noEmit
pnpm lint / pretty
```

`pnpm test` is a no-op (`true`).

## Common pitfalls

- **Don't add business logic.** The `WalletModal.tsx` `onConnected` callback is where partners would plug in registration / ToS / routing — but those don't belong in this app. Surface as docs or comments instead.
- **Don't depend on `@sodax/sdk` or `@sodax/dapp-kit`.** The whole point is to prove the wallet layer works on its own. Adding those deps would defeat the purpose.
- **Don't theme.** A themed `<WalletModal />` component is intentionally out of scope. This app stays unstyled-beyond-Tailwind-defaults.
- **Node polyfills.** Uses `@bangjelkoski/vite-plugin-node-polyfills` because wallet adapters pull in `buffer` etc. Add new polyfills there rather than in app code.
