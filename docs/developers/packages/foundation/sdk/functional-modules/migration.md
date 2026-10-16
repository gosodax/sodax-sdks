---
title: "Migration"
icon: truck
generatedFrom: packages/sdk/docs/MIGRATION.md
---

> **Error handling conventions:** This module returns `Result<T, SodaxError<NarrowCode>>` from every async public method. Discriminate on `error.code` (a closed reason-only union) and `error.feature === 'migration'`. See [Error Handling](#error-handling) below.

Migration part of the SDK provides abstractions to assist you with migrating tokens between ICON and the hub chain (Sonic). The service supports multiple migration types including ICX/wICX → SODA, bnUSD legacy → new bnUSD, BALN → SODA, and their reverse operations.

## Using SDK Config and Constants

SDK includes predefined configurations of supported chains, tokens and other relevant information for the client to consume.

```typescript
import { 
  ChainKeys,
  type HubChainKey,
  type SpokeChainKey,
} from "@sodax/sdk"

// Supported migration chains
const hubChainKey: HubChainKey = ChainKeys.SONIC_MAINNET;
const iconChainKey: SpokeChainKey = ChainKeys.ICON_MAINNET;

// Migration tokens
const migrationTokens = ['ICX', 'bnUSD', 'BALN'] as const;
```

Please refer to [SDK ChainKeys](https://github.com/icon-project/sodax-sdks/blob/main/packages/types/src/chains/chain-keys.ts) for more. For a direct mapping from old `*_CHAIN_ID` constants to `ChainKeys.*` see `packages/sdk/CHAIN_ID_MIGRATION.md`.

### Wallet Providers

All execution methods accept a `walletProvider` inside the action params object — no spoke provider classes need to be constructed by callers. The wallet provider type is chain-narrowed from the `srcChainKey` in the params.

```typescript
import { EvmWalletProvider, IconWalletProvider } from '@sodax/wallet-sdk-core';

// ICON wallet provider (for ICX / BALN / legacy bnUSD migrations originating on ICON)
const iconWalletProvider = new IconWalletProvider({ privateKey: '...', rpcUrl: '...' });

// Sonic wallet provider (for reverse ICX migration originating on Sonic)
const sonicWalletProvider = new EvmWalletProvider({ privateKey: '...', rpcUrl: '...' });
```

## Migration Types

The MigrationService supports multiple types of migrations:

1. **ICX/wICX → SODA**: Migrate ICX or wICX tokens from ICON to SODA tokens on the hub chain
2. **SODA → wICX**: Revert SODA tokens from the hub chain back to wICX tokens on ICON
3. **bnUSD Legacy ↔ New bnUSD**: Unified migration between legacy and new bnUSD tokens across supported chains
4. **BALN → SODA**: Migrate BALN tokens to SODA tokens on the hub chain

## Calling Convention

All exec methods on `MigrationService` follow the `SpokeExecActionParams` wrapper pattern. The wrapper carries the migration params, the wallet provider, and optional flags:

```typescript
// Signed execution (raw: false, walletProvider required)
const result = await sodax.migration.migrateIcxToSoda({
  params: { srcChainKey: ChainKeys.ICON_MAINNET, /* ... */ },
  walletProvider: iconWalletProvider,
  timeout: 30000,       // optional, ms; default 120000
  skipSimulation: false, // optional
});

// Raw transaction (raw: true, walletProvider forbidden)
const rawResult = await sodax.migration.createMigrateIcxToSodaIntent({
  params: { srcChainKey: ChainKeys.ICON_MAINNET, /* ... */ },
  raw: true,
});
```

TypeScript enforces the pairing: `walletProvider` when `raw: true` is a compile error; omitting it when `raw: false` is also a compile error.

## Common Operations

### Check Allowance

Before creating migration intents, you should check if the allowance is valid. For forward migrations (ICX/wICX, bnUSD from ICON, BALN), no allowance is required as these tokens do not require approval.

**Note**: For Stellar-based operations, the allowance system works differently:
- **Source Chain (Stellar)**: The standard `isAllowanceValid` method works as expected for EVM chains, but for Stellar as the source chain, this method checks and establishes trustlines instead.
- **Destination Chain (Stellar)**: When Stellar is specified as the destination chain, frontends/clients need to manually check trustlines using `StellarSpokeService.hasSufficientTrustline` before executing migration operations.

```typescript
const sodax = new Sodax();

// For forward ICX/BALN migration (no allowance required — returns true immediately for ICON source)
const migrationParams: IcxMigrateParams = {
  srcChainKey: ChainKeys.ICON_MAINNET,
  srcAddress: 'hx...',
  address: 'cx88fd7df7ddff82f7cc735c871dc519838cb235bb', // wICX address
  amount: BigInt(1000000000000000000), // 1 ICX (18 decimals)
  dstAddress: '0x1234567890123456789012345678901234567890', // Recipient address on hub chain
};

const isAllowed = await sodax.migration.isAllowanceValid(migrationParams, 'migrate');

if (!isAllowed.ok) {
  console.error('Failed to check allowance:', isAllowed.error);
} else {
  console.log('Allowance is valid:', isAllowed.value);
}

// For reverse ICX migration (SODA tokens require allowance check — source chain is Sonic)
const revertParams: IcxCreateRevertMigrationParams = {
  srcChainKey: ChainKeys.SONIC_MAINNET,
  srcAddress: '0xabc...', // Sonic address
  amount: BigInt(1000000000000000000), // 1 SODA token (18 decimals)
  dstAddress: 'hx1234567890123456789012345678901234567890', // ICON address to receive wICX
};

const isAllowedRevert = await sodax.migration.isAllowanceValid(revertParams, 'revert');

if (!isAllowedRevert.ok) {
  console.error('Failed to check allowance:', isAllowedRevert.error);
} else if (!isAllowedRevert.value) {
  console.log('Approval needed for SODA tokens');
} else {
  console.log('Allowance is valid');
}
```

### Approve Tokens

For reverse migrations, if the allowance check returns false, you need to approve the tokens before creating the revert migration intent.

**Some tokens take two transactions.** A few ERC-20s of the 2017 TetherToken lineage — Ethereum USDT
is the only one in the SODAX token list today — reject an allowance change from one non-zero value to
another, so `approve` sends `approve(0)` first and waits for it to be mined before the real approval.
The user signs twice; the returned value is still a single transaction hash, the **last** one's.
Detection simulates the approval rather than consulting a token list, so a token listed later behaves
the same way.

**Note**: For Stellar-based operations, the approval system works differently:
- **Source Chain (Stellar)**: The standard `approve` method works as expected for EVM chains, but for Stellar as the source chain, this method establishes trustlines instead.
- **Destination Chain (Stellar)**: When Stellar is specified as the destination chain, frontends/clients need to manually establish trustlines using `StellarSpokeService.requestTrustline` before executing migration operations.

```typescript
const sodax = new Sodax();

const revertParams: IcxCreateRevertMigrationParams = {
  srcChainKey: ChainKeys.SONIC_MAINNET,
  srcAddress: '0xabc...',
  amount: BigInt(1000000000000000000),
  dstAddress: 'hx1234567890123456789012345678901234567890',
};

// Approve SODA tokens for reverse migration
const approveResult = await sodax.migration.approve(
  {
    params: revertParams,
    walletProvider: sonicWalletProvider,
  },
  'revert',
);

if (approveResult.ok) {
  console.log('Approval transaction hash:', approveResult.value);
  // Wait for approval transaction to be mined
  const approveTxResult = await sonicWalletProvider.waitForTransactionReceipt(approveResult.value);
  console.log('Approval transaction confirmed:', approveTxResult);
} else {
  console.error('Failed to approve tokens:', approveResult.error);
}
```

### Stellar Trustline Requirements

For Stellar-based migration operations, you need to handle trustlines differently depending on whether Stellar is the source or destination chain. See [Stellar Trustline Requirements](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/STELLAR_TRUSTLINE.md#migration) for detailed information and code examples.

## ICX Migration (ICX/wICX → SODA)

### Migrate ICX to SODA

Migrate ICX or wICX tokens to SODA tokens on the hub chain.

```typescript
const sodax = new Sodax();

const migrationParams: IcxMigrateParams = {
  srcChainKey: ChainKeys.ICON_MAINNET,
  srcAddress: 'hx...', // ICON wallet address
  address: 'cx88fd7df7ddff82f7cc735c871dc519838cb235bb', // wICX address
  amount: BigInt(1000000000000000000), // 1 ICX (18 decimals)
  dstAddress: '0x1234567890123456789012345678901234567890', // Recipient address on hub chain
};

// Migrate ICX to SODA
const result = await sodax.migration.migrateIcxToSoda({
  params: migrationParams,
  walletProvider: iconWalletProvider,
  timeout: 30000, // Optional timeout in milliseconds (default: 120000)
});

if (result.ok) {
  const { srcChainTxHash, dstChainTxHash } = result.value;
  console.log('ICX migration successful!');
  console.log('Spoke transaction hash:', srcChainTxHash);
  console.log('Hub transaction hash:', dstChainTxHash);
} else {
  console.error('ICX migration failed:', result.error);
}
```

## Reverse ICX Migration (SODA → wICX)

### Revert SODA to ICX

Revert SODA tokens back to wICX tokens on ICON. A SODA approval from the caller to their hub wallet must be set before calling this method (use `isAllowanceValid` to check and `approve` to set it).

```typescript
const sodax = new Sodax();

const revertParams: IcxCreateRevertMigrationParams = {
  srcChainKey: ChainKeys.SONIC_MAINNET,
  srcAddress: '0xabc...', // Sonic wallet address
  amount: BigInt(1000000000000000000), // 1 SODA token (18 decimals)
  dstAddress: 'hx1234567890123456789012345678901234567890', // ICON address to receive wICX
};

// Revert SODA to ICX
const result = await sodax.migration.revertMigrateSodaToIcx({
  params: revertParams,
  walletProvider: sonicWalletProvider,
  timeout: 30000, // Optional timeout in milliseconds (default: 120000)
});

if (result.ok) {
  const { srcChainTxHash, dstChainTxHash } = result.value;
  console.log('SODA to ICX revert successful!');
  console.log('Sonic transaction hash:', srcChainTxHash);
  console.log('Hub packet receipt:', dstChainTxHash);
} else {
  console.error('SODA to ICX revert failed:', result.error);
}
```

## bnUSD Migration (Legacy ↔ New bnUSD)

The bnUSD migration now uses a unified API that handles both forward (legacy → new) and reverse (new → legacy) migrations. The system automatically determines the migration direction based on the token addresses provided.

### bnUSD Constants and Helper Functions

The SDK provides several constants and helper functions to work with legacy and new bnUSD tokens across different chains:

```typescript
import {
  bnUSDLegacySpokeChainIds,
  newbnUSDSpokeChainIds,
  bnUSDLegacyTokens,
  isLegacybnUSDChainId,
  isNewbnUSDChainId,
  isLegacybnUSDToken,
  isNewbnUSDToken,
  getAllLegacybnUSDTokens,
} from '@sodax/sdk';

// Get all chains that support legacy bnUSD
console.log('Legacy bnUSD chains:', bnUSDLegacySpokeChainIds);
// Output: ['0x1.icon', 'sui', 'stellar']

// Get all chains that support new bnUSD
console.log('New bnUSD chains:', newbnUSDSpokeChainIds);
// Output: ['sonic', 'arbitrum', 'base', 'polygon', ...] (all chains except Icon)

// Check if a chain supports legacy bnUSD
const isLegacyChain = isLegacybnUSDChainId(ChainKeys.ICON_MAINNET); // true
const isNewChain = isNewbnUSDChainId(ChainKeys.SONIC_MAINNET); // true

// Check if a token address is legacy bnUSD
const isLegacyToken = isLegacybnUSDToken('cx88fd7df7ddff82f7cc735c871dc519838cb235bb'); // true
const isNewToken = isNewbnUSDToken('0xE801CA34E19aBCbFeA12025378D19c4FBE250131'); // true
```

### Migrate Legacy bnUSD to New bnUSD

Migrate legacy bnUSD tokens to new bnUSD tokens on any spoke chain (besides Icon — which has only legacy bnUSD).

**Note**: When migrating to Stellar as the destination chain, ensure you have established the necessary trustlines using `StellarSpokeService.hasSufficientTrustline` and `StellarSpokeService.requestTrustline` before executing the migration.

```typescript
const sodax = new Sodax();

const migrationParams: UnifiedBnUSDMigrateParams<typeof ChainKeys.ICON_MAINNET> = {
  srcChainKey: ChainKeys.ICON_MAINNET,
  srcAddress: 'hx...', // ICON wallet address
  dstChainKey: ChainKeys.SONIC_MAINNET,
  srcbnUSD: 'cx88fd7df7ddff82f7cc735c871dc519838cb235bb', // Legacy bnUSD address on ICON
  dstbnUSD: '0xE801CA34E19aBCbFeA12025378D19c4FBE250131', // New bnUSD address on Sonic
  amount: BigInt(1000000000000000000), // 1 bnUSD (18 decimals)
  dstAddress: '0x1234567890123456789012345678901234567890', // Recipient address on Sonic
};

// Migrate legacy bnUSD to new bnUSD
const result = await sodax.migration.migratebnUSD({
  params: migrationParams,
  walletProvider: iconWalletProvider,
  timeout: 30000, // Optional timeout in milliseconds (default: 120000)
});

if (result.ok) {
  const { srcChainTxHash, dstChainTxHash } = result.value;
  console.log('bnUSD migration successful!');
  console.log('Spoke transaction hash:', srcChainTxHash);
  console.log('Hub transaction hash:', dstChainTxHash);
} else {
  console.error('bnUSD migration failed:', result.error);
}
```

### Reverse Migrate New bnUSD to Legacy bnUSD

Revert new bnUSD tokens back to legacy bnUSD tokens. Legacy bnUSD exists on Icon, Sui or Stellar chains.

**Note**: When migrating to Stellar as the destination chain, ensure you have established the necessary trustlines using `StellarSpokeService.hasSufficientTrustline` and `StellarSpokeService.requestTrustline` before executing the migration.

```typescript
const sodax = new Sodax();

const revertParams: UnifiedBnUSDMigrateParams<typeof ChainKeys.SONIC_MAINNET> = {
  srcChainKey: ChainKeys.SONIC_MAINNET,
  srcAddress: '0xabc...', // Sonic wallet address
  dstChainKey: ChainKeys.ICON_MAINNET,
  srcbnUSD: '0xE801CA34E19aBCbFeA12025378D19c4FBE250131', // New bnUSD address on Sonic
  dstbnUSD: 'cx88fd7df7ddff82f7cc735c871dc519838cb235bb', // Legacy bnUSD address on ICON
  amount: BigInt(1000000000000000000), // 1 new bnUSD (18 decimals)
  dstAddress: 'hx1234567890123456789012345678901234567890', // Recipient address on ICON
};

// Check allowance for reverse migration
const isAllowed = await sodax.migration.isAllowanceValid(revertParams, 'revert');

if (!isAllowed.ok) {
  console.error('Failed to check allowance:', isAllowed.error);
} else if (!isAllowed.value) {
  // Approve if needed
  const approveResult = await sodax.migration.approve(
    {
      params: revertParams,
      walletProvider: sonicWalletProvider,
    },
    'revert',
  );

  if (approveResult.ok) {
    console.log('Approval transaction hash:', approveResult.value);
    // Wait for approval transaction to be mined
    await sonicWalletProvider.waitForTransactionReceipt(approveResult.value);
  } else {
    console.error('Failed to approve tokens:', approveResult.error);
    return;
  }
}

// Reverse migrate new bnUSD to legacy bnUSD
const result = await sodax.migration.migratebnUSD({
  params: revertParams,
  walletProvider: sonicWalletProvider,
  timeout: 30000, // Optional timeout in milliseconds (default: 120000)
});

if (result.ok) {
  const { srcChainTxHash, dstChainTxHash } = result.value;
  console.log('bnUSD reverse migration successful!');
  console.log('Sonic transaction hash:', srcChainTxHash);
  console.log('Hub packet receipt:', dstChainTxHash);
} else {
  console.error('bnUSD reverse migration failed:', result.error);
}
```

## BALN Migration (BALN → SODA)

### Migrate BALN to SODA

Migrate BALN tokens to SODA tokens on the hub chain. Use `LockupPeriod` enum values for the `lockupPeriod` field — longer lock-ups yield higher SODA multipliers (0.5×–1.5×).

```typescript
import { LockupPeriod } from '@sodax/sdk';

const sodax = new Sodax();

const migrationParams: BalnMigrateParams = {
  srcChainKey: ChainKeys.ICON_MAINNET,
  srcAddress: 'hx...', // ICON wallet address
  amount: BigInt(1000000000000000000), // 1 BALN (18 decimals)
  lockupPeriod: LockupPeriod.SIX_MONTHS, // 0.75x multiplier; use LockupPeriod enum
  dstAddress: '0x1234567890123456789012345678901234567890', // Recipient address on hub chain
  stake: true, // Whether to immediately stake the received SODA tokens
};

// Migrate BALN to SODA
const result = await sodax.migration.migrateBaln({
  params: migrationParams,
  walletProvider: iconWalletProvider,
  timeout: 30000, // Optional timeout in milliseconds (default: 120000)
});

if (result.ok) {
  const { srcChainTxHash, dstChainTxHash } = result.value;
  console.log('BALN migration successful!');
  console.log('Spoke transaction hash:', srcChainTxHash);
  console.log('Hub transaction hash:', dstChainTxHash);
} else {
  console.error('BALN migration failed:', result.error);
}
```

### BALN Lock Periods and Multipliers

| Lock Period | Enum Value | Multiplier |
|---|---|---|
| No lock | `LockupPeriod.NO_LOCKUP` | 0.5× |
| 6 months | `LockupPeriod.SIX_MONTHS` | 0.75× |
| 12 months | `LockupPeriod.TWELVE_MONTHS` | 1.0× |
| 18 months | `LockupPeriod.EIGHTEEN_MONTHS` | 1.25× |
| 24 months | `LockupPeriod.TWENTY_FOUR_MONTHS` | 1.5× |

### BALN Lock Management

After migrating BALN, the resulting SODA (or xSoda) is held in locks managed by `sodax.migration.balnSwapService`. These methods act directly on the hub chain:

```typescript
const { balnSwapService } = sodax.migration;

const lockId = 1n;

// Claim unlocked SODA tokens from a completed lock
await balnSwapService.claim(userAddress, { lockId }, { walletProvider: sonicWalletProvider });

// Initiate unstaking of xSoda tokens from a lock
await balnSwapService.unstake(userAddress, { lockId }, { walletProvider: sonicWalletProvider });

// Claim tokens after the unstaking waiting period expires
await balnSwapService.claimUnstaked(userAddress, { lockId }, { walletProvider: sonicWalletProvider });

// Cancel a pending unstake request
await balnSwapService.cancelUnstake(userAddress, { lockId }, { walletProvider: sonicWalletProvider });

// Stake SODA tokens held in a lock into the xSoda vault
await balnSwapService.stake(userAddress, { lockId }, { walletProvider: sonicWalletProvider });

// Read all locks for a user
const locks = await balnSwapService.getDetailedUserLocks(publicClient, userAddress);
```

## Complete Examples

### ICX Migration Example

```typescript
import { Sodax, ChainKeys, type IcxMigrateParams } from '@sodax/sdk';
import { IconWalletProvider } from '@sodax/wallet-sdk-core';
import type { Address } from 'viem';

const sodax = new Sodax();
const iconWalletProvider = new IconWalletProvider({ privateKey: '...', rpcUrl: '...' });

async function migrateIcx(amount: bigint, recipient: Address): Promise<void> {
  const params: IcxMigrateParams = {
    srcChainKey: ChainKeys.ICON_MAINNET,
    srcAddress: await iconWalletProvider.getWalletAddress(),
    address: '0x0000000000000000000000000000000000000000', // wICX or native ICX token address
    amount,
    dstAddress: recipient,
  };

  const result = await sodax.migration.migrateIcxToSoda({
    params,
    walletProvider: iconWalletProvider,
  });

  if (result.ok) {
    const { srcChainTxHash, dstChainTxHash } = result.value;
    console.log('[migrateIcx] Migration successful!');
    console.log('[migrateIcx] Spoke transaction hash:', srcChainTxHash);
    console.log('[migrateIcx] Hub transaction hash:', dstChainTxHash);
  } else {
    console.error('[migrateIcx] Migration failed:', result.error);
  }
}

// Usage
await migrateIcx(BigInt(1000000000000000000), '0x1234567890123456789012345678901234567890');
```

### Reverse ICX Migration Example

```typescript
import { Sodax, ChainKeys, type IcxCreateRevertMigrationParams } from '@sodax/sdk';
import { EvmWalletProvider } from '@sodax/wallet-sdk-core';
import type { IconEoaAddress } from '@sodax/sdk';

const sodax = new Sodax();
const sonicWalletProvider = new EvmWalletProvider({ privateKey: '...', rpcUrl: '...' });

async function reverseMigrateIcx(amount: bigint, to: IconEoaAddress): Promise<void> {
  const srcAddress = await sonicWalletProvider.getWalletAddress();

  const params: IcxCreateRevertMigrationParams = {
    srcChainKey: ChainKeys.SONIC_MAINNET,
    srcAddress,
    amount,
    dstAddress: to,
  };

  // Check allowance
  const isAllowed = await sodax.migration.isAllowanceValid(params, 'revert');

  if (!isAllowed.ok) {
    console.error('[reverseMigrateIcx] Allowance check failed:', isAllowed.error);
    return;
  }

  if (!isAllowed.value) {
    // Approve if needed
    const approveResult = await sodax.migration.approve(
      { params, walletProvider: sonicWalletProvider },
      'revert',
    );
    if (approveResult.ok) {
      console.log('[reverseMigrateIcx] Approval hash:', approveResult.value);
      await sonicWalletProvider.waitForTransactionReceipt(approveResult.value);
    } else {
      console.error('[reverseMigrateIcx] Approval failed:', approveResult.error);
      return;
    }
  }

  // Create and submit revert migration intent
  const result = await sodax.migration.revertMigrateSodaToIcx({
    params,
    walletProvider: sonicWalletProvider,
  });

  if (result.ok) {
    const { srcChainTxHash, dstChainTxHash } = result.value;
    console.log('[reverseMigrateIcx] Revert migration successful!');
    console.log('[reverseMigrateIcx] Sonic transaction hash:', srcChainTxHash);
    console.log('[reverseMigrateIcx] Hub packet receipt:', dstChainTxHash);
  } else {
    console.error('[reverseMigrateIcx] Revert migration failed:', result.error);
  }
}

// Usage
await reverseMigrateIcx(BigInt(1000000000000000000), 'hx1234567890123456789012345678901234567890');
```

### bnUSD Migration Example

```typescript
import { Sodax, ChainKeys, type UnifiedBnUSDMigrateParams, type SpokeChainKey } from '@sodax/sdk';
import { IconWalletProvider } from '@sodax/wallet-sdk-core';
import type { Address } from 'viem';

const sodax = new Sodax();
const iconWalletProvider = new IconWalletProvider({ privateKey: '...', rpcUrl: '...' });

async function migrateBnUSD(
  amount: bigint,
  recipient: Address,
  legacybnUSD: string,
  newbnUSD: string,
  dstChainKey: SpokeChainKey,
): Promise<void> {
  const params: UnifiedBnUSDMigrateParams<typeof ChainKeys.ICON_MAINNET> = {
    srcChainKey: ChainKeys.ICON_MAINNET,
    srcAddress: await iconWalletProvider.getWalletAddress(),
    dstChainKey,
    srcbnUSD: legacybnUSD,
    dstbnUSD: newbnUSD,
    amount,
    dstAddress: recipient,
  };

  const result = await sodax.migration.migratebnUSD({
    params,
    walletProvider: iconWalletProvider,
  });

  if (result.ok) {
    const { srcChainTxHash, dstChainTxHash } = result.value;
    console.log('[migrateBnUSD] Migration successful!');
    console.log('[migrateBnUSD] Spoke transaction hash:', srcChainTxHash);
    console.log('[migrateBnUSD] Hub transaction hash:', dstChainTxHash);
  } else {
    console.error('[migrateBnUSD] Migration failed:', result.error);
  }
}

// Usage — forward migration (legacy to new)
await migrateBnUSD(
  BigInt(1000000000000000000),
  '0x1234567890123456789012345678901234567890',
  'cx88fd7df7ddff82f7cc735c871dc519838cb235bb', // Legacy bnUSD on ICON
  '0xE801CA34E19aBCbFeA12025378D19c4FBE250131', // New bnUSD on Sonic
  ChainKeys.SONIC_MAINNET,
);
```

### BALN Migration Example

```typescript
import { Sodax, ChainKeys, LockupPeriod, type BalnMigrateParams } from '@sodax/sdk';
import { IconWalletProvider } from '@sodax/wallet-sdk-core';
import type { Address } from 'viem';

const sodax = new Sodax();
const iconWalletProvider = new IconWalletProvider({ privateKey: '...', rpcUrl: '...' });

async function migrateBaln(amount: bigint, recipient: Address): Promise<void> {
  const params: BalnMigrateParams = {
    srcChainKey: ChainKeys.ICON_MAINNET,
    srcAddress: await iconWalletProvider.getWalletAddress(),
    amount,
    lockupPeriod: LockupPeriod.SIX_MONTHS, // 0.75x multiplier
    dstAddress: recipient,
    stake: true,
  };

  const result = await sodax.migration.migrateBaln({
    params,
    walletProvider: iconWalletProvider,
  });

  if (result.ok) {
    const { srcChainTxHash, dstChainTxHash } = result.value;
    console.log('[migrateBaln] Migration successful!');
    console.log('[migrateBaln] Spoke transaction hash:', srcChainTxHash);
    console.log('[migrateBaln] Hub transaction hash:', dstChainTxHash);
  } else {
    console.error('[migrateBaln] Migration failed:', result.error);
  }
}

// Usage
await migrateBaln(BigInt(1000000000000000000), '0x1234567890123456789012345678901234567890');
```

## Error Handling

All async public methods on `MigrationService` (and `IcxMigrationService.getAvailableAmount`) return `Promise<Result<T, SodaxError<NarrowCode>>>` where `NarrowCode` is a narrow per-method union of `MigrationErrorCode`. Discriminate on `error.code`, never on `error.message`. The original lower-level failure (a viem revert, a fetch error, a relay timeout) is preserved on `error.cause`; structured metadata (chain, action, direction, phase, relayCode) is on `error.context`.

```typescript
import { isMigrateOrchestrationError, type MigrateOrchestrationError } from '@sodax/sdk';

const result = await sodax.migration.migrateIcxToSoda({ /* params */ });
if (!result.ok) {
  // result.error is typed as `MigrateOrchestrationError = SodaxError<MigrateOrchestrationErrorCode>`
  switch (result.error.code) {
    case 'VALIDATION_FAILED':       // precondition tripped (see context.field)
    case 'INTENT_CREATION_FAILED':  // spoke-side intent creation failed
    case 'TX_VERIFICATION_FAILED':           // spoke tx not verifiable on-chain (only migratebnUSD calls verifyTxHash)
    case 'TX_SUBMIT_FAILED':        // relay submit failed
    case 'RELAY_TIMEOUT':           // relay packet did not arrive within timeout
    case 'RELAY_FAILED':            // relay polling failure / unknown relay error
    case 'EXECUTION_FAILED':                  // generic forward-orchestrator catch-all (see error.cause)
    case 'UNKNOWN':
      handleMigrationError(result.error);
      break;
  }
}
```

### Per-method error code unions

| Method | Codes |
|---|---|
| `migratebnUSD` / `migrateIcxToSoda` / `migrateBaln` (forward orchestrators) | `USER_REJECTED`, `VALIDATION_FAILED`, `INTENT_CREATION_FAILED`, `TX_VERIFICATION_FAILED`, `TX_SUBMIT_FAILED`, `RELAY_TIMEOUT`, `RELAY_FAILED`, `EXECUTION_FAILED`, `UNKNOWN` |
| `revertMigrateSodaToIcx` (reverse orchestrator) | `USER_REJECTED`, `VALIDATION_FAILED`, `INTENT_CREATION_FAILED`, `TX_SUBMIT_FAILED`, `RELAY_TIMEOUT`, `RELAY_FAILED`, `EXECUTION_FAILED`, `UNKNOWN` |
| `createMigratebnUSDIntent` / `createMigrateIcxToSodaIntent` / `createMigrateBalnIntent` (forward intent creators) | `USER_REJECTED`, `VALIDATION_FAILED`, `INTENT_CREATION_FAILED`, `UNKNOWN` |
| `createRevertSodaToIcxMigrationIntent` (reverse intent creator) | `USER_REJECTED`, `VALIDATION_FAILED`, `INTENT_CREATION_FAILED`, `UNKNOWN` |
| `approve` | `USER_REJECTED`, `VALIDATION_FAILED`, `APPROVE_FAILED`, `UNKNOWN` |
| `isAllowanceValid` | `VALIDATION_FAILED`, `ALLOWANCE_CHECK_FAILED`, `UNKNOWN` |
| `IcxMigrationService.getAvailableAmount` | `VALIDATION_FAILED`, `LOOKUP_FAILED`, `UNKNOWN` |

Note: `TX_VERIFICATION_FAILED` only appears in the forward-orchestrator union because `migratebnUSD` is the only orchestrator that calls `spoke.verifyTxHash`. The other forward orchestrators technically can't produce it, but the shared narrow union keeps callers working symmetrically across the three "migrate" methods.

### Structured `context`

Every migration error carries an `error.context` payload. Fields vary by code:

| Field | Set on | Notes |
|---|---|---|
| `srcChainKey` | all orchestrator + intent + approve + allowance codes | low-cardinality — suitable as a logger / Sentry tag |
| `dstChainKey` | `migratebnUSD` orchestrator + intent codes | bnUSD-only (the other orchestrators have a fixed destination) |
| `action` | all orchestrator + intent codes | one of `'migratebnUSD' \| 'migrateIcxToSoda' \| 'revertMigrateSodaToIcx' \| 'migrateBaln'` |
| `direction` | only on `migratebnUSD` errors | `'forward'` (legacy → new) or `'reverse'` (new → legacy). The error code stays `EXECUTION_FAILED` regardless — this is purely a forensics hint |
| `phase` | most codes | `'validate' \| 'intentCreation' \| 'verify' \| 'submit' \| 'relay' \| 'destinationExecution' \| 'approve' \| 'allowanceCheck' \| 'lookup'`. `'destinationExecution'` is set on `RELAY_TIMEOUT / RELAY_FAILED / TX_SUBMIT_FAILED` errors that originate from `migratebnUSD`'s secondary `waitUntilIntentExecuted` watcher (vs. `'relay'` for the primary `relayTxAndWaitPacket` call) |
| `relayCode` | `RELAY_TIMEOUT` / `TX_SUBMIT_FAILED` / `RELAY_FAILED` | mirrors the relay-layer `RELAY_ERROR_CODES` contract; carries `'RELAY_POLLING_FAILED'` so polling outage is distinguishable from generic failure |
| `field` / `reason` | `VALIDATION_FAILED` | which precondition tripped |

### Type guards

Per-method type guards are runtime-checked and compile-checked in lockstep with the union types. Use them in `catch` blocks to short-circuit when a foreign code escapes:

```typescript
import { isMigrateOrchestrationError, isMigrationError } from '@sodax/sdk';

try {
  // ... call sodax.migration.migratebnUSD ...
} catch (e) {
  if (isMigrateOrchestrationError(e)) console.error('typed forward-migration error:', e.code, e.context);
  else if (isMigrationError(e)) console.error('migration error from another method:', e.code);
  else throw e; // not a migration error — bubble up
}
```

Available guards: `isMigrationError` (broad — any migration error), `isMigrateOrchestrationError` (forward `migrateIcxToSoda` / `migratebnUSD` / `migrateBaln`), `isRevertMigrationOrchestrationError` (`revertMigrateSodaToIcx`), `isMigrationCreateIntentError` (shared by all 4 `create*Intent` methods), `isMigrationApproveError`, `isMigrationAllowanceCheckError`, `isMigrationLookupError`. Per-operation discrimination across the orchestrators is via `error.context.action` (one of `'migrateIcxToSoda' | 'migratebnUSD' | 'migrateBaln' | 'revertMigrateSodaToIcx'`).

### Validation invariant

Precondition failures throw a typed `VALIDATION_FAILED` from inside the public method's `try/catch`, surfacing as a typed `Result.error` rather than a generic prose `Error`. Consumers discriminate validation failures the same way as any other code.

```typescript
import { migrationInvariant } from '@sodax/sdk';

migrationInvariant(amount > 0n, 'Amount must be greater than 0', { field: 'amount' });
```

### Migration from the pre-v2 taxonomy

The published v1 4-code shape (`EXECUTION_FAILED`, `CREATE_MIGRATION_INTENT_FAILED`, `REVERT_MIGRATION_FAILED`, `CREATE_REVERT_MIGRATION_INTENT_FAILED`) is restored here with module-prefixed names and cause-preservation. Sub-modules (ICX, bnUSD, BALN) remain undifferentiated at the code level — fine-grained partitioning is delegated to `context.action`, faithful to v1 which also did not distinguish them.

| v1 code | v2 code | Notes |
|---|---|---|
| `EXECUTION_FAILED` | `EXECUTION_FAILED` | Forward-orchestrator catch-all (`migratebnUSD`/`migrateIcxToSoda`/`migrateBaln`). Use `context.action` to discriminate. |
| `CREATE_MIGRATION_INTENT_FAILED` | `INTENT_CREATION_FAILED` | Forward intent-creation phase. |
| `REVERT_MIGRATION_FAILED` | `EXECUTION_FAILED` | Reverse-orchestrator catch-all (`revertMigrateSodaToIcx`). |
| `CREATE_REVERT_MIGRATION_INTENT_FAILED` | `INTENT_CREATION_FAILED` | Reverse intent-creation phase. |
| (none) | `VALIDATION_FAILED` | New: typed precondition failures (replaces prose `Error` throws from `invariant`). |
| (none) | `TX_VERIFICATION_FAILED` | New: spoke tx verification phase tag (only set by `migratebnUSD`, the only orchestrator that calls `verifyTxHash`). |
| (none) | `TX_SUBMIT_FAILED` / `RELAY_TIMEOUT` / `RELAY_FAILED` | New: typed relay-phase codes mapped from the shared `RELAY_ERROR_CODES` contract. |
| (none) | `APPROVE_FAILED` / `ALLOWANCE_CHECK_FAILED` / `LOOKUP_FAILED` | New: typed phase codes for `approve` / `isAllowanceValid` / `IcxMigrationService.getAvailableAmount`. |
| (none) | `UNKNOWN` | Reserved fallback for never-classified errors. |

## Configuration

The MigrationService is wired internally by the `Sodax` facade. Custom relay endpoints are passed via the `Sodax` constructor config:

```typescript
import { Sodax } from '@sodax/sdk';

const sodax = new Sodax({
  relay: {
    relayerApiEndpoint: 'https://custom-relay-api.example.com',
  },
});

await sodax.config.initialize(); // optional: fetch dynamic chain config from backend
```

Default configuration:
- `relayerApiEndpoint`: `https://relay.soniclabs.com`
- `timeout`: 120000 ms (120 seconds) — overridable per call via the `timeout` field in action params
