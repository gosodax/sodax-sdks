# Quickstart — `@sodax/dapp-kit` v2

Get a React app running with dapp-kit in five minutes. For copy-paste recipes per feature, see [`recipes/`](recipes/). For design rationale, see [`architecture.md`](architecture.md).

## 1. Install

```bash
# Required
pnpm add @sodax/dapp-kit @tanstack/react-query

# Wallet connectivity (the canonical companion)
pnpm add @sodax/wallet-sdk-react
```

`@sodax/dapp-kit` peers on `react`, `react-dom` (>=18), and `@tanstack/react-query`. It re-exports `@sodax/sdk` — don't add `@sodax/types` separately.

## 2. Wire providers

```tsx
// providers.tsx
import { QueryClientProvider } from '@tanstack/react-query';
import { SodaxProvider, createSodaxQueryClient } from '@sodax/dapp-kit';
import { SodaxWalletProvider, type SodaxWalletConfig } from '@sodax/wallet-sdk-react';
import { ChainKeys, type SodaxOptions } from '@sodax/sdk';

const queryClient = createSodaxQueryClient();

const sodaxConfig: SodaxOptions = {
  chains: {
    [ChainKeys.SONIC_MAINNET]: { rpcUrl: 'https://sonic-rpc.publicnode.com' },
    [ChainKeys.BSC_MAINNET]: { rpcUrl: 'https://bsc-dataseed.binance.org' },
    [ChainKeys.BASE_MAINNET]: { rpcUrl: 'https://mainnet.base.org' },
    [ChainKeys.ARBITRUM_MAINNET]: { rpcUrl: 'https://arb1.arbitrum.io/rpc' },
    // Add chains your dApp needs
  },
};

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
        <SodaxWalletProvider config={walletConfig}>
          {children}
        </SodaxWalletProvider>
      </QueryClientProvider>
    </SodaxProvider>
  );
}
```

`createSodaxQueryClient` gives you a `QueryClient` pre-wired with global mutation observability. Optional — if you construct your own `QueryClient`, nothing changes. See [`recipes/observability.md`](recipes/observability.md).

## 3. Initialize the SDK (optional)

`sodax.config.initialize()` currently returns success without fetching anything, so this step is optional and adds no tokens:

```tsx
import { useEffect } from 'react';
import { useSodaxContext } from '@sodax/dapp-kit';

export function useInitializeSodax() {
  const { sodax } = useSodaxContext();
  useEffect(() => {
    sodax.config.initialize().then((result) => {
      if (!result.ok) console.error('Failed to initialize Sodax:', result.error);
    });
  }, [sodax]);
}
```

Tokens and chains come from the installed `@sodax/sdk` version. For tokens the backend lists after that release, use the `useSwapsApi*`, `useBridgeApi*` and `useLeverageYieldApi*` hooks (the `auxiliary-services` skill), which leave token validation to the backend.

## 4. Get a wallet provider

```tsx
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/sdk';

function MyFeature() {
  const walletProvider = useWalletProvider({ xChainId: ChainKeys.BSC_MAINNET });
  // undefined until the user connects a BSC wallet
  return <button disabled={!walletProvider}>...</button>;
}
```

`useWalletProvider` returns a chain-specific wallet provider object that satisfies `IEvmWalletProvider` (or `IIconWalletProvider`, `ISolanaWalletProvider`, etc., depending on the chain).

## 5. Run a mutation

The canonical pattern: hook takes `{ mutationOptions }` (optional); domain inputs flow through `mutate(vars)`. Use `mutateAsyncSafe` for explicit `Result<T>` branching:

```tsx
import { useSwap } from '@sodax/dapp-kit';
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/sdk';
import type { CreateIntentParams } from '@sodax/sdk';

function SwapButton({ intentParams }: { intentParams: CreateIntentParams }) {
  const walletProvider = useWalletProvider({ xChainId: ChainKeys.BSC_MAINNET });
  const { mutateAsyncSafe: swap, isPending } = useSwap();

  const handleSwap = async () => {
    if (!walletProvider) return;
    const result = await swap({ params: intentParams, walletProvider });
    if (!result.ok) {
      alert(result.error instanceof Error ? result.error.message : 'Swap failed');
      return;
    }
    console.log('Swap submitted!', result.value);
  };

  return (
    <button onClick={handleSwap} disabled={isPending || !walletProvider}>
      {isPending ? 'Swapping...' : 'Swap'}
    </button>
  );
}
```

