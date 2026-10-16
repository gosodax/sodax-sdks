# Money Market

> **Error handling conventions:** This module uses the canonical `SodaxError<MoneyMarketErrorCode>` shape (same family as the swap module). Discriminate on `result.error.code` (e.g. `'RELAY_TIMEOUT'`, `'EXECUTION_FAILED'`); structured details live on `result.error.context` (`action`, `phase`, `relayCode`, `field`). See the **Error Handling** section below for the full per-method code table and migration notes from the legacy `error.message`-based pattern.

Money Market part of SDK provides abstractions to assist you with interacting with the cross-chain Money Market Smart Contracts.

All money market operations are accessed through the `moneyMarket` property of a `Sodax` instance:

```typescript
import { Sodax, ChainKeys } from '@sodax/sdk';

const sodax = new Sodax();

// All money market methods are available through sodax.moneyMarket
const supplyResult = await sodax.moneyMarket.supply({
  params: {
    srcChainKey: ChainKeys.BSC_MAINNET,
    srcAddress: '0x...',
    token: '0x...',
    amount: 1000n,
    action: 'supply',
  },
  walletProvider: evmWalletProvider,
});
```

## Using SDK Config and Constants

SDK includes predefined configurations of supported chains, tokens and other relevant information for the client to consume. All configurations are accessible through the `config` property of the Sodax instance (`sodax.config`), or through service-specific properties for convenience.

**IMPORTANT**: If you want dynamic (backend API based - contains latest tokens) configuration, make sure to initialize the instance before usage:
```typescript
await sodax.config.initialize();
```
By default, configuration from the specific SDK version you are using is used.

```typescript
import { Sodax, ChainKeys, type SpokeChainKey, type Address } from '@sodax/sdk';

const sodax = new Sodax();
await sodax.config.initialize(); // Initialize for dynamic config (optional)

// All supported spoke chains (general config)
const spokeChains: SpokeChainKey[] = sodax.config.getSupportedSpokeChains();

// Get supported money market tokens for a specific chain
const supportedMoneyMarketTokens = sodax.moneyMarket.getSupportedTokensByChainId(ChainKeys.BSC_MAINNET);

// Get all supported money market tokens per chain
const allMoneyMarketTokens = sodax.moneyMarket.getSupportedTokens();

// Get all supported reserves (hub chain token addresses, i.e. money market on Sonic chain)
const supportedReserves: readonly Address[] = sodax.moneyMarket.getSupportedReserves();

// Check if token address for given spoke chain key is supported (through config service)
const isMoneyMarketSupportedToken: boolean = sodax.config.isMoneyMarketSupportedToken(ChainKeys.BSC_MAINNET, tokenAddress);

// Alternative: Access through config service
const moneyMarketTokensFromConfig = sodax.config.getSupportedMoneyMarketTokensByChainId(ChainKeys.BSC_MAINNET);
const allMoneyMarketTokensFromConfig = sodax.config.getSupportedMoneyMarketTokens();
```

Chain constants are available under the `ChainKeys` namespace (e.g. `ChainKeys.BSC_MAINNET`, `ChainKeys.SONIC_MAINNET`). The old `*_CHAIN_ID` constants have been replaced — see `packages/sdk/CHAIN_ID_MIGRATION.md` for the full rename mapping.

## Available Methods

All money market methods are accessible through `sodax.moneyMarket`:

### Token & Reserve Configuration
- `getSupportedTokensByChainId(chainKey)` - Get supported money market tokens for a specific chain
- `getSupportedTokens()` - Get all supported money market tokens per chain
- `getSupportedReserves()` - Get all supported money market reserves (hub chain addresses)

### Allowance & Approval
- `isAllowanceValid({ params })` - Check if token approval/trustline is sufficient
- `approve({ params, walletProvider, raw? })` - Approve tokens or establish Stellar trustline

### Money Market Operations
- `supply({ params, walletProvider, timeout? })` - Supply tokens (complete operation with relay)
- `createSupplyIntent({ params, walletProvider?, raw?, skipSimulation? })` - Create supply intent only
- `borrow({ params, walletProvider, timeout? })` - Borrow tokens (complete operation with relay)
- `createBorrowIntent({ params, walletProvider?, raw?, skipSimulation? })` - Create borrow intent only
- `withdraw({ params, walletProvider, timeout? })` - Withdraw tokens (complete operation with relay)
- `createWithdrawIntent({ params, walletProvider?, raw?, skipSimulation? })` - Create withdraw intent only
- `repay({ params, walletProvider, timeout? })` - Repay tokens (complete operation with relay)
- `createRepayIntent({ params, walletProvider?, raw?, skipSimulation? })` - Create repay intent only

### Gas Estimation
- `estimateGas(params)` - Estimate gas for an encoded transaction on a given spoke chain

