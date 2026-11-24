# Provider classes — class × config × interface × merge helper

One row per chain. Use this when you know the chain and need to look up everything else.

| Chain | Class | Config union | Interface (`@sodax/types`) | Default merge helper | Discriminant |
|---|---|---|---|---|---|
| EVM       | `EvmWalletProvider`       | `EvmWalletConfig`       | `IEvmWalletProvider`       | `mergePolicy` (per-method)   | Field presence (no `type`) |
| Solana    | `SolanaWalletProvider`    | `SolanaWalletConfig`    | `ISolanaWalletProvider`    | flat (read directly)         | Field presence (no `type`) |
| Sui       | `SuiWalletProvider`       | `SuiWalletConfig`       | `ISuiWalletProvider`       | `mergePolicy` (per-method)   | Field presence — uses `mnemonics` |
| Bitcoin   | `BitcoinWalletProvider`   | `BitcoinWalletConfig`   | `IBitcoinWalletProvider`   | `mergeDefaults` (flat)       | **`type` field** (`'PRIVATE_KEY' \| 'BROWSER_EXTENSION'`) |
| Stellar   | `StellarWalletProvider`   | `StellarWalletConfig`   | `IStellarWalletProvider`   | `mergeDefaults` (flat)       | **`type` field** |
| ICON      | `IconWalletProvider`      | `IconWalletConfig`      | `IIconWalletProvider`      | `mergeDefaults` (flat)       | Field presence (no `type`) |
| Injective | `InjectiveWalletProvider` | `InjectiveWalletConfig` | `IInjectiveWalletProvider` | `mergeDefaults` (flat)       | Field presence — PK variant uses `secret` wrapper |
| NEAR      | `NearWalletProvider`      | `NearWalletConfig`      | `INearWalletProvider`      | `mergeDefaults` (flat)       | Field presence (no `type`) |
| Stacks    | `StacksWalletProvider`    | `StacksWalletConfig`    | `IStacksWalletProvider`    | `mergeDefaults` (flat)       | Field presence (no `type`) |
| Tron      | `TronWalletProvider`      | `TronWalletConfig`      | `ITronWalletProvider`      | flat (read directly)         | Field presence (no `type`) |

> EVM and Sui group their `defaults` per method (e.g. `defaults.sendTransaction`, `defaults.signAndExecuteTxn`) via `mergePolicy`. Every other chain (incl. Solana) has a flat `defaults` object. See [`../architecture.md`](../architecture.md) § `BaseWalletProvider`.

---

## All exported `chainType` literals

| Provider | `chainType` |
|---|---|
| `EvmWalletProvider` | `'EVM'` |
| `SolanaWalletProvider` | `'SOLANA'` |
| `SuiWalletProvider` | `'SUI'` |
| `BitcoinWalletProvider` | `'BITCOIN'` |
| `StellarWalletProvider` | `'STELLAR'` |
| `IconWalletProvider` | `'ICON'` |
| `InjectiveWalletProvider` | `'INJECTIVE'` |
| `NearWalletProvider` | `'NEAR'` |
| `StacksWalletProvider` | `'STACKS'` |
| `TronWalletProvider` | `'TRON'` |

These match `ChainType` values in `@sodax/types`. Useful for runtime discrimination of a generic `IXxxWalletProvider`.

---

## Class hierarchy

```
BaseWalletProvider<TDefaults>           ← abstract base from this package
├── EvmWalletProvider       implements IEvmWalletProvider
├── SolanaWalletProvider    implements ISolanaWalletProvider
├── SuiWalletProvider       implements ISuiWalletProvider
├── BitcoinWalletProvider   implements IBitcoinWalletProvider
├── StellarWalletProvider   implements IStellarWalletProvider
├── IconWalletProvider      implements IIconWalletProvider
├── InjectiveWalletProvider implements IInjectiveWalletProvider
├── NearWalletProvider      implements INearWalletProvider
├── StacksWalletProvider    implements IStacksWalletProvider
└── TronWalletProvider      implements ITronWalletProvider
```

Subclassing `BaseWalletProvider` is **maintainer-only** — it implies adding a new chain to the package.
