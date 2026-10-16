# EVM Switch Chain

A single wagmi connection covers **every configured EVM network** (Sonic, Ethereum, Arbitrum, Base, BSC, Optimism, Polygon, Avalanche, HyperEVM, Lightlink, Redbelly, Kaia, Hedera, Robinhood). The user picks a wallet once; switching the **active network** within that wallet is a separate concern handled by `useEvmSwitchChain`.

The hook also covers Injective's MetaMask wallet path — when the user connected Injective via MetaMask, the underlying ethereum chain id must be Ethereum mainnet (chain id `1`). `useEvmSwitchChain` detects the mismatch and exposes a switch action.

Source: [`useEvmSwitchChain.ts`](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/src/hooks/useEvmSwitchChain.ts), [`useEthereumChainId.ts`](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/src/hooks/useEthereumChainId.ts).

## Table of contents

1. [Why this exists](#why-this-exists)
2. [`useEvmSwitchChain` API](#useevmswitchchain-api)
3. [Standard EVM switch flow](#standard-evm-switch-flow)
4. [Injective MetaMask special case](#injective-metamask-special-case)
5. [`useEthereumChainId` (internal) — how the MetaMask chain id is read](#useethereumchainid-internal--how-the-metamask-chain-id-is-read)
6. [Safe to call when EVM is disabled](#safe-to-call-when-evm-is-disabled)

---

## Why this exists

When you call `sodax.swaps.swap({ params: { srcChainKey: ChainKeys.BSC_MAINNET, ... }, walletProvider })`, the wallet provider must be **on BSC** at signing time — wagmi will reject the tx otherwise. But wagmi remembers the last network the user selected, so a user who connected via MetaMask on Ethereum and then opened your dApp's BSC swap form needs to switch first.

`useEvmSwitchChain` reads the connected EVM wallet's current chain id, compares against the chain id implied by `srcChainKey`, and exposes:

- `isWrongChain: boolean` — render a "Switch to BSC" CTA when `true`
- `handleSwitchChain()` — triggers wagmi's `switchChain()` (or `wallet_switchEthereumChain` for Injective MetaMask)

Without this hook you'd have to import wagmi directly and replicate the logic per-chain.

---

## `useEvmSwitchChain` API

```typescript
import { useEvmSwitchChain } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/types';

const { isWrongChain, handleSwitchChain } = useEvmSwitchChain({
  xChainId: ChainKeys.BSC_MAINNET,
});
```

| Field | Type | Behavior |
|-------|------|----------|
| `isWrongChain` | `boolean` | `true` when the wallet's active chain id doesn't match `xChainId`. Always `false` for non-EVM/Injective chain ids. |
| `handleSwitchChain` | `() => void` | Triggers the network switch. No-op for chain ids that aren't EVM or Injective. |

The hook never throws — `handleSwitchChain` returns synchronously and lets wagmi (or `wallet_switchEthereumChain`) own the user-rejection error path.

---

## Standard EVM switch flow

```tsx
import { useEvmSwitchChain, useWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/types';

function BscSwapButton() {
  const { isWrongChain, handleSwitchChain } = useEvmSwitchChain({
    xChainId: ChainKeys.BSC_MAINNET,
  });
  const walletProvider = useWalletProvider({ xChainId: ChainKeys.BSC_MAINNET });

  if (!walletProvider) {
    return <ConnectCta />;
  }

  if (isWrongChain) {
    return <button onClick={handleSwitchChain}>Switch to BSC</button>;
  }

  return <button onClick={() => doSwap(walletProvider)}>Swap</button>;
}
```

Internally:
- Reads `chainId` from wagmi's `useAccount()`.
- Compares against `baseChainInfo[xChainId].chainId` (numeric EVM chain id resolved from the `SpokeChainKey`).
- `handleSwitchChain` calls wagmi's `useSwitchChain().switchChain({ chainId })`.

`useSwitchChain` opens the wallet's network-switch popup; wagmi handles the chain-config-not-added flow (most wallets prompt to add the chain if it's missing).

---

## Injective MetaMask special case

Injective offers MetaMask as a wallet option (in addition to Keplr, Leap). When MetaMask is the active Injective wallet, **the underlying Ethereum chain id must be mainnet (`1`)** — Injective uses MetaMask's `personal_sign` infrastructure which is bound to whatever EVM network the wallet is currently on.

`useEvmSwitchChain({ xChainId: ChainKeys.INJECTIVE_MAINNET })` detects the mismatch:

```typescript
isWrongChain =
  xChainType === 'INJECTIVE' &&
  injectiveXService?.walletStrategy.getWallet() === Wallet.Metamask &&
  ethereumChainId !== 1; // mainnet.id from viem/chains
```

`handleSwitchChain` for Injective calls `wallet_switchEthereumChain` directly on `window.ethereum` (not wagmi's `switchChain`, which only knows EVM chains registered in the wagmi config). It uses an EIP-1193-compliant promise + event listener pair:

```typescript
await Promise.race([
  metamask.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }] }),
  new Promise(resolve => {
    const handler = (chainId: string) => {
      if (chainId === '0x1') {
        metamask.removeListener('chainChanged', handler);
        resolve();
      }
    };
    metamask.on('chainChanged', handler);
  }),
]);
```

The promise/event race covers both wallet behaviors — some wallets resolve `wallet_switchEthereumChain` only after the user confirms; others resolve immediately and emit `chainChanged` afterwards.

Keplr and Leap on Injective don't have this constraint — `isWrongChain` is `false` for those wallets regardless of network state.

---

## `useEthereumChainId` (internal) — how the MetaMask chain id is read

`useEthereumChainId` is an implementation detail of `useEvmSwitchChain`, not part of the public API. `@sodax/wallet-sdk-react` declares only the `.` and `./xchains/*` export entries, so there is no `./hooks/*` subpath to import from and no top-level `useEthereumChainId`. It is described here only to explain where the `ethereumChainId` in the check above comes from.

The hook returns the active Ethereum chain id when MetaMask is the Injective wallet, otherwise `null`. It subscribes to MetaMask's `onChainIdChanged` event so the value stays fresh when the user switches networks outside the dApp. For non-MetaMask Injective wallets (Keplr, Leap) and non-Injective use cases, it returns `null`.

To read the raw EVM chain id in app code, use wagmi's `useAccount().chainId`. The wrong-network UX is already folded into `useEvmSwitchChain`.

---

## Safe to call when EVM is disabled

`useEvmSwitchChain` checks `useIsChainEnabled('EVM')` and returns a no-op result `{ isWrongChain: false, handleSwitchChain: () => {} }` when the EVM slot isn't mounted in `SodaxWalletProvider` config:

```typescript
const evmEnabled = useIsChainEnabled('EVM');
if (!evmEnabled) return EVM_DISABLED_RESULT;
```

This is **important** — calling wagmi's `useAccount` / `useSwitchChain` outside a `WagmiProvider` would throw. The early-return lets components opt-in to a "switch chain" CTA without checking EVM-enabled themselves at every call site.

The conditional hook call (early-return before `useEvmSwitchChainInner` runs) is technically a Rules-of-Hooks violation but **safe**: `evmEnabled` is derived from config, which is immutable after `SodaxWalletProvider` mounts (the config is captured once via `useRef`). The branch never changes during the component's lifetime.

---

## Related docs

- [Configure SodaxWalletProvider](./CONFIGURE_PROVIDER.md) — opt in / out of EVM
- [Wallet Provider Bridge](./WALLET_PROVIDER_BRIDGE.md) — `useWalletProvider` returns the same provider for all EVM chain ids
- [Chain Detection](./CHAIN_DETECTION.md) — EVM collapses to one row in `useChainGroups` / `useConnectedChains` for the same reason
- [Connect Flow](./CONNECT_FLOW.md) — connect once; chain switching is a separate UX
- [wagmi `useSwitchChain` docs](https://wagmi.sh/react/api/hooks/useSwitchChain)
- [EIP-3326 — `wallet_switchEthereumChain`](https://eips.ethereum.org/EIPS/eip-3326)
