# Recipe: Adopt `library-exports` (optional cleanup)

Re-import types from `@sodax/wallet-sdk-core` instead of upstream chain SDKs. Optionally drop direct chain-SDK deps from `package.json`.

**Apply when:** the user imports type names like `WalletClient`, `PublicClient`, `Networks`, `PostConditionMode`, `NearConnector`, etc. directly from their upstream packages.

For the full list of re-exported types, see [`recipes/library-exports.md`](../../../integration/knowledge/recipes/library-exports.md).

---

## Before

```ts
import type { WalletClient, PublicClient, TransactionReceipt } from 'viem';
import { Networks } from '@stellar/stellar-sdk';
import { PostConditionMode } from '@stacks/transactions';
import type { Commitment, ConnectionConfig, SendOptions } from '@solana/web3.js';
```

## After

```ts
import type {
  WalletClient,
  PublicClient,
  TransactionReceipt,
  Commitment,
  ConnectionConfig,
  SendOptions,
} from '@sodax/wallet-sdk-core';

import { Networks, PostConditionMode } from '@sodax/wallet-sdk-core';
```

---

## Steps

1. **Identify candidate imports.** Run the grep below to find type imports from upstream chain SDKs:
   ```bash
   grep -rn "from 'viem'" <user-src> | grep -E "WalletClient|PublicClient|TransactionReceipt|SendTransactionParameters|WaitForTransactionReceiptParameters"
   grep -rn "from '@stellar/stellar-sdk'" <user-src> | grep "Networks"
   grep -rn "from '@stacks/transactions'" <user-src> | grep -E "PostConditionMode|ClarityValue|PostConditionModeName"
   # …see ../../integration/recipes/library-exports.md for the full grep list
   ```

2. **Replace one import statement at a time.** Switch the `from` clause to `@sodax/wallet-sdk-core`. Re-run `pnpm checkTs` after each file.

3. **Check whether the upstream package is still needed for runtime.** If the consumer's only remaining import from `viem` (etc.) is one of the re-exported types, you can drop the dep from `package.json`. If they also import `createPublicClient`, `Connection`, `Transaction`, etc. — keep the dep.

   ```bash
   grep -rn "from 'viem'" <user-src>   # confirm nothing remains
   ```

---

## Trade-offs

| Switch | Trade-off |
|---|---|
| Type imports | Lossless. Same symbol, different module. |
| Dep removal (after switching all imports) | Smaller `node_modules`, faster installs. But you re-add the dep if you later need a runtime helper. |
| Version pinning | After dep removal, you no longer control the chain-SDK version directly — it's locked to whatever SODAX uses. Acceptable for most apps. |

---

## When NOT to adopt

| Scenario | Why skip |
|---|---|
| The user is pinned to a specific chain-SDK version different from SODAX's | Adopting library-exports forces SODAX's version. Keep direct imports. |
| The user imports many runtime symbols (`createPublicClient`, etc.) not in library-exports | Migration churn for limited benefit — they still need the dep. |
| The user is mid-migration to another chain SDK and library-exports doesn't cover the new one | Wait until library-exports catches up, or just keep the direct dep. |

---

## Verification

```bash
# 1. Type check
pnpm checkTs

# 2. No remaining direct upstream-SDK type imports
grep -rn "from 'viem'" <user-src> | grep -E "WalletClient|PublicClient|TransactionReceipt"
# expect empty (or kept on purpose with justification)

# 3. Optional: confirm the upstream dep was actually removed
cat <user>/package.json | jq -r '.dependencies | keys[]'
```

---

## Why

See [`../breaking-changes/library-exports.md`](../breaking-changes/library-exports.md) for the motivation.
