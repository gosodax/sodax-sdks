# `library-exports` added

**Additive — no action required.** Older code continues to compile.

---

## What changed

`@sodax/wallet-sdk-core` now re-exports a curated set of types (and two runtime values) from each upstream chain SDK:

```ts
// Now possible
import type { WalletClient, PublicClient, TransactionReceipt } from '@sodax/wallet-sdk-core';
import { Networks, PostConditionMode } from '@sodax/wallet-sdk-core';
```

The full list lives at `src/types/library-exports.ts` and in [`recipes/library-exports.md`](../../../integration/knowledge/recipes/library-exports.md).

## Why

Consumer apps previously had to list every chain SDK explicitly in `package.json` just to import a few types:

```jsonc
// Before — direct deps
{
  "dependencies": {
    "@sodax/wallet-sdk-core": "…",
    "viem": "^2.x",                          // for WalletClient, PublicClient
    "@stellar/stellar-sdk": "^11.x",          // for Networks
    "@stacks/transactions": "^6.x",           // for PostConditionMode
  }
}
```

Three problems:

1. **Version drift.** Consumer's `viem` could be a different minor than SODAX's, causing type incompatibilities.
2. **Lockfile churn.** Every chain-SDK bump in SODAX propagated to consumer lockfiles.
3. **Discoverability.** Consumers had to know which chain SDK each type lived in. The re-export pins types under one familiar namespace.

## Consumer impact

| Older pattern | Replacement (optional) |
|---|---|
| `import type { WalletClient } from 'viem'` | `import type { WalletClient } from '@sodax/wallet-sdk-core'` |
| `import { Networks } from '@stellar/stellar-sdk'` | `import { Networks } from '@sodax/wallet-sdk-core'` |
| `import { PostConditionMode } from '@stacks/transactions'` | `import { PostConditionMode } from '@sodax/wallet-sdk-core'` |

**If 100% of upstream-SDK usage is covered by `library-exports`**, you can drop the direct chain-SDK dep from `package.json`. Most apps will still need some upstream package (e.g. `viem` for `createPublicClient`, `@solana/web3.js` for `Connection`, …) — adoption is a per-import decision.

## How to adopt

Apply [`../recipes/adopt-library-exports.md`](../recipes/adopt-library-exports.md). Skip if you have no time — the older direct imports still work, just at a small cost in package size and version coupling.

## What is NOT re-exported

The list is curated. Runtime helpers (`createWalletClient`, `Connection`, `Transaction`, `TransactionBuilder`, …) and lesser-used types are **not** included. See [`recipes/library-exports.md`](../../../integration/knowledge/recipes/library-exports.md) § "When to NOT use re-exports".
