# Recipe: Setup

Install and wire `@sodax/wallet-sdk-react` into a React project. **Always do this first** — every other recipe assumes `SodaxWalletProvider` is mounted.

**Depends on:** None

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

## Wire `SodaxWalletProvider`

Top-level keys on `SodaxWalletConfig` are chain-type slots — **omit a slot to skip mounting that adapter**, pass `{}` to mount with SDK defaults. `<QueryClientProvider>` must wrap `<SodaxWalletProvider>`.

```tsx
// providers.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SodaxWalletProvider, type SodaxWalletConfig } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/types';

const queryClient = new QueryClient();

const walletConfig: SodaxWalletConfig = {
  EVM: {
    ssr: true, // Next.js — keep true for SSR-safe hydration. Drop for Vite/CRA.
    chains: {
      [ChainKeys.SONIC_MAINNET]: { rpcUrl: 'https://rpc.soniclabs.com' },
      [ChainKeys.ETHEREUM_MAINNET]: { rpcUrl: 'https://ethereum-rpc.publicnode.com' },
      [ChainKeys.BSC_MAINNET]: { rpcUrl: 'https://bsc-dataseed.binance.org' },
    },
  },
  ICON: {
    chains: { [ChainKeys.ICON_MAINNET]: { rpcUrl: 'https://ctz.solidwallet.io/api/v3' } },
  },
  // BITCOIN: {},  // mount with SDK defaults
  // SOLANA: { chains: { [ChainKeys.SOLANA_MAINNET]: { rpcUrl: '...' } } },
};

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <SodaxWalletProvider config={walletConfig}>{children}</SodaxWalletProvider>
    </QueryClientProvider>
  );
}
```

---

## Mount point per framework

| Framework | Where to mount `<Providers>` | `EVM.ssr` |
|---|---|---|
| Next.js (App Router) | `app/layout.tsx`, inside `<body>`. Mark the providers file `'use client'`. Pair with [`recipes/ssr-setup.md`](../../../migration-v1-to-v2/knowledge/recipes/ssr-setup.md) if you need wagmi cookie hydration. | `true` |
| Vite + React | `main.tsx`, wrap `<App />` directly. | omit (defaults `false`) |
| Create React App | `index.tsx`, wrap `<App />` directly. | omit |
| Remix / Tanstack Start | Root route component, marked client-only. Same as Next.js. | `true` |

For wagmi cookie hydration in App Router, also see [`recipes/ssr-setup.md`](../../../migration-v1-to-v2/knowledge/recipes/ssr-setup.md).

---

## Chain-type slots

| Slot | React adapter mounted? | Notes |
|---|---|---|
| `EVM` | ✅ wagmi | One connection across every configured EVM chain. WalletConnect opt-in via `EVM.walletConnect.projectId`. |
| `SOLANA` | ✅ `@solana/wallet-adapter-react` | `autoConnect` defaults to `true`. |
| `SUI` | ✅ `@mysten/dapp-kit-react` | `network` defaults to `'mainnet'`. |
| `BITCOIN` / `STELLAR` / `ICON` / `INJECTIVE` / `NEAR` / `STACKS` | ❌ no React adapter | Service auto-registered at mount. Connector list shipped per chain. |

For chain key constants and per-chain entry shapes, see [`../reference/chain-support.md`](../reference/chain-support.md).

---

## Enable WalletConnect (optional)

Add WalletConnect support for Fireblocks / Ledger Live / mobile-only EVM wallets by setting `EVM.walletConnect.projectId`:

```tsx
// @ai-snippets-skip
const walletConfig: SodaxWalletConfig = {
  EVM: {
    ssr: true,
    walletConnect: {
      projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID!,
      // Optional: showQrModal, metadata, qrModalOptions — see WalletConnectParameters
    },
    chains: { /* ... */ },
  },
};
```

Get a project ID from [cloud.walletconnect.com](https://cloud.walletconnect.com). Omit `walletConnect` entirely to disable — v2 falls back to EIP-6963 injected wallets only. Full pattern in [`walletconnect-setup.md`](./walletconnect-setup.md).

---

## Config is captured once on mount

`SodaxWalletProvider` freezes the `config` prop on first render. Subsequent re-renders with a new reference have **no effect**. To swap config at runtime, remount with a new `key`:

```tsx
// @ai-snippets-skip
<SodaxWalletProvider key={configVersion} config={walletConfig}>
  {children}
</SodaxWalletProvider>
```

---

## Pair with `@sodax/dapp-kit` (optional)

If you also use `@sodax/dapp-kit` for SDK feature hooks, mount `SodaxProvider` outermost:

```tsx
// @ai-snippets-skip
<SodaxProvider config={sodaxConfig}>
  <QueryClientProvider client={queryClient}>
    <SodaxWalletProvider config={walletConfig}>{children}</SodaxWalletProvider>
  </QueryClientProvider>
</SodaxProvider>
```

`SodaxProvider` (from dapp-kit) wraps the lot. `QueryClientProvider` must wrap `SodaxWalletProvider` because hooks inside use React Query.

---

## Verification

```bash
# 1. Type check
pnpm checkTs

# 2. Provider mounted exactly once
grep -rn "SodaxWalletProvider" <user-src> --include="*.tsx" | grep -v "import" | wc -l
# expect 1

# 3. QueryClientProvider wraps SodaxWalletProvider
# (manual — confirm nesting in providers.tsx)
```

---

## Next steps

- [`connect-button.md`](./connect-button.md) — single-chain connect/disconnect button
- [`multi-chain-modal.md`](./multi-chain-modal.md) — multi-chain headless wallet modal
- [`bridge-to-sdk.md`](./bridge-to-sdk.md) — pass `walletProvider` to `@sodax/sdk` calls
