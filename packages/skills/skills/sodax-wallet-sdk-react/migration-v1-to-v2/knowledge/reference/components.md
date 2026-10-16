# Reference: Component / Provider Map

Components and exported providers between v1 and v2. See [`../breaking-changes.md`](../breaking-changes.md) for the WHY.

---

## `SodaxWalletProvider`

Same name in v1 and v2. **Props changed** — see [`config.md`](./config.md) for the full shape map.

```tsx
// @ai-snippets-skip
// v1 ❌
<SodaxWalletProvider
  rpcConfig={rpcConfig}
  options={{ wagmi, solana, sui }}
  initialState={wagmiState}
>
  {children}
</SodaxWalletProvider>

// v2 ✅
<SodaxWalletProvider config={walletConfig}>
  {children}
</SodaxWalletProvider>
```

### Provider-stack order

| Position | v1 | v2 |
|---|---|---|
| Outermost (app entry) | `SodaxWalletProvider` (creates internal QueryClient) | `QueryClientProvider` (caller-provided QueryClient) |
| Middle | (none) | `SodaxWalletProvider` |
| Children | app | app |

```tsx
// @ai-snippets-skip
// v1 ❌ — SodaxWalletProvider internal QueryClient
<SodaxWalletProvider rpcConfig={...} options={...}>
  {children}
</SodaxWalletProvider>

// v2 ✅ — caller wraps with QueryClientProvider
<QueryClientProvider client={queryClient}>
  <SodaxWalletProvider config={walletConfig}>
    {children}
  </SodaxWalletProvider>
</QueryClientProvider>
```

---

## Internal-only components (do not import directly)

These are mounted **inside** `SodaxWalletProvider` and are not part of the public API in either v1 or v2. Listed for awareness — if you imported them in v1 you should not have, and v2 may not expose them.

| Component | v1 | v2 | Note |
|---|---|---|---|
| `Hydrate` | exported (file `Hydrate.ts`) | replaced by per-chain `EvmHydrator`, `SolanaHydrator`, `SuiHydrator` (internal) | If you imported `Hydrate` from v1, **remove the import** — v2 does not export an equivalent. State hydration is automatic. |
| `WagmiProvider`, `SuiClientProvider`, `SolanaWalletProvider` (re-exports) | not re-exported | not re-exported | Use the original packages (`wagmi`, `@mysten/dapp-kit-react`, `@solana/wallet-adapter-react`) only if you need direct access — most apps should not. |

---

## `XService` and `XConnector` abstract classes

| | v1 | v2 |
|---|---|---|
| Import path | `@sodax/wallet-sdk-react` (barrel) | `@sodax/wallet-sdk-react` (barrel — types only) |
| Runtime class export | yes | yes |
| Abstract method signature | `abstract connect(): Promise<XAccount \| undefined>` | unchanged |
| Properties | `id`, `name`, `icon`, `xChainType` | unchanged |

The abstract contract is **stable across v1 → v2**. If you have a custom subclass, it should compile against v2 with no changes — but verify, and check `getBalance` / `getBalances` defaults if you override them.

> **Stop condition:** if the user has a custom `XConnector` or `XService` subclass, the migration agent must stop and ask. The abstract surface is stable but downstream usage (e.g. how the subclass is instantiated, registered) has changed.
