# Breaking Changes: v1 → v2

This is the **single source of truth** for behavior and API changes between v1 and v2 of `@sodax/wallet-sdk-react`. The reference files (`imports.md`, `hooks.md`, `config.md`, `components.md`) are **lookup tables** derived from the changes here — they do not duplicate the prose.

## Table of contents

1. [`SodaxWalletProvider` props (largest change)](#1-sodaxwalletprovider-props-largest-change)
2. [`QueryClientProvider` is no longer mounted internally](#2-queryclientprovider-is-no-longer-mounted-internally)
3. [Hooks now take an options object, not positional args](#3-hooks-now-take-an-options-object-not-positional-args)
4. [Store hook removed from the public API](#4-store-hook-removed-from-the-public-api)
5. [Concrete chain classes moved behind sub-path imports](#5-concrete-chain-classes-moved-behind-sub-path-imports)
6. [Chain-type opt-in (mounting behavior)](#6-chain-type-opt-in-mounting-behavior)
7. [EVM = single connection across every configured EVM network](#7-evm--single-connection-across-every-configured-evm-network)
8. [New: WalletConnect support for EVM](#8-new-walletconnect-support-for-evm)
9. [New: headless wallet modal primitives](#9-new-headless-wallet-modal-primitives)
10. [Removed: `useXBalances`](#10-removed-usexbalances)
11. [`useEvmSwitchChain` reshaped](#11-useevmswitchchain-reshaped)
12. [`SodaxWalletProvider` freezes config on first render](#12-sodaxwalletprovider-freezes-config-on-first-render)

What did NOT change → [bottom of file](#what-did-not-change).

---

## 1. `SodaxWalletProvider` props (largest change)

### What changed

v1 spread chain configuration across **three separate props**: `rpcConfig` (per-chain RPC URLs), `options` (per-adapter options like `wagmi.ssr`, `solana.autoConnect`, `sui.autoConnect`), and `initialState` (wagmi state for SSR hydration).

v2 collapses all three into a **single `config` prop** of type `SodaxWalletConfig`. The new shape uses **chain-type slots** (`EVM`, `SOLANA`, `SUI`, `BITCOIN`, `STELLAR`, `ICON`, `INJECTIVE`, `NEAR`, `STACKS`) at the top level. Each slot is `ChainTypeConfig<T>` — adapter options merged with `{ chains?, connectors? }` where `chains` is keyed by `ChainKey` and holds per-chain `{ rpcUrl?, defaults? }` — except `SUI`, whose entry is `{ grpcUrl?, defaults? }` with `rpcUrl` kept as a deprecated alias.

### Why

- **Configurable chain opt-in.** v1 always mounted every chain adapter regardless of need. v2 mounts only the slots you include — omit a slot to skip it entirely. Pass `{}` to mount with SDK defaults.
- **Single source of truth.** v1 spread chain knowledge across three independent props that had to stay in sync; the new `config` shape derives `enabledChains`, `chains`, and per-chain defaults from one tree.
- **Per-chain `defaults`.** v2 lets each chain entry hold call-level defaults (e.g. EVM `waitForTransactionReceipt.confirmations`) that flow to the bridged `IXxxWalletProvider`.

### How to migrate

See [`reference/config.md`](./reference/config.md) for the mechanical mapping. See [`recipes/`](./recipes/) for paired before/after code in common patterns.

---

## 2. `QueryClientProvider` is no longer mounted internally

### What changed

v1 created its own `QueryClient` inside `SodaxWalletProvider` and wrapped children with `<QueryClientProvider>` automatically. v2 expects the consumer to provide one, externally.

### Why

- **One QueryClient per app, not per package.** v1's behavior caused subtle bugs when an app already had its own `QueryClient` for app-level queries — there were two clients, two caches, and React Query devtools showed only one.
- **Predictable provider order.** Consumers can now mount `QueryClientProvider` at the position that fits their app — between auth providers and `SodaxWalletProvider`, around route boundaries, etc.

### How to migrate

Wrap `<SodaxWalletProvider>` with `<QueryClientProvider>` at the call site:

```tsx
// @ai-snippets-skip
// v2 ✅
<QueryClientProvider client={queryClient}>
  <SodaxWalletProvider config={walletConfig}>{children}</SodaxWalletProvider>
</QueryClientProvider>
```

Add `@tanstack/react-query` as a direct dependency if not already present:

```bash
pnpm add @tanstack/react-query
```

---

## 3. Hooks now take an options object, not positional args

### What changed

Every public hook that took a `xChainType` or `chainIdentifier` positional argument now takes an options object with named fields. The same applies to the **callback returned by `useXDisconnect`** — `await disconnect('EVM')` is now `await disconnect({ xChainType: 'EVM' })`.

### Why

- **Forward compatibility.** Adding new fields (e.g. `xChainId` alongside `xChainType`) without breaking call sites.
- **Disambiguation.** v1 `useXAccount(chainIdentifier)` accepted both `ChainType` (`'EVM'`) and `ChainId` (`'0x1.eth'`) and detected at runtime. v2 splits them — `xChainType: ChainType` vs `xChainId: SpokeChainKey` — and the type system enforces "exactly one".

### How to migrate

See [`reference/hooks.md`](./reference/hooks.md) for the per-hook signature map. The `useXDisconnect` returned-callback case typically surfaces as `TS2345: Argument of type 'string' is not assignable to parameter of type 'UseXDisconnectArgs'`.

---

## 4. Store hook removed from the public API

### What changed

v1 exported the Zustand store hook as `useXWagmiStore` from the package barrel. v2 **does not export the store hook at all** — direct store access is no longer part of the public API. The localStorage **persistence key is unchanged** (`xwagmi-store`) so existing user connections survive the upgrade.

### Why

- **Public surface should be the hook layer.** Reading store state directly couples consumers to internal field shapes that change between minor versions. v2 provides one public hook per consumer concern (`useXService`, `useXConnection`, `useXConnectors`, …) so internal store renames don't break consumers.
- **localStorage compatibility.** Renaming the persistence key would log every user out on upgrade. The internal store rename (which v2 also did) keeps the localStorage key intact.

### How to migrate

For each `useXWagmiStore(state => state.X)` selector, replace with the equivalent public hook. There is no `useXWalletStore` import to rename to. See [`reference/imports.md`](./reference/imports.md) § "Store hook removed" for the field-to-hook map.

---

## 5. Concrete chain classes moved behind sub-path imports

### What changed

v1 re-exported every concrete `XService` and `XConnector` class from the package barrel:

```diff
- // v1 — barrel exports concrete classes
- import { EvmXService, XverseXConnector, IconHanaXConnector } from '@sodax/wallet-sdk-react';
```

v2's barrel exports only **types, hooks, abstractions, and `SodaxWalletProvider`**. Concrete chain classes live behind sub-paths:

```ts
// @ai-snippets-skip
// v2 — concrete classes via sub-path
import { XverseXConnector } from '@sodax/wallet-sdk-react/xchains/bitcoin';
```

### Why

- **API surface hygiene.** Consumers who only use hooks shouldn't pull concrete chain classes into their bundle just because they were re-exported. v2's barrel is shaped around the consumer-facing API; advanced use (e.g. `instanceof`) opts in via deep imports.
- **Adding chains is non-breaking.** v1 required updating `index.ts` whenever a new chain landed. v2 auto-discovers per-chain entries via tsup glob — adding a chain doesn't touch the barrel.

### How to migrate

See [`reference/imports.md`](./reference/imports.md) for the sub-path map per chain.

---

## 6. Chain-type opt-in (mounting behavior)

### What changed

v1 mounted **every** chain adapter (wagmi, `@solana/wallet-adapter`, `@mysten/dapp-kit-react`) and registered services for every chain regardless of whether the consumer used them.

v2 mounts only the slots present in `walletConfig`. An app that only needs EVM + Sui passes `{ EVM: {...}, SUI: {...} }` and ships **none** of the Solana / Bitcoin / NEAR adapter code in the React tree.

### Why

- **Bundle size.** v1 forced every consumer to ship every adapter. v2 lets you opt in.
- **Provider context isolation.** Apps that don't need Solana don't get the `WalletProvider` from `@solana/wallet-adapter` in their context — fewer renders, fewer dev-tool nodes.

### How to migrate

Add only the chain-type slots your app actually uses to `walletConfig`. See [`reference/config.md`](./reference/config.md). New behavior: `useXConnectors({ xChainType: 'X' })` returns `[]` for chains not in `enabledChains` and logs a one-time warning.

---

## 7. EVM = single connection across every configured EVM network

### What changed

v1 had one connector per chain in some flows (legacy from earlier wagmi versions). v2 treats EVM as **one logical connection** that spans every configured EVM chain — there is no per-network connect/disconnect, and `useChainGroups` collapses EVM into a single row.

### Why

- **Match wagmi's actual semantics.** wagmi has always modeled EVM connection as one connector per session that hops between configured chains via `wagmi.switchChain`. v1's per-chain UI was a workaround.
- **Multi-chain dApps.** Users connect once and operate across every EVM network the app supports — no re-authorization on each chain switch.

### How to migrate

Audit any UI that exposed per-EVM-chain connect/disconnect. Replace with a single "EVM" entry. Use `useEvmSwitchChain` for switching. See [`recipes/connect-button.md`](./recipes/connect-button.md) and [`recipes/multi-chain-modal.md`](./recipes/multi-chain-modal.md).

---

## 8. New: WalletConnect support for EVM

### What changed

v2 adds `EVM.walletConnect.projectId` to `walletConfig` to enable the WalletConnect connector. v1 did not support WalletConnect — only EIP-6963 injected wallets.

### Why

- **Enterprise custody.** Partners using Fireblocks / Ledger Live / mobile-only wallets cannot install browser extensions. WalletConnect is the only viable protocol.
- **Backwards compatible default.** Omitting `walletConnect` from the config preserves v1 behavior (EIP-6963 only).

### How to migrate

Not breaking — additive. See [`recipes/walletconnect-migration.md`](./recipes/walletconnect-migration.md) for opt-in.

---

## 9. New: headless wallet modal primitives

### What changed

v2 ships `useWalletModal`, `useChainGroups`, `useConnectedChains`, `useBatchConnect`, `useBatchDisconnect`, `useIsWalletInstalled`, `useConnectionFlow`. None of these existed in v1.

### Why

- **Bring-your-own UI.** v1 left the modal UX to the consumer. v2 ships state-machine primitives — render-agnostic — so apps can build modal UX without rebuilding the chain registry / connector dispatch logic from scratch.

### How to migrate

Not breaking — additive. See [`recipes/multi-chain-modal.md`](./recipes/multi-chain-modal.md) for the modern pattern.

---

## 10. Removed: `useXBalances`

### What changed

v1 exported `useXBalances({ xChainId, xTokens, address })` from `@sodax/wallet-sdk-react`. v2 removes it. A hook with the same name lives in `@sodax/dapp-kit`, but the **signature has changed**:

```diff
- // v1 ❌ — from wallet-sdk-react
- import { useXBalances } from '@sodax/wallet-sdk-react';
- const { data } = useXBalances({ xChainId, xTokens, address });
+ // v2 ✅ — from dapp-kit, params are now wrapped
+ import { useXBalances } from '@sodax/dapp-kit';
+ import { useXService } from '@sodax/wallet-sdk-react';
+ const xService = useXService({ xChainType: 'EVM' });
+ const { data } = useXBalances({ params: { xService, xChainId, xTokens, address } });
```

### Why

- **Wrong package.** Token-balance queries are a dApp-feature concern, not a wallet-sdk concern. The hook required token metadata, RPC routing, and refetch policies — none of which belong in a wallet SDK.
- **`xService` is now an explicit input.** v2 surfaces the chain service to the call site so query keys are stable across config changes and the hook is testable in isolation.

### How to migrate

1. `pnpm add @sodax/dapp-kit` if not already installed.
2. Switch the import path: `'@sodax/wallet-sdk-react'` → `'@sodax/dapp-kit'`.
3. Wrap the existing arg as `{ params: { xService, xChainId, xTokens, address } }` and pass `xService` from `useXService({ xChainType })`.

If you cannot add dapp-kit, port the call to direct `viem` / `@solana/web3.js` reads with your own `useQuery`.

---

## 11. `useEvmSwitchChain` reshaped

### What changed

v1 forwarded wagmi's `switchChain` mutation directly:

```ts
// @ai-snippets-skip
// v1 ❌
const { switchChain } = useEvmSwitchChain();
await switchChain({ chainId: 1 });
```

v2 takes a target `xChainId` and exposes wrong-network state:

```ts
// @ai-snippets-skip
// v2 ✅
import { ChainKeys } from '@sodax/types';

const { isWrongChain, handleSwitchChain } = useEvmSwitchChain({
  xChainId: ChainKeys.ETHEREUM_MAINNET,
});
```

### Why

- **Single source of truth for "expected chain".** UI code repeatedly recomputed `connectedChainId !== expectedChainId`. The hook owns that comparison once.
- **Injective + MetaMask.** v2 transparently handles the Injective-via-MetaMask case (auto-switches to Ethereum mainnet). v1 callers had to bolt this on.
- **Safe when EVM is disabled.** If the consumer's `walletConfig` omits the `EVM` slot, v2 returns no-op values instead of throwing.

### How to migrate

Replace the destructured `switchChain` with `handleSwitchChain` and feed the target chain via `xChainId`. Render the network-mismatch CTA from `isWrongChain`. See [`reference/hooks.md`](./reference/hooks.md) for examples.

---

## 12. `SodaxWalletProvider` freezes config on first render

### What changed

v1 re-derived chain config on every render whose `rpcConfig` / `options` reference changed. v2 **captures `config` once on mount** and ignores subsequent prop changes. To swap config at runtime, remount with a new `key`.

### Why

- **Stable wagmi config object.** wagmi's `WagmiProvider` is sensitive to config-object identity changes — re-creating the config triggers re-connection and breaks in-flight transactions.
- **Predictable identity.** Apps should compose chain config once at startup, not derive it dynamically. Hot config swaps were rare in v1 but caused hard-to-debug reconnect storms.

### How to migrate

If you previously updated `rpcConfig` reactively, route the change through a remount:

```tsx
// @ai-snippets-skip
<SodaxWalletProvider key={configVersion} config={walletConfig}>
  {children}
</SodaxWalletProvider>
```

Bumping `configVersion` (e.g. when the user picks a new RPC endpoint) forces a clean re-init of all chain services.

---

## What did NOT change

- Chain support: still 9 chain types (EVM, BITCOIN, INJECTIVE, STELLAR, SUI, SOLANA, ICON, NEAR, STACKS).
- Persisted localStorage key: still `xwagmi-store`.
- Devtools store name: still `xwagmi-store`.
- Peer dependencies: `react >= 19`, `@tanstack/react-query 5.x`.
- `XService` / `XConnector` abstract base contract (still has `connect()` / `disconnect()` / `getXConnectors()`).
- Public `XAccount`, `XConnection`, `WalletId` types in `@sodax/types`.
