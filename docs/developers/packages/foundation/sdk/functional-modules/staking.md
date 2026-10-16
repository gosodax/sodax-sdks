---
title: "Staking"
icon: piggy-bank
generatedFrom: packages/sdk/docs/STAKING.md
---

> **Error handling conventions:** This module returns `Result<T, SodaxError<NarrowCode>>` from every async public method. Discriminate on `error.code` (a closed reason-only union) and `error.feature === 'staking'`. See [Error Handling](#error-handling) below.

The `StakingService` class, reachable through `sodax.staking`, provides functionality for staking SODA tokens,
unstaking, claiming rewards, and retrieving staking information. It supports operations across all spoke chains
with automatic hub chain integration.

## Setup

```typescript
import { Sodax, ChainKeys } from '@sodax/sdk';

const sodax = new Sodax();
const initResult = await sodax.config.initialize();
if (!initResult.ok) {
  console.error('SDK initialization failed:', initResult.error.message);
}
```

## Calling Convention

All mutating methods accept a single `SpokeExecActionParams` object with the following shape:

```typescript
{
  params: <StakingParams>,   // action-specific params (includes srcChainKey)
  walletProvider: ...,       // required when raw: false; chain-narrowed by srcChainKey
  raw?: boolean,             // false (default) → sign & broadcast; true → return raw tx payload
  skipSimulation?: boolean,  // optional: skip preflight simulation
  timeout?: number,          // optional: relay timeout in milliseconds (default: 120 000)
}
```

**`raw: true` / `raw: false` rules (enforced at compile time):**
- `{ raw: true }` — `walletProvider` is **forbidden**; returns an unsigned transaction payload.
- `{ raw: false, walletProvider }` — `walletProvider` is **required** and chain-narrowed from `srcChainKey`.

## Methods

### isAllowanceValid

Checks whether the current token allowance is sufficient for a `stake`, `unstake`, or `instantUnstake` action.

- **EVM spoke chains**: checks the asset-manager allowance.
- **Hub chain (Sonic)**: checks the user's hub wallet allowance.
- **Stellar**: delegates to the Stellar spoke allowance check (trustlines).
- **Other non-EVM chains**: no on-chain allowance required; always resolves `true`.

**Signature:**
```typescript
async isAllowanceValid<K extends SpokeChainKey, Raw extends boolean>(
  _params: StakingParamsUnion<K, Raw>,
): Promise<Result<boolean>>
```

**Example:**
```typescript
const result = await sodax.staking.isAllowanceValid({
  params: {
    srcChainKey: ChainKeys.BASE_MAINNET,
    srcAddress: '0x1234567890abcdef...',
    amount: 1000000000000000000n, // 1 SODA
    minReceive: 950000000000000000n,
    action: 'stake',
  },
  walletProvider: evmWalletProvider,
});

if (result.ok && result.value) {
  console.log('Allowance is sufficient');
} else if (result.ok) {
  console.log('Need to approve tokens first');
} else {
  console.error('Allowance check failed:', result.error.message);
}
```

### approve

Submits a token-spending approval on the source chain for a `stake`, `unstake`, or `instantUnstake` action.

**Some tokens take two transactions.** A few ERC-20s of the 2017 TetherToken lineage — Ethereum USDT
is the only one in the SODAX token list today — reject an allowance change from one non-zero value to
another, so `approve` sends `approve(0)` first and waits for it to be mined before the real approval.
The user signs twice; the returned value is still a single transaction hash, the **last** one's.
Detection simulates the approval rather than consulting a token list, so a token listed later behaves
the same way.

Supported chains: EVM spoke chains, hub chain (Sonic), and Stellar. All other chains return an error.

The spender address is resolved automatically:
- Hub chain: the user's hub wallet (derived from spoke address).
- EVM spoke chain: the chain's asset-manager contract.

Must be called before executing the corresponding action whenever `isAllowanceValid` returns `false`.

**Signature:**
```typescript
async approve<K extends SpokeChainKey, Raw extends boolean>(
  _params: StakingParamsUnion<K, Raw>,
): Promise<Result<TxReturnType<K, Raw>>>
```

**Example (signed):**
```typescript
const result = await sodax.staking.approve({
  params: {
    srcChainKey: ChainKeys.BASE_MAINNET,
    srcAddress: '0x1234567890abcdef...',
    amount: 1000000000000000000n,
    minReceive: 950000000000000000n,
    action: 'stake',
  },
  walletProvider: evmWalletProvider,
});

if (result.ok) {
  console.log('Approval tx hash:', result.value);
} else {
  console.error('Approval failed:', result.error.message);
}
```

**Example (raw tx):**
```typescript
const result = await sodax.staking.approve({
  params: {
    srcChainKey: ChainKeys.BASE_MAINNET,
    srcAddress: '0x1234567890abcdef...',
    amount: 1000000000000000000n,
    minReceive: 950000000000000000n,
    action: 'stake',
  },
  raw: true,
  // walletProvider must not be passed when raw: true
});
```

### Stellar Trustline Requirements

For Stellar-based staking operations, `isAllowanceValid` and `approve` handle trustlines automatically
when Stellar is the source chain. See
[Stellar Trustline Requirements](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/STELLAR_TRUSTLINE.md#staking)
for details.

Staking operations always flow from spoke chains (including Stellar) to the hub chain (Sonic), so Stellar
is only used as a source chain.

### stake

Stakes SODA tokens from a spoke chain, relays the intent to the hub, and waits for hub confirmation.

Internally calls `createStakeIntent` to submit on the spoke, then relays the cross-chain packet and waits
for the hub transaction to land. For hub-chain callers (`srcChainKey: ChainKeys.SONIC_MAINNET`) the spoke
and hub hashes are identical.

**Prerequisite:** call `isAllowanceValid` + `approve` before staking on EVM chains.

**Signature:**
```typescript
async stake<K extends SpokeChainKey>(
  _params: StakeAction<K, false>,
): Promise<Result<TxHashPair>>
```

**Example:**
```typescript
const result = await sodax.staking.stake({
  params: {
    srcChainKey: ChainKeys.BASE_MAINNET,
    srcAddress: '0x1234567890abcdef...',
    amount: 1000000000000000000n, // 1 SODA
    minReceive: 950000000000000000n, // 0.95 xSODA minimum
    action: 'stake',
  },
  walletProvider: evmWalletProvider,
  timeout: 30000,
});

if (result.ok) {
  const { srcChainTxHash, dstChainTxHash } = result.value;
  console.log('Stake successful:', { srcChainTxHash, dstChainTxHash });
} else {
  console.error('Stake failed:', result.error.message);
}
```

### createStakeIntent

Submits the stake transaction on the spoke chain **without** relaying to the hub.

Returns `IntentTxResult` containing the spoke tx result and the `relayData` (hub wallet address + encoded
payload) needed for a subsequent manual relay step. Use `stake` for the full end-to-end flow.

**Signature:**
```typescript
async createStakeIntent<K extends SpokeChainKey, Raw extends boolean>(
  _params: StakeAction<K, Raw>,
): Promise<Result<IntentTxResult<K, Raw>>>
```

**Example:**
```typescript
const result = await sodax.staking.createStakeIntent({
  params: {
    srcChainKey: ChainKeys.BASE_MAINNET,
    srcAddress: '0x1234567890abcdef...',
    amount: 1000000000000000000n,
    minReceive: 950000000000000000n,
    action: 'stake',
  },
  walletProvider: evmWalletProvider,
});

if (result.ok) {
  console.log('Spoke tx:', result.value.tx);
  console.log('Relay data:', result.value.relayData);
}
```

**Full manual flow:**
1. `isAllowanceValid` → check allowance
2. `approve` → approve if needed
3. `createStakeIntent` → spoke tx only
4. `stake` → full relay + hub confirmation (or relay manually using `relayData`)

### unstake

Initiates an unstake request for xSoda shares, relays the intent to the hub, and waits for confirmation.

Unstaking begins a waiting period. The user receives SODA only after calling `claim` once the period
elapses. Early claims incur a linear penalty (see `getStakingConfig`). For immediate redemption without a
waiting period, use `instantUnstake` instead.

**Prerequisite:** call `isAllowanceValid` + `approve` before unstaking on EVM chains.

**Signature:**
```typescript
async unstake<K extends SpokeChainKey>(
  _params: UnstakeAction<K, false>,
): Promise<Result<TxHashPair>>
```

**Example:**
```typescript
const result = await sodax.staking.unstake({
  params: {
    srcChainKey: ChainKeys.BASE_MAINNET,
    srcAddress: '0x1234567890abcdef...',
    amount: 1000000000000000000n, // 1 xSODA
    action: 'unstake',
  },
  walletProvider: evmWalletProvider,
  timeout: 30000,
});

if (result.ok) {
  const { srcChainTxHash, dstChainTxHash } = result.value;
  console.log('Unstake successful:', { srcChainTxHash, dstChainTxHash });
} else {
  console.error('Unstake failed:', result.error.message);
}
```

### createUnstakeIntent

Submits the unstake transaction on the spoke chain **without** relaying to the hub.

**Signature:**
```typescript
async createUnstakeIntent<K extends SpokeChainKey, Raw extends boolean>(
  _params: UnstakeAction<K, Raw>,
): Promise<Result<IntentTxResult<K, Raw>>>
```

**Example:**
```typescript
const result = await sodax.staking.createUnstakeIntent({
  params: {
    srcChainKey: ChainKeys.BASE_MAINNET,
    srcAddress: '0x1234567890abcdef...',
    amount: 1000000000000000000n,
    action: 'unstake',
  },
  walletProvider: evmWalletProvider,
});

if (result.ok) {
  console.log('Spoke tx:', result.value.tx);
  console.log('Relay data:', result.value.relayData);
}
```

### instantUnstake

Instantly redeems xSoda shares for SODA without a waiting period, relays the intent to the hub, and waits
for confirmation. Routes through the StakingRouter, which provides immediate liquidity at the cost of
slippage. Use `getInstantUnstakeRatio` to preview the SODA output before calling this method.

**Prerequisite:** call `isAllowanceValid` + `approve` before instant unstaking on EVM chains.

**Signature:**
```typescript
async instantUnstake<K extends SpokeChainKey>(
  _params: InstantUnstakeAction<K, false>,
): Promise<Result<TxHashPair>>
```

**Example:**
```typescript
const result = await sodax.staking.instantUnstake({
  params: {
    srcChainKey: ChainKeys.BASE_MAINNET,
    srcAddress: '0x1234567890abcdef...',
    amount: 1000000000000000000n, // 1 xSODA
    minAmount: 950000000000000000n, // 0.95 SODA minimum
    action: 'instantUnstake',
  },
  walletProvider: evmWalletProvider,
  timeout: 30000,
});

if (result.ok) {
  const { srcChainTxHash, dstChainTxHash } = result.value;
  console.log('Instant unstake successful:', { srcChainTxHash, dstChainTxHash });
} else {
  console.error('Instant unstake failed:', result.error.message);
}
```

### createInstantUnstakeIntent

Submits the instant-unstake transaction on the spoke chain **without** relaying to the hub.

**Signature:**
```typescript
async createInstantUnstakeIntent<K extends SpokeChainKey, Raw extends boolean>(
  _params: InstantUnstakeAction<K, Raw>,
): Promise<Result<IntentTxResult<K, Raw>>>
```

**Example:**
```typescript
const result = await sodax.staking.createInstantUnstakeIntent({
  params: {
    srcChainKey: ChainKeys.BASE_MAINNET,
    srcAddress: '0x1234567890abcdef...',
    amount: 1000000000000000000n,
    minAmount: 950000000000000000n,
    action: 'instantUnstake',
  },
  walletProvider: evmWalletProvider,
});
```

### claim

Claims SODA from an unstake request, relays the intent to the hub, and waits for confirmation.

Can be invoked before the unstaking period has fully elapsed, in which case the claim incurs a linear
penalty against the claimable amount. Use `getUnstakingInfoWithPenalty` first to preview the exact
claimable amount given the current penalty.

**Signature:**
```typescript
async claim<K extends SpokeChainKey>(
  _params: ClaimAction<K, false>,
): Promise<Result<TxHashPair>>
```

**Example:**
```typescript
const result = await sodax.staking.claim({
  params: {
    srcChainKey: ChainKeys.BASE_MAINNET,
    srcAddress: '0x1234567890abcdef...',
    requestId: 1n,
    amount: 950000000000000000n, // claimable amount after penalty
    action: 'claim',
  },
  walletProvider: evmWalletProvider,
  timeout: 30000,
});

if (result.ok) {
  const { srcChainTxHash, dstChainTxHash } = result.value;
  console.log('Claim successful:', { srcChainTxHash, dstChainTxHash });
} else {
  console.error('Claim failed:', result.error.message);
}
```

### createClaimIntent

Submits the claim transaction on the spoke chain **without** relaying to the hub.

**Signature:**
```typescript
async createClaimIntent<K extends SpokeChainKey, Raw extends boolean>(
  _params: ClaimAction<K, Raw>,
): Promise<Result<IntentTxResult<K, Raw>>>
```

**Example:**
```typescript
const result = await sodax.staking.createClaimIntent({
  params: {
    srcChainKey: ChainKeys.BASE_MAINNET,
    srcAddress: '0x1234567890abcdef...',
    requestId: 1n,
    amount: 950000000000000000n,
    action: 'claim',
  },
  walletProvider: evmWalletProvider,
});
```

### cancelUnstake

Cancels a pending unstake request and re-stakes the underlying SODA as xSoda shares, relays to the hub,
and waits for confirmation. Aborts the waiting period and redeposits SODA back into the xSoda vault so
the user continues earning staking rewards.

**Signature:**
```typescript
async cancelUnstake<K extends SpokeChainKey>(
  _params: CancelUnstakeAction<K, false>,
): Promise<Result<TxHashPair>>
```

**Example:**
```typescript
const result = await sodax.staking.cancelUnstake({
  params: {
    srcChainKey: ChainKeys.BASE_MAINNET,
    srcAddress: '0x1234567890abcdef...',
    requestId: 1n,
    action: 'cancelUnstake',
  },
  walletProvider: evmWalletProvider,
  timeout: 30000,
});

if (result.ok) {
  const { srcChainTxHash, dstChainTxHash } = result.value;
  console.log('Cancel unstake successful:', { srcChainTxHash, dstChainTxHash });
} else {
  console.error('Cancel unstake failed:', result.error.message);
}
```

### createCancelUnstakeIntent

Submits the cancel-unstake transaction on the spoke chain **without** relaying to the hub.

**Signature:**
```typescript
async createCancelUnstakeIntent<K extends SpokeChainKey, Raw extends boolean>(
  _params: CancelUnstakeAction<K, Raw>,
): Promise<Result<IntentTxResult<K, Raw>>>
```

**Example:**
```typescript
const result = await sodax.staking.createCancelUnstakeIntent({
  params: {
    srcChainKey: ChainKeys.BASE_MAINNET,
    srcAddress: '0x1234567890abcdef...',
    requestId: 1n,
    action: 'cancelUnstake',
  },
  walletProvider: evmWalletProvider,
});
```

### getStakingInfoFromSpoke

Fetches comprehensive staking information for a user identified by their spoke-chain address and chain key.

Resolves the hub wallet address from the spoke address, then delegates to `getStakingInfo`.

**Signature:**
```typescript
async getStakingInfoFromSpoke<K extends SpokeChainKey>(
  srcAddress: Address,
  srcChainKey: K,
): Promise<Result<StakingInfo>>
```

**Example:**
```typescript
const result = await sodax.staking.getStakingInfoFromSpoke(
  '0x1234567890abcdef...',
  ChainKeys.BASE_MAINNET,
);

if (result.ok) {
  const { totalStaked, userXSodaBalance, userXSodaValue } = result.value;
  console.log('Total staked:', totalStaked.toString());
  console.log('User xSODA balance:', userXSodaBalance.toString());
  console.log('User xSODA value in SODA:', userXSodaValue.toString());
} else {
  console.error('Failed to get staking info:', result.error.message);
}
```

### getStakingInfo

Fetches comprehensive staking information for a hub wallet address directly.

**Signature:**
```typescript
async getStakingInfo(userAddress: Address): Promise<Result<StakingInfo>>
```

**Example:**
```typescript
const result = await sodax.staking.getStakingInfo('0xHubWalletAddress...');

if (result.ok) {
  const { totalStaked, userXSodaBalance, userXSodaValue } = result.value;
  console.log('Total staked:', totalStaked.toString());
  console.log('User xSODA balance:', userXSodaBalance.toString());
  console.log('User xSODA value in SODA:', userXSodaValue.toString());
} else {
  console.error('Failed to get staking info:', result.error.message);
}
```

### getUnstakingInfo

Fetches all pending unstake requests and the total SODA amount currently unstaking for a user.

**Signature:**
```typescript
async getUnstakingInfo<K extends SpokeChainKey>(
  srcAddress: Address,
  srcChainKey: K,
): Promise<Result<UnstakingInfo>>
```

**Example:**
```typescript
const result = await sodax.staking.getUnstakingInfo(
  '0x1234567890abcdef...',
  ChainKeys.BASE_MAINNET,
);

if (result.ok) {
  const { totalUnstaking, userUnstakeSodaRequests } = result.value;
  console.log('Total unstaking:', totalUnstaking.toString());
  console.log('Number of requests:', userUnstakeSodaRequests.length);
} else {
  console.error('Failed to get unstaking info:', result.error.message);
}
```

### getUnstakingInfoWithPenalty

Fetches all pending unstake requests enriched with current penalty calculations.

Applies the linear penalty model to each request based on elapsed time:
- Before `minUnstakingPeriod`: `maxPenalty` applies in full.
- Between `minUnstakingPeriod` and `unstakingPeriod`: penalty decreases linearly to zero.
- After `unstakingPeriod`: no penalty.

**Signature:**
```typescript
async getUnstakingInfoWithPenalty<K extends SpokeChainKey>(
  srcAddress: Address,
  srcChainKey: K,
): Promise<Result<UnstakingInfo & { requestsWithPenalty: UnstakeRequestWithPenalty[] }>>
```

**Example:**
```typescript
const result = await sodax.staking.getUnstakingInfoWithPenalty(
  '0x1234567890abcdef...',
  ChainKeys.BASE_MAINNET,
);

if (result.ok) {
  const { totalUnstaking, requestsWithPenalty } = result.value;
  console.log('Total unstaking:', totalUnstaking.toString());

  for (const req of requestsWithPenalty) {
    console.log('Amount:', req.request.amount.toString());
    console.log('Penalty:', req.penalty.toString());
    console.log('Penalty %:', req.penaltyPercentage);
    console.log('Claimable:', req.claimableAmount.toString());
  }
} else {
  console.error('Failed to get unstaking info with penalty:', result.error.message);
}
```

### getStakingConfig

Reads the current staking configuration from the StakedSoda contract.

**Signature:**
```typescript
async getStakingConfig(): Promise<Result<StakingConfig>>
```

**Example:**
```typescript
const result = await sodax.staking.getStakingConfig();

if (result.ok) {
  const { unstakingPeriod, minUnstakingPeriod, maxPenalty } = result.value;
  console.log('Unstaking period (s):', unstakingPeriod.toString());
  console.log('Min unstaking period (s):', minUnstakingPeriod.toString());
  console.log('Max penalty (%):', maxPenalty.toString());
} else {
  console.error('Failed to get staking config:', result.error.message);
}
```

### getInstantUnstakeRatio

Estimates the SODA amount receivable from instantly unstaking a given quantity of xSoda shares.

Calls `StakingRouter.estimateInstantUnstake` on-chain. Use this before calling `instantUnstake` to set
an appropriate `minAmount` slippage guard.

**Signature:**
```typescript
async getInstantUnstakeRatio(amount: bigint): Promise<Result<bigint>>
```

**Example:**
```typescript
const result = await sodax.staking.getInstantUnstakeRatio(1000000000000000000n);

if (result.ok) {
  console.log('Estimated SODA output:', result.value.toString());
} else {
  console.error('Failed to get instant unstake ratio:', result.error.message);
}
```

### getConvertedAssets

Converts a quantity of xSoda shares to its current underlying SODA value using the vault's
`convertToAssets` view function. The result increases over time as staking rewards accrue.

**Signature:**
```typescript
async getConvertedAssets(amount: bigint): Promise<Result<bigint>>
```

**Example:**
```typescript
const result = await sodax.staking.getConvertedAssets(1000000000000000000n);

if (result.ok) {
  console.log('SODA equivalent:', result.value.toString());
} else {
  console.error('Failed to convert assets:', result.error.message);
}
```

### getStakeRatio

Estimates the xSoda shares and preview-deposit amount for a given SODA input. Calls
`StakingRouter.estimateXSodaAmount` on-chain. Use this to display expected output before a stake
transaction.

**Signature:**
```typescript
async getStakeRatio(amount: bigint): Promise<Result<[bigint, bigint]>>
```

**Example:**
```typescript
const result = await sodax.staking.getStakeRatio(1000000000000000000n);

if (result.ok) {
  const [xSodaAmount, previewDepositAmount] = result.value;
  console.log('xSODA you will receive:', xSodaAmount.toString());
  console.log('Preview deposit amount:', previewDepositAmount.toString());
} else {
  console.error('Failed to get stake ratio:', result.error.message);
}
```

## Types

### StakeParams

```typescript
export type StakeParams<K extends SpokeChainKey> = {
  srcChainKey: K;      // chain key of the spoke chain to stake from
  srcAddress: Address; // account to stake from
  amount: bigint;      // SODA amount to stake
  minReceive: bigint;  // minimum xSODA shares to receive (slippage guard)
  action: 'stake';
};
```

### UnstakeParams

```typescript
export type UnstakeParams<K extends SpokeChainKey> = {
  srcChainKey: K;      // chain key of the spoke chain to unstake from
  srcAddress: Address; // account to unstake from
  amount: bigint;      // xSoda share amount to unstake
  action: 'unstake';
};
```

### InstantUnstakeParams

```typescript
export type InstantUnstakeParams<K extends SpokeChainKey> = {
  srcChainKey: K;      // chain key of the spoke chain to instant unstake from
  srcAddress: Address;
  amount: bigint;      // xSoda share amount to redeem
  minAmount: bigint;   // minimum SODA to receive (slippage guard)
  action: 'instantUnstake';
};
```

### ClaimParams

```typescript
export type ClaimParams<K extends SpokeChainKey> = {
  srcChainKey: K;      // chain key of the spoke chain to claim from
  srcAddress: Address;
  requestId: bigint;
  amount: bigint;      // claimable SODA amount after penalty calculation
  action: 'claim';
};
```

### CancelUnstakeParams

```typescript
export type CancelUnstakeParams<K extends SpokeChainKey> = {
  srcChainKey: K;      // chain key of the spoke chain to cancel unstake from
  srcAddress: Address;
  requestId: bigint;
  action: 'cancelUnstake';
};
```

### StakingInfo

```typescript
export type StakingInfo = {
  totalStaked: bigint;      // Total SODA staked (totalAssets from xSODA vault)
  totalUnderlying: bigint;  // Total underlying SODA assets in the vault
  userXSodaBalance: bigint; // User's xSODA shares (raw balance)
  userXSodaValue: bigint;   // User's xSODA value in SODA (converted)
  userUnderlying: bigint;   // User's underlying SODA amount
};
```

### UnstakingInfo

```typescript
export type UnstakingInfo = {
  userUnstakeSodaRequests: readonly UserUnstakeInfo[];
  totalUnstaking: bigint;
};
```

### UnstakeRequestWithPenalty

```typescript
export type UnstakeRequestWithPenalty = UserUnstakeInfo & {
  penalty: bigint;           // SODA withheld as penalty
  penaltyPercentage: number; // 0–100
  claimableAmount: bigint;   // net SODA receivable after penalty
};
```

### StakingConfig

```typescript
export type StakingConfig = {
  unstakingPeriod: bigint;    // full wait duration in seconds; no penalty after this
  minUnstakingPeriod: bigint; // minimum wait in seconds; max penalty before this
  maxPenalty: bigint;         // maximum penalty percentage (1–100)
};
```

### StakingActionType

```typescript
export type StakingActionType = 'stake' | 'unstake' | 'claim' | 'cancelUnstake' | 'instantUnstake';
```

### TxHashPair

Returned by the full relay methods (`stake`, `unstake`, `instantUnstake`, `claim`, `cancelUnstake`):

```typescript
type TxHashPair = {
  srcChainTxHash: string; // transaction hash on the source (spoke) chain
  dstChainTxHash: string; // transaction hash on the destination (hub) chain
};
```

## Error Handling

All async public methods on `StakingService` return `Promise<Result<T, SodaxError<NarrowCode>>>` where
`NarrowCode` is a narrow per-method union of `StakingErrorCode`. Discriminate on `error.code`, never
on `error.message`. The original lower-level failure (a viem revert, a fetch error, a relay timeout)
is preserved on `error.cause`; structured metadata (chain, action, phase, relayCode) is on
`error.context`.

```typescript
import { isStakeOrchestrationError, type StakeOrchestrationError } from '@sodax/sdk';

const result = await sodax.staking.stake({ /* params */ });
if (!result.ok) {
  // result.error is typed as `StakeOrchestrationError = SodaxError<StakeOrchestrationErrorCode>`
  switch (result.error.code) {
    case 'VALIDATION_FAILED':       // precondition tripped (see context.field)
    case 'INTENT_CREATION_FAILED':
    case 'TX_VERIFICATION_FAILED':           // spoke tx not verifiable on-chain
    case 'TX_SUBMIT_FAILED':        // relay submit failed
    case 'RELAY_TIMEOUT':           // relay packet did not arrive within timeout
    case 'RELAY_FAILED':            // relay polling failure / unknown relay error
    case 'EXECUTION_FAILED':            // generic catch-all (see error.cause)
    case 'UNKNOWN':
      handleStakeError(result.error);
      break;
  }
}
```

### Per-method error code unions

| Method | Codes |
|---|---|
| `stake` | `USER_REJECTED`, `VALIDATION_FAILED`, `INTENT_CREATION_FAILED`, `TX_VERIFICATION_FAILED`, `TX_SUBMIT_FAILED`, `RELAY_TIMEOUT`, `RELAY_FAILED`, `EXECUTION_FAILED`, `UNKNOWN` |
| `unstake` | `USER_REJECTED`, `VALIDATION_FAILED`, `INTENT_CREATION_FAILED`, `TX_SUBMIT_FAILED`, `RELAY_TIMEOUT`, `RELAY_FAILED`, `EXECUTION_FAILED`, `UNKNOWN` |
| `instantUnstake` | `USER_REJECTED`, `VALIDATION_FAILED`, `INTENT_CREATION_FAILED`, `TX_SUBMIT_FAILED`, `RELAY_TIMEOUT`, `RELAY_FAILED`, `EXECUTION_FAILED`, `UNKNOWN` |
| `claim` | `USER_REJECTED`, `VALIDATION_FAILED`, `INTENT_CREATION_FAILED`, `TX_SUBMIT_FAILED`, `RELAY_TIMEOUT`, `RELAY_FAILED`, `EXECUTION_FAILED`, `UNKNOWN` |
| `cancelUnstake` | `USER_REJECTED`, `VALIDATION_FAILED`, `INTENT_CREATION_FAILED`, `TX_SUBMIT_FAILED`, `RELAY_TIMEOUT`, `RELAY_FAILED`, `EXECUTION_FAILED`, `UNKNOWN` |
| `create<Op>Intent` | `USER_REJECTED`, `VALIDATION_FAILED`, `INTENT_CREATION_FAILED`, `UNKNOWN` |
| `approve` | `USER_REJECTED`, `VALIDATION_FAILED`, `APPROVE_FAILED`, `UNKNOWN` |
| `isAllowanceValid` | `VALIDATION_FAILED`, `ALLOWANCE_CHECK_FAILED`, `UNKNOWN` |
| `getStakingInfo*` / `getUnstakingInfo*` / `getStakingConfig` / `getInstantUnstakeRatio` / `getConvertedAssets` / `getStakeRatio` | `VALIDATION_FAILED`, `LOOKUP_FAILED`, `UNKNOWN` |

Note: `TX_VERIFICATION_FAILED` only appears in `StakeOrchestrationErrorCode` because `stake` is the
only orchestrator that calls `spoke.verifyTxHash`. The 4 non-stake orchestrators
(`unstake`/`instantUnstake`/`claim`/`cancelUnstake`) share `StakingOrchestrationErrorCode`.

### Structured `context`

Every staking error carries an `error.context` payload. Fields vary by code:

| Field | Set on | Notes |
|---|---|---|
| `srcChainKey` | all orchestrator + intent codes | low-cardinality — suitable as a logger / Sentry tag |
| `action` | all orchestrator + intent codes | one of `'stake' \| 'unstake' \| 'instantUnstake' \| 'claim' \| 'cancelUnstake'` |
| `phase` | most codes | `'validate' \| 'intentCreation' \| 'verify' \| 'submit' \| 'relay' \| 'approve' \| 'allowanceCheck' \| 'infoFetch'` |
| `relayCode` | `RELAY_TIMEOUT` / `TX_SUBMIT_FAILED` / `RELAY_FAILED` | mirrors the relay-layer `RELAY_ERROR_CODES` contract; carries `'RELAY_POLLING_FAILED'` so polling outage is distinguishable from generic failure |
| `field` / `reason` | `VALIDATION_FAILED` | which precondition tripped |
| `method` | `LOOKUP_FAILED` | the read-only method name (`'getStakingInfo'`, `'getUnstakingInfo'`, `'getStakingConfig'`, …) — partitions the 8 readers without per-method codes |

### Type guards

Per-method type guards are runtime-checked and compile-checked in lockstep with the union types. Use
them in `catch` blocks to short-circuit when a foreign code escapes:

```typescript
import { isStakeOrchestrationError, isStakingError } from '@sodax/sdk';

try {
  // ... call sodax.staking.stake ...
} catch (e) {
  if (isStakeOrchestrationError(e)) console.error('typed stake error:', e.code, e.context);
  else if (isStakingError(e)) console.error('staking error from another method:', e.code);
  else throw e; // not a staking error — bubble up
}
```

Available guards: `isStakingError` (broad — any staking error), `isStakeOrchestrationError` (the
`stake` orchestrator only, the one path with `TX_VERIFICATION_FAILED`), `isStakingOrchestrationError`
(the 4 non-stake orchestrators), `isStakingCreateIntentError` (shared by all 5 `create*Intent`
methods), `isStakingApproveError`, `isStakingAllowanceCheckError`, `isStakingInfoFetchError`.
Per-operation discrimination across the orchestrators is via `error.context.action` (one of
`'stake' | 'unstake' | 'instantUnstake' | 'claim' | 'cancelUnstake'`).

### Validation invariant

Precondition failures throw a typed `VALIDATION_FAILED` from inside the public method's
`try/catch`, surfacing as a typed `Result.error` rather than a generic prose `Error`. This means
consumers can discriminate validation failures the same way as any other code.

```typescript
import { stakingInvariant } from '@sodax/sdk';

stakingInvariant(amount > 0n, 'Amount must be greater than 0', { field: 'amount' });
```

### Migration from the pre-v2 taxonomy

The published v1 `StakingError<Code>` shape (8 codes: `STAKE_FAILED`, `UNSTAKE_FAILED`,
`INSTANT_UNSTAKE_FAILED`, `CLAIM_FAILED`, `CANCEL_UNSTAKE_FAILED`, `INFO_FETCH_FAILED`,
`ALLOWANCE_CHECK_FAILED`, `APPROVAL_FAILED`) is restored here with module-prefixed names and
cause-preservation:

| v1 code | v2 code | Notes |
|---|---|---|
| `STAKE_FAILED` | `EXECUTION_FAILED` | Generic stake catch-all. Underlying cause on `error.cause`. |
| `UNSTAKE_FAILED` | `EXECUTION_FAILED` | Generic unstake catch-all. |
| `INSTANT_UNSTAKE_FAILED` | `EXECUTION_FAILED` | Generic instant-unstake catch-all. |
| `CLAIM_FAILED` | `EXECUTION_FAILED` | Generic claim catch-all. |
| `CANCEL_UNSTAKE_FAILED` | `EXECUTION_FAILED` | Generic cancel-unstake catch-all. |
| `INFO_FETCH_FAILED` | `LOOKUP_FAILED` | Shared by all 8 read-only methods; partition via `context.method`. |
| `ALLOWANCE_CHECK_FAILED` | `ALLOWANCE_CHECK_FAILED` | Allowance check failed at the spoke layer. |
| `APPROVAL_FAILED` | `APPROVE_FAILED` | Approve operation failed. |
| (none) | `VALIDATION_FAILED` | New: typed precondition failures (replaces prose `Error` throws from `invariant`). |
| (none) | `INTENT_CREATION_FAILED` | New: per-op intent-creation phase tag (e.g. spoke deposit revert). |
| (none) | `TX_VERIFICATION_FAILED` | New: spoke tx verification phase tag (only set by `stake`). |
| (none) | `TX_SUBMIT_FAILED` / `RELAY_TIMEOUT` / `RELAY_FAILED` | New: typed relay-phase codes mapped from the shared `RELAY_ERROR_CODES` contract. |
| (none) | `UNKNOWN` | Reserved fallback for never-classified errors. |

## Usage Flow

### Full stake flow (EVM spoke chain)

```typescript
// 1. Check allowance
const allowanceResult = await sodax.staking.isAllowanceValid({
  params: { srcChainKey: ChainKeys.BASE_MAINNET, srcAddress, amount, minReceive, action: 'stake' },
  walletProvider: evmWalletProvider,
});
if (!allowanceResult.ok) throw allowanceResult.error;

// 2. Approve if needed
if (!allowanceResult.value) {
  const approveResult = await sodax.staking.approve({
    params: { srcChainKey: ChainKeys.BASE_MAINNET, srcAddress, amount, minReceive, action: 'stake' },
    walletProvider: evmWalletProvider,
  });
  if (!approveResult.ok) throw approveResult.error;
}

// 3. Stake (spoke tx + relay + hub confirmation)
const stakeResult = await sodax.staking.stake({
  params: { srcChainKey: ChainKeys.BASE_MAINNET, srcAddress, amount, minReceive, action: 'stake' },
  walletProvider: evmWalletProvider,
  timeout: 60000,
});
if (!stakeResult.ok) throw stakeResult.error;

const { srcChainTxHash, dstChainTxHash } = stakeResult.value;
```

### Full unstake + claim flow

```typescript
// Unstake (starts waiting period)
const unstakeResult = await sodax.staking.unstake({
  params: { srcChainKey: ChainKeys.BASE_MAINNET, srcAddress, amount, action: 'unstake' },
  walletProvider: evmWalletProvider,
});

// ... wait for unstaking period ...

// Preview claimable amount with penalty info
const penaltyResult = await sodax.staking.getUnstakingInfoWithPenalty(srcAddress, ChainKeys.BASE_MAINNET);
if (penaltyResult.ok) {
  for (const req of penaltyResult.value.requestsWithPenalty) {
    // Claim with the pre-computed claimable amount
    await sodax.staking.claim({
      params: {
        srcChainKey: ChainKeys.BASE_MAINNET,
        srcAddress,
        requestId: req.id,
        amount: req.claimableAmount,
        action: 'claim',
      },
      walletProvider: evmWalletProvider,
    });
  }
}
```

## Supported Chains

All staking operations accept any `SpokeChainKey` as the source chain. The hub chain (Sonic,
`ChainKeys.SONIC_MAINNET`) may also be used as the source — in that case, spoke and hub tx hashes are
identical. Example chains:

- EVM spoke chains: `ChainKeys.BASE_MAINNET`, `ChainKeys.ETHEREUM_MAINNET`, `ChainKeys.ARBITRUM_MAINNET`, etc.
- Hub chain: `ChainKeys.SONIC_MAINNET`
- Non-EVM chains: `ChainKeys.ICON_MAINNET`, `ChainKeys.SUI_MAINNET`, `ChainKeys.STELLAR_MAINNET`, etc.

Approval support: EVM spoke chains, hub chain, and Stellar only. All other non-EVM chains do not require
on-chain approval.

## Penalty System

The staking system includes a penalty mechanism for early unstaking:

- **`minUnstakingPeriod`** — maximum penalty applies if claiming before this time elapses.
- **`unstakingPeriod`** — no penalty once this full period elapses.
- **Linear reduction** — penalty decreases linearly between `minUnstakingPeriod` and `unstakingPeriod`.

Use `getStakingConfig` to read the current parameters, and `getUnstakingInfoWithPenalty` to see the
exact penalty for each pending request.

## Instant Unstaking

Instant unstaking allows users to immediately receive SODA tokens in exchange for xSoda shares, bypassing
the waiting period, but receiving a reduced amount due to the immediate-liquidity mechanism. The actual
amount received depends on current pool conditions and is estimated by `getInstantUnstakeRatio`.

Always call `getInstantUnstakeRatio` before `instantUnstake` to set an appropriate `minAmount` slippage
guard.
