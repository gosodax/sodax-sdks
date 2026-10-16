# Recipe: Setup

Install and wire `@sodax/dapp-kit` into a React project.

**Depends on:** None

## Install

```bash
# Required
pnpm add @sodax/dapp-kit @tanstack/react-query

# Optional (only if you want built-in wallet connectivity hooks + providers)
pnpm add @sodax/wallet-sdk-react
```

## Wire Providers

RPC URLs are injected via `config.chains` — each chain entry takes `{ rpcUrl: string }`.

```tsx
// providers.tsx
import { QueryClientProvider } from '@tanstack/react-query';
import { SodaxProvider, createSodaxQueryClient } from '@sodax/dapp-kit';
import { ChainKeys, type SodaxOptions } from '@sodax/sdk';

const queryClient = createSodaxQueryClient();

const sodaxConfig: SodaxOptions = {
  chains: {
    [ChainKeys.ARBITRUM_MAINNET]: { rpcUrl: 'https://arb1.arbitrum.io/rpc' },
    [ChainKeys.BASE_MAINNET]: { rpcUrl: 'https://mainnet.base.org' },
    [ChainKeys.BSC_MAINNET]: { rpcUrl: 'https://bsc-dataseed.binance.org' },
    [ChainKeys.POLYGON_MAINNET]: { rpcUrl: 'https://polygon-rpc.com' },
    // Add chains your dApp needs
  },
};

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SodaxProvider config={sodaxConfig}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </SodaxProvider>
  );
}
```

### Config reactivity

`SodaxProvider`'s `config` prop is tracked by **reference**, not by value. The SDK is re-instantiated whenever the prop identity changes - resetting wagmi connection state, in-flight RPC, and any persisted state inside `useSodaxContext` consumers. Choose the pattern that matches your config source:

```tsx
// @ai-snippets-skip — illustrative; uses placeholder values + JSX without surrounding imports
// ✅ Static config — module constant (preferred when nothing depends on runtime state).
const sodaxConfig: SodaxOptions = {
  chains: { [ChainKeys.SONIC_MAINNET]: { rpcUrl: '...' } },
};

// ✅ Runtime-switchable config — useMemo with explicit deps.
//    Re-runs only when listed deps change, so the SDK survives unrelated re-renders.
const sodaxConfig = useMemo(
  () => ({ solver: solverConfigMap[solverEnv], chains: { ... } }),
  [solverEnv], // SDK re-inits when solverEnv switches.
);

// ❌ Inline — new identity every parent render, SDK churns on every render.
<SodaxProvider config={{ chains: { ... } }}>
```

Drive runtime config switches (solver env, feature flags, etc.) through `useMemo` deps - never remount `SodaxProvider` for them.

### Optional: Add Wallet Provider

If you want to use `@sodax/wallet-sdk-react` for wallet connectivity, wrap `SodaxWalletProvider` inside `QueryClientProvider`:

```tsx
// @ai-snippets-skip
import { SodaxWalletProvider, type SodaxWalletConfig } from '@sodax/wallet-sdk-react';

const walletConfig: SodaxWalletConfig = {
  EVM: {
    chains: {
      [ChainKeys.BSC_MAINNET]: { rpcUrl: 'https://bsc-dataseed.binance.org' },
      [ChainKeys.BASE_MAINNET]: { rpcUrl: 'https://mainnet.base.org' },
    },
  },
};

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SodaxProvider config={sodaxConfig}>
      <QueryClientProvider client={queryClient}>
        <SodaxWalletProvider config={walletConfig}>{children}</SodaxWalletProvider>
      </QueryClientProvider>
    </SodaxProvider>
  );
}
```

## `createSodaxQueryClient` (optional)

`createSodaxQueryClient` returns a `QueryClient` pre-wired with a `MutationCache.onError` hook for global mutation observability. Use it instead of `new QueryClient()`:

```tsx
// @ai-snippets-skip — illustrative — multiple createSodaxQueryClient variations
import { createSodaxQueryClient } from '@sodax/dapp-kit';

// Default: logs every mutation failure as `[sodax] Mutation error: <error>`
const queryClient = createSodaxQueryClient();

// Wire to your own logger
const queryClient = createSodaxQueryClient({
  onMutationError: (e) => Sentry.captureException(e),
});

// Silence a specific mutation locally via meta.silent
const swap = useSwap({
  mutationOptions: { meta: { silent: true }, onError: (e) => toast.error(e.message) },
});
```

## Initialize SDK (Optional)

For dynamic config (latest tokens/chains from backend API):

```tsx
import { useEffect } from 'react';
import { useSodaxContext } from '@sodax/dapp-kit';

export function useInitializeSodax() {
  const { sodax } = useSodaxContext();

  useEffect(() => {
    sodax.initialize().then((result) => {
      if (!result.ok) console.error('Failed to initialize Sodax:', result.error);
    });
  }, [sodax]);
}
```

## Chain Key Constants

```tsx
import { ChainKeys } from '@sodax/sdk';

// Examples (full list lives in @sodax/sdk's reference):
ChainKeys.SONIC_MAINNET;       // 'sonic'           (hub)
ChainKeys.ARBITRUM_MAINNET;    // '0xa4b1.arbitrum'
ChainKeys.BASE_MAINNET;        // '0x2105.base'
ChainKeys.BSC_MAINNET;         // '0x38.bsc'
ChainKeys.ETHEREUM_MAINNET;    // '0x1.ethereum'
ChainKeys.POLYGON_MAINNET;     // '0x89.polygon'
ChainKeys.OPTIMISM_MAINNET;    // '0xa.optimism'
ChainKeys.AVALANCHE_MAINNET;   // '0xa86a.avax'
ChainKeys.SUI_MAINNET;         // 'sui'
ChainKeys.STELLAR_MAINNET;     // 'stellar'
ChainKeys.SOLANA_MAINNET;      // 'solana'
ChainKeys.ICON_MAINNET;        // '0x1.icon'
ChainKeys.INJECTIVE_MAINNET;   // 'injective-1'
ChainKeys.NEAR_MAINNET;        // 'near'
ChainKeys.STACKS_MAINNET;      // 'stacks'
ChainKeys.BITCOIN_MAINNET;     // 'bitcoin'
// HyperEVM, Lightlink, Redbelly, Kaia, Hedera, Monad also available.
```

**v1 → v2:** the legacy `*_MAINNET_CHAIN_ID` constants (e.g. `BSC_MAINNET_CHAIN_ID`) are gone. Use `ChainKeys.X_MAINNET` namespace access.
