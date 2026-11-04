---
title: "Estimate Gas"
icon: gauge
generatedFrom: packages/sdk/docs/ESTIMATE_GAS.md
---

### Estimate Gas for Raw Transactions

`estimateGas` estimates the gas cost of a raw (unsigned) transaction before execution. The typical flow is:

1. Call any service method with `raw: true` to get an unsigned transaction payload.
2. Pass that payload to `estimateGas` to get a chain-specific gas estimate.

`estimateGas` is available as an instance method on three services — all delegate to `SpokeService.estimateGas` internally:

- `sodax.swaps.estimateGas(params)` — for swap / intent transactions
- `sodax.moneyMarket.estimateGas(params)` — for money market transactions
- `sodax.spoke.estimateGas(params)` — for any raw spoke transaction (approvals, deposits, etc.)

---

#### Method signature

All three methods share the same signature:

```typescript
public async estimateGas<C extends SpokeChainKey>(
  params: EstimateGasParams<C>,
): Promise<Result<GetEstimateGasReturnType<C>>>
```

`EstimateGasParams<C>` is defined in `packages/sdk/src/shared/types/spoke-types.ts`:

```typescript
export type EstimateGasParams<C extends SpokeChainKey> = {
  tx: TxReturnType<C, true>; // the raw tx payload from a raw: true call
  chainKey: C;               // the chain key the transaction is for
};
```

---

#### Return type: `GetEstimateGasReturnType<C>`

The return type is conditional on the source chain's chain family. The concrete type per chain family is:

| Chain family | Type | Notes |
|---|---|---|
| EVM (Ethereum, Arbitrum, Base, BSC, Optimism, Polygon, Avalanche, HyperEVM, Lightlink, Redbelly, Kaia, Hedera, Robinhood) | `bigint` (`EvmGasEstimate`) | Gas units |
| EVM hub (Sonic) | `bigint` (`EvmGasEstimate`) | Gas units |
| Solana | `number \| undefined` (`SolanaGasEstimate`) | Compute units; `undefined` if simulation unavailable |
| Stellar | `bigint` (`StellarGasEstimate`) | Fee in stroops |
| ICON | `bigint` (`IconGasEstimate`) | Step count |
| Sui | `SuiGasEstimate` | Object with `computationCost`, `storageCost`, `storageRebate`, `nonRefundableStorageFee` (all `string`) |
| Injective | `InjectiveGasEstimate` | Object with `gasWanted: number` and `gasUsed: number` |
| Bitcoin | `bigint` (`BitcoinGasEstimate`) | Fee in satoshis |
| NEAR | `bigint` (`NearGasEstimate`) | Gas in yoctoNEAR |
| Stacks | `FeeEstimateTransaction` | Object with `low`, `medium`, `high` tiers, each `{ fee: number, fee_rate: number }` |

The full type definitions are in `packages/types/src/common/common.ts`.

---

#### `raw: true` / `raw: false` — the `WalletProviderSlot<K, Raw>` constraint

`estimateGas` always takes a raw transaction, so you must first get one by calling a service method with `raw: true`. The `WalletProviderSlot<K, Raw>` type in `packages/types/src/common/common.ts` enforces this at compile time:

- `raw: true` → `walletProvider` is **forbidden** (typed as `never`). The method returns an unsigned payload (`TxReturnType<K, true>`, e.g. `EvmRawTransaction`).
- `raw: false` → `walletProvider` is **required** and chain-narrowed to `GetWalletProviderType<K>`. The method broadcasts and returns a tx hash.

Wallet providers are obtained from `packages/wallet-sdk-core` — never constructed manually in caller code.

---

#### `ChainKeys.*` constants

All chain constants live under `ChainKeys.*` from `@sodax/sdk`. There are no separate `*_CHAIN_ID` exports.

```typescript
import { ChainKeys } from '@sodax/sdk';

ChainKeys.BSC_MAINNET        // was: BSC_MAINNET_CHAIN_ID
ChainKeys.ETHEREUM_MAINNET   // was: ETHEREUM_MAINNET_CHAIN_ID
ChainKeys.SONIC_MAINNET      // was: SONIC_MAINNET_CHAIN_ID
```

---

#### Error handling: `Result<T>`

Every `estimateGas` call returns `Promise<Result<GetEstimateGasReturnType<C>>>` where `Result<T>` is:

```typescript
type Result<T, E = Error | unknown> =
  | { ok: true; value: T }
  | { ok: false; error: E };
```

Always check `result.ok` before accessing `result.value`.

---

#### Examples

**Example 1: Estimate gas for a swap intent transaction (EVM spoke)**

