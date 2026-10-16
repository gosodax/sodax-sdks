---
title: "Stellar Trustline Requirements"
icon: star
generatedFrom: packages/sdk/docs/STELLAR_TRUSTLINE.md
---

Stellar blockchain requires trustlines to be established before you can receive or hold tokens. This document explains how to handle trustlines when using Stellar with the SODAX SDK across different operations.

## Overview

In Stellar, trustlines are required to:

- **Receive tokens**: You must establish a trustline before receiving any token on Stellar
- **Hold tokens**: You cannot hold tokens without an active trustline

The SDK handles trustlines differently depending on whether Stellar is used as the source chain or destination chain:

- **Source Chain (Stellar)**: The SDK automatically handles trustlines through the standard `isAllowanceValid` and `approve` methods on each feature service (e.g. `sodax.swaps.isAllowanceValid`, `sodax.bridge.isAllowanceValid`).
- **Destination Chain (Stellar)**: You must manually check and establish trustlines before executing operations.

## Architecture

In the v2 SDK there are no caller-constructed spoke provider objects. The `Sodax` facade exposes a `spoke` property of type `SpokeService`, which owns a `stellar: StellarSpokeService` instance. All Stellar-specific logic is accessed through that path.

The Stellar wallet provider is `IStellarWalletProvider` (from `@sodax/wallet-sdk-core`). When calling methods with `raw: false`, the chain-narrowed provider type is resolved from the `srcChainKey` via `GetWalletProviderType<ChainKeys.STELLAR_MAINNET>` — there is no manual spoke provider construction.

## StellarSpokeService Methods

`StellarSpokeService` (accessed via `sodax.spoke.stellar`) provides three methods for managing Stellar trustlines.

### hasSufficientTrustline

Checks if a sufficient trustline exists for a given token and wallet address.

```typescript
import { ChainKeys } from '@sodax/sdk';

const hasTrustline = await sodax.spoke.stellar.hasSufficientTrustline(
  tokenAddress,    // The Stellar token contract ID
  amount,          // The amount you need to receive (bigint, in stroops)
  walletAddress,   // The Stellar wallet address to check
);
```

**Returns:** `Promise<boolean>` — `true` if the trustline exists and has sufficient available limit, `false` otherwise. Native XLM and legacy bnUSD always return `true` (no trustline required).

### requestTrustline

Establishes (or increases) a trustline for a given token. Accepts `RequestTrustlineParams<StellarChainKey, Raw>`:

```typescript
import { ChainKeys } from '@sodax/sdk';
import type { IStellarWalletProvider } from '@sodax/wallet-sdk-core';

// Executed mode (raw: false) — signs and broadcasts immediately
const txHash = await sodax.spoke.stellar.requestTrustline({
  srcChainKey: ChainKeys.STELLAR_MAINNET,
  srcAddress: walletAddress,
  token: tokenAddress,
  amount: amount,
  raw: false,
  walletProvider: stellarWalletProvider, // IStellarWalletProvider
});

// Raw mode (raw: true) — returns unsigned transaction XDR; walletProvider must be omitted
const rawTx = await sodax.spoke.stellar.requestTrustline({
  srcChainKey: ChainKeys.STELLAR_MAINNET,
  srcAddress: walletAddress,
  token: tokenAddress,
  amount: amount,
  raw: true,
});
```

**Returns:** `Promise<TxReturnType<StellarChainKey, Raw>>`
- `raw: false` → transaction hash (`string`)
- `raw: true` → `{ from, to, value, data }` where `data` is the unsigned transaction XDR string

## Source-Chain Trustline Flow (Automated)

When Stellar is the **source chain**, `isAllowanceValid` delegates to `hasSufficientTrustline` and `approve` delegates to `requestTrustline` internally. The exact signatures for swaps and bridge are shown below.

### SwapService

