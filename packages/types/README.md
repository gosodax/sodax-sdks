# @sodax/types

Shared SODAX type definitions, constants, and configuration for SDK packages and applications.

This package includes chain and token metadata, wallet provider interfaces, transaction and receipt types, backend API contracts, swap and money market configuration, DEX configuration, and common utilities.

## Install

```bash
pnpm add @sodax/types
```

## Usage

> SDK consumers should import these from `@sodax/sdk` (`import { ... } from '@sodax/sdk'`), which re-exports `@sodax/types`; reserve a direct `@sodax/types` install for standalone or type-only use.

Import shared types, constants, configuration, and helpers from the root package:

```typescript
import {
  ChainKeys,
  CONFIG_VERSION,
  SDK_VERSION,
  configVersionFor,
  formatConfigVersion,
  parseConfigVersion,
  getEvmChainKeyByChainId,
  sodaxConfig,
  supportedTokensByChain,
} from '@sodax/types';

import type {
  Address,
  DeepPartial,
  EvmRawTransaction,
  IBitcoinWalletProvider,
  IEvmWalletProvider,
  IWalletProvider,
  SpokeChainKey,
  WalletAddressProvider,
} from '@sodax/types';
```

DEX types and constants are also available from the dedicated DEX subpath export:

```typescript
import { concentratedLiquidityConfig, dexConfig } from '@sodax/types/dex';

import type { ConcentratedLiquidityConfig, DexConfig, PoolKey } from '@sodax/types/dex';
```

The package currently exposes only the root export (`@sodax/types`) and the DEX export (`@sodax/types/dex`). Chain-specific types such as `IEvmWalletProvider`, `BitcoinRawTransaction`, and `SolanaRawTransactionReceipt` are available from the root package.

## Export Overview

| Area | Examples |
| --- | --- |
| Shared primitives | `Address`, `Hex`, `Hash`, `Base64String`, `HttpUrl`, `TxPollingConfig` |
| Common types and constants | `Result`, `PartnerFee`, `TxReturnType`, `apiConfig`, `solverConfig`, retry and timeout constants |
| Chains and tokens | `ChainKeys`, `SpokeChainKey`, `ChainType`, `baseChainInfo`, `spokeChainConfig` [^cfg], `supportedTokensByChain` |
| Wallet providers | `WalletAddressProvider`, `ICoreWallet`, `IWalletProvider`, `GetWalletProviderType` |
| Chain transaction types | `EvmRawTransaction`, `BitcoinRawTransaction`, `SolanaRawTransaction`, `StellarRawTransaction`, `SuiRawTransaction`, `IconRawTransaction`, `InjectiveRawTransaction`, `NearRawTransaction`, `StacksRawTransaction` |
| Backend API contracts | `IConfigApiV1`, `IConfigApiV2`, `GetAllConfigApiResponse`, `SubmitTxRequestV2`, `SubmitTxResponseV2`, `SubmitTxStatusResponseV2`, `SubmitIntentRequestV2`, `SubmitIntentResponseV2` |
| Product configuration | `sodaxConfig` [^cfg], `bridgeConfig`, `swapsConfig`, `moneyMarketConfig`, `dexConfig`, `concentratedLiquidityConfig` |
| Leverage yield | leverage-yield param and response types (`leverageYield`) |
| Hooks | shared hook types (`hooks`) |
| Utilities | `DeepPartial`, `getChainType`, `getEvmChainKeyByChainId`, chain guard helpers, bnUSD token helpers |

[^cfg]: `spokeChainConfig` and `sodaxConfig` (and the related `hubConfig`, etc.) are **packaged-default snapshots** frozen at SDK release time. They are safe to import at module scope, but **direct imports do NOT reflect overrides passed to `new Sodax(config)` or dynamic config loaded by `sodax.config.initialize()`** — those flow into the `ConfigService` only. Once a `Sodax` instance exists, prefer the instance-scope readers: `sodax.config.spokeChainConfig`, `sodax.config.getChainConfig(chainKey)`, `sodax.config.sodaxConfig`, `sodax.config.getHubChainConfig()`, etc. Mixing a static import with a custom-configured `Sodax` instance will silently fall back to defaults for any chain you customized.

## Wallet Providers

All wallet providers extend the base wallet address contract:

```typescript
interface WalletAddressProvider {
  getWalletAddress(): Promise<string>;
  getPublicKey?: () => Promise<string>;
}
```

`ICoreWallet` extends `WalletAddressProvider`, and each chain-specific provider adds its own signing, transaction, and query methods. The root export includes provider interfaces for all supported chain families:

| Chain family | Provider interface |
| --- | --- |
| EVM | `IEvmWalletProvider` |
| Bitcoin | `IBitcoinWalletProvider` |
| Solana | `ISolanaWalletProvider` |
| Stellar | `IStellarWalletProvider` |
| Sui | `ISuiWalletProvider` |
| ICON | `IIconWalletProvider` |
| Injective | `IInjectiveWalletProvider` |
| NEAR | `INearWalletProvider` |
| Stacks | `IStacksWalletProvider` |

Use `IWalletProvider` for the union of all chain-specific wallet providers, or `GetWalletProviderType<C>` to map a `SpokeChainKey` or `ChainType` to the matching provider interface.

```typescript
import type { GetWalletProviderType, IEvmWalletProvider, IWalletProvider, SpokeChainKey } from '@sodax/types';

type ProviderForChain<C extends SpokeChainKey> = GetWalletProviderType<C>;

function isEvmProvider(provider: IWalletProvider): provider is IEvmWalletProvider {
  return provider.chainType === 'EVM';
}
```

## Address Types

`GetAddressType<C>` is the type the SDK's address parameters (`srcAddress`, `owner`, …) declare for a `SpokeChainKey` or `ChainType`. Each chain family carries its own address encoding — a Solana address is a base58 public key, not a hex string.

| Chain family | Declared type | Encoding to pass |
| --- | --- | --- |
| EVM | `Address` | `0x…` |
| ICON | `IconAddress` | `hx…` (or `cx…` for a contract) |
| Solana | `SolanaBase58PublicKey` | base58 public key |
| Sui | `Hex` | `0x…` (32-byte) |
| Stellar | `Hex` [^addr] | `G…` ed25519 strkey |
| NEAR | `Address` [^addr] | account id (`alice.near`, or a 64-char implicit account) |
| Injective, Stacks | `string` | `inj1…` / `SP…`, `ST…` |

[^addr]: Stellar and NEAR declare a hex type their chain does not use. The Stellar spoke service passes the address to `Address.fromString` and `loadAccount`, which need a `G…` strkey; the NEAR spoke service passes it as a NEAR account id (`signerId`, `accountId`). Pass the chain's own encoding — the declared type is wrong here, not the chain.

`Address`, `Hex` and `IconAddress` are template-literal types, so the compiler does check the prefix. `SolanaBase58PublicKey` and the `string` entries are plain aliases with no branding — nothing there catches a wrong-encoding address until the chain's own SDK rejects it at runtime.

```typescript
import type { GetAddressType, SpokeChainKey } from '@sodax/types';

type AddressForChain<C extends SpokeChainKey> = GetAddressType<C>;
```

`GetTokenAddressType<C>` is the token-address counterpart: `Address` for EVM chains, `string` everywhere else.

## Config version

`CONFIG_VERSION` identifies the SDK release a SODAX config belongs to. The backend does not maintain
its own number — it serves this constant from the `@sodax/sdk` release it has installed — so comparing
it against `GetAllConfigResponseV2.version` answers *do the SDK and the API run the same release?*

It is **derived from this package's version**, never hand-edited:

```
CONFIG_VERSION = major * 1_000_000 + minor * 10_000 + patch * 100 + (rc ?? 99)
```

The `99` rc slot is the sentinel for a stable release, so it outranks every rc of the same triple.
Each field is capped — major `1..99`, minor and patch `0..99`, rc `0..98` — because one past any
boundary the packing would carry into the next field and collide with a different release.

| version | `CONFIG_VERSION` |
| --- | --- |
| `2.2.0-rc.6` | `2_020_006` |
| `2.2.0` | `2_020_099` |
| `2.2.1` | `2_020_199` |
| `2.10.0` | `2_100_099` |

Read it back rather than unpacking it by hand. All three helpers are total — they return `null` for
anything outside the encoding, including the small counter values an API on an older SDK still serves:

```typescript
import { CONFIG_VERSION, SDK_VERSION, configVersionFor, formatConfigVersion, parseConfigVersion } from '@sodax/types';

SDK_VERSION;                              // '2.2.0-rc.6' — computed from CONFIG_VERSION, never written
formatConfigVersion(2_020_099);           // '2.2.0'
parseConfigVersion(2_020_006);            // { major: 2, minor: 2, patch: 0, rc: 6 }
configVersionFor('2.2.0');                // 2_020_099
configVersionFor('2.3.0-beta.1');         // null — outside the grammar
parseConfigVersion(235);                  // null — a legacy counter value, not a config version
```

`rc` is `null` for a stable release; `rc: 0` is legal, so test it against `null` rather than for
truthiness.