```typescript
import { ChainKeys } from '@sodax/sdk';
import type { EstimateGasParams } from '@sodax/sdk';

// Step 1: Get a raw transaction from createIntent
const intentResult = await sodax.swaps.createIntent({
  params: {
    srcChainKey: ChainKeys.BSC_MAINNET,
    dstChainKey: ChainKeys.ARBITRUM_MAINNET,
    srcAddress: '0xYourBscAddress',
    inputToken: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',  // BEP-20 ETH on BSC
    outputToken: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // WETH on Arbitrum
    inputAmount: 1_000_000_000_000_000n,
    minOutputAmount: 980_000_000_000_000n,
    deadline: 0n,
  },
  raw: true, // walletProvider must be absent when raw: true
});

if (!intentResult.ok) {
  console.error('Failed to build intent tx:', intentResult.error);
} else {
  const { tx: rawTx } = intentResult.value;

  // Step 2: Estimate gas for the raw transaction
  const gasResult = await sodax.swaps.estimateGas({
    tx: rawTx,
    chainKey: ChainKeys.BSC_MAINNET,
  });

  if (gasResult.ok) {
    // EVM → bigint (gas units)
    console.log('Estimated gas (BSC):', gasResult.value);
  } else {
    console.error('Gas estimation failed:', gasResult.error);
  }
}
```

**Example 2: Estimate gas for a money market supply transaction (EVM spoke)**

```typescript
import { ChainKeys } from '@sodax/sdk';

// Step 1: Get a raw supply transaction
const supplyResult = await sodax.moneyMarket.createSupplyIntent({
  params: {
    srcChainKey: ChainKeys.ETHEREUM_MAINNET,
    // ... other supply params
  },
  raw: true,
});

if (supplyResult.ok) {
  // Step 2: Estimate gas
  const gasResult = await sodax.moneyMarket.estimateGas({
    tx: supplyResult.value.tx,
    chainKey: ChainKeys.ETHEREUM_MAINNET,
  });

  if (gasResult.ok) {
    // EVM → bigint
    console.log('Estimated gas (Ethereum):', gasResult.value);
  } else {
    console.error('Gas estimation failed:', gasResult.error);
  }
}
```

**Example 3: Estimate gas for an approval transaction**

```typescript
import { ChainKeys } from '@sodax/sdk';

// Step 1: Get a raw approval transaction
const approveResult = await sodax.swaps.approve({
  params: {
    srcChainKey: ChainKeys.BSC_MAINNET,
    srcAddress: '0xYourBscAddress',
    inputToken: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
    inputAmount: 1_000_000_000_000_000n,
    // ... other swap params
  },
  raw: true,
});

if (approveResult.ok) {
  // Step 2: Estimate gas via spoke directly
  const gasResult = await sodax.spoke.estimateGas({
    tx: approveResult.value,
    chainKey: ChainKeys.BSC_MAINNET,
  });

  if (gasResult.ok) {
    console.log('Estimated gas for approval:', gasResult.value);
  } else {
    console.error('Gas estimation failed:', gasResult.error);
  }
}
```

**Example 4: Non-EVM chain — Sui**

```typescript
import { ChainKeys } from '@sodax/sdk';

const intentResult = await sodax.swaps.createIntent({
  params: {
    srcChainKey: ChainKeys.SUI_MAINNET,
    // ... other intent params
  },
  raw: true,
});

if (intentResult.ok) {
  const gasResult = await sodax.swaps.estimateGas({
    tx: intentResult.value.tx,
    chainKey: ChainKeys.SUI_MAINNET,
  });

  if (gasResult.ok) {
    // Sui → { computationCost, storageCost, storageRebate, nonRefundableStorageFee }
    const { computationCost, storageCost, storageRebate, nonRefundableStorageFee } = gasResult.value;
    console.log('Sui gas estimate:', { computationCost, storageCost, storageRebate, nonRefundableStorageFee });
  }
}
```

**Example 5: Stacks**

```typescript
import { ChainKeys } from '@sodax/sdk';

const rawTxResult = await sodax.swaps.createIntent({
  params: { srcChainKey: ChainKeys.STACKS_MAINNET, /* ... */ },
  raw: true,
});

if (rawTxResult.ok) {
  const gasResult = await sodax.swaps.estimateGas({
    tx: rawTxResult.value.tx,
    chainKey: ChainKeys.STACKS_MAINNET,
  });

  if (gasResult.ok) {
    // Stacks → { low, medium, high } — each { fee: number, fee_rate: number }
    const { low, medium, high } = gasResult.value;
    console.log('Stacks fee tiers:', { low, medium, high });
  }
}
```