```typescript
import { ChainKeys } from '@sodax/sdk';

// Check if the trustline covers the input amount
const allowanceResult = await sodax.swaps.isAllowanceValid({
  params: {
    srcChainKey: ChainKeys.STELLAR_MAINNET,
    inputToken: tokenAddress,
    inputAmount: amount,
    srcAddress: walletAddress,
    // … other CreateIntentParams fields
  },
  raw: false,
  walletProvider: stellarWalletProvider,
});

if (allowanceResult.ok && !allowanceResult.value) {
  // Establish the trustline
  const approveResult = await sodax.swaps.approve({
    params: {
      srcChainKey: ChainKeys.STELLAR_MAINNET,
      inputToken: tokenAddress,
      inputAmount: amount,
      srcAddress: walletAddress,
      // … other CreateIntentParams fields
    },
    raw: false,
    walletProvider: stellarWalletProvider,
  });

  if (!approveResult.ok) {
    console.error('Trustline establishment failed:', approveResult.error.message);
  }
}
```

### BridgeService

```typescript
import { ChainKeys } from '@sodax/sdk';

// Check if the trustline covers the bridge amount
const allowanceResult = await sodax.bridge.isAllowanceValid({
  params: {
    srcChainKey: ChainKeys.STELLAR_MAINNET,
    srcToken: tokenAddress,
    amount: amount,
    srcAddress: walletAddress,
    // … other CreateBridgeIntentParams fields
  },
  raw: false,
  walletProvider: stellarWalletProvider,
});

if (allowanceResult.ok && !allowanceResult.value) {
  const approveResult = await sodax.bridge.approve({
    params: {
      srcChainKey: ChainKeys.STELLAR_MAINNET,
      srcToken: tokenAddress,
      amount: amount,
      srcAddress: walletAddress,
      // … other CreateBridgeIntentParams fields
    },
    raw: false,
    walletProvider: stellarWalletProvider,
  });

  if (!approveResult.ok) {
    console.error('Trustline establishment failed:', approveResult.error.message);
  }
}
```

## Destination-Chain Trustline Flow (Manual)

When Stellar is the **destination chain**, the SDK cannot establish a trustline on your behalf — you must check and establish it before executing any operation that delivers tokens to a Stellar address.

```typescript
import { ChainKeys } from '@sodax/sdk';

async function ensureTrustline(
  tokenAddress: string,
  amount: bigint,
  walletAddress: string,
  stellarWalletProvider: IStellarWalletProvider,
): Promise<void> {
  const hasTrustline = await sodax.spoke.stellar.hasSufficientTrustline(
    tokenAddress,
    amount,
    walletAddress,
  );

  if (!hasTrustline) {
    const txHash = await sodax.spoke.stellar.requestTrustline({
      srcChainKey: ChainKeys.STELLAR_MAINNET,
      srcAddress: walletAddress,
      token: tokenAddress,
      amount: amount,
      raw: false,
      walletProvider: stellarWalletProvider,
    });

    // Wait for the trustline transaction to be confirmed before proceeding
    const receipt = await sodax.spoke.stellar.waitForTransactionReceipt({
      txHash,
      chainKey: ChainKeys.STELLAR_MAINNET,
    });

    if (!receipt.ok || receipt.value.status !== 'success') {
      throw new Error('Trustline transaction failed or timed out');
    }
  }
}
```

## Usage by Operation Type

### Swaps

- **Source Chain (Stellar)**: Trustlines are automatically handled by `sodax.swaps.isAllowanceValid` and `sodax.swaps.approve`.
- **Destination Chain (Stellar)**: Call `ensureTrustline` (above) for the destination token before calling `sodax.swaps.swap`.

### Money Market

- **Source Chain (Stellar)**: Trustlines are automatically handled by `sodax.moneyMarket.isAllowanceValid` and `sodax.moneyMarket.approve`.
- **Destination Chain (Stellar)**: Call `ensureTrustline` for the destination token before executing money market actions.

### Bridge

- **Source Chain (Stellar)**: Trustlines are automatically handled by `sodax.bridge.isAllowanceValid` and `sodax.bridge.approve`.
- **Destination Chain (Stellar)**: Call `ensureTrustline` for the destination token before calling `sodax.bridge.bridge`.

