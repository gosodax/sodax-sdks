---
title: "Read wallet balances"
sidebarTitle: "Wallet balances"
description: "Read a user's own token balances on any SODAX network with sodax.spoke.getWalletBalance and getWalletBalances, or the useBalances hook from @sodax/dapp-kit: one chain-agnostic call per network, batched where the chain supports it."
icon: wallet
---

Use this guide to show a user what they hold before they swap, bridge or deposit. The SDK reads the user's own wallet, not the protocol, with the same call on every network SODAX supports. Available from `@sodax/sdk` and `@sodax/dapp-kit` 2.2.0.

## One token

`sodax.spoke.getWalletBalance` reads one token for one address. It works the same on every chain type: native coins, EVM ERC-20s, Solana SPL tokens and the rest.

```typescript
import { Sodax, ChainKeys } from '@sodax/sdk';

const sodax = new Sodax();
await sodax.initialize();

const tokens = sodax.swaps.getSupportedSwapTokensByChainId(ChainKeys.ARBITRUM_MAINNET);
const usdc = tokens.find(t => t.symbol === 'USDC');
if (!usdc) throw new Error('USDC is not supported on Arbitrum');

const result = await sodax.spoke.getWalletBalance({
  srcChainKey: ChainKeys.ARBITRUM_MAINNET,
  srcAddress: userAddress,
  token: usdc,
});

if (result.ok) {
  console.log(result.value); // bigint, in the token's smallest unit
} else {
  console.error(result.error);
}
```

The balance is a `bigint` in the token's smallest unit. Divide by `10 ** token.decimals` to display it.

## Many tokens on one network

`sodax.spoke.getWalletBalances` reads a list of tokens in one call. The SDK batches the reads where the chain allows it (EVM multicall3, ICON aggregated calls, the Injective portfolio), so a full token list costs one or two round trips, not one per token.

```typescript
const tokens = sodax.swaps.getSupportedSwapTokensByChainId(ChainKeys.ARBITRUM_MAINNET);

const result = await sodax.spoke.getWalletBalances({
  srcChainKey: ChainKeys.ARBITRUM_MAINNET,
  srcAddress: userAddress,
  tokens,
});

if (result.ok) {
  for (const token of tokens) {
    const balance = result.value[token.address] ?? 0n;
    console.log(token.symbol, balance);
  }
}
```

The result is a map keyed by `token.address`. Look tokens up by address, not by symbol: two tokens can share a symbol.

## Several networks

Each call reads one network. To show a portfolio across networks, run one call per network the user has connected, in parallel:

```typescript
import type { SpokeChainKey } from '@sodax/sdk';

async function readPortfolio(wallets: { chainKey: SpokeChainKey; address: string }[]) {
  return Promise.all(
    wallets.map(async ({ chainKey, address }) => {
      const tokens = sodax.swaps.getSupportedSwapTokensByChainId(chainKey);
      const result = await sodax.spoke.getWalletBalances({ srcChainKey: chainKey, srcAddress: address, tokens });
      return { chainKey, balances: result.ok ? result.value : null };
    }),
  );
}
```

A failed network comes back as `null` here, so one broken RPC does not hide the other networks. `Promise.all` still waits for every call, so the slowest network sets when the portfolio appears; to show each network as it arrives, render each one from its own promise (or one `useBalances` per network in React).

## In React: useBalances

`useBalances` from `@sodax/dapp-kit` wraps `getWalletBalances` in a React Query hook. It only needs a `SodaxProvider`, not a wallet SDK, and it refreshes every 5 seconds.

```tsx
import { useBalances } from '@sodax/dapp-kit';
import type { SpokeChainKey, XToken } from '@sodax/sdk';

function Balances({ chainKey, address, tokens }: {
  chainKey: SpokeChainKey | undefined;
  address: string | undefined;
  tokens: readonly XToken[];
}) {
  const { data: balances, isLoading, error } = useBalances({ params: { chainKey, address, tokens } });

  if (isLoading) return <p>Loading balances…</p>;
  if (error) return <p>Could not read balances.</p>;

  return (
    <ul>
      {tokens.map(token => (
        <li key={token.address}>
          {token.symbol}: {(balances?.[token.address] ?? 0n).toString()}
        </li>
      ))}
    </ul>
  );
}
```

The hook stays idle until `chainKey` and `address` are set and `tokens` is not empty, so you can mount it before the user picks a network. Pass `queryOptions` to change the refresh interval or other React Query settings.

`useBalances` is the SDK-backed successor to `useXBalances`, which reads through the wallet SDK's `xService`. Prefer `useBalances` when your app already has a `SodaxProvider`.

## How failures are reported

- **One token fails:** it is logged through the SDK logger and reported as `0n`. The other balances still come back. A failed read and an empty wallet look the same, on purpose: showing too little blocks a spend, it never allows one.
- **The whole batch fails:** the `Result` is `ok: false` (the hook's `error` is set). This happens for an invalid chain key, a shared request every token depends on, or a batch where no token could be read at all, so a dead RPC never shows as an empty wallet.

## Things to know

- **The chain comes from `srcChainKey`.** Every read uses `token.address` on that chain and ignores the token's own `chainKey`. A foreign token is not reliably `0n`: EVM networks share the native-token address, so another network's native token reads as this network's native balance. In a batch, a token that cannot be read reports `0n`; with `getWalletBalance` the same failure is an `ok: false` result. Keep the chain key and the token list in step, for example with `getSupportedSwapTokensByChainId(chainKey)`.
- **Stellar XLM** returns the spendable amount: the total minus the minimum reserve and selling liabilities.
- **Bitcoin Runes** return `0n`; their amounts are not exposed by the UTXO endpoint.
- **Hedera native HBAR** is returned in HBAR's 8 decimals, not the 18-decimal weibars that `eth_getBalance` reports. See the [Hedera wallets guide](/hedera/wallets).

## Reference

- [`SpokeService.getWalletBalance` and `getWalletBalances`](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/src/shared/services/spoke/SpokeService.ts)
- [`useBalances`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/shared/useBalances.ts)
- [dapp-kit package](/developers/packages/experience/dapp-kit)
