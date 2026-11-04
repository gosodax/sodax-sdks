# Architecture — Mental Model

This file explains **why** `@sodax/wallet-sdk-react` is shaped the way it is. Read it once before applying recipes — knowing the model lets you handle ambiguous user code without inventing migrations.

If you are looking for "how do I do X", go to [`recipes/`](./recipes/). This file is purely conceptual.

---

## The shape of the package

`@sodax/wallet-sdk-react` is a **uniform React layer over heterogeneous chain wallet libraries**. Each chain family ships a different React adapter (wagmi, `@solana/wallet-adapter-react`, `@mysten/dapp-kit-react`) or no React adapter at all (Bitcoin, Stellar, ICON, Injective, NEAR, Stacks). The package wraps all nine families behind one set of hooks so consumer code does not branch on chain family.

Two abstractions make this work:

- **`XConnector`** — represents a *wallet* on a *chain family* (e.g. MetaMask on EVM, Phantom on Solana, Xverse on Bitcoin). Knows how to `connect()`, `disconnect()`, expose `id` / `name` / `icon` / `isInstalled`.
- **`XService`** — represents a *chain family* (one per `ChainType`). Holds the list of available connectors, the current active connection, and exposes a chain-family-specific `IXxxWalletProvider` once connected.

Hooks always operate on `XService` / `XConnector` — never directly on a chain library's primitives. Consumers do not import `useAccount` from wagmi; they call `useXAccount({ xChainType: 'EVM' })` and get back a uniform `XAccount` shape.

---

## The provider mount tree

`<SodaxWalletProvider config={...}>` mounts only the chain-type slots present in `config`. The internal nesting order is fixed:

```
<WalletConfigProvider value={frozenConfig}>
  <EvmProvider config={config.EVM}>           ← only if EVM slot present (mounts wagmi.WagmiProvider)
    <SuiProvider config={config.SUI}>          ← only if SUI slot present (mounts dapp-kit providers)
      <SolanaProvider config={config.SOLANA}>  ← only if SOLANA slot present (mounts solana-wallet-adapter)
        {children}
      </SolanaProvider>
    </SuiProvider>
  </EvmProvider>
</WalletConfigProvider>
```

Three things to internalize:

1. **Slot opt-in is real.** Omitting `config.SOLANA` means `@solana/wallet-adapter-react` is **not** in the React tree at all — zero runtime cost, smaller bundle. `useXConnectors({ xChainType: 'SOLANA' })` returns `[]` and logs a one-time warning. Apps that only use EVM should pass only `{ EVM: {...} }`.
2. **Provider-managed vs registered chains.** EVM/Solana/Sui have native React adapters and need a provider tree node. Bitcoin/Stellar/ICON/Injective/NEAR/Stacks register their `XService` at mount time via `useInitChainServices` — no provider node, no React context for the underlying SDK.
3. **`QueryClientProvider` must wrap `<SodaxWalletProvider>`.** v2 does *not* mount a `QueryClient` internally (v1 did). `useXConnect`, `useXSignMessage`, batch hooks all depend on React Query — without an outer `QueryClientProvider` they throw at runtime, not at type-check.

---

## Config is captured once

`<SodaxWalletProvider config>` freezes `config` with `useRef` on first render. Subsequent renders with a new reference have **no effect**. Reasons:

- **Wagmi config-object identity matters.** wagmi reconnects if the config object identity changes; reactive configs caused reconnect storms in v1.
- **Predictable startup.** Apps should compose chain config once at module scope, not derive it dynamically from props.

To swap config at runtime, remount with a new `key`:

```tsx
// @ai-snippets-skip
<SodaxWalletProvider key={configVersion} config={walletConfig}>
  {children}
</SodaxWalletProvider>
```

This is the only supported way to change config — there is no `setConfig` API.

---

## State: Zustand store + adapter sync

The package keeps connection state in a Zustand store keyed by `ChainType`. The store hook **is not exported** — consumers read state through public hooks (`useXAccount`, `useXService`, `useWalletProvider`, …), each of which subscribes to the relevant slice internally. The shape below is informational only:

```ts
// @ai-snippets-skip
// internal shape — do NOT import
{
  xServices:     Partial<Record<ChainType, XService>>,
  xConnections:  Partial<Record<ChainType, XConnection>>,
  // …plus internal mutations
}
```

Two things matter to consumers:

1. **Provider-managed chains sync state from the adapter.** EVM/Solana/Sui each have a `<Hydrator>` that watches its native adapter (wagmi `useAccount`, etc.) and writes the active connection into `xConnections`. Hooks read from the Zustand store, so they see one consistent view across all chains.
2. **Persistence: `xwagmi-store` localStorage key, kept stable from v1.** Renaming would log out every existing user. Hydration runs lazily — the first render after refresh has `xConnections = {}` even if storage has data. Hooks expose this via `useConnectedChains().status === 'ready'` — gate UI on that to avoid hydration flicker on Next.js.

You should **not** read the store directly. Use the public hooks. The store hook itself is not exported from v2 — see [`reference/api-surface.md`](./reference/api-surface.md) § "Not exported".

---

## Wallet discovery (EIP-6963 + custom)

For EVM, available wallets are discovered via [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963) — browser extensions broadcast their metadata and `useXConnectors({ xChainType: 'EVM' })` builds the list at runtime. No hardcoded wallet registry; new wallets installed by the user appear without an SDK update.

Other chains ship a curated connector list (Bitcoin: Xverse / Unisat / OKX / Hana, Sui: dapp-kit's standard connectors, Solana: wallet-adapter's standard connectors, etc.). For each connector, `isInstalled` reflects whether the underlying extension/wallet is detected. `sortConnectors(list, { preferred })` puts installed connectors first — call it once in your render path; the result is stable per render.