### Migration

- **Source Chain (Stellar)**: Trustlines are automatically handled by the migration service's allowance/approve methods.
- **Destination Chain (Stellar)**: Call `ensureTrustline` for the destination token before executing migration operations.

### Staking

- **Source Chain (Stellar)**: Trustlines are automatically handled by `sodax.staking.isAllowanceValid` and `sodax.staking.approve`.
- **Note**: Staking operations always flow from spoke chains (including Stellar) to the hub chain (Sonic), so Stellar is only ever the source chain for staking.

## Best Practices

1. **Always check trustlines before operations**: Use `hasSufficientTrustline` to verify trustline status before any operation where Stellar is the destination chain.

2. **Set appropriate trustline limits**: When establishing a trustline via `requestTrustline`, the limit is set to the Stellar maximum by default (`Operation.changeTrust` without an explicit limit). Ensure the wallet has sufficient XLM for the transaction fee.

3. **Wait for confirmation**: Always wait for the trustline transaction to be confirmed (use `waitForTransactionReceipt`) before proceeding with the main operation.

4. **Handle errors via `Result<T>`**: All public service methods return `Promise<Result<T>>`. Check `result.ok` before using `result.value`. On failure, inspect `result.error.message` and `result.error.cause`.

5. **Reuse trustlines**: Once established, trustlines persist on the Stellar ledger. You do not need to recreate them for subsequent operations with the same token.

## Common Patterns

### Complete Example: Swap with Stellar Destination

```typescript
import { ChainKeys } from '@sodax/sdk';
import type { IStellarWalletProvider } from '@sodax/wallet-sdk-core';

async function swapWithStellarDestination(
  swapParams: CreateIntentParams<typeof ChainKeys.SOLANA_MAINNET>,
  srcWalletProvider: ISolanaWalletProvider,
  stellarWalletProvider: IStellarWalletProvider,
): Promise<void> {
  const destinationTokenAddress = swapParams.outputToken;
  const minOutputAmount = swapParams.minOutputAmount;
  const dstAddress = swapParams.dstAddress; // Stellar wallet address

  // Step 1: Check and establish trustline if needed
  const hasTrustline = await sodax.spoke.stellar.hasSufficientTrustline(
    destinationTokenAddress,
    minOutputAmount,
    dstAddress,
  );

  if (!hasTrustline) {
    console.log('Establishing trustline...');
    const txHash = await sodax.spoke.stellar.requestTrustline({
      srcChainKey: ChainKeys.STELLAR_MAINNET,
      srcAddress: dstAddress,
      token: destinationTokenAddress,
      amount: minOutputAmount,
      raw: false,
      walletProvider: stellarWalletProvider,
    });

    const receipt = await sodax.spoke.stellar.waitForTransactionReceipt({
      txHash,
      chainKey: ChainKeys.STELLAR_MAINNET,
    });

    if (!receipt.ok || receipt.value.status !== 'success') {
      throw new Error('Trustline transaction failed');
    }

    console.log('Trustline established successfully');
  }

  // Step 2: Proceed with the swap
  const swapResult = await sodax.swaps.swap({
    params: swapParams,
    raw: false,
    walletProvider: srcWalletProvider,
  });

  if (swapResult.ok) {
    console.log('Swap completed:', swapResult.value.intentDeliveryInfo);
  } else {
    console.error('Swap failed:', swapResult.error);
  }
}
```

## Related Documentation

- [Swaps](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/SWAPS.md) - Cross-chain intent-based swaps
- [Money Market](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/MONEY_MARKET.md) - Cross-chain lending and borrowing
- [Bridge](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/BRIDGE.md) - Cross-chain token bridging
- [Migration](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/MIGRATION.md) - Token migration
- [Staking](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/STAKING.md) - SODA token staking
- [Architecture Reference](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/ARCHITECTURE_REFACTOR_SUMMARY.md) - Full v2 architecture reference
