# Recipe: Wallet Connectivity

Connect wallets and pass wallet providers to feature hooks.

**Depends on:** [setup.md](setup.md)

## Hooks

| Hook | Package | Type | Purpose |
|------|---------|------|---------|
| `useWalletProvider` | `@sodax/wallet-sdk-react` | Utility | Get wallet provider for a chain from connected wallet |
| `useHubProvider` | `@sodax/dapp-kit` | Utility | Access the hub chain (Sonic) provider |
| `useDeriveUserWalletAddress` | `@sodax/dapp-kit` | Query | Derive hub wallet address from spoke address (CREATE3) |
| `useGetUserHubWalletAddress` | `@sodax/dapp-kit` | Query | Derive hub wallet address via wallet router |
| `useBalances` | `@sodax/dapp-kit` | Query | SDK-backed wallet token balances (no `xService`) |
| `useXBalances` | `@sodax/dapp-kit` | Query | Cross-chain token balances for an address (needs `xService`) |
| `useEstimateGas` | `@sodax/dapp-kit` | Mutation | Estimate gas for raw transactions |
| `useStellarTrustlineCheck` | `@sodax/dapp-kit` | Query | Check if Stellar account has sufficient trustline |
| `useEstablishTrustline` | `@sodax/dapp-kit` | Mutation | Request a Stellar trustline for a token |
| `useNearStorageCheck` | `@sodax/dapp-kit` | Query | Check if a NEAR account is NEP-141 storage-registered for a token |
| `useRegisterNearStorage` | `@sodax/dapp-kit` | Mutation | Submit a NEP-141 `storage_deposit` so a NEAR account can receive a token |
| `useNearStorageGate` | `@sodax/dapp-kit` | Hook | Combine the NEAR storage check, registration mutation, and UI gate flags |

## Connect a Wallet

`@sodax/wallet-sdk-react` provides per-chain wallet hooks:

```tsx
// @ai-snippets-skip
import { useEvmWallet } from '@sodax/wallet-sdk-react';

function ConnectButton() {
  const { connect, disconnect, address, isConnected } = useEvmWallet();

  if (isConnected) {
    return (
      <div>
        <span>{address}</span>
        <button onClick={disconnect}>Disconnect</button>
      </div>
    );
  }
  return <button onClick={() => connect()}>Connect Wallet</button>;
}
```

## Get a Wallet Provider

`useWalletProvider` returns a typed wallet provider for a specific chain. Pass it directly to feature hook mutation calls:

```tsx
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/sdk';

function MyFeature() {
  const walletProvider = useWalletProvider({ xChainId: ChainKeys.BSC_MAINNET });
  // undefined until wallet is connected for that chain
  // Pass as: useSwap() then swap({ params, walletProvider })
}
```

## Fetch Token Balances

`useXBalances` from `@sodax/dapp-kit` fetches on-chain balances for a wallet address:

```tsx
import { useXBalances } from '@sodax/dapp-kit';
import { useXService, getXChainType } from '@sodax/wallet-sdk-react';
import { ChainKeys, type XToken } from '@sodax/sdk';

function TokenBalance({ address, xTokens }: { address: string; xTokens: readonly XToken[] }) {
  const xChainId = ChainKeys.BSC_MAINNET;
  // `useXBalances` requires an `xService` from `@sodax/wallet-sdk-react` plus the chain key,
  // the token list to read, and the user's address — all four fields are part of `params`.
  const xService = useXService({ xChainType: getXChainType(xChainId) });
  const { data: balances } = useXBalances({
    params: { xService, xChainId, xTokens, address },
  });

  // balances is a map of token address → balance (bigint)
}
```

### SDK-backed alternative: `useBalances`

`useBalances` reads wallet balances straight from the core SDK (`sodax.spoke.getWalletBalances`) via the `SodaxProvider` context, so it drops the `xService` requirement — no `@sodax/wallet-sdk-react` hook needed. Prefer it when the app already has a `SodaxProvider`; the params collapse to `chainKey`, the `tokens` list, and the `address`.