---

## Chain identifiers — `xChainType` vs `xChainId`

Two parallel addressing schemes:

- **`xChainType: ChainType`** — family-level (`'EVM'`, `'SOLANA'`, `'BITCOIN'`, …). 9 values total.
- **`xChainId: SpokeChainKey`** — chain-specific key from `@sodax/types` (`ChainKeys.ETHEREUM_MAINNET`, `ChainKeys.BSC_MAINNET`, …). Inspect `@sodax/types` for the current set.

Hooks that accept both enforce **exactly one** at runtime *and* at the type level. Passing both, neither, or `undefined` for both throws.

```ts
// @ai-snippets-skip
useXAccount({ xChainType: 'EVM' });                              // ✅ family-level
useXAccount({ xChainId: ChainKeys.BSC_MAINNET });                // ✅ key-level
useXAccount({ xChainType: 'EVM', xChainId: ChainKeys.BSC });     // ❌ throws
useXAccount({});                                                 // ❌ throws
```

When to pick which:

- **Use `xChainType`** for family-level reads (e.g. "is the user connected to *any* EVM chain?"). One connection covers every configured EVM network.
- **Use `xChainId`** when you need the narrowest TypeScript inference (e.g. `useWalletProvider({ xChainId: ChainKeys.BSC_MAINNET })` returns `IEvmWalletProvider | undefined`, not the broader `IWalletProvider`).

The chain-id form is required when handing off to `@sodax/sdk` — SDK calls take a chain-narrowed wallet provider.

---

## EVM is one connection across every configured EVM network

A subtle but important model choice: wagmi treats every configured EVM chain as one connector session. v2 reflects this directly — `useChainGroups()` collapses EVM into a single row, and `useXAccount({ xChainType: 'EVM' })` returns the same `address` regardless of which chain the user is currently on.

Consequences:

- **No per-EVM-network connect/disconnect UI.** "Connect to Ethereum" and "Connect to BSC" are the same operation.
- **Switching networks does not re-connect.** `useEvmSwitchChain({ xChainId })` calls wagmi's `switchChain` and fires the `chainChanged` EIP-1193 event. The connector stays connected.
- **`useEvmSwitchChain` owns the "wrong network" comparison.** Pass the *expected* `xChainId`; the hook returns `{ isWrongChain, handleSwitchChain }`. Don't recompute this in UI code.
- **Injective + MetaMask special case.** `useEvmSwitchChain` auto-switches to Ethereum mainnet when the user connects to Injective via MetaMask (Injective has a separate native chain but uses MetaMask's EVM signing for some flows). Transparent to consumers.

Other chain families do **not** have this single-connection model — Bitcoin connects to one address per connector, Solana to one wallet, etc.

---

## Bridging to `@sodax/sdk`

The `IXxxWalletProvider` interface is the contract between this package and `@sodax/sdk`. Consumers call `useWalletProvider({ xChainId })` to get a chain-narrowed provider, then pass it to SDK methods:

```ts
// @ai-snippets-skip
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { useSwap } from '@sodax/dapp-kit';
import { ChainKeys } from '@sodax/types';

const evm = useWalletProvider({ xChainId: ChainKeys.ETHEREUM_MAINNET });
// evm: IEvmWalletProvider | undefined

const swap = useSwap();
if (evm) await swap.mutateAsync({ ..., walletProvider: evm });
```

The wallet provider is `undefined` until the user is connected on that chain family. SDK calls should always guard on `!= undefined`. See [`recipes/bridge-to-sdk.md`](./recipes/bridge-to-sdk.md) for the full pattern.

---

## What lives where (file-system tour)

```
src/
├── SodaxWalletProvider.tsx     # Root provider — mounts slots conditionally
├── core/                       # XService + XConnector abstract base classes
├── context/                    # WalletConfigContext (frozen config injection)
├── hooks/                      # All public `useXxx` hooks (read-only)
├── actions/                    # Imperative helpers (getXService, getXChainType)
├── utils/                      # sortConnectors, walletRpcConfig, isNativeToken
├── types/                      # Public types — config, interfaces, chainActions
├── providers/                  # Per-chain-type React provider implementations
└── xchains/<chain>/            # Per-chain XService + XConnector implementations
    │                           # Sub-path import: '@sodax/wallet-sdk-react/xchains/<chain>'
    └── ...                     # Auto-discovered by tsup; not re-exported from barrel
```

Adding a new chain = create `src/xchains/<chain>/index.ts`. tsup picks it up automatically; the package barrel does not need editing.

---

## Things that look weird until you know why

- **`useXAccount` returns an object with `address: undefined` when disconnected**, not `undefined` itself. Avoids `account?.address` chains everywhere.
- **`useXConnect` resolves to `undefined` for provider-managed chains** (EVM/Solana/Sui). The mutation kicks off the adapter's connect flow; the address arrives via the adapter's state, not the mutation result. Read it via `useXAccount` after the mutation lands.
- **`useEvmSwitchChain` returns `{ isWrongChain: false, handleSwitchChain: noop }` if EVM is not in `walletConfig`.** Same shape, no-op behavior — so UI code does not need to branch on "is EVM enabled".
- **Concrete chain classes are not on the barrel.** `XverseXConnector`, `EvmXService`, etc. live behind `@sodax/wallet-sdk-react/xchains/<chain>`. Default to barrel imports; opt into deep imports only when you need `instanceof` or to extend a class.
