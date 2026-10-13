# Integration: First-time setup (Human-readable overview)

This folder helps you integrate `@sodax/wallet-sdk-react` into a fresh React app. It is the **human-facing** entry point for new integrations. If you are a coding agent, read [`ai-rules.md`](./ai-rules.md) first.

If you are migrating from v1 instead, see [`sodax-wallet-sdk-react` (migration mode)](../../migration-v1-to-v2/knowledge/).

---

## What this package does

`@sodax/wallet-sdk-react` is the React layer over `@sodax/wallet-sdk-core`. It gives you:

- **Multi-chain wallet connect** across 9 chain types (EVM, Solana, Sui, Bitcoin, Stellar, ICON, Injective, NEAR, Stacks).
- **Hooks** (`useXConnect`, `useXAccount`, `useXDisconnect`, `useXSignMessage`, etc.) backed by a Zustand store — composable and SSR-safe.
- **Headless modal primitives** (`useWalletModal`, `useChainGroups`, `useBatchConnect`) — bring your own UI.
- **Typed wallet providers** for hand-off to `@sodax/sdk` calls (`useWalletProvider`).

---

## Recommended path (in order)

If this is your first time using the package:

1. [`recipes/setup.md`](./recipes/setup.md) — install, wire `SodaxWalletProvider`, pick chain slots. **Always do this first**.
2. Pick a connect UX (one, not both):
   - [`recipes/connect-button.md`](./recipes/connect-button.md) — single chain, simplest UX.
   - [`recipes/multi-chain-modal.md`](./recipes/multi-chain-modal.md) — chain picker + connector picker, headless.
3. [`recipes/sign-message.md`](./recipes/sign-message.md) — sign messages cross-chain (auth flows).
4. [`recipes/bridge-to-sdk.md`](./recipes/bridge-to-sdk.md) — pass `walletProvider` to `@sodax/sdk` calls (swaps, lending, staking, etc.).
5. [`recipes/switch-chain.md`](./recipes/switch-chain.md) — switch the active EVM network when source chain doesn't match.
6. [`recipes/chain-detection.md`](./recipes/chain-detection.md) — list enabled chains, render connected list with hydration gate, install detection.
7. Add advanced features as needed:
   - [`recipes/walletconnect-setup.md`](./recipes/walletconnect-setup.md) — enable WalletConnect for enterprise-custody / mobile-only wallets.
   - [`recipes/privy-email-login.md`](./recipes/privy-email-login.md) — add "Email (Privy)" email login with an embedded wallet (`EVM.privy`).
   - [`recipes/batch-operations.md`](./recipes/batch-operations.md) — batch connect / disconnect across multiple chains.
   - [`recipes/sub-path-imports.md`](./recipes/sub-path-imports.md) — deep imports from `xchains/<chain>` for `instanceof` checks or custom connector lists.
8. Reference docs (lookup as needed):
   - [`reference/hooks.md`](./reference/hooks.md) — full hook surface with signatures.
   - [`reference/connectors.md`](./reference/connectors.md) — available wallet connectors per chain.
   - [`reference/chain-support.md`](./reference/chain-support.md) — supported chains, slots, and adapter notes.
9. Copy-paste examples (runnable code, minimal narrative):
   - [`examples/`](./examples/) — 4 self-contained `.tsx` files: minimal EVM setup, multi-chain modal, Next.js App Router, WalletConnect setup.

---

## Install

```bash
pnpm add @sodax/wallet-sdk-react @tanstack/react-query
```

Peer dependencies:

```json
{
  "react": ">=19",
  "@tanstack/react-query": "5.x"
}
```

---

## Pair with `@sodax/sdk` and `@sodax/dapp-kit`

Most apps integrate this package together with the SDK and dapp-kit:

```
@sodax/sdk            ← business logic (swaps, lending, staking, etc.)
@sodax/dapp-kit       ← high-level React hooks combining SDK + wallet-sdk
@sodax/wallet-sdk-react  ← wallet connectivity (this package)
```

If you are using all three, mount providers in this order at the app root:

```tsx
// @ai-snippets-skip
<SodaxProvider config={sodaxConfig}>            {/* @sodax/dapp-kit */}
  <QueryClientProvider client={queryClient}>
    <SodaxWalletProvider config={walletConfig}>  {/* this package */}
      {children}
    </SodaxWalletProvider>
  </QueryClientProvider>
</SodaxProvider>
```

`SodaxProvider` (from dapp-kit) wraps the lot. `QueryClientProvider` must wrap `SodaxWalletProvider` because hooks inside use React Query.

---

## Conventions worth knowing

- **Hooks use a single options object.** `useXConnectors({ xChainType: 'EVM' })`, not positional args.
- **`xChainId` (chain key) and `xChainType` (family) are both accepted** by `useXAccount` and `useWalletProvider`. Pass one, not both.
- **`useXConnect` is a React Query mutation.** Pass an `IXConnector` to `mutateAsync`.
- **Persisted connections.** Connections survive reload via `localStorage` key `xwagmi-store`. Gate UI on `useConnectedChains().status === 'ready'` to avoid hydration flicker.
- **EVM is one connection across all networks.** wagmi treats every configured EVM chain as part of one connector — there is no per-network connect/disconnect.

---

## Getting help

- API surface lookup: [`reference/`](./reference/).
- Bug or missing feature: [open an issue](https://github.com/icon-project/sodax-sdks/issues).
- Internal architecture (only relevant for SODAX maintainers): `../CLAUDE.md` in the package root.