### Data Retrieval & Formatting
- `data.getReservesList()` - Get list of all reserve addresses
- `data.getReservesData()` - Get raw aggregated reserve data
- `data.getReservesHumanized()` - Get humanized reserve data
- `data.getReserveData(asset)` - Get specific reserve data
- `data.getReserveNormalizedIncome(asset)` - Get normalized income for a specific asset (RAY precision)
- `data.getUserReservesData(spokeChainKey, userAddress)` - Get raw user reserve data
- `data.getUserReservesHumanized(spokeChainKey, userAddress)` - Get humanized user reserve data
- `data.getEModes()` - Get raw E-Mode data
- `data.getEModesHumanized()` - Get humanized E-Mode data
- `data.formatReservesUSD(request)` - Format reserves with USD conversions
- `data.formatReserveUSD(request)` - Format a single reserve with USD conversion
- `data.formatUserSummary(request)` - Format user portfolio summary with USD conversions

### Function Parameters Structure

All money market exec methods use a single `SpokeExecActionParams`-shaped object:

- **`params`**: The money market operation parameters (`MoneyMarketSupplyParams`, `MoneyMarketBorrowParams`, `MoneyMarketWithdrawParams`, or `MoneyMarketRepayParams`). Every params type carries:
  - `srcChainKey: K` — the source spoke chain (drives TypeScript narrowing of `walletProvider`)
  - `srcAddress: string` — the caller's address on the source chain
  - `token: string` — token address on the source chain (or destination chain for borrow/withdraw)
  - `amount: bigint` — amount in token's native decimals
  - `action: 'supply' | 'borrow' | 'withdraw' | 'repay'`
  - `dstChainKey?: SpokeChainKey` — optional destination chain (defaults to `srcChainKey`)
  - `dstAddress?: string` — optional destination address (defaults to `srcAddress`)
- **`walletProvider`**: The wallet provider for the source chain. Required when `raw` is `false` (or omitted); forbidden when `raw: true`. The type is automatically narrowed to the correct interface for the given `srcChainKey` (e.g. `IEvmWalletProvider` for EVM chains).
- **`raw`**: (Optional, default `false`) When `true`, returns unsigned transaction data instead of executing. When `true`, `walletProvider` must not be passed. Used in `create*Intent` and `approve` methods.
- **`skipSimulation`**: (Optional, default `false`) Skip transaction simulation before broadcast. Used in `create*Intent` methods.
- **`timeout`**: (Optional, default: `DEFAULT_RELAY_TX_TIMEOUT` = 120 seconds) Timeout in milliseconds for relay operations. Used in `supply`, `borrow`, `withdraw`, and `repay` methods.

## Allowance and Approval

Before making a money market action (supply, repay), you need to ensure the money market contract has sufficient allowance to spend your tokens. The SDK provides methods to check and set allowances for different types of spoke providers.

**Note**: For Stellar-based operations, the allowance and approval system works differently:
- **Source Chain (Stellar)**: The standard `isAllowanceValid` and `approve` methods check and establish trustlines automatically.
- **Destination Chain (Stellar)**: When Stellar is specified as the destination chain, the SDK checks both the sender's and recipient's trustlines via `isAllowanceValid`.

**Withdraw and borrow**: No on-chain approval is required for these actions. `isAllowanceValid` always returns `true` for them (though it validates the token is supported on the destination chain).

### Checking Allowance

The `isAllowanceValid` method checks if the current allowance is sufficient for the specified action:

```typescript
import { type MoneyMarketSupplyParams, ChainKeys } from '@sodax/sdk';

const supplyParams: MoneyMarketSupplyParams = {
  srcChainKey: ChainKeys.BSC_MAINNET,
  srcAddress: '0x...', // Caller's address on the source chain
  token: '0x...', // Address of the token (spoke chain) to supply
  amount: 1000n, // Amount to supply (in token decimals)
  action: 'supply',
};

const isAllowanceValid = await sodax.moneyMarket.isAllowanceValid({ params: supplyParams });

if (!isAllowanceValid.ok) {
  // Handle error
  return;
}

if (!isAllowanceValid.value) {
  // Need to approve — allowance is insufficient
}
```

### Setting Allowance

The `approve` method sets the allowance for the specified action. The spender address is resolved internally based on the chain:

- **EVM Spoke Chains**: The spender is the spoke asset manager contract
- **Sonic (Hub) Chain**: The spender is the user's hub router contract
- **Stellar**: Creates/updates the required trustline

**Some tokens need two transactions.** A few ERC-20s of the 2017 TetherToken lineage — Ethereum
USDT is the one in the SODAX token list today — reject an allowance change from one non-zero value
to another. When a wallet already holds a stale allowance on such a token, `approve` sends
`approve(0)` first, waits for it to be mined, then sends the real approval. The user signs twice.
The SDK detects this by simulating the approval, not from a token list, so a token added or upgraded
later is handled the same way. Nothing changes for callers: `approve` still resolves to a single
transaction hash — the hash of the **last** transaction — and everything else is a single
transaction as before.