The exact same pattern works for every mutation: `useBridge`, `useSupply`, `useStake`, `useDexDeposit`, etc. The only difference is the `params` shape (each feature's reference doc has the type signature).

## 6. Run a query

Queries take `{ params, queryOptions }`. The hook owns `queryKey`, `queryFn`, and `enabled`:

```tsx
import { useQuote } from '@sodax/dapp-kit';
import { ChainKeys } from '@sodax/sdk';

function SwapQuote({ amount }: { amount: bigint }) {
  const { data: quoteResult, isLoading } = useQuote({
    params: {
      payload: amount > 0n
        ? {
            token_src: '0x0000000000000000000000000000000000000000',
            token_dst: '0x0000000000000000000000000000000000000000',
            token_src_blockchain_id: ChainKeys.BSC_MAINNET,
            token_dst_blockchain_id: ChainKeys.ARBITRUM_MAINNET,
            amount,
            quote_type: 'exact_input',
          }
        : undefined,
    },
    queryOptions: { staleTime: 3000 },
  });

  if (isLoading) return <p>Loading...</p>;
  if (quoteResult?.ok) return <p>Output: {quoteResult.value.quoted_amount}</p>;
  return null;
}
```

Some query hooks return `Result<T>` as their `data` (the underlying SDK method returns Result and we surface it directly for query hooks; only mutations unwrap). Always check `.ok` before reading `.value`.

## First-time troubleshooting

| Error | Why | Fix |
|---|---|---|
| `Module '"@sodax/dapp-kit"' has no exported member 'useSpokeProvider'` | v1 hook deleted in v2. | Drop the import. Pass `walletProvider` (from `useWalletProvider`) into `mutate(vars)` instead. |
| `Property 'approve' does not exist on type 'SafeUseMutationResult'` | v1 approve hooks returned `{ approve, isLoading, error }`; v2 returns `SafeUseMutationResult`. | Use `mutateAsync` / `mutateAsyncSafe`. `isLoading` → `isPending`. |
| `Type 'CreateIntentParams' is missing the following properties from ...: walletProvider` | v1 hooks took params at hook-init; v2 takes them via `mutate(vars)`. | Move `params` and `walletProvider` from hook init to `mutate({ params, walletProvider })`. |
| `Property 'xChainId' does not exist on type 'XToken'` | SDK-leakage rename: `xChainId` → `chainKey` on `XToken` in v2. | Use `xToken.chainKey`. (Note: `useXBalances` params still use `xChainId` for the request shape — that's distinct from the read shape.) |
| `Type ... is missing the following properties from type 'MoneyMarketSupplyParams': srcChainKey, srcAddress` | SDK-leakage: v2 added required `srcChainKey` + `srcAddress` to action params. | Add both to your `params` payload. See [`features/money-market.md`](features/money-market.md). |
| `Cannot read properties of undefined (reading 'sodax')` | `useSodaxContext` (or any dapp-kit hook) called outside `<SodaxProvider>`. | Wrap your component tree in `<SodaxProvider>` from this package. |

For broader v1 → v2 migration, see [`README.md`](../../migration-v1-to-v2/knowledge/README.md).

## What to read next

- [`recipes/`](recipes/) — copy-paste patterns for each feature and cross-cutting concerns.
- [`architecture.md`](architecture.md) — full design rationale for `useSafeMutation`, `unwrapResult`, queryKey conventions, etc.
- [`features/<x>.md`](features/) — per-feature reference (hook tables, types, gotchas).
- [`reference/hooks-index.md`](reference/hooks-index.md) — full hook table.
- [`ai-rules.md`](ai-rules.md) — DO / DO NOT for AI agents writing dapp-kit code.

## Cross-references

- `sodax-sdk` (integration mode) skill — the underlying Core SDK's knowledge tree (sibling under `@sodax/skills`). Load it when you hit SDK-level types or behaviors leaking through hook signatures.

