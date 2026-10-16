# How to Make a Swap

Use this guide to understand each step of an SDK swap, including allowance, settlement, and failure handling.
For a shorter complete ESM example, start with [Your first swap](https://github.com/icon-project/sodax-sdks/blob/main/docs/quickstart.mdx).

| Find an answer | Section |
| --- | --- |
| Initialize configuration and wallets | [Setup](#step-1-initialize-sodax-instance) |
| Check allowance and approve | [Token allowance](#step-4-check-token-allowance) |
| Submit a swap | [Execution](#step-7-execute-the-swap) |
| Track settlement | [Intent status](#step-8-check-intent-status) |
| Handle execution failures | [Errors](#step-9-handle-errors) |
| Orchestrate the steps yourself | [Migrate a manual swap to submit-tx](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/MIGRATE_SWAP_TO_SUBMIT_TX.md) |
| Look up fields and error codes | [Swap reference](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/SWAPS.md) |

## Prerequisites

Before you begin, ensure you have:

- A wallet provider implementation (e.g., `IEvmWalletProvider` for EVM chains). You can use existing wallet provider implementations from the [`@sodax/wallet-sdk-core`](https://www.npmjs.com/package/@sodax/wallet-sdk-core) npm package, or use the local package [@wallet-sdk-core](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-core/README.md) if working within the SODAX monorepo.
- The `@sodax/sdk` package installed
- Sufficient token balance to cover the swap amount and fees
- RPC URLs for the chains you're interacting with (we recommend having a dedicated node provider like Alchemy, Quicknode, etc.)
- Private key or wallet (browser) connection for signing transactions. For React applications, you can use the [`@sodax/wallet-sdk-react`](https://www.npmjs.com/package/@sodax/wallet-sdk-react) npm package, or use the local package [@wallet-sdk-react](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/README.md) if working within the SODAX monorepo.

## Step 1: Initialize Sodax Instance

First, create and initialize a Sodax instance. The Sodax constructor defaults to mainnet configuration, so no configuration is required for basic usage.

```typescript
import { Sodax } from "@sodax/sdk";

// Create Sodax instance (defaults to mainnet configs)
const sodax = new Sodax();

// The current SDK keeps the constructor configuration when initialized.
const initResult = await sodax.initialize();
if (!initResult.ok) {
  console.warn('Initialization failed, using packaged defaults:', initResult.error);
  // The SDK continues to work with built-in default config — this is non-fatal.
}
```

**Note**:

- The `new Sodax()` constructor defaults to mainnet configuration automatically. No configuration is required for basic usage.
- Read effective configuration from `sodax.config` to include constructor overrides. For initialization behavior and configuration options, see [Configure SDK](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/CONFIGURE_SDK.md#default-configuration).

### Optional: Custom Configuration

If you need to use custom solver configuration or hub provider settings, you can pass them when creating the Sodax instance:

```typescript
import { Sodax, getSolverConfig } from "@sodax/sdk";

const sodax = new Sodax({
  solver: getSolverConfig(), // Custom solver config (takes no args; returns the packaged default object)
  hub: {
    rpcUrl: 'https://rpc.soniclabs.com', // override only what you need; the rest merges with the packaged HubConfig
  },
});

const initResult = await sodax.config.initialize();
if (!initResult.ok) {
  console.warn('Initialization failed, using packaged defaults:', initResult.error);
}
```

See [CONFIGURE_SDK.md](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/CONFIGURE_SDK.md) for the full `SodaxConfig` shape and canonical override patterns.

## Step 2: Obtain a Wallet Provider

The SDK does not require you to construct a spoke provider object. Instead, you supply a wallet provider directly in each service call. The `srcChainKey` field in the call params tells the SDK which chain to route to, and the `walletProvider` field is type-narrowed to the correct interface for that chain.

**Note**: For Node.js environments, we suggest you provide RPC URLs when creating wallet providers (default public ones might not work). For browser environments, wallet providers are typically injected by wallet extensions.

For EVM chains (Arbitrum, Polygon, BSC, etc.):

```typescript
import {
  ChainKeys,
  type IEvmWalletProvider,
  type Hex
} from "@sodax/sdk";
import { EvmWalletProvider } from "@sodax/wallet-sdk-core";

const evmWalletProvider: IEvmWalletProvider = new EvmWalletProvider({
  privateKey: '0x...' as Hex, // Your private key
  chainId: ChainKeys.ARBITRUM_MAINNET,
  rpcUrl: 'https://arb1.arbitrum.io/rpc', // Arbitrum RPC URL
});

// For browser: use the injected wallet provider from wallet extension or
// the @sodax/wallet-sdk-react package.
// const evmWalletProvider: IEvmWalletProvider = /* injected by wallet */;
```

**Important**: For the Sonic hub chain, pass an EVM wallet provider as well — Sonic is an EVM chain. The SDK distinguishes hub-vs-spoke behavior internally via `srcChainKey`.

### Getting Supported Tokens

Before creating a swap, you may want to check which tokens are supported for swaps on each chain:

```typescript
// Get all supported swap tokens for a specific chain
const supportedTokens = sodax.swaps.getSupportedSwapTokensByChainId(ChainKeys.ARBITRUM_MAINNET);
console.log('Supported tokens on Arbitrum:', supportedTokens);

// Get all supported swap tokens across all chains
const allSupportedTokens = sodax.swaps.getSupportedSwapTokens();
console.log('All supported tokens:', allSupportedTokens);

// Each token object contains address, decimals, symbol, etc.
supportedTokens.forEach(token => {
  console.log(`Token: ${token.symbol}, Address: ${token.address}, Decimals: ${token.decimals}`);
});
```

## Step 3: Get a Quote (Optional but Recommended)

Before executing a swap, it is good practice to get a quote to show users the expected output amount. This helps set proper expectations and allows you to calculate slippage tolerance.

**Example**: See how quotes are obtained in the example file: [`apps/node/src/swap.ts`](https://github.com/icon-project/sodax-sdks/blob/main/apps/node/src/swap.ts).

```typescript
import {
  ChainKeys,
  type SolverIntentQuoteRequest
} from "@sodax/sdk";

// Instance configuration includes constructor overrides; the packaged export does not.
const arbEthToken = sodax.config.spokeChainConfig[ChainKeys.ARBITRUM_MAINNET].nativeToken; // ETH on Arbitrum
const polygonPolToken = sodax.config.spokeChainConfig[ChainKeys.POLYGON_MAINNET].nativeToken; // POL on Polygon

// Amount to swap — IMPORTANT: Amount must be in the token's smallest unit.
// For example, ETH has 18 decimals, so 0.0001 ETH = 100000000000000n (0.0001 * 10^18).
const inputAmount = 100000000000000n; // 0.0001 ETH (18 decimals)

const quoteRequest = {
  token_src: arbEthToken,
  token_dst: polygonPolToken,
  token_src_blockchain_id: ChainKeys.ARBITRUM_MAINNET,
  token_dst_blockchain_id: ChainKeys.POLYGON_MAINNET,
  amount: inputAmount,
  quote_type: 'exact_input',
} satisfies SolverIntentQuoteRequest;

const quoteResult = await sodax.swaps.getQuote(quoteRequest);

if (!quoteResult.ok) {
  console.error('Failed to get quote:', quoteResult.error);
  // Handle error — could be no path found, invalid tokens, etc.
} else {
  const { quoted_amount } = quoteResult.value;
  console.log('Quoted output amount:', quoted_amount);
  // Use quoted_amount to set minOutputAmount in your intent params
}
```

## Step 4: Check Token Allowance

Before creating a swap intent, check whether the Asset Manager contract already has permission to spend your tokens. If not, you will need to approve it first.

**Example**: See how allowance checking is implemented in the example file: [`apps/node/src/swap.ts`](https://github.com/icon-project/sodax-sdks/blob/main/apps/node/src/swap.ts).

```typescript
import type { CreateIntentParams } from "@sodax/sdk";

const walletAddress = await evmWalletProvider.getWalletAddress();

// Prepare intent parameters (we'll complete this in Step 6)
const createIntentParams: CreateIntentParams<typeof ChainKeys.ARBITRUM_MAINNET> = {
  inputToken: arbEthToken,
  outputToken: polygonPolToken,
  inputAmount: inputAmount,
  minOutputAmount: 900000n, // Minimum output you're willing to accept
  deadline: 0n, // 0 = no deadline, or use sodax.swaps.getSwapDeadline() for a time-bounded deadline
  allowPartialFill: false,
  srcChainKey: ChainKeys.ARBITRUM_MAINNET,
  dstChainKey: ChainKeys.POLYGON_MAINNET,
  srcAddress: walletAddress,
  dstAddress: walletAddress, // Destination address (where output tokens are delivered)
  solver: '0x0000000000000000000000000000000000000000', // address(0) = any solver
  data: '0x',
};

// Check if approval is needed.
// isAllowanceValid accepts the same SwapActionParams shape as swap() / createIntent().
const allowanceResult = await sodax.swaps.isAllowanceValid({
  params: createIntentParams,
  walletProvider: evmWalletProvider,
});

if (!allowanceResult.ok) {
  console.error('Failed to check allowance:', allowanceResult.error);
  // Handle error — could be network issue, invalid token, etc.
} else if (!allowanceResult.value) {
  console.log('Approval required. Proceeding to Step 5...');
} else {
  console.log('Allowance is sufficient. Proceeding to Step 6...');
}
```

**Note on field names**: `CreateIntentParams` uses `srcChainKey` and `dstChainKey` (not `srcChain` / `dstChain`). The on-chain `Intent` type has `Intent.srcChain` / `Intent.dstChain` as bigint relay chain IDs — these are internal identifiers and should not be confused with the user-facing chain key fields.

## Step 5: Approve Tokens (If Needed)

If the allowance check returned `false`, approve the Asset Manager contract to spend your tokens. The approval amount matches the `inputAmount` in your intent parameters (fees are automatically deducted from this amount).

**Two signatures on some tokens.** A few ERC-20s of the 2017 TetherToken lineage — Ethereum USDT is
the one in the SODAX token list today — reject an allowance change from one non-zero value to
another. When the wallet already holds a stale allowance on such a token, `approve` sends
`approve(0)` first, waits for it to be mined, then sends the real approval, so the user signs twice.
The returned value is still a single hash — the **last** transaction's — so the code below is
unchanged. If you show an "Approving…" state, expect a second wallet prompt on those tokens.

**Example**: See how token approval is handled in the example file: [`apps/node/src/swap.ts`](https://github.com/icon-project/sodax-sdks/blob/main/apps/node/src/swap.ts).

```typescript
if (!allowanceResult.value) {
  console.log('Approving tokens...');

  const approveResult = await sodax.swaps.approve({
    params: createIntentParams,
    walletProvider: evmWalletProvider,
  });

  if (!approveResult.ok) {
    console.error('Failed to approve tokens:', approveResult.error);
    return; // Stop execution if approval fails
  }

  const approvalTxHash = approveResult.value;
  console.log('Approval transaction hash:', approvalTxHash);

  // IMPORTANT: Wait for the approval transaction to be confirmed before proceeding.
  await evmWalletProvider.waitForTransactionReceipt(approvalTxHash);
  console.log('Approval confirmed. Proceeding with swap...');
}
```

**Important**: Always wait for the approval transaction to be confirmed before proceeding with the swap.

**Raw mode**: `approve` also supports `raw: true` to return the unsigned transaction payload instead of broadcasting:

```typescript
const rawApproveResult = await sodax.swaps.approve({
  params: createIntentParams,
  raw: true,
  // walletProvider must be omitted when raw: true
});
```

## Step 6: Prepare Intent Parameters

Now that you have approval (if needed), prepare the complete intent parameters. Make sure to:

- Use the quoted amount from Step 3 to set a reasonable `minOutputAmount`
- Set an appropriate `deadline` (or use `0n` for no deadline / limit-order behavior)
- Ensure `srcAddress` matches your wallet address
- Set `dstAddress` to where you want to receive the output tokens

```typescript
// Optionally get a deadline (5 minutes from now by default)
const deadlineResult = await sodax.swaps.getSwapDeadline(); // or use 0n for no deadline
if (!deadlineResult.ok) {
  console.error('Failed to get deadline:', deadlineResult.error);
  return;
}
const deadline = deadlineResult.value;

// Prepare complete intent parameters
const createIntentParams: CreateIntentParams<typeof ChainKeys.ARBITRUM_MAINNET> = {
  inputToken: arbEthToken,
  outputToken: polygonPolToken,
  inputAmount: inputAmount,
  minOutputAmount: 900000n, // Minimum output (should be based on quote from Step 3)
  deadline: deadline,        // or 0n for no deadline
  allowPartialFill: false,   // Set to true to allow partial fills
  srcChainKey: ChainKeys.ARBITRUM_MAINNET,
  dstChainKey: ChainKeys.POLYGON_MAINNET,
  srcAddress: walletAddress, // Must match your wallet address
  dstAddress: walletAddress, // Where to receive output tokens
  solver: '0x0000000000000000000000000000000000000000', // address(0) = any solver
  data: '0x', // Additional arbitrary data
};
```

## Step 7: Execute the Swap

Now you're ready to execute the swap. The `swap` method orchestrates the complete lifecycle automatically:

1. Creates the intent deposit transaction on the source chain
2. Verifies the spoke transaction landed on-chain
3. Submits the transaction to the relayer and waits for the relay packet to land on the hub (Sonic). This step is skipped when `srcChainKey` is the hub itself.
4. Calls `postExecution` to notify the solver, triggering it to fill the intent

**Example**: See how the swap is executed in the example file: [`apps/node/src/swap.ts`](https://github.com/icon-project/sodax-sdks/blob/main/apps/node/src/swap.ts).

```typescript
const swapResult = await sodax.swaps.swap({
  params: createIntentParams,
  walletProvider: evmWalletProvider,
  // Optional parameters:
  // timeout: 120000, // Timeout in milliseconds waiting for hub relay (default: DEFAULT_RELAY_TX_TIMEOUT = 120 s)
  // skipSimulation: false, // Whether to skip transaction simulation (default: false)
});

if (!swapResult.ok) {
  // Handle error — see Step 9 for detailed error handling
  console.error('Swap failed:', swapResult.error.message);
} else {
  const { solverExecutionResponse, intent, intentDeliveryInfo } = swapResult.value;

  console.log('Swap successful!');
  console.log('Solver execution response:', solverExecutionResponse);
  console.log('Intent:', intent);
  console.log('Source transaction hash:', intentDeliveryInfo.srcTxHash);
  console.log('Destination transaction hash:', intentDeliveryInfo.dstTxHash);

  // Use intentDeliveryInfo.dstTxHash to poll for solver fill status (Step 8)
}
```

## Step 8: Check Intent Status

After a successful swap submission, continuously monitor the intent status until it reaches a terminal state. Poll every 5 seconds until the swap is completed, failed, or not found.

**Example**: See the complete status polling implementation in the example file: [`apps/node/src/swap.ts`](https://github.com/icon-project/sodax-sdks/blob/main/apps/node/src/swap.ts).

```typescript
import type { SolverIntentStatusRequest, SolverIntentStatusCode } from "@sodax/sdk";

/**
 * Polls the solver API until the intent reaches a terminal state.
 * Pass the hub-chain (destination) tx hash from the swap result.
 */
async function checkIntentStatus(
  sodax: Sodax,
  dstTxHash: string,
  maxAttempts = 60,
  intervalMs = 5000,
): Promise<void> {
  const statusRequest: SolverIntentStatusRequest = {
    intent_tx_hash: dstTxHash as `0x${string}`,
  };

  let attempt = 0;
  let lastStatus: SolverIntentStatusCode | null = null;
  let notFoundCount = 0;

  while (attempt < maxAttempts) {
    attempt++;
    const statusResult = await sodax.swaps.getStatus(statusRequest);

    if (!statusResult.ok) {
      console.error(`[Attempt ${attempt}] Failed to check intent status:`, statusResult.error);
      // Continue polling — may be a transient API issue
      await new Promise(resolve => setTimeout(resolve, intervalMs));
      continue;
    }

    const { status, fill_tx_hash } = statusResult.value;

    if (status === SolverIntentStatusCode.SOLVED) {
      console.log(`[Attempt ${attempt}] Status: Swap completed successfully!`);
      if (fill_tx_hash) {
        console.log(`Fill transaction hash: ${fill_tx_hash}`);
      }
      return;
    }

    if (status === SolverIntentStatusCode.FAILED) {
      console.log(`[Attempt ${attempt}] Status: Swap failed`);
      return;
    }

    if (status === SolverIntentStatusCode.NOT_FOUND) {
      notFoundCount++;
      if (notFoundCount >= 3) {
        console.log(`[Attempt ${attempt}] Intent not found after ${notFoundCount} attempts. Check tx hash manually.`);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs));
      continue;
    }

    if (status !== lastStatus) {
      switch (status) {
        case SolverIntentStatusCode.NOT_STARTED_YET:
          console.log(`[Attempt ${attempt}] Status: Intent queued, waiting to be processed`);
          break;
        case SolverIntentStatusCode.STARTED_NOT_FINISHED:
          console.log(`[Attempt ${attempt}] Status: Intent is being processed`);
          break;
        default:
          console.log(`[Attempt ${attempt}] Unknown status (${status})`);
          return;
      }
      lastStatus = status;
    } else {
      console.log(`[Attempt ${attempt}] Still processing... (status: ${status})`);
    }

    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  console.log(`Status polling reached maximum attempts (${maxAttempts}).`);
  console.log(`Last known status: ${lastStatus ?? 'unknown'}`);
  console.log(`Check manually using destination tx hash: ${dstTxHash}`);
}

// After successful swap, start polling for status
await checkIntentStatus(sodax, intentDeliveryInfo.dstTxHash);
```

**Status Codes**:

- `NOT_FOUND (-1)`: Intent not found in the solver system (may appear immediately after creation). After 3 consecutive NOT_FOUND responses, polling stops.
- `NOT_STARTED_YET (1)`: Intent is queued and waiting to be processed (continues polling)
- `STARTED_NOT_FINISHED (2)`: Intent is currently being processed (continues polling)
- `SOLVED (3)`: Swap completed successfully (includes `fill_tx_hash` when available) — **Terminal state**
- `FAILED (4)`: Swap failed to complete — **Terminal state**

**Polling Behavior**:

- Polls every 5 seconds (configurable via `intervalMs` parameter)
- Continues until a terminal state is reached (SOLVED, FAILED, or NOT_FOUND after 3 attempts)
- Maximum polling duration: 5 minutes by default (60 attempts × 5 seconds, configurable via `maxAttempts`)
- Handles temporary API errors gracefully by continuing to poll

**Note**: The `fill_tx_hash` field is only present when the status is `SOLVED (3)`. This is the transaction hash of the fill transaction on the destination chain.

## Step 9: Handle Errors

`swap()` returns `Result<SwapResponse, SodaxError<SwapErrorCode>>`. Lower-level methods such as `getQuote()` and `getStatus()` use their own error types; consult the per-method reference. Discriminate on **`result.error.code`** (a closed reason-only union), never on `error.message` (human-readable, may change). The original lower-level failure is preserved on `error.cause`; structured metadata is on `error.context`.

See [SWAPS.md](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/SWAPS.md#error-handling) for the full per-method code unions and `context` schema.

```typescript
if (!swapResult.ok) {
  const error = swapResult.error;
  switch (error.code) {
    case 'EXECUTION_FAILED':
      // Catch-all for the swap orchestrator. context.phase tells you which stage
      // ('postExecution' for the solver-API step).
      console.error('Swap orchestration failed:', error.cause);
      break;

    case 'RELAY_TIMEOUT':
      // Spoke transaction was submitted but the hub packet did not arrive within timeout.
      // The relay may still complete — poll the relayer API.
      console.error('Relay timed out. Cause:', error.cause);
      break;

    case 'TX_SUBMIT_FAILED':
      // CRITICAL: spoke tx landed but relay submission failed. Funds may be in flight.
      // Persist the user's input + spoke tx hash and retry submission.
      console.error('Relay submit failed:', error.context?.relayCode, error.cause);
      break;

    case 'RELAY_FAILED':
      // error.context.relayCode disambiguates:
      //   'RELAY_POLLING_FAILED' — polling endpoint outage; query the hub directly.
      //   'UNKNOWN'              — forward-compat fallback for new relay error codes.
      break;

    case 'VALIDATION_FAILED':
      // Bad input — error.context.field tells you which.
      console.error('Bad input:', error.message);
      break;

    case 'INTENT_CREATION_FAILED':
    case 'TX_VERIFICATION_FAILED':
    case 'EXTERNAL_API_ERROR':
    case 'UNKNOWN':
    default:
      console.error('Swap error:', error.code, error.cause);
  }
}
```

**Note**: The swap module exports narrow guards `isSwapError`, `isSwapCreateIntentError`, `isPostExecutionError` from `@sodax/sdk`. Use them in `catch` blocks for cross-bundle type safety; see [SWAPS.md](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/SWAPS.md#error-handling).

## Complete Example

[Your first swap](https://github.com/icon-project/sodax-sdks/blob/main/docs/quickstart.mdx) is the complete ESM example: follow its snippets
in order for installation, configuration, quoting, execution, and settlement polling. It uses native
gas tokens; for other inputs, also follow [Check Token Allowance](#step-4-check-token-allowance)
and [Approve Tokens](#step-5-approve-tokens-if-needed) above. On EVM chains this grants an ERC-20
allowance, on Stellar it sets up a trustline, and on other chains the check returns `true`.

The [Node smoke script](https://github.com/icon-project/sodax-sdks/blob/main/apps/node/src/swap.ts)
is an additional repository example. It executes on mainnet and reads its private key from the environment.

## Next Steps

- **Recovery**: Follow the [failed-swap recovery guidance](https://github.com/icon-project/sodax-sdks/blob/main/docs/developers/faq.md) before retrying a transaction that may have already been submitted
- Learn more about swap configuration and advanced features in [SWAPS.md](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/SWAPS.md)
- Explore other SDK features like [Money Market](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/MONEY_MARKET.md), [Bridge](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/BRIDGE.md), and [Staking](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/STAKING.md)
- Check the [README.md](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/README.md) for general SDK usage and configuration
- Read [ARCHITECTURE_REFACTOR_SUMMARY.md](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/ARCHITECTURE_REFACTOR_SUMMARY.md) for the full architecture reference
