# packages/wallet-sdk-core

Low-level multi-chain wallet providers for signing and broadcasting transactions. Each chain has a provider class supporting both private-key (for scripts/testing) and browser-extension (for production dApps) configurations.

Consumer-facing AI material (skills + knowledge for coding agents, Cursor, Codex) lives in [`packages/skills`](../skills/AGENTS.md) — not in this package.

## Architecture

### Folder-per-provider structure

Each provider lives in its own folder under `src/wallet-providers/` with co-located implementation, types, tests, and a barrel `index.ts`:

```
src/
├── index.ts                          # Public re-exports (wallet-providers + types)
├── types/                            # Shared library-level types
├── utils/                            # Internal utils (shallowMerge); not re-exported publicly
└── wallet-providers/
    ├── index.ts                      # Barrel re-export of every provider folder
    ├── BaseWalletProvider.ts         # Abstract base: holds `defaults`, exposes mergePolicy/mergeDefaults
    ├── evm/                          # EVM chains via viem
    │   ├── EvmWalletProvider.ts
    │   ├── EvmWalletProvider.test.ts
    │   ├── types.ts
    │   └── index.ts
    ├── solana/                       # Solana (@solana/web3.js)
    ├── sui/                          # Sui (@mysten/sui)
    ├── icon/                         # ICON (icon-sdk-js)
    ├── injective/                    # Injective (@injectivelabs/sdk-ts)
    ├── stellar/                      # Stellar (@stellar/stellar-sdk)
    ├── stacks/                       # Stacks (@stacks/transactions)
    ├── bitcoin/                      # Bitcoin (bitcoinjs-lib, PSBT signing)
    └── near/                         # NEAR (near-api-js)
```

### Provider Pattern

Each provider:
1. Extends abstract `BaseWalletProvider<TDefaults>` to inherit `defaults` storage and merge helpers
2. Implements a chain-specific interface extending `WalletAddressProvider` from `@sodax/types`
3. Accepts a discriminated union config: `PrivateKey*Config | BrowserExtension*Config`, plus an optional `defaults` field of `TDefaults` shape
4. Constructor calls `super(walletConfig.defaults)` and picks the implementation path based on config type
5. Exposes: `getWalletAddress()`, chain-specific signing/sending methods

### Configurable defaults

`BaseWalletProvider` lets each provider declare a `TDefaults` shape, then merge per-call options over those defaults:

- `mergePolicy(key, options)` — merge over a slice of defaults keyed by method (e.g. `defaults.sendTransaction`)
- `mergeDefaults(options)` — merge over a flat defaults object

Merging is **shallow** (top-level only) via `shallowMerge` in `src/utils/merge.ts` (imported internally through `src/utils/index.ts`).
Nested objects are replaced wholesale, not deep-merged — see JSDoc on `shallowMerge`.

Example interfaces:
- `IEvmWalletProvider`: `sendTransaction()`, `waitForTransactionReceipt()`
- `ISolanaWalletProvider`: `sendTransaction()`, `buildV0Txn()`, `getAssociatedTokenAddress()`
- `IBitcoinWalletProvider`: `signTransaction()`, `signEcdsaMessage()`, `signBip322Message()`

### Config variants (discriminants)

Every provider supports two modes (private-key vs browser/extension), but **the config union discriminant is provider-specific**:

```typescript
// EVM: discriminates by field presence (NO `type` field)
new EvmWalletProvider({
  privateKey: '0x…',
  chainId: ChainKeys.SONIC_MAINNET, // from '@sodax/types'
  rpcUrl: 'https://…',
});

new EvmWalletProvider({
  walletClient: viemWalletClient,
  publicClient: viemPublicClient,
});

// Bitcoin: discriminates by explicit uppercase `type`
new BitcoinWalletProvider({
  type: 'PRIVATE_KEY',
  privateKey: '0x…',
  network: 'TESTNET',
});

new BitcoinWalletProvider({
  type: 'BROWSER_EXTENSION',
  walletsKit: myWalletsKit,
  network: 'TESTNET',
});
```

### Adding a New Chain Provider

> The provider here is one slice of a full chain integration. For the end-to-end cross-package flow (types, sdk spoke, wallet-sdk-react), use the `add-chain` skill (`.claude/skills/add-chain/`).
>
> To add a new **signing-config variant** to an existing provider (e.g. a mnemonic mode) or a new **wallet connector** to a chain that already exists, use the `add-wallet-provider` skill (`.claude/skills/add-wallet-provider/`).

Follow an existing implementation (e.g. `evm/`):
1. Create folder `src/wallet-providers/<chain>/`
2. In `<chain>/types.ts`: define `PrivateKey<Chain>WalletConfig`, `BrowserExtension<Chain>WalletConfig`, the `<Chain>WalletConfig` discriminated union, the `<Chain>Defaults` shape, and the provider interface `I<Chain>WalletProvider` extending `WalletAddressProvider`. **Exception:** when the credential is not a plain private key (e.g. the config supports both `privateKey` and `mnemonics`), use a descriptive name and a nested credential object instead of the `PrivateKey*` literal pattern — see `SecretInjectiveWalletConfig` (with `secret: { privateKey } | { mnemonics }`) as the canonical example.
3. In `<chain>/<Chain>WalletProvider.ts`: implement the class extending `BaseWalletProvider<<Chain>Defaults>`, calling `super(walletConfig.defaults)` and discriminating on config type
4. Add `<chain>/<Chain>WalletProvider.test.ts` covering constructor variants, defaults merge, and core methods
5. Add `<chain>/index.ts` barrel: `export * from './types.js'; export * from './<Chain>WalletProvider.js';`
6. Re-export the folder from `src/wallet-providers/index.ts`

## Biome Overrides (Tech Debt)

This package has a local `biome.json` that relaxes several root rules:
- `noNonNullAssertion: off` (style)
- `noUselessElse: off` (style)
- `noExplicitAny: off` (suspicious)
- `noStaticOnlyClass: off` (complexity)
- `noUnusedFunctionParameters: off` (correctness)

These are tech debt. When modifying code in this package, fix non-null assertions, `any` types, useless `else` branches, and unused parameters where possible rather than relying on these overrides.

## Build

tsup: dual ESM (`.mjs`) + CJS (`.cjs`) with sibling `.d.ts` / `.d.cts` (`dts: true`). Platform: neutral (Node + browser) via `esbuildOptions.platform = 'neutral'`.
`near-api-js` and `@sodax/types` are force-bundled for CJS compatibility via `noExternal` in [tsup.config.ts](tsup.config.ts).

## Tests

Vitest. Co-located tests (`*.test.ts`) inside each provider folder. Provider tests should cover constructor variants and defaults merge; add deeper method behavior coverage when changing signing or broadcasting logic. `utils/merge.test.ts` covers `shallowMerge` edge cases.

`checkTs` typechecks test files too: `tsconfig.json` deliberately does not exclude them, and the shared
`scripts/check-tests-typechecked.mjs` (repo root, the tail of `checkTs`) fails loudly if a future exclude hides them
again. It also requires a one-line why-comment on every `as unknown as` in a test file — this package carries no
grandfathered baseline, so every such cast must be documented where it stands.
