---
title: "Monetize SDK"
icon: sack-dollar
generatedFrom: packages/sdk/docs/MONETIZE_SDK.md
---

Learn how to configure fees and monetize your SODAX SDK integration.

When using the SODAX SDK, you can monetize your integration by collecting fees from the transactions processed through your application.

## Two integration paths

| | **Orchestrator** — `sodax.swaps`, `sodax.moneyMarket`, `sodax.bridge`, `sodax.leverageYield` | **Swaps API** — `sodax.api.swaps`, `@sodax/swaps-api`, raw `POST /swaps/*` |
|---|---|---|
| Where the fee comes from | `new Sodax({ … })` config, applied client-side | `partnerFee` on each request body |
| Fee on the wire | Baked into the intent by the SDK | `partnerFee` field in the payload |
| Configured fee, no `partnerFee` on the request | Applies automatically | Ignored — config is never read here |

On the Swaps API path there is no default: omit `partnerFee` and the swap succeeds with no fee.
See [Swaps API monetization](#swaps-api-monetization). The Bridge API is different — omitted
`partnerFee` falls back to the backend's `bridgePartnerFee`.

The sections immediately below describe the orchestrator path.
Fees are configured globally per feature when creating the `Sodax` instance, and the swap, bridge and leverage-yield features additionally accept a per-action override: swap's `getQuote()` and leverage-yield's `getQuote()` take an optional `partnerFee`, swap's `swap()` / `createIntent()` and bridge's `bridge()` / `createBridgeIntent()` read `extras.partnerFee`, and leverage-yield's `deposit()` / `vaultSwap()` / `createVaultIntent()` take `partnerFee` directly. When omitted, the configured fee applies.

## Defining Fee

```typescript
import { PartnerFee } from '@sodax/sdk';

// Partner fee can be defined as a percentage or a definite token amount.
// Fee is optional, you can leave it empty/undefined.
// `address` must be a real Sonic address you control — nothing validates it.
const partnerFeePercentage = {
  address: '0xYourFeeReceiverOnSonic', // EVM (Sonic) address to receive fee
  percentage: 100, // 100 = 1%, 10000 = 100%
} satisfies PartnerFee;

const partnerFeeAmount = {
  address: '0xYourFeeReceiverOnSonic', // EVM (Sonic) address to receive fee
  amount: 1000n, // definite amount denominated in token decimal precision
} satisfies PartnerFee;
```

## Global fee configuration

On the orchestrator path, configure fees globally per feature with `new Sodax({...configuration})`.
This applies to `sodax.swaps` / `sodax.moneyMarket` / `sodax.bridge` / `sodax.leverageYield` only
(not `sodax.api.*`):

```typescript
import { Sodax, PartnerFee } from '@sodax/sdk';

// both partnerFeePercentage or partnerFeeAmount can be used

// apply fee to swap feature
const sodaxWithSwapFees = new Sodax({
  swaps: { partnerFee: partnerFeePercentage },
});

// apply fee to money market feature
const sodaxWithMoneyMarketFees = new Sodax({
  moneyMarket: { partnerFee: partnerFeePercentage },
});

// apply fee to bridge feature
const sodaxWithBridgeFees = new Sodax({
  bridge: { partnerFee: partnerFeePercentage },
});

// apply fee to leverage-yield vault deposits and withdrawals
const sodaxWithLeverageYieldFees = new Sodax({
  leverageYield: { partnerFee: partnerFeePercentage },
});

// apply fee to multiple features
const sodaxWithFees = new Sodax({
  swaps: { partnerFee: partnerFeePercentage },
  moneyMarket: { partnerFee: partnerFeePercentage },
  bridge: { partnerFee: partnerFeePercentage },
  leverageYield: { partnerFee: partnerFeePercentage },
});
```

Each feature's fee is independent: `swaps.partnerFee` applies to `sodax.swaps` only and does **not**
apply to leverage-yield vault flows, even though those are executed as solver intents. A feature with
no `partnerFee` of its own falls back to the global `fee`.

## Per-request fee configuration

The swap feature supports a per-action fee override that beats the configured `swaps.partnerFee` (per-feature override, else global). When omitted, the configured fee applies. This is what lets a backend construct swap intents on behalf of partners whose fee differs per request.

Precedence is the same for every feature that accepts an override: **per-action fee → feature fee → global `fee` → no fee.**

Two consequences worth knowing:

- **An override of `undefined` is not "no fee" — it falls back to the configured fee.** `partnerFee: undefined` and omitting `partnerFee` behave identically, so a lookup that misses (`partnerFee: feesByPartner[id]`) charges the configured fee rather than nothing. If you need a specific request to charge nothing while a fee is configured, pass a zero fee explicitly: `{ address, percentage: 0 }`.
- **To read the fee without placing an order,** use `sodax.swaps.getPartnerFee(amount)` (or `sodax.bridge.getFee(amount)`) rather than quoting with a zero fee — quotes already return the net amount, so they cannot tell you the fee that was deducted.

Money market is the exception: it has no per-action override, so every money-market flow charges the configured `moneyMarket.partnerFee` (else the global `fee`).

### Quote request

`SwapService.getQuote()` deducts the partner fee from the `amount` before forwarding to the solver, so `quoted_amount` reflects the net output. No fee field appears in the solver request payload — the deduction happens client-side. Pass an optional `partnerFee` field on the request payload to match a per-action override used on `createIntent` / `swap`; omit it to use the configured swap fee.

```typescript
import {
  type SolverIntentQuoteRequest,
} from "@sodax/sdk";

const quoteRequest = {
  token_src: '0x...', // The address of the source token on the spoke chain
  token_dst: '0x...', // The address of the destination token on the spoke chain
  token_src_blockchain_id: ChainKeys.BSC_MAINNET,  // Source chain key (e.g. Binance Smart Chain)
  token_dst_blockchain_id: ChainKeys.ARBITRUM_MAINNET, // Destination chain key (e.g. Arbitrum)
  amount: 1000000000000000n, // token amount in scaled token decimal precision (e.g. 1 ETH = 1e18)
  quote_type: 'exact_input', // type of quote
} satisfies SolverIntentQuoteRequest;

// Uses the configured swaps.partnerFee:
const result = await sodax.swaps.getQuote(quoteRequest);

// Or override the fee just for this quote (matches an extras.partnerFee passed to createIntent/swap):
const overriddenResult = await sodax.swaps.getQuote({ ...quoteRequest, partnerFee: partnerFeePercentage });

if (result.ok) {
  const { quoted_amount } = result.value;
  console.log('Quoted amount:', quoted_amount);
} else {
  // handle error
  console.error('Quote failed:', result.error);
}
```

### Swap request

The fee is applied automatically by the service, which encodes it into the intent it builds, so no fee field appears on the wire. Pass `extras.partnerFee` to override the configured `swaps.partnerFee` for this single action — omit `extras` (or `extras.partnerFee`) to use the configured fee.

```typescript
const swapResult = await sodax.swaps.swap({
  params: {
    inputToken: '0x...',  // The address of the input token on the spoke chain
    outputToken: '0x...', // The address of the output token on the spoke chain
    inputAmount: 1_000_000n, // Amount of input tokens, fee will be deducted from this amount
    minOutputAmount: 900_000n, // Minimum output tokens expected
    deadline: 0n, // Optional: timestamp after which intent expires (0 = no deadline)
    allowPartialFill: false, // Whether intent can be partially filled
    srcChainKey: ChainKeys.BSC_MAINNET, // Source chain key
    dstChainKey: ChainKeys.ARBITRUM_MAINNET, // Destination chain key
    srcAddress: '0x...', // Originating address on source chain
    dstAddress: '0x...', // Destination address on destination chain
    solver: '0x0000000000000000000000000000000000000000', // Optional: specific solver, address(0) means any solver
    data: '0x', // Arbitrary additional data
  },
  extras: { partnerFee: partnerFeePercentage }, // optional per-action fee override; falls back to the configured swaps.partnerFee
  walletProvider, // chain-narrowed wallet provider for the source chain
  timeout, // optional, request timeout in ms if needed
  skipSimulation, // optional - whether to skip transaction simulation (default: false)
});
```

### Leverage-yield vault requests

Vault deposits and withdrawals are solver intents, but they are priced off the **leverage-yield** fee
(`leverageYield.partnerFee`, else the global `fee`) — never `swaps.partnerFee`. **Both directions are
charged.** Pass `partnerFee` to `deposit()` or `withdraw()` (it rides on the returned payload), or
directly to `vaultSwap()` / `createVaultIntent()`, to override the configured fee for one intent.

The fee always comes out of `inputAmount`, so its denomination differs by direction: a deposit's input
is the token being paid in, while a **withdraw's input is the vault itself — that fee is taken in
`lsoda*` shares**, so the receiver accrues vault shares rather than the output token. Both are hub-side
ERC20s and both show up in `sodax.partners.feeClaim`.

Quote through `sodax.leverageYield.getQuote()`, not `sodax.swaps.getQuote()`: it deducts the same
effective leverage-yield fee the intent will charge, so the quote and the intent agree. Quoting a
vault flow through the swap service deducts the swap fee instead. You *can* make the two agree by
passing the leverage-yield fee to `swaps.getQuote` explicitly — using a zero fee
(`{ address, percentage: 0 }`) when that effective fee is `undefined`, because an explicit
`undefined` falls back to the configured swap fee — but `leverageYield.getQuote()` resolves it for
you and is the canonical path.

**Pass the same `partnerFee` to the quote and to the deposit.** The fee is deducted from the input
before the swap, so a quote taken with a different fee is sized on a different net input. If the
intent's fee is the larger of the two, `minOutputAmount` derived from that quote is higher than the
intent can deliver and the intent will not fill. Omitting `partnerFee` on both calls is equally
safe — both then resolve the same effective leverage-yield fee.

```typescript
const vault = sodax.leverageYield.getVault('lsodaWEETH');
if (!vault) return;

const inputToken = '0x...';   // weETH on Arbitrum
const inputAmount = 1_000_000n;
const SLIPPAGE_BPS = 50n;     // 0.5%

// Quote first — token_dst = vault for a deposit, token_src = vault for a withdraw.
const quote = await sodax.leverageYield.getQuote({
  token_src: inputToken,
  token_src_blockchain_id: ChainKeys.ARBITRUM_MAINNET,
  token_dst: vault.vault,     // the lsoda* vault proxy
  token_dst_blockchain_id: ChainKeys.SONIC_MAINNET,
  amount: inputAmount,
  quote_type: 'exact_input',
  partnerFee: partnerFeePercentage, // same value as the deposit below
});
if (!quote.ok) return;

const built = await sodax.leverageYield.deposit({
  vault: vault.vault,
  srcChainKey: ChainKeys.ARBITRUM_MAINNET,
  srcAddress: '0x...',
  inputToken,
  inputAmount,
  minOutputAmount: (quote.value.quoted_amount * (10_000n - SLIPPAGE_BPS)) / 10_000n,
  partnerFee: partnerFeePercentage, // same value as the quote above
});
```

## Swaps API monetization

On `sodax.api.swaps` / `@sodax/swaps-api` / raw `/swaps/*`, put `partnerFee` on the request body —
SDK fee config does not apply. Send the same value on quote and create-intent:

```typescript
const partnerFee = {
  address: '0xYourSonicFeeReceiver',
  percentage: 10, // basis points: 10 = 0.1%, 100 = 1%
};

const quote = await sodax.api.swaps.getQuote({
  tokenSrc, tokenSrcChainKey, tokenDst, tokenDstChainKey,
  amount: '1000000000',
  quoteType: 'exact_input',
  partnerFee,
});

const created = await sodax.api.swaps.createIntent({
  srcChainKey, dstChainKey, inputToken, outputToken,
  inputAmount: '1000000000', minOutputAmount, deadline: '0',
  allowPartialFill: false, srcAddress, dstAddress,
  partnerFee,
});
```

`checkAllowance` / `approve` accept the field via the shared body but ignore it. Use `amount`
(decimal string) instead of `percentage` for a flat fee; if both are set the backend uses `amount`.

Reference: [SWAPS_API.md](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/SWAPS_API.md),
[`@sodax/swaps-api` README](https://github.com/icon-project/sodax-sdks/blob/main/packages/swaps-api/README.md).

## Partner Fee Claiming

Partners earn fees from every swap or bridge operation they facilitate. Those fees accrue as
wrapped ERC-20 tokens on the Sonic hub chain. The `sodax.partners` service exposes the full
lifecycle for retrieving and converting those balances.

### Accessing the partner service

```typescript
// Access via the Sodax facade — property is `partners` (not `partner`)
const { feeClaim } = sodax.partners;
```

### Step 1 — Query accrued balances

`fetchAssetsBalances` issues a multicall to the hub chain and returns only non-zero balances,
keyed by the wrapped asset address on Sonic.

```typescript
import { ChainKeys } from '@sodax/sdk';

const balancesResult = await sodax.partners.feeClaim.fetchAssetsBalances(
  '0xYourSonicAddress',
);

if (balancesResult.ok) {
  for (const [assetAddress, balance] of balancesResult.value) {
    console.log(`${balance.symbol}: ${balance.balance} (decimals: ${balance.decimal})`);
    console.log(`  Hub address:      ${balance.address}`);
    console.log(`  Original chain:   ${balance.originalChain}`);
    console.log(`  Original address: ${balance.originalAddress}`);
  }
} else {
  // result.error.code === 'LOOKUP_FAILED' (context.method === 'fetchAssetsBalances')
  console.error('Balance fetch failed:', balancesResult.error);
}
```

### Step 2 — Configure auto-swap preferences

Before claiming, configure where swapped proceeds should be delivered. Preferences are stored
on-chain and applied automatically to every future `createIntentAutoSwap` call.

```typescript
import { ChainKeys } from '@sodax/sdk';

// Read current preferences
const prefsResult = await sodax.partners.feeClaim.getAutoSwapPreferences('0xYourSonicAddress');
if (prefsResult.ok) {
  const { outputToken, dstChainKey, dstAddress } = prefsResult.value;
  // dstChainKey === 'not configured' when no destination chain has been set yet
  console.log('Current preferences:', { outputToken, dstChainKey, dstAddress });
}

// Write new preferences
const setResult = await sodax.partners.feeClaim.setSwapPreference({
  params: {
    srcChainKey: ChainKeys.SONIC_MAINNET, // must be the hub chain key
    srcAddress: '0xYourSonicAddress',
    outputToken: '0xDesiredOutputTokenAddress', // spoke-chain or hub-chain address
    dstChainKey: ChainKeys.ARBITRUM_MAINNET,   // chain to receive proceeds
    dstAddress: '0xYourArbitrumAddress',
  },
  walletProvider, // EVM wallet provider for Sonic
});

if (!setResult.ok) {
  console.error('Set preference failed:', setResult.error);
}
```

`setSwapPreference` supports both signed execution (`raw: false`) and raw transaction building
(`raw: true`). When `raw: true`, `walletProvider` must be omitted — the method returns the
unsigned transaction object instead.

### Step 3 — Approve the fee token

Before swapping, ensure the ProtocolIntents contract is approved to spend the fee token.
Native tokens are pre-approved and always return `true` from `isTokenApproved`.

**Some tokens take two transactions.** A few ERC-20s of the 2017 TetherToken lineage reject an
allowance change from one non-zero value to another, so `approveToken` sends `approve(0)` first and
waits for it to be mined before the real approval — the user signs twice. This applies here more
often than elsewhere, because fee approval always requests an unlimited allowance, so a second claim
is always a non-zero to non-zero change. The returned value is still a single transaction hash, the
**last** one's.

```typescript
const approvedResult = await sodax.partners.feeClaim.isTokenApproved({
  srcChainKey: ChainKeys.SONIC_MAINNET,
  srcAddress: '0xYourSonicAddress',
  token: '0xFeeTokenHubAddress',
});

if (approvedResult.ok && !approvedResult.value) {
  // Not yet approved — send the approval transaction
  const approveResult = await sodax.partners.feeClaim.approveToken({
    params: {
      srcChainKey: ChainKeys.SONIC_MAINNET,
      srcAddress: '0xYourSonicAddress',
      token: '0xFeeTokenHubAddress',
    },
    walletProvider, // EVM wallet provider for Sonic
  });

  if (!approveResult.ok) {
    // result.error.code === 'APPROVE_FAILED'
    console.error('Approval failed:', approveResult.error);
  }
}
```

### Step 4 — Claim fees (end-to-end swap)

`swap` is the high-level method that submits the auto-swap intent on-chain and notifies the
solver to execute it in one call.

```typescript
const claimResult = await sodax.partners.feeClaim.swap({
  params: {
    srcChainKey: ChainKeys.SONIC_MAINNET, // must be the hub chain key
    srcAddress: '0xYourSonicAddress',
    fromToken: '0xFeeTokenHubAddress',
    amount: 1_000_000_000_000_000_000n, // amount in token's native decimals
    timeout: 30_000, // optional, ms to wait for tx confirmation
  },
  walletProvider, // EVM wallet provider for Sonic
});

if (claimResult.ok) {
  const { srcTxHash, intentTxHash, solverExecutionResponse } = claimResult.value;
  console.log('Intent submitted:', srcTxHash);
  console.log('Intent confirmed:', intentTxHash);
  console.log('Solver response:', solverExecutionResponse);
} else {
  // result.error.code may be:
  //   'EXECUTION_FAILED' (context.action === 'waitAutoSwap') — receipt polling failed after submission
  //   error from createIntentAutoSwap — if the initial tx failed
  //   error from SolverApiService.postExecution — if solver notification failed
  console.error('Claim failed:', claimResult.error.code, claimResult.error.cause);
}
```

Use `createIntentAutoSwap` instead of `swap` when you need manual control over the solver
notification step (e.g. to retry independently).

### Step 5 — Same-token claims (no conversion) and recovery

The solver cannot fill a swap whose output token equals its input token. If a partner's configured
output token is the same asset as the fee token they are claiming (e.g. claiming BTC fees while the
auto-swap output is BTC), `swap` rejects it up front with `VALIDATION_FAILED` instead of creating an
unfillable intent that would lock the funds.

To deliver such a fee **as-is**, skip the swap and move the wrapped fee token off Sonic with the
bridge — to its native chain, or to a Sonic address for same-chain delivery:

```typescript
const withdrawResult = await sodax.bridge.bridge({
  params: {
    srcChainKey: ChainKeys.SONIC_MAINNET,
    srcAddress: '0xYourSonicAddress',
    srcToken: '0xFeeTokenHubAddress', // the wrapped fee token's address on Sonic
    amount: 1_000_000n,
    dstChainKey: ChainKeys.SONIC_MAINNET, // or the fee token's native chain
    dstToken: '0xFeeTokenHubAddress', // same hub asset for Sonic; the original token address on a native chain
    recipient: '0xRecipient',
  },
  walletProvider,
});
```

Bridging from Sonic pulls the token via the partner's hub-wallet router, so it needs a bridge
allowance first (`sodax.bridge.isAllowanceValid` / `sodax.bridge.approve`) — a different spender than
the ProtocolIntents approval used by `swap`.

If a same-token claim was already submitted before this guard existed, the funds sit in an unfillable
intent. Recover them with `cancelIntent`, which calls ProtocolIntents' own `cancelIntent(fromToken,
toToken)` and refunds the locked amount to the partner. This is the only authorized cancel path: the
intent's creator is the ProtocolIntents contract, so the generic `SwapService.cancelIntent` reverts
`Unauthorized()`.

```typescript
// Detect a stuck intent for a token pair (0x0…0 == none):
const intentHash = await sodax.partners.feeClaim.getUserIntent({
  user: '0xYourSonicAddress',
  fromToken: '0xFeeTokenHubAddress',
  toToken: '0xOutputTokenHubAddress', // same as fromToken for a same-token claim
});

// Recover (refunds the locked tokens to your wallet):
const recoverResult = await sodax.partners.feeClaim.cancelIntent({
  params: {
    srcChainKey: ChainKeys.SONIC_MAINNET,
    srcAddress: '0xYourSonicAddress',
    fromToken: '0xFeeTokenHubAddress',
    toToken: '0xOutputTokenHubAddress',
  },
  walletProvider,
});
```

### Error handling

All `partners.feeClaim` methods return `Promise<Result<T, SodaxError<PartnerErrorCode>>>` from
the unified vocabulary. Discriminate on `error.code` (closed reason-only union) and
`error.feature === 'partner'`. The original lower-level failure is preserved on `error.cause`;
operation/method partition is on `error.context.action` / `error.context.method`.

```typescript
import { isPartnerError, type PartnerError } from '@sodax/sdk';

if (!result.ok) {
  // result.error: PartnerError = SodaxError<PartnerErrorCode>
  switch (result.error.code) {
    case 'USER_REJECTED':
      // User cancelled the approveToken wallet prompt. Not a failure — reset the UI.
      break;
    case 'VALIDATION_FAILED':
      // Bad input — see context.field.
      break;
    case 'LOOKUP_FAILED':
      // Read failed — context.method is one of:
      //   'fetchAssetsBalances' | 'getAutoSwapPreferences' | 'isTokenApproved'
      //   | 'getUserIntent' | 'getIntentDetails'
      break;
    case 'APPROVE_FAILED':
      // approveToken transaction failed.
      break;
    case 'EXECUTION_FAILED':
      // Orchestrator-level failure — context.action === 'waitAutoSwap'.
      break;
    case 'UNKNOWN':
      break;
  }
  if (result.error.code !== 'USER_REJECTED') {
    console.error('Partner error:', result.error.toJSON());
  }
}
```

`PartnerErrorCode` is the narrow union `'USER_REJECTED' | 'VALIDATION_FAILED' | 'LOOKUP_FAILED' | 'APPROVE_FAILED' | 'EXECUTION_FAILED' | 'UNKNOWN'`. Use `isPartnerError(e)` instead of `instanceof SodaxError` in dapp/app code (bundle-safe).

### Raw transaction mode

Every write method on `PartnerFeeClaimService` supports `raw: true` to obtain the unsigned
transaction instead of broadcasting it. When `raw: true`, the `walletProvider` field must be
omitted — TypeScript enforces this at compile time.

```typescript
// Build the unsigned setSwapPreference transaction without broadcasting
const rawTxResult = await sodax.partners.feeClaim.setSwapPreference({
  params: {
    srcChainKey: ChainKeys.SONIC_MAINNET,
    srcAddress: '0xYourSonicAddress',
    outputToken: '0xOutputTokenAddress',
    dstChainKey: ChainKeys.ARBITRUM_MAINNET,
    dstAddress: '0xYourArbitrumAddress',
  },
  raw: true,
  // walletProvider must NOT be passed when raw: true
});

if (rawTxResult.ok) {
  const { from, to, data, value } = rawTxResult.value;
  // Sign and broadcast yourself
}
```