```typescript
import { type MoneyMarketSupplyParams, ChainKeys } from '@sodax/sdk';

const supplyParams: MoneyMarketSupplyParams = {
  srcChainKey: ChainKeys.BSC_MAINNET,
  srcAddress: '0x...',
  token: '0x...',
  amount: 1000n,
  action: 'supply',
};

// First check if allowance is sufficient
const isAllowanceValid = await sodax.moneyMarket.isAllowanceValid({ params: supplyParams });

if (!isAllowanceValid.ok) {
  // Handle error
  return;
}

if (!isAllowanceValid.value) {
  // Approve — signed execution (raw: false or omitted)
  const approveResult = await sodax.moneyMarket.approve({
    params: supplyParams,
    walletProvider: evmWalletProvider,
  });

  if (!approveResult.ok) {
    // Handle approval error
    return;
  }

  // Transaction hash
  const txHash = approveResult.value;
}
```

To obtain unsigned approval calldata without broadcasting:

```typescript
// Raw transaction — walletProvider must NOT be passed
const rawApproveResult = await sodax.moneyMarket.approve({
  params: supplyParams,
  raw: true,
});

if (rawApproveResult.ok) {
  const rawTx = rawApproveResult.value; // EvmRawTransaction (or chain-specific equivalent)
}
```

### Supported Actions by Provider Type

The allowance and approval system supports different actions depending on the spoke chain type:

**EVM Spoke Providers:**
- `supply` - Approves the asset manager contract to spend tokens
- `repay` - Approves the asset manager contract to spend tokens

**Sonic Spoke Provider (Hub Chain):**
- `supply` - Approves the user hub router to spend tokens
- `repay` - Approves the user hub router to spend tokens

**Stellar:**
- `supply` / `repay` / `withdraw` / `borrow` — Checks and establishes trustlines

**Borrow and withdraw on EVM/hub chains do not require approval.**

### Stellar Trustline Requirements