The two hooks are not drop-in equivalents — check these before migrating a screen:

- `chainKey` decides the chain read; `token.chainKey` is ignored, so a token from another chain reads as `0n` rather than erroring. `useXBalances` is the opposite: it derives the chain from `xTokens[0].chainKey` and ignores the `xChainId` you pass.
- A token that could not be read is logged by the SDK and reported as `0n`, so it is indistinguishable from an empty wallet. The query errors only when the entire batch is unusable.
- Stellar XLM is the *spendable* amount (total minus minimum reserve and selling liabilities); Bitcoin Rune tokens read as `0n` because the UTXO endpoint carries no rune amounts.


```tsx
import { useBalances } from '@sodax/dapp-kit';
import { ChainKeys, type XToken } from '@sodax/sdk';

function TokenBalanceViaSdk({ address, tokens }: { address: string; tokens: readonly XToken[] }) {
  const chainKey = ChainKeys.BSC_MAINNET;
  // No `xService` — the hook reads the SDK instance from the SodaxProvider context.
  const { data: balances } = useBalances({ params: { chainKey, address, tokens } });

  // balances is a map of token address → balance (bigint), refetched every 5s
}
```

## Use Wallet Provider in Feature Hooks

All mutation hooks accept no arguments at initialization level. The `walletProvider` flows through `mutate(vars)`:

```tsx
import { useSwap } from '@sodax/dapp-kit';
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/sdk';

function SwapButton() {
  const walletProvider = useWalletProvider({ xChainId: ChainKeys.BSC_MAINNET });
  const { mutateAsync: swap, isPending } = useSwap();

  const handleSwap = async () => {
    if (!walletProvider) return;
    const result = await swap({ params: intentParams, walletProvider });
    // ...
  };
}
```

This pattern is consistent across all features: `useSwap`, `useBridge`, `useSupply`, `useStake`, `useDexDeposit`, etc.

## No type cast is needed — broad-union wiring just works

A common anti-pattern is reaching for `as any` / `as IEvmWalletProvider` when the runtime-typed `walletProvider` from `useWalletProvider({ xChainId })` is passed into a mutation hook. **That cast is not needed.** v2 accepts the broad-union wallet-provider type as long as the chain key on the payload and the wallet provider both come from the same runtime `xChainId` value.

```tsx
// @ai-snippets-skip — illustrative anti-pattern vs correct
// ❌ ANTI-PATTERN — unnecessary cast
const walletProvider = useWalletProvider({ xChainId });
await swap({ params, walletProvider: walletProvider as any });           // don't
await swap({ params, walletProvider: walletProvider as IEvmWalletProvider }); // don't

// ✅ CORRECT — pass directly, TypeScript infers the relationship
const walletProvider = useWalletProvider({ xChainId });
if (!walletProvider) return;        // narrow undefined first
await swap({ params, walletProvider });
```

### Why this works

- `useWalletProvider({ xChainId })` returns `GetWalletProviderType<typeof xChainId> | undefined`. When `xChainId` is a runtime value (e.g. from props/state typed `SpokeChainKey`), the return type is the **broad union** `IWalletProvider | undefined`, not `any`.
- Mutation hooks like `useSwap<K>()` default `K` to the broad `SpokeChainKey` union. Their `mutate` vars are typed `{ params: SwapParams<SpokeChainKey>, walletProvider: GetWalletProviderType<SpokeChainKey> }` — i.e. `walletProvider` is the same broad union.
- The two unions are structurally assignable. No cast required.

### When the cast is actually needed

If you've narrowed `xChainId` to a literal (e.g. via `chainKey === ChainKeys.BSC_MAINNET` checks in a branch) and the mutation hook is also generic-narrowed, you'll get narrower types on both sides. Even there, the cast is usually unnecessary — TypeScript propagates the narrowed `K` through the hook's generic. Reach for a cast only when you can produce a real TS error message proving it's needed.
