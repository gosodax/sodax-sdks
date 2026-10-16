---
title: "Bridge"
icon: bridge-suspension
generatedFrom: packages/sdk/docs/BRIDGE.md
---

> **Error handling conventions:** This module uses the canonical `SodaxError<BridgeErrorCode>` shape (same family as the swap and money market modules). Discriminate on `result.error.code` (e.g. `'RELAY_TIMEOUT'`, `'INTENT_CREATION_FAILED'`); structured details live on `result.error.context` (`srcChainKey`, `dstChainKey`, `phase`, `relayCode`, `field`). See the **Error Handling** section below for the full per-method code table and migration notes from the legacy `error.message`-based pattern.

The `BridgeService` class, reachable via `sodax.bridge`, orchestrates cross-chain token transfers within the SODAX hub-and-spoke architecture.

Bridging works by depositing tokens into a spoke vault on the source chain, which triggers a cross-chain message relayed to the Sonic hub. The hub then performs vault transformations (deposit/withdraw) and forwards the tokens to the destination chain via the asset manager.

Three transfer directions are supported:
- **Spoke → Hub** — deposit into hub vault
- **Hub → Spoke** — withdrawal from hub vault
- **Spoke → Spoke** — deposit on source + withdraw on destination

> **Backend Bridge API.** For the typed HTTP client over the backend `/bridge/*` routes (`sodax.api.bridge`
> — allowance/approve/create-intent, submit-tx + status, tokens), see [`BRIDGE_API.md`](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/BRIDGE_API.md). The
> `bridge()` orchestrator routes the spoke-deposit through that API by default (`bridge.useBackendSubmitTx`,
> default ON) with a client-side fallback; set `new Sodax({ bridge: { useBackendSubmitTx: false } })` to
> force the client-side relay — see
> [`CONFIGURE_SDK.md`](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/CONFIGURE_SDK.md#backend-submit-tx-bridgeusebackendsubmittx).

## Methods

### isAllowanceValid

Checks whether the caller has sufficient token allowance to execute the bridge.

The required spender varies by chain type:
- **Hub (Sonic)**: the caller's hub wallet router contract
- **EVM spoke**: the spoke chain's asset manager contract
- **Stellar**: validated by the Stellar spoke service (no explicit spender needed)
- **All other chain types** (e.g. Solana, NEAR, Bitcoin): returns `true` — approvals are not applicable

**Parameters:**
- `_params`: `BridgeParams<S, Raw>` — bridge parameters including source chain key, token, amount, and sender address

**Returns:** `Promise<Result<boolean>>`

**Note**: For Stellar-based operations, the allowance system works differently:
- **Source chain (Stellar)**: this method checks and establishes trustlines automatically via the Stellar spoke service.
- **Destination chain (Stellar)**: clients must manually check trustlines using `StellarSpokeService.hasSufficientTrustline` before executing bridge operations.

**Example:**
```typescript
import { ChainKeys } from '@sodax/sdk';

const result = await sodax.bridge.isAllowanceValid({
  params: {
    srcChainKey: ChainKeys.BASE_MAINNET,
    srcAddress: '0xYourAddress...',
    srcToken: '0x1234567890abcdef...',
    amount: 1000000000000000000n, // 1 token in base units
    dstChainKey: ChainKeys.POLYGON_MAINNET,
    dstToken: '0xabcdef1234567890...',
    recipient: '0x9876543210fedcba...',
  },
  walletProvider: evmWalletProvider,
});

if (result.ok && result.value) {
  console.log('Allowance is sufficient');
} else {
  console.log('Need to approve tokens first');
}
```

### approve

Grants token spending approval required before executing a bridge.

**Some tokens take two transactions.** A few ERC-20s of the 2017 TetherToken lineage — Ethereum USDT
is the only one in the SODAX token list today — reject an allowance change from one non-zero value to
another, so `approve` sends `approve(0)` first and waits for it to be mined before the real approval.
The user signs twice; the returned value is still a single transaction hash, the **last** one's.
Detection simulates the approval rather than consulting a token list, so a token listed later behaves
the same way.

Approval targets differ by chain:
- **Hub (Sonic)**: approves the caller's hub wallet router contract.
- **EVM spoke**: approves the spoke chain's asset manager contract.
- **Stellar**: delegates to the Stellar spoke service for trustline/allowance handling.
- **All other chain types**: returns an error — approvals are not supported.

When `raw` is `true`, the encoded transaction is returned without broadcasting.
When `raw` is `false`, the transaction is signed and submitted via the provided wallet provider.

**Parameters:**
- `_params`: `BridgeParams<K, Raw>` — bridge parameters including source chain key, token, amount, wallet provider, and `raw` flag

**Returns:** `Promise<Result<TxReturnType<K, Raw>>>`

**Note**: For Stellar-based operations, the approval system works differently:
- **Source chain (Stellar)**: this method establishes trustlines automatically.
- **Destination chain (Stellar)**: clients must manually establish trustlines using `StellarSpokeService.requestTrustline` before executing bridge operations.

**Example (signed):**
```typescript
import { ChainKeys } from '@sodax/sdk';

const result = await sodax.bridge.approve({
  params: {
    srcChainKey: ChainKeys.BASE_MAINNET,
    srcAddress: '0xYourAddress...',
    srcToken: '0x1234567890abcdef...',
    amount: 1000000000000000000n,
    dstChainKey: ChainKeys.POLYGON_MAINNET,
    dstToken: '0xabcdef1234567890...',
    recipient: '0x9876543210fedcba...',
  },
  walletProvider: evmWalletProvider,
});

if (result.ok) {
  console.log('Approval transaction hash:', result.value);
} else {
  console.error('Approval failed:', result.error.message);
}
```

**Example (raw):**
```typescript
const result = await sodax.bridge.approve({
  params: { /* ... */ },
  raw: true,
  // walletProvider must NOT be passed when raw: true
});
```

### buildApproveTxs

The unsigned approval transactions for the bridge's source token, in the order they must be broadcast.

`approve({ raw: true })` returns exactly one transaction, which cannot express the two-step plan a
stale allowance on a USDT-class token requires (see the note under [approve](#approve)). This method
returns both, named rather than ordered, so there is no index to map:

**Parameters:**
- `_params`: `BridgeParams<K, true>` — the same bridge parameters as `approve`; `raw` is pinned to `true` and no wallet provider is accepted

**Returns:** `Promise<Result<ApprovalTxs<K>>>` — `{ approveTx, resetTx? }`

`resetTx` is present only when the token needs its stale allowance cleared first. **Broadcast it and
wait for it to be mined before `approveTx`** — the second approval is not valid until the reset has
landed on chain, and a receipt that mined with a revert status must stop the sequence rather than
advance it. Spender resolution is identical to `approve`, so an allowance checked with
`isAllowanceValid` is the allowance this grants.

```typescript
const result = await sodax.bridge.buildApproveTxs({
  params: { /* same shape as approve */ },
  raw: true,
});

if (result.ok) {
  const { resetTx, approveTx } = result.value;
  if (resetTx) {
    // sign, broadcast, and WAIT for the receipt before continuing
  }
  // then sign and broadcast approveTx
}
```

`approve` is unchanged and still the right call for signed execution: `SpokeService.approve` already
runs the reset internally, so a signed caller gets the two-step behaviour without handling it.

### Stellar Trustline Requirements

For Stellar-based bridge operations, trustlines must be handled depending on whether Stellar is the source or destination chain. See the [Stellar Trustline Requirements](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/STELLAR_TRUSTLINE.md#bridge) doc for detailed information and code examples.

### bridge

Executes a full end-to-end bridge transfer: spoke deposit → relay → hub settlement.

Internally calls `createBridgeIntent()` to submit the spoke-side deposit transaction, then completes the transfer via one of two paths (see [Completion paths and `timeout`](#completion-paths-and-timeout) below). Use this method for the typical "fire and wait" bridge UX.

This method is signed-execution only (`raw: false`). For raw transaction building, use `createBridgeIntent()` directly.

**Parameters:**
- `_params`: `BridgeParams<K, false>` — bridge parameters including source/destination chain keys, token addresses, amount, recipient, wallet provider, and optional `timeout` (a **per-attempt** budget — see below)

**Returns:** `Promise<Result<TxHashPair>>` — `{ srcChainTxHash, dstChainTxHash }` on success, where `srcChainTxHash` is the spoke deposit tx and `dstChainTxHash` is the hub settlement tx.

**Example:**
```typescript
import { ChainKeys } from '@sodax/sdk';

const result = await sodax.bridge.bridge({
  params: {
    srcChainKey: ChainKeys.BASE_MAINNET,
    srcAddress: '0xYourAddress...',
    srcToken: '0x1234567890abcdef...',
    amount: 1000000000000000000n,
    dstChainKey: ChainKeys.POLYGON_MAINNET,
    dstToken: '0xabcdef1234567890...',
    recipient: '0x9876543210fedcba...',
  },
  walletProvider: evmWalletProvider,
  timeout: 30_000, // optional, per attempt; defaults to DEFAULT_RELAY_TX_TIMEOUT
});

if (result.ok) {
  const { srcChainTxHash, dstChainTxHash } = result.value;
  console.log('Bridge successful:', { srcChainTxHash, dstChainTxHash });
} else {
  console.error('Bridge failed:', result.error.message);
}
```

#### Completion paths and `timeout`

`bridge()` completes through the **backend submit-tx path by default** (`bridge.useBackendSubmitTx`, default `true`): it hands the broadcast deposit to the bridge API (`sodax.api.bridge.submitTx`), which relays server-side, and polls submit-tx status. On **any** non-success — submission rejected, terminal `failed`/abandoned, or the poll running out — it falls back to the client-side `relayTxAndWaitPacket` flow so the bridge still completes, returning the same `TxHashPair` either way. That is safe because re-relaying an already-relayed deposit is idempotent, and it matters in practice: the backend keeps processing at its own pace after the SDK gives up, so the two relays can race. Set `new Sodax({ bridge: { useBackendSubmitTx: false } })` to force the client-side path.

On-chain verification (`verifyTxHash`) runs on the **client-side path only** — the backend runs its own, so verifying before handing the deposit over would delay every backend success by the source chain's confirmation wait and could fail a bridge the backend would have completed. `TX_VERIFICATION_FAILED` therefore never surfaces on a bridge the backend completes.

`timeout` is a **per-attempt** budget, not an end-to-end deadline. Each phase is bounded by a different thing:

| Phase | Bound |
| --- | --- |
| `createBridgeIntent` — build, sign, broadcast | **not** bounded by `timeout` |
| Backend attempt — submit POST + status poll | `timeout` |
| ↳ any single backend request within it | `min(budget left in the attempt, api.timeout)` |
| On-chain verification — client-side path only | the source chain's `pollingConfig.maxTimeoutMs` |
| Relay wait — client-side path only, starts after verification | `max(timeout, RELAY_FALLBACK_FLOOR_MS)` |

So a stalled backend cannot shorten the fallback's relay wait, and raising `timeout` grows both attempts. Worst-case wall-clock is `createBridgeIntent + timeout + verification + max(timeout, RELAY_FALLBACK_FLOOR_MS)` — reached only when the backend accepts the submission and then never finishes. Bridge has no solver post-execution, so unlike swaps there is no `'posting_execution'` step and no post-execution term.

Read the constants from source rather than memorising them: `DEFAULT_RELAY_TX_TIMEOUT`, `DEFAULT_BACKEND_API_TIMEOUT` and per-chain `pollingConfig` live in [`@sodax/types`](https://github.com/icon-project/sodax-sdks/tree/main/packages/types/src), and `RELAY_FALLBACK_FLOOR_MS` in [`IntentRelayApiService.ts`](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/src/shared/services/intentRelay/IntentRelayApiService.ts). Verification timeouts differ widely by chain, so derive them per chain from `chains.ts`. The swaps side documents the identical model in more depth — see [How `timeout` bounds each attempt](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/SWAPS.md#how-timeout-bounds-each-attempt) — and [BRIDGE_API.md](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/BRIDGE_API.md) covers the API client itself.

### createBridgeIntent

Submits the spoke-side deposit transaction that initiates a bridge transfer, without waiting for the cross-chain relay to complete.

This is the first step of a bridge operation. After this call succeeds you must relay the returned `relayData` to the hub (Sonic) via `relayTxAndWaitPacket` or the intent relay API to complete the transfer. The higher-level `bridge()` method does this automatically — use `createBridgeIntent()` only when you need manual relay control.

When `raw` is `true`, returns the encoded transaction without broadcasting (useful for simulation or batching). When `raw` is `false`, signs and submits the deposit transaction via the provided wallet provider.

**Bitcoin note:** Bitcoin is only supported with `raw: false` because it requires the Bound Exchange trading wallet derivation flow.

**Chain-specific preconditions** (both fail as `VALIDATION_FAILED` with the offending `context.field`):

- **Native BTC and the dust limit.** Native BTC is denominated in satoshis and must clear the Bitcoin dust limit of `BITCOIN_DUST_SATS` (546) — outputs below it are economically unspendable and nodes reject transactions that create them. With Bitcoin as the **source**, `amount` must be at least 546. With Bitcoin as the **destination**, the *post-fee delivered* amount must clear 546: the partner fee is deducted on the hub in 18-dp vault units, so a percentage fee — or a fixed wei-denominated `PartnerFee.amount` — can push a nominally valid `amount` under the limit (`Post-fee BTC delivery (…) is below the Bitcoin dust limit`).
- **Stacks with `raw: true`** requires `extras.srcPublicKey` — see [BridgeExtras](#bridgeextras).

**Parameters:**
- `_params`: `BridgeParams<K, Raw>` — bridge parameters including source/destination chain keys, token addresses, amount, recipient, wallet provider, `raw` flag, optional `extras` (see [BridgeExtras](#bridgeextras)), and optional `skipSimulation`

**Returns:** `Promise<Result<IntentTxResult<K, Raw>>>` — on success, `{ tx, relayData }` where `tx` is the spoke deposit tx hash (or encoded call data when raw), and `relayData` contains the hub wallet address and encoded hub execution payload needed for relay.

**Example (signed):**
```typescript
import { ChainKeys } from '@sodax/sdk';

const result = await sodax.bridge.createBridgeIntent({
  params: {
    srcChainKey: ChainKeys.BASE_MAINNET,
    srcAddress: '0xYourAddress...',
    srcToken: '0x1234567890abcdef...',
    amount: 1000000000000000000n,
    dstChainKey: ChainKeys.POLYGON_MAINNET,
    dstToken: '0xabcdef1234567890...',
    recipient: '0x9876543210fedcba...',
  },
  walletProvider: evmWalletProvider,
});

if (result.ok) {
  console.log('Spoke deposit tx:', result.value.tx);
  console.log('Relay data:', result.value.relayData);
} else {
  console.error('Bridge intent creation failed:', result.error.message);
}
```

**Note:** This method only executes the transaction on the spoke chain and creates the bridge intent. To successfully bridge tokens you need to:
1. Check if the allowance is sufficient using `isAllowanceValid`
2. Approve the appropriate contract to spend the tokens using `approve`
3. Create the bridge intent using this method
4. Relay the transaction to the hub and await completion (or use the `bridge()` method which handles this automatically)

### getFee

Calculates the partner fee deducted from a given bridge input amount.

Returns `0n` when no partner fee applies. The fee is denominated in the same units as `inputAmount` (vault token decimals, 18 dp).

**Parameters:**
- `inputAmount`: `bigint` — gross amount being bridged, in 18-dp hub/vault units (the units the hub deducts the fee in — **not** the spoke token's native base units). This matters for a fixed `PartnerFee.amount`, which is wei-denominated; a percentage fee is unit-agnostic.
- `partnerFee` (optional): `PartnerFee | undefined` — fee to price against. Pass the same per-action override you will hand to `bridge()` / `createBridgeIntent()` via `extras.partnerFee` to preview its amount. Omitting the argument — or passing `undefined` explicitly, which triggers the same default — prices the configured `bridge.partnerFee`.

**Returns:** `bigint` — fee amount to be deducted, in the same units as `inputAmount`

**Example:**
```typescript
// Configured fee
const feeAmount = sodax.bridge.getFee(1000000000000000000n);

// Preview a per-action override before passing the same fee to bridge()
const previewed = sodax.bridge.getFee(1000000000000000000n, {
  address: '0xPartner...',
  percentage: 100, // 1%
});
console.log('Fee:', feeAmount.toString(), previewed.toString());
```

### getBridgeableAmount

Returns the maximum amount that can currently be bridged between two tokens, taking into account both deposit capacity on the source side and withdrawal liquidity on the destination side.

The limit type depends on the transfer direction:
- **Spoke → Hub**: constrained by the source vault's remaining deposit capacity (`DEPOSIT_LIMIT`).
- **Hub → Spoke**: constrained by the asset manager balance on the destination spoke (`WITHDRAWAL_LIMIT`).
- **Spoke → Spoke**: the minimum of the deposit capacity (source) and the asset manager balance (destination), normalised to a common unit. The returned `type` indicates which side is the binding constraint.

Returns `{ amount: 0n, type: 'DEPOSIT_LIMIT' }` when the source token is not yet supported by the vault.

**Parameters:**
- `from`: `XToken` — source token (chain key + address) to bridge from
- `to`: `XToken` — destination token (chain key + address) to bridge to

**Returns:** `Promise<Result<BridgeLimit>>` — `{ amount, decimals, type }` where `amount` is the maximum bridgeable quantity in the token's native base units and `decimals` is its decimal precision.

**Example:**
```typescript
import { ChainKeys } from '@sodax/sdk';

const result = await sodax.bridge.getBridgeableAmount(
  {
    address: '0x1234567890abcdef...',
    chainKey: ChainKeys.BASE_MAINNET,
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
  },
  {
    address: '0xabcdef1234567890...',
    chainKey: ChainKeys.POLYGON_MAINNET,
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
  },
);

if (result.ok) {
  console.log('Max bridgeable:', result.value.amount.toString());
  console.log('Decimals:', result.value.decimals);
  console.log('Limit type:', result.value.type); // 'DEPOSIT_LIMIT' | 'WITHDRAWAL_LIMIT'
} else {
  console.error('Error getting bridgeable amount:', result.error);
}
```

### isBridgeable

Determines whether two tokens (potentially on different chains) can be bridged to each other.

Two tokens are bridgeable if they resolve to the same vault address on the Sonic hub, meaning they represent the same underlying asset across chains (e.g. USDC on Base and USDC on Arbitrum both map to the same hub vault).

Returns `false` — rather than throwing — on any resolution or validation error.

**Parameters:**
- `from`: `XToken` — source token to bridge from
- `to`: `XToken` — destination token to bridge to
- `unchecked`: `boolean` (optional, default `false`) — when `true`, skips the `isValidSpokeChainKey` guard. Useful for checking theoretical bridgeability without requiring both chains to be in the active config.

**Returns:** `boolean` — `true` if the tokens share the same hub vault; `false` otherwise.

**Example:**
```typescript
import { ChainKeys } from '@sodax/sdk';

const isBridgeable = sodax.bridge.isBridgeable({
  from: {
    address: '0x1234567890abcdef...',
    chainKey: ChainKeys.BASE_MAINNET,
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
  },
  to: {
    address: '0xabcdef1234567890...',
    chainKey: ChainKeys.POLYGON_MAINNET,
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
  },
});

console.log('Assets are bridgeable:', isBridgeable);
```

### getBridgeableTokens

Returns all tokens on the destination chain that can receive a bridge from the given source token. Filters the destination chain's supported tokens to those that share the same hub vault as the source token.

**Parameters:**
- `from`: `SpokeChainKey` — source chain key
- `to`: `SpokeChainKey` — destination chain key whose supported tokens are searched
- `token`: `string` — source token address on `from`

**Returns:** `Result<XToken[]>` — array of destination-chain tokens bridgeable from the source token; error result if the source token is not found in config.

**Example:**
```typescript
import { ChainKeys } from '@sodax/sdk';

const result = sodax.bridge.getBridgeableTokens(
  ChainKeys.BASE_MAINNET,
  ChainKeys.POLYGON_MAINNET,
  '0x1234567890abcdef...',
);

if (result.ok) {
  console.log('Bridgeable tokens on Polygon:', result.value);
} else {
  console.error('Error getting bridgeable tokens:', result.error);
}
```

### Get Detailed Status

`getDetailedStatus` answers "what is the status of this bridge?" from the **source-chain** tx — the one identifier you always hold. It does not define a new status: it routes to whichever of the two existing sources can answer, and returns that source's payload unmodified.

```typescript
const result = await sodax.bridge.getDetailedStatus({
  srcChainKey: ChainKeys.ARBITRUM_MAINNET,
  srcTxHash: bridgeResult.value.srcChainTxHash,
});

if (result.ok) {
  if (result.value.source === 'backend') {
    // `data` is the BridgeSubmitTxStatusDataV2 from sodax.api.bridge.getSubmitTxStatus
    console.log(result.value.data.status, result.value.data.userMessage);
  } else {
    // `data` is the delivered relay PacketData
    console.log(result.value.data.status, result.value.data.dst_tx_hash);
  }
}
```

`DetailedBridgeStatus` is discriminated on `source`, so it narrows on its own — no type guards needed:

```typescript
type DetailedBridgeStatus =
  | { source: 'backend'; data: BridgeSubmitTxStatusDataV2 }
  | { source: 'relay'; data: PacketData };
```

A point-in-time read — poll it yourself, or use `@sodax/dapp-kit`'s `useBridgeDetailedStatus`.

The optional second argument is a `RequestOverrideConfig` for the backend read (a per-action `apiKey`, a different `baseURL`). The relay leg is unauthenticated and takes none.

#### Why it exists

`sodax.api.bridge.getSubmitTxStatus` cannot answer for every bridge, in two different ways.

Sometimes there is **no record**, and it reads 404 — you opted out with `useBackendSubmitTx: false`, or the submit itself never landed. More often the record exists but is **stale**: the backend path POSTs the tx *first* and only falls back to the client-side relay once that path stalls, so a fallback-completed bridge leaves behind whatever state the backend last reached — `pending`, `relaying`, or a record it abandoned outright. Neither shape reflects what actually happened to the bridge.

The relay can answer for it, but only if you know to ask it, and with what. So the caller had to know which path ran and pick a source. This method makes that choice instead:

1. Read the backend record; return it while it is still in play.
2. Otherwise return the delivered relay packet for the source tx.

A record the backend **gave up on** (`failed`, or `abandonedAt` set) takes step 2, and on the default path this is the *common* branch rather than an edge case: the record almost always exists, so abandonment — not a 404 — is what usually signals the fallback ran. It never self-heals, so keeping it would report `failed` for a bridge the fallback went on to complete. A `success: false` envelope takes step 2 as well — that is the wire contract's "no record found", whatever `data` carries. A transport or server error routes on too, so a transient backend outage does not fail a bridge the relay can still report on.

**One failure does not route on: a rejected API key.** `GET /bridge/submit-tx/status` is guarded by an API key, so a 401/403 is a terminal configuration problem rather than a source that had nothing to say. Degrading to the relay would bury it behind a relay error and leave a poller retrying a request only a corrected key can satisfy, so it surfaces directly, with `context.status` set for `isAuthFailure`.

**What the relay arm proves, and what it does not.** The packet is returned whole rather than reduced to a hash, because `dst_tx_hash` means different things by route: for a spoke-source bridge it is the **hub settlement** tx, and for a hub-source bridge it is the destination spoke's tx. The spoke→spoke hop from the hub onwards is not covered by this read. So a `source: 'relay'` answer means *the deposit reached the packet's destination*, not always *the funds landed with the recipient*. The arm is terminal either way: the router only ever returns an `executed` packet with a non-empty `dst_tx_hash`.

Both payloads are already documented — the submit-tx record in [BRIDGE_API.md](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/BRIDGE_API.md), the relay packet as `PacketData`. Nothing is translated between them, so no field is dropped and no status is reinterpreted.

#### When it fails

`LOOKUP_FAILED`, and only that. It means no source could answer — most often the relay has not delivered the packet yet.

If you poll this yourself, branch on `error.context.reason`. It equals `DETAILED_STATUS_NOT_DELIVERED` when the backend answered (a record, or a definitive 404) **and** the relay has no packet for the source tx — whether it answers 404 for a tx it has not indexed, or returns no matching delivered packet. You cannot tell that apart from "still in flight", so bound it with a retry budget. Any other `LOOKUP_FAILED` is a dependency failing right now — relay 5xx or unreachable, malformed response, or a backend outage that left the relay miss unprovable. Keep retrying those, since retrying is how the read recovers. A rejected key is the exception: `isAuthFailure(error)` is true and no budget applies, because only a corrected key changes the answer. `useBridgeDetailedStatus` applies exactly this split.

Because it is meant to be polled, the relay read carries the relay module's own per-request budget and gives up rather than hanging. An expiry lands in the retryable group: it is a dependency failing right now, so it does not consume a not-delivered budget.

## Types

### CreateBridgeIntentParams

```typescript
export type CreateBridgeIntentParams<K extends SpokeChainKey = SpokeChainKey> = {
  srcAddress: string;
  srcChainKey: K;
  srcToken: string;
  amount: bigint;
  dstChainKey: SpokeChainKey;
  dstToken: string;
  recipient: string; // non-encoded recipient address
};
```

### BridgeParams

`BridgeParams` is an alias for `SpokeExecActionParams`, which is a discriminated union combining the intent params with the `WalletProviderSlot`:

```typescript
export type BridgeParams<ChainKey extends SpokeChainKey, Raw extends boolean> = SpokeExecActionParams<
  ChainKey,
  Raw,
  CreateBridgeIntentParams<ChainKey>,
  BridgeExtras<ChainKey>
>;
```

`SpokeExecActionParams` contributes `params`, the optional `extras` slot (see below), `skipSimulation`, `timeout`, and the wallet-provider slot. `timeout` is a per-attempt budget — see [Completion paths and `timeout`](#completion-paths-and-timeout).

The `WalletProviderSlot<K, Raw>` discriminant enforces at compile time:
- `{ raw: true }` — `walletProvider` is **forbidden**; returns raw tx payload
- `{ raw: false, walletProvider: GetWalletProviderType<K> }` — `walletProvider` is **required** and chain-narrowed; signs and broadcasts

### BridgeExtras

Per-action extras passed via the `extras` slot of `bridge()` / `createBridgeIntent()`. The chain-specific slots are keyed off `K`, so a non-Stacks action cannot set `srcPublicKey` and a non-Bitcoin action cannot set `bound`:

```typescript
export type BridgeExtras<K extends SpokeChainKey = SpokeChainKey> = (GetChainType<K> extends 'STACKS'
  ? { srcPublicKey?: string }
  : { srcPublicKey?: never }) &
  (GetChainType<K> extends 'BITCOIN' ? { bound?: BitcoinBoundExtras } : { bound?: never }) & {
    partnerFee?: PartnerFee;
    apiKey?: string;
  };
```

- `partnerFee` — chain-agnostic per-action fee override. When present it takes precedence over the config-level `bridge.partnerFee` for that call, letting an integrator charge and route its own fee per bridge. Omit to use the configured fee. Preview the amount with `getFee(inputAmount, partnerFee)`.
- `apiKey` — chain-agnostic per-action override of the configured backend API key (`x-api-key`) for this action's backend submit-tx leg. Omit to use the configured key — see [CONFIGURE_SDK.md § API key](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/CONFIGURE_SDK.md#api-key). Pass it only from server-side code — see [API key good practices](https://docs.sodax.com/developers/how-to/api-key-good-practices).
- `srcPublicKey` — **required** for Stacks sources with `raw: true`. A Stacks address cannot yield the signer public key at raw-tx build time, so the unsigned tx needs it up front; omitting it fails with `VALIDATION_FAILED` (`context.field: 'srcPublicKey'`).
- `bound` — Bound Exchange (Radfi) inputs for raw Bitcoin TRADING-mode sources: `{ accessToken?: string }`, falling back to the `RadfiProvider` instance token when omitted.

```typescript
const result = await sodax.bridge.bridge({
  params: { /* … */ },
  raw: false,
  walletProvider: evmWalletProvider,
  extras: { partnerFee: { address: '0xPartner...', percentage: 100 } },
});
```

### BridgeLimit

```typescript
type BridgeLimit = {
  amount: bigint;
  decimals: number;
  type: 'DEPOSIT_LIMIT' | 'WITHDRAWAL_LIMIT';
};
```

### TxHashPair

```typescript
type TxHashPair = {
  srcChainTxHash: string;
  dstChainTxHash: string;
};
```

### PartnerFee

A percentage fee or a fixed amount:

```typescript
type PartnerFee = PartnerFeeAmount | PartnerFeePercentage;

type PartnerFeePercentage = {
  address: string;
  percentage: number; // 100 = 1%, 10000 = 100% (FEE_PERCENTAGE_SCALE)
};

type PartnerFeeAmount = {
  address: string;
  amount: bigint; // fixed amount, subtracted directly — so it must be in the same units as the
                  // amount it is charged against (for bridge: 18-dp hub/vault units, not spoke units)
};
```

## Error Handling

The Bridge module's user-facing methods return `Promise<Result<T, SodaxError<NarrowCode>>>`. Discriminate on `result.error.code` (a string literal) — never on `result.error.message`. Same canonical shape used by swap and money market.

### The canonical error: `SodaxError<C>`

All bridge-module errors are instances of `SodaxError`, exported from `@sodax/sdk`:

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
- `error.context` carries structured metadata: `srcChainKey`, `dstChainKey`, `phase`, plus per-code extras (`relayCode`, `field`).
- `error.toJSON()` is the canonical logger surface; `JSON.stringify(error)` invokes it automatically and produces a logger-safe payload (bigints in `context` are coerced to strings, cause walked depth-3, no circular hazards).
- Use `isBridgeError(e)` (broad) or one of the narrow guards `isBridgeOrchestrationError(e)` / `isBridgeCreateIntentError(e)` / `isBridgeApproveError(e)` / `isBridgeAllowanceCheckError(e)` / `isBridgeLookupError(e)` from `@sodax/sdk` instead of `instanceof SodaxError` in dapp/app code (bundle-safe).

### Per-method error code unions

| Method | Codes |
|---|---|
| `bridge` | `USER_REJECTED`, `VALIDATION_FAILED`, `INTENT_CREATION_FAILED`, `TX_VERIFICATION_FAILED`, `TX_SUBMIT_FAILED`, `RELAY_TIMEOUT`, `RELAY_FAILED`, `EXECUTION_FAILED`, `UNKNOWN` |
| `createBridgeIntent` | `USER_REJECTED`, `VALIDATION_FAILED`, `INTENT_CREATION_FAILED`, `UNKNOWN` |
| `approve` | `USER_REJECTED`, `VALIDATION_FAILED`, `APPROVE_FAILED`, `UNKNOWN` |
| `isAllowanceValid` | `VALIDATION_FAILED`, `ALLOWANCE_CHECK_FAILED`, `UNKNOWN` |
| `getBridgeableAmount` | `VALIDATION_FAILED`, `LOOKUP_FAILED`, `UNKNOWN` |
| `getBridgeableTokens` | `VALIDATION_FAILED`, `LOOKUP_FAILED`, `UNKNOWN` |

**Important:** `bridge` orchestrates verify + relay only on the **client-side path** (the fallback, or `useBackendSubmitTx: false`), so `TX_VERIFICATION_FAILED`, `TX_SUBMIT_FAILED`, `RELAY_TIMEOUT` and `RELAY_FAILED` never surface on a bridge the backend completes. When the backend attempt does not complete, its own error is logged and discarded — the fallback runs and its outcome is what you receive, so the code you see always describes the client-side attempt, never the backend one. Check the logs, not the `Result`, to tell why the backend path was abandoned. See [Completion paths and `timeout`](#completion-paths-and-timeout).

The exported narrow types are `BridgeOrchestrationError` (for `bridge`), `BridgeCreateIntentError` (for `createBridgeIntent`), `BridgeApproveError`, `BridgeAllowanceCheckError`, and a single `BridgeLookupError` shared by `getBridgeableAmount` and `getBridgeableTokens` (discriminate them at runtime via `error.context.method`). Each has a matching narrow guard listed above.

### Standard `context` fields

```typescript
{
  srcChainKey?: SpokeChainKey;
  dstChainKey?: SpokeChainKey;
  phase?: 'validate' | 'intentCreation' | 'verify' | 'submit' | 'relay'
        | 'approve' | 'allowanceCheck' | 'lookup';
  relayCode?: 'SUBMIT_TX_FAILED' | 'RELAY_TIMEOUT' | 'RELAY_POLLING_FAILED' | 'UNKNOWN';
  field?: string;     // on VALIDATION_FAILED
  reason?: string;
}
```

### Discrimination example

```typescript
import { isBridgeOrchestrationError } from '@sodax/sdk';

const result = await sodax.bridge.bridge({
  params: { /* ... */ },
  raw: false,
  walletProvider: evmWalletProvider,
});

if (!result.ok) {
  // result.error is BridgeOrchestrationError = SodaxError<BridgeOrchestrationErrorCode>
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
      // Persist the input params and retry submission.
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
      // Catch-all for the bridge orchestration; cause has the original.
      console.error('Bridge failed:', result.error.cause);
      break;

    case 'UNKNOWN':
      console.error('Unexpected:', result.error.cause);
      break;
  }
}
```

### Migration from the legacy pattern

If you were on the previous CODE-on-`error.message` pattern (or the older `BridgeError<Code>` typed shape that the published docs [document](https://docs.sodax.com/developers/packages/foundation/sdk/functional-modules/bridge#error-handling)), here are the mappings:

| Before | After |
|---|---|
| `error.message === 'RELAY_TIMEOUT'` | `error.code === 'RELAY_TIMEOUT'` |
| `error.message === 'SUBMIT_TX_FAILED'` | `error.code === 'TX_SUBMIT_FAILED'` |
| `error.message === 'CREATE_BRIDGE_INTENT_FAILED'` | `error.code === 'INTENT_CREATION_FAILED'` |
| `error.message === 'EXECUTION_FAILED'` | `error.code === 'EXECUTION_FAILED'` (now narrow-typed) |
| `error.message === 'ALLOWANCE_CHECK_FAILED'` | `error.code === 'ALLOWANCE_CHECK_FAILED'` |
| `error.message === 'APPROVAL_FAILED'` | `error.code === 'APPROVE_FAILED'` |
| Prose `error.message` for invariants | `error.code === 'VALIDATION_FAILED'`; the prose stays on `error.message` |

### Best practices

1. **Always handle `TX_SUBMIT_FAILED`**. Critical — the spoke tx landed but the relay submission failed. Funds may be in flight; persist the user's input and retry.
2. **Handle `RELAY_TIMEOUT` gracefully**. The spoke tx succeeded; the relay just didn't deliver in time. Check on-chain status before retrying.
3. **Discriminate `RELAY_FAILED` via `context.relayCode`**. `'RELAY_POLLING_FAILED'` (polling outage — packet status unknown) needs different UX from generic `'UNKNOWN'`.
4. **Use `error.cause` for forensics**. Every wrapped error preserves the original on `cause`. Loggers walk it automatically.
5. **Use `JSON.stringify(error)` for logging**. The `toJSON()` method handles bigint coercion + cause-chain truncation safely.
6. **Type-guard, don't `as`-cast**. Use `is<Op>Error(error)` to narrow; an `as <Op>Error` cast after a generic `isSodaxError` check would silently widen the contract.

## Usage Flow

The typical bridge operation follows this sequence:

1. **Check allowance** using `isAllowanceValid()`
2. **Approve tokens** using `approve()` if needed
3. **For Stellar destination chains**: check and establish trustlines (see [Stellar Trustline Requirements](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/STELLAR_TRUSTLINE.md#bridge))
4. **Execute bridge** using `bridge()` for the full lifecycle, or `createBridgeIntent()` for manual relay control
5. **Monitor progress** using the returned transaction hashes

## Chain Keys

Use `ChainKeys.*` constants from `@sodax/sdk` instead of raw string chain IDs:

```typescript
import { ChainKeys } from '@sodax/sdk';

// Examples
ChainKeys.BASE_MAINNET      // '0x2105.base'
ChainKeys.POLYGON_MAINNET   // '0x89.polygon'
ChainKeys.SONIC_MAINNET     // hub chain
ChainKeys.ETHEREUM_MAINNET
ChainKeys.ARBITRUM_MAINNET
// ... other supported chains (see ChainKeys)
```

The chain key in the request payload (e.g. `srcChainKey`) drives both TypeScript narrowing — so `walletProvider` is automatically typed to the correct interface — and runtime routing inside the SDK.

## Supported Chains

The service supports every chain in the SODAX network (see `ChainKeys` in `@sodax/types` for the authoritative list):
- **EVM:** Sonic (hub), Ethereum, Arbitrum, Base, BSC, Optimism, Polygon, Avalanche, HyperEVM, Lightlink, Redbelly, Kaia, Hedera, Robinhood
- **Non-EVM:** Solana, Sui, Stellar, ICON, Injective, NEAR, Stacks, Bitcoin

## Partner Fees

Partner fees are configured at `Sodax` construction time via `config.bridge.partnerFee`. They are automatically applied inside `bridge()` and `createBridgeIntent()`. Use `getFee()` to preview the fee amount for a given input:

```typescript
const feeAmount = sodax.bridge.getFee(inputAmount);
const netAmount = inputAmount - feeAmount;
```

A single bridge can override the configured fee via `extras.partnerFee` (see [BridgeExtras](#bridgeextras)). Pass the same fee as `getFee`'s second argument to preview that override:

```typescript
const perActionFee = { address: '0xPartner...', percentage: 100 }; // 1%
const feeAmount = sodax.bridge.getFee(inputAmount, perActionFee);

const result = await sodax.bridge.bridge({
  params: { /* … */ },
  raw: false,
  walletProvider: evmWalletProvider,
  extras: { partnerFee: perActionFee },
});
```

Fees are denominated in vault token decimals (18 dp).