For Stellar-based money market operations, you need to handle trustlines differently depending on whether Stellar is the source or destination chain. See [Stellar Trustline Requirements](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/STELLAR_TRUSTLINE.md#money-market) for detailed information and code examples.

### Complete Example

Here's a complete example showing the allowance check and approval flow:

```typescript
import { type MoneyMarketSupplyParams, ChainKeys } from '@sodax/sdk';

const supplyParams: MoneyMarketSupplyParams = {
  srcChainKey: ChainKeys.BSC_MAINNET,
  srcAddress: '0x...',
  token: '0x...',
  amount: 1000n,
  action: 'supply',
};

// Step 1: Check if allowance is sufficient
const allowanceCheck = await sodax.moneyMarket.isAllowanceValid({ params: supplyParams });

if (!allowanceCheck.ok) {
  console.error('Allowance check failed:', allowanceCheck.error);
  return;
}

// Step 2: Approve if allowance is insufficient
if (!allowanceCheck.value) {
  console.log('Insufficient allowance, approving...');

  const approveResult = await sodax.moneyMarket.approve({
    params: supplyParams,
    walletProvider: evmWalletProvider,
  });

  if (!approveResult.ok) {
    console.error('Approval failed:', approveResult.error);
    return;
  }

  console.log('Approval successful:', approveResult.value);
}

// Step 3: Now you can proceed with supply
const supplyResult = await sodax.moneyMarket.supply({
  params: supplyParams,
  walletProvider: evmWalletProvider,
});

if (supplyResult.ok) {
  const { srcChainTxHash, dstChainTxHash } = supplyResult.value;
  console.log('Supply successful:', { srcChainTxHash, dstChainTxHash });
} else {
  console.error('Supply failed:', supplyResult.error);
}
```

### Estimate Gas for Raw Transactions

The `estimateGas` method estimates gas for an already-encoded transaction on a given spoke chain. Use this after obtaining a raw transaction from a `create*Intent` or `approve` call.

```typescript
import { type MoneyMarketSupplyParams, ChainKeys } from '@sodax/sdk';

// Example: Get raw supply transaction, then estimate its gas
const supplyIntentResult = await sodax.moneyMarket.createSupplyIntent({
  params: supplyParams,
  raw: true, // walletProvider must not be passed
});

if (supplyIntentResult.ok) {
  const { tx: rawTx } = supplyIntentResult.value;

  const gasEstimate = await sodax.moneyMarket.estimateGas({
    tx: rawTx,
    chainKey: ChainKeys.BSC_MAINNET,
  });

  if (gasEstimate.ok) {
    console.log('Estimated gas for supply:', gasEstimate.value);
  }
}
```

## Supply Tokens

Supply tokens to the money market pool. There are two methods available:

1. `supply`: Executes the spoke-side deposit, relays to the hub, and waits for the relay to settle.
2. `createSupplyIntent`: Builds (and optionally broadcasts) only the spoke-side transaction without waiting for the relay. Useful when you need manual relay control.

```typescript
import { type MoneyMarketSupplyParams, DEFAULT_RELAY_TX_TIMEOUT, ChainKeys } from '@sodax/sdk';

const supplyParams: MoneyMarketSupplyParams = {
  srcChainKey: ChainKeys.BSC_MAINNET,
  srcAddress: '0x...',
  token: '0x...',
  amount: 1000n,
  action: 'supply',
};

// First check and set allowance if needed
const isAllowanceValid = await sodax.moneyMarket.isAllowanceValid({ params: supplyParams });

if (!isAllowanceValid.ok) {
  console.error('Allowance check failed:', isAllowanceValid.error);
  return;
}

if (!isAllowanceValid.value) {
  const approveResult = await sodax.moneyMarket.approve({
    params: supplyParams,
    walletProvider: evmWalletProvider,
  });

  if (!approveResult.ok) {
    console.error('Approval failed:', approveResult.error);
    return;
  }

  console.log('Approval transaction:', approveResult.value);
}

// Supply and relay (complete operation)
const supplyAndSubmitResult = await sodax.moneyMarket.supply({
  params: supplyParams,
  walletProvider: evmWalletProvider,
  timeout: DEFAULT_RELAY_TX_TIMEOUT, // Optional: timeout in milliseconds (default: 120 seconds)
});

if (supplyAndSubmitResult.ok) {
  const { srcChainTxHash, dstChainTxHash } = supplyAndSubmitResult.value;
  console.log('Supply successful:', { srcChainTxHash, dstChainTxHash });
} else {
  console.error('Supply failed:', supplyAndSubmitResult.error);
}

// Create supply intent only (no relay wait)
const supplyIntentResult = await sodax.moneyMarket.createSupplyIntent({
  params: supplyParams,
  walletProvider: evmWalletProvider,
});

if (supplyIntentResult.ok) {
  const { tx: txHash, relayData } = supplyIntentResult.value;
  console.log('Supply intent created:', txHash);
} else {
  console.error('Supply intent creation failed:', supplyIntentResult.error);
}

// Get raw supply calldata (no wallet, no broadcast)
const rawSupplyResult = await sodax.moneyMarket.createSupplyIntent({
  params: supplyParams,
  raw: true,
});

if (rawSupplyResult.ok) {
  const { tx: rawTx, relayData } = rawSupplyResult.value;
  console.log('Raw supply tx:', rawTx);
}
```

## Borrow Tokens

Borrow tokens from the money market pool. Borrowed tokens can be delivered to a different spoke chain by specifying `dstChainKey` and `dstAddress`.

1. `borrow`: Executes the spoke-side message, relays to the hub, and waits for the relay to settle.
2. `createBorrowIntent`: Builds (and optionally broadcasts) only the spoke-side transaction without waiting for the relay.

```typescript
import { type MoneyMarketBorrowParams, DEFAULT_RELAY_TX_TIMEOUT, ChainKeys } from '@sodax/sdk';

const borrowParams: MoneyMarketBorrowParams = {
  srcChainKey: ChainKeys.BSC_MAINNET,
  srcAddress: '0x...',
  token: '0x...', // Token address on the destination chain (defaults to srcChainKey)
  amount: 1000n,
  action: 'borrow',
  // Optional: deliver borrowed tokens to a different chain
  // dstChainKey: ChainKeys.ETHEREUM_MAINNET,
  // dstAddress: '0x...',
};

// Borrow and relay (complete operation)
const borrowAndSubmitResult = await sodax.moneyMarket.borrow({
  params: borrowParams,
  walletProvider: evmWalletProvider,
  timeout: DEFAULT_RELAY_TX_TIMEOUT,
});

if (borrowAndSubmitResult.ok) {
  const { srcChainTxHash, dstChainTxHash } = borrowAndSubmitResult.value;
  console.log('Borrow successful:', { srcChainTxHash, dstChainTxHash });
} else {
  console.error('Borrow failed:', borrowAndSubmitResult.error);
}

// Create borrow intent only (no relay wait)
const borrowIntentResult = await sodax.moneyMarket.createBorrowIntent({
  params: borrowParams,
  walletProvider: evmWalletProvider,
});

if (borrowIntentResult.ok) {
  const { tx: txHash, relayData } = borrowIntentResult.value;
  console.log('Borrow intent created:', txHash);
} else {
  console.error('Borrow intent creation failed:', borrowIntentResult.error);
}
```

## Withdraw Tokens

Withdraw previously supplied tokens from the money market pool. Withdrawn tokens can be delivered to a different spoke chain by specifying `dstChainKey` and `dstAddress`.

1. `withdraw`: Executes the spoke-side message, relays to the hub, and waits for the relay to settle.
2. `createWithdrawIntent`: Builds (and optionally broadcasts) only the spoke-side transaction without waiting for the relay.

```typescript
import { type MoneyMarketWithdrawParams, DEFAULT_RELAY_TX_TIMEOUT, ChainKeys } from '@sodax/sdk';

const withdrawParams: MoneyMarketWithdrawParams = {
  srcChainKey: ChainKeys.BSC_MAINNET,
  srcAddress: '0x...',
  token: '0x...', // Token address on the destination chain (defaults to srcChainKey)
  amount: 1000n,
  action: 'withdraw',
};

// Withdraw and relay (complete operation)
const withdrawAndSubmitResult = await sodax.moneyMarket.withdraw({
  params: withdrawParams,
  walletProvider: evmWalletProvider,
  timeout: DEFAULT_RELAY_TX_TIMEOUT,
});

if (withdrawAndSubmitResult.ok) {
  const { srcChainTxHash, dstChainTxHash } = withdrawAndSubmitResult.value;
  console.log('Withdraw successful:', { srcChainTxHash, dstChainTxHash });
} else {
  console.error('Withdraw failed:', withdrawAndSubmitResult.error);
}

// Create withdraw intent only (no relay wait)
const withdrawIntentResult = await sodax.moneyMarket.createWithdrawIntent({
  params: withdrawParams,
  walletProvider: evmWalletProvider,
});

if (withdrawIntentResult.ok) {
  const { tx: txHash, relayData } = withdrawIntentResult.value;
  console.log('Withdraw intent created:', txHash);
} else {
  console.error('Withdraw intent creation failed:', withdrawIntentResult.error);
}
```

## Repay Tokens

Repay a borrowed position in the money market pool.

1. `repay`: Executes the spoke-side deposit, relays to the hub, and waits for the relay to settle.
2. `createRepayIntent`: Builds (and optionally broadcasts) only the spoke-side transaction without waiting for the relay.

```typescript
import { type MoneyMarketRepayParams, DEFAULT_RELAY_TX_TIMEOUT, ChainKeys } from '@sodax/sdk';

const repayParams: MoneyMarketRepayParams = {
  srcChainKey: ChainKeys.BSC_MAINNET,
  srcAddress: '0x...',
  token: '0x...',
  amount: 1000n,
  action: 'repay',
};

// First check and set allowance if needed
const isAllowanceValid = await sodax.moneyMarket.isAllowanceValid({ params: repayParams });

if (!isAllowanceValid.ok) {
  console.error('Allowance check failed:', isAllowanceValid.error);
  return;
}

if (!isAllowanceValid.value) {
  const approveResult = await sodax.moneyMarket.approve({
    params: repayParams,
    walletProvider: evmWalletProvider,
  });

  if (!approveResult.ok) {
    console.error('Approval failed:', approveResult.error);
    return;
  }

  console.log('Approval transaction:', approveResult.value);
}

// Repay and relay (complete operation)
const repayAndSubmitResult = await sodax.moneyMarket.repay({
  params: repayParams,
  walletProvider: evmWalletProvider,
  timeout: DEFAULT_RELAY_TX_TIMEOUT,
});

if (repayAndSubmitResult.ok) {
  const { srcChainTxHash, dstChainTxHash } = repayAndSubmitResult.value;
  console.log('Repay successful:', { srcChainTxHash, dstChainTxHash });
} else {
  console.error('Repay failed:', repayAndSubmitResult.error);
}

// Create repay intent only (no relay wait)
const repayIntentResult = await sodax.moneyMarket.createRepayIntent({
  params: repayParams,
  walletProvider: evmWalletProvider,
});

if (repayIntentResult.ok) {
  const { tx: txHash, relayData } = repayIntentResult.value;
  console.log('Repay intent created:', txHash);
} else {
  console.error('Repay intent creation failed:', repayIntentResult.error);
}
```

## Error Handling

The Money Market module's user-facing methods return `Promise<Result<T, SodaxError<NarrowCode>>>`. Discriminate on `result.error.code` (a string literal) — never on `result.error.message`. This is the same canonical shape used by the swap module.

### The canonical error: `SodaxError<C>`

All MM-module errors are instances of `SodaxError`, exported from `@sodax/sdk`:

```typescript
import { SodaxError, isSodaxError } from '@sodax/sdk';

class SodaxError<C extends string = string> extends Error {
  readonly code: C;                         // string-literal discriminator
  readonly cause?: unknown;                 // ES2022 cause chain
  readonly context?: Record<string, unknown>;
  toJSON(): { name, code, message, stack, context, cause };
}
```

**Rules:**

- Discriminate on `error.code` — never on `error.message` (which is human-readable, may change).
- `error.cause` walks the underlying error chain (loggers like Sentry/Pino/Datadog walk this automatically).
- `error.context` carries structured metadata: `srcChainKey`, `dstChainKey`, `action`, `phase`, plus per-code extras (`relayCode`, `field`, …).
- `error.toJSON()` is the canonical logger surface; `JSON.stringify(error)` invokes it automatically and produces a logger-safe payload (bigints in `context` are coerced to strings, cause walked depth-3, no circular hazards).
- Use `isMoneyMarketError(e)` (broad) or one of the narrow guards `isMoneyMarketOrchestrationError(e)` / `isMoneyMarketCreateIntentError(e)` / `isMoneyMarketApproveError(e)` / `isMoneyMarketAllowanceCheckError(e)` / `isMoneyMarketGasEstimationError(e)` from `@sodax/sdk` instead of `instanceof SodaxError` in dapp/app code (bundle-safe).

### Per-method error type unions

The 4 orchestrators (`supply`/`borrow`/`withdraw`/`repay`) share **one** type — `MoneyMarketOrchestrationError`. They are not partitioned at the type level; instead, discriminate operations at runtime via `error.context.action`. Similarly, the 4 `create*Intent` methods share `MoneyMarketCreateIntentError`.

| Method | Error type | Codes |
|---|---|---|
| `supply` / `borrow` / `withdraw` / `repay` | `MoneyMarketOrchestrationError` | `USER_REJECTED`, `VALIDATION_FAILED`, `INTENT_CREATION_FAILED`, `TX_VERIFICATION_FAILED`, `TX_SUBMIT_FAILED`, `RELAY_TIMEOUT`, `RELAY_FAILED`, `EXECUTION_FAILED`, `UNKNOWN` |
| `createSupplyIntent` / `createBorrowIntent` / `createWithdrawIntent` / `createRepayIntent` | `MoneyMarketCreateIntentError` | `USER_REJECTED`, `VALIDATION_FAILED`, `INTENT_CREATION_FAILED`, `UNKNOWN` |
| `approve` | `MoneyMarketApproveError` | `USER_REJECTED`, `VALIDATION_FAILED`, `APPROVE_FAILED`, `UNKNOWN` |
| `isAllowanceValid` | `MoneyMarketAllowanceCheckError` | `VALIDATION_FAILED`, `ALLOWANCE_CHECK_FAILED`, `UNKNOWN` |
| `estimateGas` | `MoneyMarketGasEstimationError` | `VALIDATION_FAILED`, `GAS_ESTIMATION_FAILED`, `UNKNOWN` |

Use `error.context.action` (`'supply' | 'borrow' | 'withdraw' | 'repay'`) to discriminate which orchestrator surfaced the error.

### Standard `context` fields

```typescript
{
  srcChainKey?: SpokeChainKey;
  dstChainKey?: SpokeChainKey;
  action?: 'supply' | 'borrow' | 'withdraw' | 'repay';  // on relay/verify codes
  phase?: 'validate' | 'intentCreation' | 'verify' | 'submit' | 'relay' |
          'approve' | 'allowanceCheck' | 'gasEstimation';
  relayCode?: 'SUBMIT_TX_FAILED' | 'RELAY_TIMEOUT' | 'RELAY_POLLING_FAILED' | 'UNKNOWN';
  field?: string;     // on VALIDATION_FAILED
  reason?: string;
}
```

### Discrimination example

```typescript
import { isMoneyMarketOrchestrationError } from '@sodax/sdk';

const result = await sodax.moneyMarket.supply({
  params: supplyParams,
  walletProvider: evmWalletProvider,
});

if (!result.ok) {
  // result.error is MoneyMarketOrchestrationError = SodaxError<MoneyMarketOrchestrationErrorCode>
  // with context.action === 'supply'
  switch (result.error.code) {
    case 'VALIDATION_FAILED':
      // Bad input — error.message is human-readable; error.context.field tells you which.
      console.error('Bad input:', result.error.message);
      break;

    case 'INTENT_CREATION_FAILED':
      // Spoke deposit failed.
      console.error('Intent creation failed:', result.error.cause);
      break;

    case 'TX_VERIFICATION_FAILED':
      // Spoke tx couldn't be verified on-chain.
      break;

    case 'TX_SUBMIT_FAILED':
      // CRITICAL: spoke tx landed but the relay submission failed. Funds may be in flight.
      // Persist the original supply params (or just the spoke tx hash) and retry submission.
      console.error('Relay submit failed; retry needed:', result.error.context?.relayCode);
      break;

    case 'RELAY_TIMEOUT':
      // Relay packet didn't confirm in time. Check intent status and retry with longer timeout.
      break;

    case 'RELAY_FAILED':
      // Other relay failure. error.context.relayCode disambiguates:
      //   'RELAY_POLLING_FAILED' — polling endpoint outage; query hub directly to confirm packet status.
      //   'UNKNOWN' — forward-compat fallback for new relay error codes.
      break;

    case 'EXECUTION_FAILED':
      // Catch-all for the supply orchestration; cause has the original.
      console.error('Supply failed:', result.error.cause);
      break;

    case 'UNKNOWN':
      console.error('Unexpected:', result.error.cause);
      break;
  }
}
```

### Handling create-intent errors

`create*Intent` methods only cover the spoke-side transaction. Their narrow union excludes relay/verify codes:

```typescript
const r = await sodax.moneyMarket.createSupplyIntent({
  params: supplyParams,
  walletProvider: evmWalletProvider,
});

if (!r.ok) {
  switch (r.error.code) {
    case 'VALIDATION_FAILED':
      // Input validation: bad amount, unsupported token, wrong wallet provider type.
      break;
    case 'INTENT_CREATION_FAILED':
      // Spoke deposit failed (insufficient balance, network issues, simulation revert).
      break;
    case 'UNKNOWN':
      break;
  }
}
```

### Handling allowance + approval errors

```typescript
const a = await sodax.moneyMarket.isAllowanceValid({ params: supplyParams });
if (!a.ok && a.error.code === 'ALLOWANCE_CHECK_FAILED') {
  // Network / RPC issue; surface to user, retry.
}

if (a.ok && !a.value) {
  const ap = await sodax.moneyMarket.approve({ params: supplyParams, walletProvider: evmWalletProvider });
  if (!ap.ok && ap.error.code === 'APPROVE_FAILED') {
    // Approval transaction failed.
  }
}
```

### Migration from the legacy `error.message`-based pattern

If you were on the previous CODE-string-on-`error.message` pattern (or the older `MoneyMarketError<Code>` typed shape that the public docs [document](https://docs.sodax.com/developers/packages/foundation/sdk/functional-modules/money_market#error-handling)), here are the mappings:

| Before | After |
|---|---|
| `error.message === 'SUBMIT_TX_FAILED'` | `error.code === 'TX_SUBMIT_FAILED'` |
| `error.message === 'RELAY_TIMEOUT'` | `error.code === 'RELAY_TIMEOUT'` |
| `error.message === 'CREATE_SUPPLY_INTENT_FAILED'` | `error.code === 'INTENT_CREATION_FAILED'` |
| `error.message === 'CREATE_BORROW_INTENT_FAILED'` etc. | `error.code === 'INTENT_CREATION_FAILED'` etc. |
| `error.message === 'SUPPLY_UNKNOWN_ERROR'` etc. | `error.code === 'EXECUTION_FAILED'` etc. (with cause) |
| `isMoneyMarketSubmitTxFailedError(e)` | `e.code === 'TX_SUBMIT_FAILED'` (after `isMoneyMarketOrchestrationError(e)` and `e.context?.action === 'supply'`) |
| Prose `error.message` for invariants | `error.code === 'VALIDATION_FAILED'`; the prose stays on `error.message` |
| `error.data.payload` (historical) | **Not preserved.** Capture input params before calling if you need them for retry; this is the one departure from the historical published guidance. |

### Best practices

1. **Always handle `TX_SUBMIT_FAILED`**. Critical — the spoke tx landed but the relay submission failed. Funds may be in flight; persist the user's input and retry.
2. **Handle `RELAY_TIMEOUT` gracefully**. The spoke tx succeeded; the relay just didn't deliver in time. Check on-chain status before retrying.
3. **Discriminate `RELAY_FAILED` via `context.relayCode`**. `'RELAY_POLLING_FAILED'` (polling outage — packet status unknown) needs different UX from generic `'UNKNOWN'`.
4. **Use `error.cause` for forensics**. Every wrapped error preserves the original on `cause`. Loggers walk it automatically.
5. **Use `JSON.stringify(error)` for logging**. The `toJSON()` method handles bigint coercion + cause-chain truncation safely.
6. **Type-guard, don't `as`-cast**. Use the narrow guards (`isMoneyMarketOrchestrationError`, `isMoneyMarketCreateIntentError`, etc.) to narrow; an `as MoneyMarketOrchestrationError` cast after a generic `isSodaxError` check would silently widen the contract.

## Data Retrieval and Formatting

The Money Market SDK provides comprehensive data retrieval and formatting capabilities through the `MoneyMarketDataService`, accessible as `sodax.moneyMarket.data`. This service allows you to fetch reserve data, user data, and format them into human-readable values with USD conversions.

### Available Data Methods

#### Reserve Data
- `getReservesList(unfiltered?)` - Get list of all reserve addresses (bnUSD debt reserve filtered by default)
- `getReservesData()` - Get raw aggregated reserve data (bigint fields)
- `getReservesHumanized()` - Get humanized reserve data with decimal strings
- `getReserveData(asset)` - Get specific reserve data for an asset
- `getReserveNormalizedIncome(asset)` - Get normalized income for a specific asset (RAY precision)

#### User Data
- `getUserReservesData(spokeChainKey, userAddress)` - Get raw user reserve data
- `getUserReservesHumanized(spokeChainKey, userAddress)` - Get humanized user reserve data

#### E-Mode Data
- `getEModes()` - Get raw E-Mode data
- `getEModesHumanized()` - Get humanized E-Mode data

### Data Formatting

#### Formatting Reserve Data
- `formatReservesUSD(request)` - Format an array of reserves with USD conversions
- `formatReserveUSD(request)` - Format a single reserve with USD conversion

#### Formatting User Data
- `formatUserSummary(request)` - Format user portfolio summary with USD conversions

**NOTE**: If you need more customized formatting, see [math-utils](https://github.com/icon-project/sodax-sdks/tree/main/packages/sdk/src/moneyMarket/math-utils).

### Complete Example: Fetching and Formatting Data

```typescript
import { ChainKeys } from '@sodax/sdk';

// Fetch reserves data
const reserves = await sodax.moneyMarket.data.getReservesHumanized();

// Format reserves with USD conversions
const formattedReserves = sodax.moneyMarket.data.formatReservesUSD(
  sodax.moneyMarket.data.buildReserveDataWithPrice(reserves),
);

// Fetch user reserves data
const userReserves = await sodax.moneyMarket.data.getUserReservesHumanized(
  ChainKeys.BSC_MAINNET,
  userAddress,
);

// Format user summary with USD conversions
const userSummary = sodax.moneyMarket.data.formatUserSummary(
  sodax.moneyMarket.data.buildUserSummaryRequest(reserves, formattedReserves, userReserves),
);

console.log('formattedReserves:', formattedReserves);
console.log('userSummary:', userSummary);
```

### Step-by-Step Data Retrieval Process

#### 1. Fetch Raw Data

```typescript
import { ChainKeys } from '@sodax/sdk';

// Get humanized reserves data (decimal strings, no bigint)
const reserves = await sodax.moneyMarket.data.getReservesHumanized();

// Get user reserves data for a specific spoke chain
const userReserves = await sodax.moneyMarket.data.getUserReservesHumanized(
  ChainKeys.BSC_MAINNET,
  userAddress,
);
```

#### 2. Build Formatting Requests

```typescript
// Build request for reserve formatting
const reserveFormatRequest = sodax.moneyMarket.data.buildReserveDataWithPrice(reserves);

// Build request for user summary formatting
const userSummaryRequest = sodax.moneyMarket.data.buildUserSummaryRequest(
  reserves,
  formattedReserves,
  userReserves,
);
```

#### 3. Format Data

```typescript
// Format reserves with USD values
const formattedReserves = sodax.moneyMarket.data.formatReservesUSD(reserveFormatRequest);

// Format user summary with USD values
const userSummary = sodax.moneyMarket.data.formatUserSummary(userSummaryRequest);
```

### Data Structure Examples

#### Formatted Reserve Data

The `formattedReserves` array entries extend the humanized reserve shape with USD-denominated fields computed by `formatReservesUSD`:

```typescript
// Key USD-formatted fields added by formatReservesUSD:
{
  // Supply / borrow APY as decimal strings
  supplyAPY: string;
  variableBorrowAPY: string;

  // USD totals as decimal strings
  totalLiquidityUSD: string;
  totalVariableDebtUSD: string;
  availableLiquidityUSD: string;

  // Utilisation as decimal string
  utilizationRate: string;

  // Price from base currency
  priceInMarketReferenceCurrency: string;
  priceInUSD: string;

  // Original humanized fields (symbol, decimals, rates as decimal strings, etc.)
  // are preserved on the same object
}
```

#### Formatted User Summary

The `userSummary` object contains the user's portfolio information:

```typescript
// Key fields in FormatUserSummaryResponse:
{
  totalCollateralUSD: string;
  totalBorrowsUSD: string;
  totalLiquidityUSD: string;
  healthFactor: string;
  availableBorrowsUSD: string;
  currentTimestamp: number;
  userEmodeCategoryId: number;
  // ... additional fields
}
```

### Utility Functions

The SDK also provides utility functions for formatting specific values:

```typescript
import { formatPercentage, formatBasisPoints } from '@sodax/sdk';

// Format RAY-precision (27 decimal) rate as a percentage string
const rateValue = 52500000000000000000000000n; // 5.25% in RAY
const formattedRate = formatPercentage(rateValue, 27); // Returns "5.25%"

// Format basis points (1 bp = 0.01%) as a percentage string
const basisPointsValue = 250n; // 250 bps = 2.50%
const formattedBasisPoints = formatBasisPoints(basisPointsValue); // Returns "2.50%"
```
