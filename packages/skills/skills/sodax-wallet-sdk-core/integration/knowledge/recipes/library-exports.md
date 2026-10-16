# Recipe: `library-exports` — re-import upstream chain types

Avoid adding `viem`, `@mysten/sui`, `@solana/web3.js`, etc. as direct `package.json` deps. `@sodax/wallet-sdk-core` re-exports a curated set of types (and a handful of runtime enums) from each upstream chain SDK.

**Depends on:** none — pure type-level optimisation.

---

## What's re-exported

Source file: `src/types/library-exports.ts`. The export name is the same as upstream — only the source module changes.

### Types (no runtime cost)

| Chain SDK | Re-exported types |
|---|---|
| `viem` | `Account`, `Address`, `Chain`, `Transport`, `PublicClient`, `WalletClient`, `HttpTransportConfig`, `PublicClientConfig`, `WalletClientConfig`, `SendTransactionParameters`, `WaitForTransactionReceiptParameters`, `TransactionReceipt` |
| `@mysten/sui/transactions` | `Transaction`, `TransactionArgument` |
| `@solana/web3.js` | `Commitment`, `ConnectionConfig`, `SendOptions` |
| `@injectivelabs/networks` | `Network` |
| `@injectivelabs/ts-types` | `ChainId`, `EvmChainId` |
| `@injectivelabs/wallet-core` | `MsgBroadcaster` |
| `@stacks/transactions` | `ClarityValue`, `PostConditionModeName` |
| `@stacks/network` | `StacksNetwork` |
| `@stacks/connect` | `StacksProvider` |
| `near-api-js` | `KeyPairString` |
| `@hot-labs/near-connect` | `NearConnector` |
| `bitcoinjs-lib/src/networks.js` | `Network as BitcoinJsNetwork` |

### Runtime values (also re-exported)

| Source | Value | Why include the runtime |
|---|---|---|
| `@stellar/stellar-sdk` | `Networks` (object) | Consumers commonly read `Networks.PUBLIC` / `Networks.TESTNET` |
| `@stacks/transactions` | `PostConditionMode` (enum) | Used as a value when building Stacks tx params |

Note the file name: `library-exports` (not `library-types`). It exists precisely because the file mixes type and runtime re-exports.

---

## Usage

```ts
// ✅ DO — types and the two runtime enums via wallet-sdk-core
import type {
  WalletClient,
  PublicClient,
  TransactionReceipt,
  ConnectionConfig,
  Network,
  ChainId,
  StacksNetwork,
  StacksProvider,
  NearConnector,
} from '@sodax/wallet-sdk-core';

import { Networks, PostConditionMode } from '@sodax/wallet-sdk-core';
```

```ts
// ❌ DON'T — direct upstream imports for these names if you only need them as types
import type { WalletClient } from 'viem';
import { Networks } from '@stellar/stellar-sdk';
```

---

## When to NOT use re-exports

The re-export list is **curated** — only the types most consumers need. Use the upstream package directly when:

- You need a type not in the re-export list (e.g. viem's `TransactionRequest`, Solana's `Keypair` value).
- You need a **runtime value** other than `Networks` / `PostConditionMode` (e.g. viem's `createPublicClient`, `@solana/web3.js`'s `Connection`).
- You are building a polyfill, mock, or shim around the underlying SDK.

In those cases, add the upstream package to `package.json` and import normally. The re-export is an optimisation, not a hard wall.

---

## Why `library-exports` exists

| Without it | With it |
|---|---|
| Consumer `package.json` lists 8+ chain SDKs explicitly | Consumer lists only `@sodax/wallet-sdk-core` + `@sodax/types` |
| Upgrading a chain SDK touches consumer lockfiles | SODAX bumps the SDK; consumers re-install |
| Type drift between SODAX and consumer (different `viem` minor versions) | Single source of truth — same `viem` version as SODAX uses internally |

The trade-off is the curated list — uncommon types need a direct dep.

---

## Verification

```bash
# 1. Type check
pnpm checkTs

# 2. Confirm no direct upstream imports for re-exported types
grep -rn "from 'viem'" <user-src> | grep -E "WalletClient|PublicClient|TransactionReceipt|SendTransactionParameters"
grep -rn "from '@stellar/stellar-sdk'" <user-src> | grep "Networks"
grep -rn "from '@stacks/transactions'" <user-src> | grep "PostConditionMode"
# expect empty for all three

# 3. Confirm the chain SDKs are NOT direct deps in consumer's package.json
cat <user>/package.json | grep -E '"viem"|"@stellar/stellar-sdk"|"@stacks/transactions"|"@mysten/sui"|"@solana/web3.js"|"@injectivelabs"|"near-api-js"|"bitcoinjs-lib"'
# expect empty unless the consumer legitimately uses a non-re-exported symbol
```

---

## Common pitfalls

| Pitfall | Symptom | Fix |
|---|---|---|
| Importing `Networks` from `@stellar/stellar-sdk` after install | Works, but adds a direct dep | Switch to `import { Networks } from '@sodax/wallet-sdk-core'` |
| Mixing type-only and value imports in one statement | Build size grows | `import type { … }` for types; separate value imports |
| Expecting all viem helpers to be re-exported | `createPublicClient` is missing | Only types + 2 enums are re-exported. Other runtime helpers require direct install. |

---

## See also

- [`../architecture.md`](../architecture.md) § `library-exports` — the upstream-SDK indirection.
- [`../reference/public-api.md`](../reference/public-api.md) — full barrel export list.
