---
title: "Leverage Yield"
icon: chart-line
generatedFrom: packages/sdk/docs/LEVERAGE_YIELD.md
---

> **Error handling conventions:** This module uses the canonical `SodaxError<LeverageYieldErrorCode>` shape (same family as the swap, bridge, and money market modules). Discriminate on `result.error.code` (e.g. `'INTENT_CREATION_FAILED'`, `'LOOKUP_FAILED'`); structured details live on `result.error.context` (`srcChainKey`, `action`, `method`, `phase`, `field`). See the **Error Handling** section below for the full per-method code table.

The `LeverageYieldService` class, reachable via `sodax.leverageYield`, exposes the SODAX **leverage-yield vaults** — leveraged-yield strategy vaults deployed on the Sonic hub. This page explains what a leverage-yield vault is, how the strategy works on-chain, and how the SDK lets you enter and exit a position from any spoke chain.

## How the leverage-yield vault works

A leverage-yield vault automates a **leveraged-lending loop** to turn a small yield spread into a larger one. It takes a yield-bearing deposit, uses it as collateral to borrow a correlated asset, swaps the borrowed amount back into more of the deposit asset, and re-supplies — repeating until it reaches a target leverage. The position is a **leveraged long on the `asset` / `borrowToken` peg**.

### The loop

```
            ┌───────────────────────────────────────────────┐
            │                                               │
            ▼                                               │
   deposit asset ──▶ supply as collateral ──▶ borrow borrowToken
   (e.g. weETH vault) (earns supply APR)       (pays borrow APR)
                                                     │
                                                     ▼
                          re-supply ◀── swap back into asset
                                        (borrowToken → asset)
            │                                               ▲
            └───────────────── repeat until targetLTV ──────┘
```

Each pass adds more collateral (and more debt). The loop stops at the vault's **target loan-to-value (`targetLTV`)** — the fraction of collateral value the vault is willing to borrow against. The geometric series of repeated borrows converges to a fixed multiple of the original deposit.

### Leverage multiplier and where the yield comes from

At a target LTV `L`, the steady-state amounts (as a multiple of your principal) are:

| Quantity | Formula | Example at `L = 85%` |
|---|---|---|
| Total collateral supplied | `1 / (1 − L)` | `6.67×` principal |
| Total borrowed | `L / (1 − L)` | `5.67×` principal |
| **Leverage multiplier** (`leverageMultiplierWad`) | `L / (1 − L)` | `5.67×` |

The multiplier is the **borrowed** multiple, not the exposure. The exposure a depositor holds is total collateral, `1 / (1 − L)` = `1 + leverageMultiplier` (`6.67×` here). A UI label that reads "Leverage" should show that sum.

Your net yield is the base supply rate on your principal **plus** the leverage multiplier applied to the *spread* between the supply and borrow rates:

```
netApr = supplyApr + leverageMultiplier × (supplyApr − borrowApr)
```

**Worked example** — supply 5%, borrow 3%, `targetLTV` 85%:

```
netApr = 5% + 5.67 × (5% − 3%) = 5% + 11.33% = 16.33%
```

A 2-point raw spread becomes a ~16% headline APR. That amplification is the entire point of the vault — and also its risk.

### The risk: the spread can invert

The multiplier cuts both ways. The same `5.67×` that amplifies a positive spread amplifies a negative one:

- If the **borrow rate rises above the supply rate**, every loop becomes a net cost and `netApr` goes **negative** (e.g. supply 3% / borrow 5% at 85% LTV → `netApr ≈ −8.3%`). The SDK returns `netAprRay` as a signed bigint precisely so this case is representable.
- Because the position holds real debt, a **depeg or price move** between `asset` and `borrowToken` can erode the health factor. `getPosition()` exposes the live `healthFactor`, `ltv`, `collateral`, and `debt` so a UI can warn before liquidation territory.
- A `targetLTV ≥ 100%` would imply infinite leverage and is rejected by `getApr()` with `VALIDATION_FAILED`.

> The APR from `getApr()` is **steady-state**, not realised APY. It assumes AAVE rates stay constant and the vault holds continuously at `targetLTV`. Real returns depend on rate volatility and rebalance cadence.

### The vault on-chain

Each vault is a deployed contract on the **Sonic hub** that follows the **ERC-4626** standard. A depositor's position is represented by the vault's ERC-4626 share token — the **`lsoda*` token** (e.g. `lsodaWEETH`). Two consequences:

- **The share token address *is* the vault proxy address.** `vault` and the `lsoda*` token are the same address.
- Standard ERC-4626 views (`previewDeposit`, `previewWithdraw`, `previewRedeem`, `maxWithdraw`, `totalAssets`) work, plus a non-standard `getPositionDetails()` that returns the live leveraged-position snapshot.

The lending pool is a **SODAX fork of AAVE**; the vault reads its reserve rates to compute APR and manages collateral/debt through it.

### A vault's descriptor

Each registered vault carries four static fields:

| Field | Meaning | Example |
|---|---|---|
| `name` | Lookup key — the `lsoda*` share-token symbol | `'lsodaWEETH'` |
| `vault` | Deployed vault proxy on Sonic — **also the `lsoda*` token address** | `0xD09d…701D` |
| `asset` | Underlying collateral (a SODAX vault token) | `SodaTokens.sodaWEETH` (symbol `weETH`) |
| `borrowToken` | Token borrowed against `asset` | `sodaETH` |

The registry lives in `@sodax/types` — the `leverageYieldVaults` array (surfaced through `leverageYieldConfig`) is the source of truth for which vaults exist. It spans ETH-, SOL- and stablecoin-collateral vaults, and derives every address from the canonical `LsodaTokens` / `SodaTokens` registries, so a deployment-address change lives in exactly one place. Look vaults up with `listVaults()`, `getVault(name)`, or `getVaultByAddress(address)`.

## The SDK model: shares as solver-tradeable tokens

The service does **not** expose bespoke "deposit into vault" / "redeem from vault" calls. Instead, the `lsoda*` share token is registered as an ordinary **solver-tradeable token** (it is spread into the swap-supported tokens for Sonic). So entering and exiting a leveraged position are just **intent-based swaps**, executed by the service's own `vaultSwap()`:

- **Enter** a position = swap *any token → `lsoda*` shares*.
- **Exit** a position = swap *`lsoda*` shares → any token*.

`LeverageYieldService`'s job is to build the correct swap payload (the `CreateIntentParams` plus any execution flags) via `deposit()` / `withdraw()`, then execute it via `vaultSwap()` (or `createVaultIntent()` for manual relay control); the solver (plus the vault's ERC-4626 mechanics) does the rest. This is why deposits and withdrawals are cross-chain by default and need no vault-specific approval: a deposit approves its input token the same way a swap does, with `sodax.swaps.isAllowanceValid` / `sodax.swaps.approve`, and a withdraw needs no approval at all.

`createVaultIntent` / `vaultSwap` are leverage-yield copies of the swap domain's `createIntent` / `swap()` — duplicated **deliberately** so the vault-specific execution modifiers (`hubWalletSwap`, per-intent `partnerFee`) live on the leverage-yield action wrapper (`VaultSwapActionParams`) and never leak into the generic swap surface.

### Partner fee

Entering and exiting a position are intent-based swaps, but they are priced off the **leverage-yield** partner fee — **not** `swaps.partnerFee`, which never applies to vault flows. Precedence is:

**per-intent `partnerFee` → `leverageYield.partnerFee` → global `fee` → no fee.**

Set it per feature, or globally:

```typescript
const sodax = new Sodax({
  leverageYield: { partnerFee: { address: '0xYourFeeReceiver...', percentage: 100 } }, // 100 bps = 1%
  // ...rest of config
});
```

**Both directions are charged.** To override the configured fee for a single intent, pass `partnerFee` to `deposit()` or `withdraw()` — it rides on the returned payload as `VaultSwapActionParams.partnerFee` — or pass it directly to `vaultSwap()` / `createVaultIntent()`:

```typescript
const intentResult = await sodax.leverageYield.deposit({
  // ...deposit params
  partnerFee: { address: '0xYourFeeReceiver...', percentage: 100 },
});
// intentResult.value = { params, partnerFee } — spread into vaultSwap() as usual.
```

The fee is taken inside `createVaultIntent()` (which `vaultSwap()` delegates to): the effective fee is deducted from `inputAmount` and encoded into the intent's `data` as the `IntentDataType.FEE` envelope, so the intents contract routes it to the partner address on the hub. `deposit()` / `withdraw()` build the `CreateIntentParams` with `data: '0x'`; the fee `data` is constructed at intent-creation time, so the builders need no fee plumbing of their own. When no fee is set at any level, none is taken.

Because the fee comes out of `inputAmount`, its **denomination differs by direction**: a deposit's input is the token being paid in, while a withdraw's input is the vault itself — so a withdraw fee is taken in `lsoda*` shares and the receiver accrues vault shares rather than the output token. Both are hub-side ERC20s and both surface in `sodax.partners.feeClaim`.

### Quoting

Size `minOutputAmount` with `sodax.leverageYield.getQuote()`, which deducts the same effective leverage-yield fee the intent will charge:

```typescript
// Deposit quote. For a withdraw, swap the two sides: the vault on SONIC_MAINNET is token_src,
// the output token on its chain is token_dst, and amount is the lsoda* shares to burn.
const inputAmount = 1_000_000_000_000_000_000n; // 1 weETH, in the input token's decimals
const quote = await sodax.leverageYield.getQuote({
  token_src: '0x...weETHonArbitrum',                   // spoke token in
  token_src_blockchain_id: ChainKeys.ARBITRUM_MAINNET,
  token_dst: vault.vault,                              // the vault, always on Sonic
  token_dst_blockchain_id: ChainKeys.SONIC_MAINNET,
  amount: inputAmount,
  quote_type: 'exact_input',
  // partnerFee — pass the same value you pass to deposit()/withdraw()/vaultSwap(), or omit on both
});
if (!quote.ok) return;

const slippageBps = 100n; // 1%
const minOutputAmount = (quote.value.quoted_amount * (10_000n - slippageBps)) / 10_000n;
```

Never pass `minOutputAmount: 0n` or a hand-picked constant. The SDK accepts zero, and the intent then accepts any fill.

Do **not** use `sodax.swaps.getQuote()` for vault flows: it deducts the effective *swap* fee, so once the two feature fees differ the quote and the intent disagree — and when the leverage-yield fee is the larger one, the `minOutputAmount` derived from that quote exceeds what the intent can deliver and it never fills.

Whichever quote method you use, keep the fee consistent across both calls: pass the same `partnerFee` to the quote and to the builder, or omit it on both.

## Flows

### Deposit (any token → `lsoda*`)

`deposit()` builds the `LeverageYieldSwapPayload` — `{ params: CreateIntentParams }` — for swapping any solver-supported `inputToken` on a spoke chain into the vault's `lsoda*` share token. The output is delivered to the user's **hub wallet** on Sonic (not back to the spoke) so a later `withdraw()` can spend it from there. The `deadline` defaults to the hub (Sonic) block timestamp + 5 minutes — anchored to on-chain time rather than the client clock; `solver` defaults to `0x0` (any solver). To size `minOutputAmount`, quote via `sodax.leverageYield.getQuote` with the vault address as the destination token (`token_dst`) — `lsoda*` shares are solver-tradeable — then subtract your slippage tolerance. An optional `partnerFee` overrides the configured leverage-yield fee for this intent; pass the same value to the quote.

```typescript
import { ChainKeys } from '@sodax/sdk';

const vault = sodax.leverageYield.getVault('lsodaWEETH');
if (!vault) throw new Error('Unknown vault');
const srcChainKey = ChainKeys.ARBITRUM_MAINNET;

const intentResult = await sodax.leverageYield.deposit({
  vault: vault.vault,
  srcChainKey,
  srcAddress: '0xYourArbitrumEOA...',
  inputToken: '0x...weETHonArbitrum',
  inputAmount, // the amount you quoted, in input-token decimals
  minOutputAmount, // lsoda* (18 dp): the quote minus slippage, from Quoting above
});

if (!intentResult.ok) throw intentResult.error;

// The spoke asset manager pulls `inputToken`, so approve it first — the swap-domain helpers take the payload's params.
const allowance = await sodax.swaps.isAllowanceValid({ params: intentResult.value.params, walletProvider: evmWalletProvider });
if (!allowance.ok) throw allowance.error;
if (!allowance.value) {
  // Pin the chain so the result narrows to an EVM tx hash.
  const approval = await sodax.swaps.approve<typeof srcChainKey, false>({
    params: { ...intentResult.value.params, srcChainKey },
    walletProvider: evmWalletProvider,
  });
  if (!approval.ok) throw approval.error;
  const receipt = await evmWalletProvider.waitForTransactionReceipt(approval.value);
  // Providers report a revert as viem's 'reverted' or the JSON-RPC '0x0'.
  if (receipt.status === 'reverted' || receipt.status === '0x0') throw new Error('Approval reverted');
}

// Spread the payload straight into the vault-swap executor.
const swapResult = await sodax.leverageYield.vaultSwap({
  ...intentResult.value,
  walletProvider: evmWalletProvider,
});
```

`deposit()` and `vaultSwap()` do not approve anything themselves. On an EVM spoke the asset manager pulls an ERC-20 input from the user's wallet, so the deposit reverts without the allowance. On Sonic the spender is the intents contract, and on Stellar the helper sets up a trustline. On other networks nothing needs approving, and the check returns `true`. The swap-domain helpers resolve all of this for each network, the same as for a swap.

### Withdraw (`lsoda*` → any token)

`withdraw()` builds the `LeverageYieldSwapPayload` for swapping the vault's `lsoda*` shares — which sit in the user's hub wallet — back into any solver-supported token on any chain. The payload carries **`hubWalletSwap: true`**: `vaultSwap()` then authorises the hub wallet to spend the shares via a `Connection.sendMessage` the user signs on `srcChainKey`, instead of a spoke-side asset-manager deposit. `withdraw()` is `async` (it reads the hub block timestamp for the default `deadline`) and returns a `Result` for a call shape uniform with `deposit()`. Size `minOutputAmount` the same way as a deposit — `sodax.leverageYield.getQuote` with the vault address as the **source** token (`token_src`) — then subtract slippage. `withdraw()` also accepts an optional `partnerFee`; withdrawals are charged, and that fee is taken in `lsoda*` shares.

```typescript
const intentResult = await sodax.leverageYield.withdraw({
  vault: vault.vault,
  srcChainKey: ChainKeys.ARBITRUM_MAINNET, // chain the user signs the sendMessage on
  srcAddress: '0xYourArbitrumEOA...',
  dstChainKey: ChainKeys.ARBITRUM_MAINNET, // where the swapped-back token is delivered
  outputToken: '0x...weETHonArbitrum',
  inputAmount: shareBalance, // lsoda* shares (18 dp)
  minOutputAmount: withdrawMinOutputAmount, // from a withdraw quote (vault as token_src) minus slippage, as in Quoting
  // recipient?: defaults to srcAddress
});

if (intentResult.ok) {
  const swapResult = await sodax.leverageYield.vaultSwap({
    ...intentResult.value, // hubWalletSwap: true is already set on the payload
    walletProvider: evmWalletProvider,
  });
}
```

To size a full exit, read the share balance with `getShareBalanceForUser(vault, srcChainKey, srcAddress)`. `inputAmount` is denominated in `lsoda*` **shares**. `getMaxWithdrawForUser` returns the ERC-4626 `maxWithdraw`, which is denominated in the underlying **asset**, so it is the wrong unit for `inputAmount`.

### Completion paths and `timeout`

`vaultSwap()` completes through one of two paths, each bounded by its **own** `timeout` budget:

- **Backend 2-step (the default):** hand the broadcast tx to the
  Leverage Yield API (`sodax.api.leverageYield.submitTx`, carrying `operation: 'deposit' | 'withdraw'`),
  which relays and post-executes server-side, then poll `getSubmitTxStatus` until `solved`. On **any**
  non-success — submission rejected, a 200 the backend did not accept, terminal `failed`/abandoned, a
  rejected API key, or the poll running out — it falls back to the client-side path so the vault swap
  still completes, returning the same `VaultSwapResponse` either way. That is safe because re-relaying /
  re-posting an already-processed vault swap is idempotent (the relay dedups and the solver re-affirms
  the intent — no double-fill), and it matters in practice: the backend keeps processing at its own pace
  after the SDK gives up, so the two relays can race.
- **Client-side (opt out with `leverageYield.useBackendSubmitTx: false`):** verify the broadcast intent tx
  landed on-chain, relay it to the hub (Sonic) — skipped when `srcChainKey` is the hub, where the spoke tx
  already *is* the hub tx — then call `notifySolver` so the solver fills the intent. This is also the
  fallback the backend path takes on any non-success.

This is the leverage-yield counterpart of `swaps.useBackendSubmitTx`, and it defaults on the same way.
Read the effective value on `sodax.config.leverageYieldUseBackendSubmitTx`.

`POST /leverage-yield/submit-tx` declares an API-key scope (`swaps:write`) where the status read declares
none, and key enforcement is a per-deployment setting. Where it is enforced, a keyless caller spends one
rejected attempt per vault swap before the fallback completes it. Configure `apiKey`, pass `extras.apiKey`
per call, or set `useBackendSubmitTx: false` to skip the attempt. `swaps.useBackendSubmitTx` declares the
same scope, so this is not specific to leverage yield.

`timeout` is a **per-attempt** budget, not an end-to-end one: the backend attempt (the POST plus its
status poll) gets it, and if that attempt does not complete the client-side relay wait gets a fresh one
starting after verification — so neither a stalled backend nor a slow source-chain confirmation can
shorten it, and raising `timeout` grows both. Verification runs on the client-side path only (the backend
runs its own, so verifying first would delay every backend success). Worst-case wall-clock is
`createVaultIntent + timeout + verification + max(timeout, RELAY_FALLBACK_FLOOR_MS) + notifySolver`, where
verification is bounded by the source chain's `pollingConfig.maxTimeoutMs` and the first and last terms
are not bounded by `timeout` at all — the same model
[SWAPS.md](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/SWAPS.md#how-timeout-bounds-each-attempt)
documents for swaps.

```typescript
// Backend 2-step is the default (client-side fallback still applies).
const sodax = new Sodax();

// Opt out — fully client-side relay + notify-solver.
const sodaxClientSide = new Sodax({ leverageYield: { useBackendSubmitTx: false } });

// Key the backend leg for one vault swap, overriding the instance `apiKey`. Server-side only.
const result = await sodax.leverageYield.vaultSwap({
  params,
  walletProvider,
  extras: { apiKey: 'partner-key' },
});
```

A key in a browser bundle is public — see [API key good practices](https://docs.sodax.com/developers/how-to/api-key-good-practices).

When the backend attempt does not complete, its own error is logged and discarded — the fallback runs and
its outcome is what you receive, so the code on the `Result` always describes the client-side attempt.
Check the logs, not the `Result`, to tell why the backend path was abandoned. For the HTTP client itself
see [LEVERAGE_YIELD_API.md](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/LEVERAGE_YIELD_API.md).

### Direct allowance management (hub-side)

`approve()` and `isAllowanceValid()` manage the allowance of the vault's underlying `asset` to the vault on Sonic. These are for callers interacting with the vault **directly on the hub**. The swap-style `deposit()` flow does not use them: it approves its input token with the swap-domain `sodax.swaps.isAllowanceValid` / `approve` (see [Flows](#flows)), and a withdraw needs no approval.

```typescript
const ok = await sodax.leverageYield.isAllowanceValid({
  vault: vault.vault,
  amount: 1_000_000_000_000_000_000n,
  owner: '0xHubWallet...',
});

if (ok.ok && !ok.value) {
  await sodax.leverageYield.approve({
    vault: vault.vault,
    amount: 1_000_000_000_000_000_000n,
    walletProvider: evmWalletProvider,
  });
}
```

## Methods

### getQuote

Solver quote for a vault deposit (`token_dst` = the vault) or withdraw (`token_src` = the vault), sized with the effective **leverage-yield** fee so the quote matches what the intent will charge. Prefer this over `sodax.swaps.getQuote` for vault flows. An optional `partnerFee` overrides the configured fee for this quote — pass the same value you pass to the builder. **Returns:** `Promise<Result<SolverIntentQuoteResponse, SolverErrorResponse | LeverageYieldLookupError>>` — on failure the error is either the solver's own `SolverErrorResponse` (`{ detail: { code, message } }`) or a `SodaxError` (`VALIDATION_FAILED` for a bad `amount` or a fee that leaves nothing to quote, `LOOKUP_FAILED`, `UNKNOWN`); discriminate with `isSodaxError(error)`.

### deposit

Builds the `LeverageYieldSwapPayload` for a deposit (any token → `lsoda*`, delivered to the hub wallet). An optional `partnerFee` is forwarded on the payload as the per-intent override of the effective leverage-yield fee. **Returns:** `Promise<Result<LeverageYieldSwapPayload, LeverageYieldCreateIntentError | LeverageYieldLookupError>>`. `context.action` is `'deposit'`.

### withdraw

Builds the `LeverageYieldSwapPayload` for a withdraw (`lsoda*` → any token), with `hubWalletSwap: true` set on the payload. `async` — it reads the hub block timestamp for the default `deadline`. An optional `partnerFee` is forwarded on the payload as the per-intent override; withdrawals are charged, and the fee is taken in `lsoda*` shares. **Returns:** `Promise<Result<LeverageYieldSwapPayload, LeverageYieldCreateIntentError | LeverageYieldLookupError>>`. `context.action` is `'withdraw'`.

### createVaultIntent

Creates the vault swap intent on the user's source spoke chain without submitting it to the solver — the leverage-yield copy of the swap domain's `createIntent`, honouring `hubWalletSwap` (withdraw routes via a hub-wallet `Connection.sendMessage`) and the per-intent `partnerFee` override. With `raw: true` returns unsigned tx data. Use it directly when you drive the relay yourself (e.g. the backend submit-tx path): relay the returned `relayData` with the shared `relayTxAndWaitPacket` helper, then call `notifySolver` with the hub-side intent tx hash to complete the flow. **Returns:** `Promise<Result<CreateVaultIntentResult<K, Raw>, LeverageYieldCreateIntentError>>` — `tx`, the constructed `intent` (with `feeAmount`), and `relayData`.

### vaultSwap

Executes the full end-to-end vault swap. `createVaultIntent` broadcasts the intent on the source spoke chain; completion then runs via one of the two paths in [Completion paths and `timeout`](#completion-paths-and-timeout) — by default the backend 2-step one, falling back to the client-side path (verify the spoke tx → relay to the hub, skipped when the source is Sonic → notify the solver) on any non-success. Pass `extras.apiKey` to key the backend leg for this call only. Spread a `LeverageYieldSwapPayload` into it alongside the wallet provider: `vaultSwap({ ...payload, walletProvider })`. **Returns:** `Promise<Result<VaultSwapResponse, LeverageYieldSwapError>>` — `solverExecutionResponse`, `intent`, and `intentDeliveryInfo`. `context.action` is `'vaultSwap'`.

### getDetailedStatus

Answers "what happened to this vault swap?" from the **source-chain** tx — the one identifier you always
hold after `vaultSwap()`. It does not define a new status: it routes to whichever of the two existing
sources can answer, and returns that source's payload unmodified.

```typescript
const result = await sodax.leverageYield.getDetailedStatus({
  srcChainKey: ChainKeys.ARBITRUM_MAINNET,
  srcTxHash: vaultSwapResponse.intentDeliveryInfo.srcTxHash,
});

if (result.ok) {
  if (result.value.source === 'backend') {
    // `data` is the SubmitTxStatusDataV2 from sodax.api.leverageYield.getSubmitTxStatus
    console.log(result.value.data.status); // pending … posted_execution | solved
  } else {
    // `data` is the SolverIntentStatusResponse — the vault intent IS a solver intent.
    // A failed or abandoned backend record routes here, so failure is the solver's FAILED code.
    console.log(result.value.data.status, result.value.dstTxHash);
  }
}
```

`DetailedLeverageYieldStatus` is discriminated on `source`, so it narrows on its own — no type guards
needed:

```typescript
type DetailedLeverageYieldStatus =
  | { source: 'backend'; data: SubmitTxStatusDataV2 }
  | { source: 'solver'; dstTxHash: Hex; data: SolverIntentStatusResponse };
```

**Why it exists.** `sodax.api.leverageYield.getSubmitTxStatus` cannot answer for every vault swap.
Sometimes there is no record — you opted out with `useBackendSubmitTx: false`, or the submit was rejected
(which a keyless caller hits every time). More often the record exists but is **stale**: the backend path
POSTs first and only falls back to the client-side relay once that stalls, so a fallback-completed vault
swap leaves behind whatever state the backend last reached, including a record it abandoned outright.
So the method routes:

1. Read the backend record; return it while it is still in play.
2. Otherwise resolve the hub tx hash — the source tx itself for hub-source vault swaps, else the
   delivered relay packet's `dst_tx_hash` — and return the solver's answer for it.

**A rejected API key stops there.** It is not a source with nothing to say — only a corrected key
resolves it — so it surfaces directly with `context.status` set for `isAuthFailure`, instead of being
routed on and buried behind a relay or solver error. The swap and bridge routers apply the same rule.

**Every other failure is `LOOKUP_FAILED`, and one of them is budgetable.** Branch on `error.context.reason`:
`DETAILED_STATUS_NOT_DELIVERED` means the relay has no packet for this source tx, which is ambiguous by
nature — a vault swap still in flight and one whose tx never relayed look identical — so it is the only
failure a caller should bound with a retry budget. Every other one is a dependency failing right now
(relay 5xx, solver down), so keep retrying until it recovers.

Takes an optional second argument, a `RequestOverrideConfig`. Its `apiKey` reaches every keyed leg —
the submit-tx record read, the solver read, and the durable-intent read a solver `NOT_FOUND` falls
back to — so one override keys the whole call. The relay leg is unauthenticated and takes none.

A point-in-time read — poll it yourself, or use `@sodax/dapp-kit`'s `useLeverageYieldDetailedStatus`.

### getIntentStatus

Polls the solver for the execution status of an intent this service created, keyed on the **hub-chain**
tx hash. Pair it with `notifySolver`. Reports the solver verbatim — unchanged contract.

It does **not** reconcile a `NOT_FOUND` against the backend's durable record. A restarted solver answers
`NOT_FOUND` for intents it already filled, because it keeps intent state in memory; `getDetailedStatus`
resolves that, and is what to reach for when you hold the source tx hash. Keeping it out of here is
deliberate: the reconcile also turns a `NOT_FOUND` behind an unreadable backend into an error, which
would change this method's answers for every caller already using it.

**Returns:** `Promise<Result<SolverIntentStatusResponse, LeverageYieldPostExecutionError>>`.

### notifySolver

Notifies the solver that a vault intent has landed on the hub, triggering it to fill — the leverage-yield copy of the swap domain's `postExecution`. `vaultSwap` calls it automatically; it is public so callers who created the intent with `createVaultIntent` and relayed it themselves can finish the flow manually. Pass `{ intent_tx_hash }` — the hub-chain (Sonic) tx hash where the intent registered (the relay packet's `dst_tx_hash`, or the spoke tx hash for hub-sourced intents). **Returns:** `Promise<Result<SolverExecutionResponse, LeverageYieldPostExecutionError>>` — emits only `EXECUTION_FAILED` / `EXTERNAL_API_ERROR` / `UNKNOWN`.

### approve

Approves the vault's underlying `asset` to the vault on Sonic. Resolves `asset()` on-chain, then delegates to `SpokeService.approve` when signing, or to `Erc20Service.approve` with `raw: true`, which returns unsigned tx data and does not broadcast. **Returns:** `Promise<Result<TxReturnType<HubChainKey, R> | EvmReturnType<true>, LeverageYieldApproveError>>`. `context.action` is `'approve'`.

**Some tokens take two transactions.** A few ERC-20s of the 2017 TetherToken lineage — Ethereum USDT
is the only one in the SODAX token list today — reject an allowance change from one non-zero value to
another, so a signed `approve` sends `approve(0)` first and waits for it to be mined before the real
approval. The user signs twice; the returned value is still a single transaction hash, the **last**
one's. Detection simulates the approval rather than consulting a token list, so a token listed later
behaves the same way.

### isAllowanceValid

Reads the on-chain allowance of the vault's `asset` for `owner → vault` and returns `true` when it covers `amount`. **Returns:** `Promise<Result<boolean, LeverageYieldAllowanceCheckError>>`. The error carries `phase: 'allowanceCheck'`.

### getApr

Computes the **steady-state** APR of a vault from the AAVE supply/borrow rates of its `asset` and `borrowToken`, scaled by the vault's target leverage (see *How the leverage-yield vault works* above for the formula and caveats). **Returns:** `Promise<Result<LeverageYieldApr, LeverageYieldLookupError>>`. Rates are in RAY (`1e27`); the leverage multiplier is in WAD (`1e18`). `netAprRay` can be negative; `targetLTV ≥ 100%` is rejected with `VALIDATION_FAILED`.

### getLsdApr / getEffectiveApr

`getLsdApr` fetches the underlying LSD's staking yield from DefiLlama; `getEffectiveApr` folds that yield into `getApr`'s AAVE-only view for the honest leveraged APR. **Returns:** `Promise<Result<LeverageYieldLsdApr | LeverageYieldEffectiveApr, LeverageYieldLookupError>>`.

> **No SDK-level caching.** Each call hits the DefiLlama HTTP API fresh — there is no built-in cache or rate limiting. UIs are typically protected by their query layer (the demo uses a 60 s `refetchInterval`), but server-side aggregators or tight polling loops should add their own caching to avoid DefiLlama rate limits. A failed/timed-out DefiLlama fetch falls back gracefully rather than throwing.

### getPosition

Reads the live leveraged-position snapshot (`collateral`, `debt`, `ltv`, `healthFactor`, `idleAsset`) via the non-standard `getPositionDetails()` view. **Returns:** `Promise<Result<LeverageYieldPosition, LeverageYieldLookupError>>`.

### getMaxWithdraw / getMaxWithdrawForUser

`getMaxWithdraw(vault, owner)` returns the ERC-4626 `maxWithdraw` for an owner. `getMaxWithdrawForUser(vault, srcChainKey, srcAddress)` resolves the user's hub wallet first, then returns `maxWithdraw` **less a small dust buffer** (1 000 wei) — trimming sidesteps an asset-denominated `withdraw` round-up that asks for one more share than the user holds. Clamps to `0n` rather than underflowing when the balance is below the buffer. **Returns:** `Promise<Result<bigint, LeverageYieldLookupError>>`.

### getShareBalance / getShareBalanceForUser

`lsoda*` share balance for an address, or for a user via their resolved hub wallet. **Returns:** `Promise<Result<bigint, LeverageYieldLookupError>>`.

### getTotalAssets / previewDeposit / previewWithdraw / previewRedeem / getAsset

Thin ERC-4626 reads: total assets held by the vault (TVL), share/asset previews, and the vault's `asset()`. All **return** `Promise<Result<bigint, LeverageYieldLookupError>>` (`getAsset` returns `Result<Address, …>`).

### listVaults / getVault / getVaultByAddress

Registry lookups (synchronous, no `Result`). `listVaults()` returns the registry from the active config; `getVault(name)` looks up by the `lsoda*` symbol; `getVaultByAddress(address)` looks up by the proxy address (case-insensitive). Return `undefined` for unknown keys.

## Types

### LeverageYieldVault

```typescript
type LeverageYieldVault = {
  name: string;        // lookup key — the lsoda* share-token symbol (e.g. 'lsodaWEETH')
  vault: Address;      // deployed vault proxy on Sonic — also the lsoda* token address
  asset: Address;      // underlying Sodax vault token (e.g. SodaTokens.sodaWEETH, symbol weETH)
  borrowToken: Address; // token borrowed against asset (e.g. sodaETH)
};
```

### LeverageYieldApr

```typescript
type LeverageYieldApr = {
  supplyAprRay: bigint;          // AAVE supply rate of asset, in RAY (1e27)
  borrowAprRay: bigint;          // AAVE variable borrow rate of borrowToken, in RAY
  targetLtvBps: bigint;          // vault targetLTV(), in basis points
  leverageMultiplierWad: bigint; // targetLTV / (1 - targetLTV), in WAD (1e18): borrowed multiple; exposure = 1 + this
  netAprRay: bigint;             // net APR at targetLTV, in RAY — can be negative
};
```

### LeverageYieldPosition

```typescript
type LeverageYieldPosition = {
  collateral: bigint;   // collateral supplied to the pool — vault-asset units (18 decimals)
  debt: bigint;         // outstanding borrowToken debt — vault-asset units (18 decimals)
  ltv: bigint;          // current loan-to-value in basis points (out of 10_000; 8_500 = 85%)
  healthFactor: bigint; // AAVE health factor in WAD (1e18); below 1e18 implies liquidation risk, type(uint256).max = no debt
  idleAsset: bigint;    // asset held by the vault but not yet supplied — vault-asset units (18 decimals)
};
```

## Error Handling

All async public methods return `Promise<Result<T, SodaxError<NarrowCode>>>`. Discriminate on `result.error.code` (a string literal) — never on `result.error.message`. Same canonical shape used by swap, bridge, and money market.

The service owns the full vault-swap lifecycle: `deposit` / `withdraw` build swap payloads, `createVaultIntent` submits the intent on the source spoke chain, `vaultSwap` orchestrates create → verify → relay → notify-solver, `approve` / `isAllowanceValid` manage the Sonic allowance, and the read methods query on-chain state. Relay/tx-verification codes appear **only** on `vaultSwap`, and only on its client-side path (the default, or the backend path's fallback) — so `TX_VERIFICATION_FAILED`, `TX_SUBMIT_FAILED`, `RELAY_TIMEOUT` and `RELAY_FAILED` never surface on a vault swap the backend completes. `deposit` / `withdraw` can additionally emit `LOOKUP_FAILED` (`method: 'resolveDeadline'`) when the default-`deadline` hub-block read fails — an RPC outage, not an intent-build failure. Every other method stays within the create-intent, approve, allowance-check, and lookup subsets.

### Per-method error code unions

| Method | Narrow type | Codes |
|---|---|---|
| `deposit`, `withdraw` | `LeverageYieldCreateIntentError \| LeverageYieldLookupError` | `VALIDATION_FAILED`, `INTENT_CREATION_FAILED`, `LOOKUP_FAILED`, `UNKNOWN` |
| `createVaultIntent` | `LeverageYieldCreateIntentError` | `VALIDATION_FAILED`, `INTENT_CREATION_FAILED`, `UNKNOWN` |
| `vaultSwap` | `LeverageYieldSwapError` | create-intent codes plus `TX_VERIFICATION_FAILED`, `TX_SUBMIT_FAILED`, `RELAY_TIMEOUT`, `RELAY_FAILED`, `EXECUTION_FAILED`, `EXTERNAL_API_ERROR` |
| `approve` | `LeverageYieldApproveError` | `VALIDATION_FAILED`, `APPROVE_FAILED`, `UNKNOWN` |
| `isAllowanceValid` | `LeverageYieldAllowanceCheckError` | `VALIDATION_FAILED`, `ALLOWANCE_CHECK_FAILED`, `UNKNOWN` |
| all read methods | `LeverageYieldLookupError` | `VALIDATION_FAILED`, `LOOKUP_FAILED`, `UNKNOWN` |

The broad union type is `LeverageYieldError` (`SodaxError<LeverageYieldErrorCode>`).

### Discriminators

- **`context.action`** — the user-facing operation (`'deposit' | 'withdraw' | 'approve' | 'vaultSwap'`).
- **`context.method`** — partitions `LOOKUP_FAILED` across the read methods (`'getApr'`, `'getPosition'`, `'getMaxWithdrawForUser'`, `'getShareBalance'`, …) and `'resolveDeadline'` for the `deposit` / `withdraw` default-deadline read.
- **`context.field`** — set on `VALIDATION_FAILED` (`'inputAmount'`, `'vault'`, `'inputToken'`, `'outputToken'`, `'amount'`, `'targetLtvBps'`).
- **`context.phase`** — `'intentCreation' | 'approve' | 'allowanceCheck' | 'lookup' | 'validate' | 'verify' | 'relay' | 'postExecution'`.

### Guards

Use the exported guards instead of `instanceof SodaxError` (bundle-safe):

- `isLeverageYieldError(e)` — broad guard for any leverage-yield error.
- `isLeverageYieldCreateIntentError(e)` — `createVaultIntent` and the create-intent arm of `deposit` / `withdraw` (whose default-deadline read can instead yield a `LOOKUP_FAILED` caught by `isLeverageYieldLookupError`).
- `isLeverageYieldSwapError(e)` — `vaultSwap`.
- `isLeverageYieldApproveError(e)` — `approve`.
- `isLeverageYieldAllowanceCheckError(e)` — `isAllowanceValid`.
- `isLeverageYieldLookupError(e)` — read methods.

### Discrimination example

```typescript
const result = await sodax.leverageYield.deposit({ /* ... */ });

if (!result.ok) {
  switch (result.error.code) {
    case 'VALIDATION_FAILED':
      // Bad input — error.context.field names the offending parameter.
      console.error('Bad input:', result.error.message, result.error.context?.field);
      break;
    case 'INTENT_CREATION_FAILED':
      // Building the swap params failed (e.g. hub-wallet resolution). cause has the original.
      console.error('Intent creation failed:', result.error.cause);
      break;
    case 'LOOKUP_FAILED':
      // An on-chain read failed — e.g. the default-deadline hub-block read (method='resolveDeadline').
      console.error('Lookup failed:', result.error.context?.method, result.error.cause);
      break;
    case 'UNKNOWN':
      console.error('Unexpected:', result.error.cause);
      break;
  }
}
```

### Best practices

1. **Discriminate on `error.code`, not `error.message`.** Messages are human-readable and may change.
2. **Partition reads via `context.method`.** All read methods share `LeverageYieldLookupError`; `context.method` tells you which read failed.
3. **Use `error.cause` for forensics.** Every wrapped error preserves the original on `cause`; loggers walk it automatically.
4. **Use `JSON.stringify(error)` for logging.** `toJSON()` handles bigint coercion + cause-chain truncation safely.
5. **Type-guard, don't `as`-cast.** Use the `isLeverageYield*Error` guards to narrow.

## Chain Keys

Vaults live on the Sonic hub; `deposit` / `withdraw` route by the user's spoke-side chain (`srcChainKey`) and the output chain (`dstChainKey`). Use `ChainKeys` from `@sodax/sdk` for chain-key constants.

## Leverage Positions

A vault is one shared ERC-4626 position at a single `targetLTV`. A **leverage position** is the unpooled counterpart: one owner-controlled AAVE account per position, cloned by `LeveragePositionFactory`. Because AAVE allows one eMode category per address, a vault forces every depositor into one category and one leverage tier, while an owner can hold several positions at different tiers simultaneously.

Positions have no static registry — discovery goes through the factory.

### Configuration

Position methods need the deployed factory, and it ships as a packaged default — `new Sodax()` can drive positions with no configuration at all.

Override it only to point somewhere else, such as a fork or a staging deployment:

```typescript
const sodax = new Sodax({ leverageYield: { positionFactory: '0x…' } });
```

Config merging skips `undefined`, so an absent override cannot blank the default. Blanking it deliberately is honoured, and factory-backed methods then return a `LOOKUP_FAILED` error — they fail closed rather than falling back to a placeholder. Position-only reads (`getPositionInfo`, `getPositionAccount`, `getPositionCollateralBalance`, `getPositionPendingState`) target the position directly and never need the factory.

### Reads

| Method | Returns |
|--------|---------|
| `listPositions(owner)` | Position clones owned by `owner`, in creation order |
| `listPositionsForUser(srcChainKey, srcAddress)` | The same, resolved through a spoke address's hub wallet |
| `getPositionInfo(position)` | Static descriptor — owner, both legs, fixed eMode category, and the position's own `feeBps` / `feeReceiver` |
| `getPositionAccount(position)` | Live AAVE snapshot — collateral, debt, LTV, health factor |
| `getPositionCollateralBalance(position, collateral?)` | Exact aToken balance — what a full exit sells, less the position's `feeBps` |
| `getPositionPendingState(position)` | The operation slot: recorded kind, whether the intent is live, whether it needs settling |
| `predictPosition(creator, owner, positionId?)` | Deterministic clone address; defaults to the next id |

`getPositionAccount` reads `getUserAccountData` on the pool, not the position contract, which keeps no accounting of its own. The pool address comes from `moneyMarket.lendingPool` config rather than the position's `pool()` getter — one round trip instead of two, and the deployment address stays sourced from config. Health factor is WAD (1e18); base-currency figures use the pool oracle's 8-decimal base unit.

Those base-currency figures are for display only. Any amount going into a transaction needs `getPositionCollateralBalance`: dividing base currency back out by a price lands *near* the balance, and a `decreaseLeverage` asking for more collateral than the position holds does not fail on submission — the hook's `transferFrom` reverts at fill time, so the intent silently expires. aToken balances only grow, so acting on a slightly stale read leaves interest dust rather than coming up short.

### Writes

**Use the high-level calls.** `openPosition`, `openPositionFromDebtToken` and `operatePosition` only
*post* the intent — reporting it is a separate `notifySolver` call, and an unreported intent expires
unfilled, so the owner ends up funded with leverage that never arrives and nothing said so. Three
methods pair the two steps for you, and which one to use is decided by the operation:

| operation | method | notifies |
| --- | --- | --- |
| open, either side | `openLeveragePosition({ side, params, walletProvider })` | yes |
| `buildAddLeverage` / `buildDecreaseLeverage` | `submitLeveragePositionIntent(...)` | yes |
| `buildPositionWithdraw` / `buildSettlePosition` / `buildCancelPositionOperation` | `runLeveragePositionOperation(...)` | no |

`withdraw`, `settle` and `cancel` are synchronous on the hub and need no notification. The split is
not cosmetic: sending a leverage change through the route-only method leaves an intent nothing will
fill, and it expires without a word. The other direction is merely noisy.

**The compiler enforces it.** `buildAddLeverage` and `buildDecreaseLeverage` return
`PositionIntentCall`, the other three return `PositionDirectCall`, and the two methods each accept
only their own. The brands are type-only and erased at runtime. `operatePosition` still takes plain
calls for anyone driving the relay by hand.

**Fees: read them from the POSITION, not from config.** `getEffectivePositionFee()` answers what a
position created *now* would carry, which is what an open needs. An existing position's fee was fixed
at creation, so config changes and per-call overrides make the two disagree — `getPositionInfo`
returns that position's own `feeBps` and `feeReceiver`, and an adjust or exit has to charge those. The
fee is given up on top of what the solver is paid, so at a non-zero fee an exit sized at the whole
collateral balance leaves nothing for it and cannot settle. A position fee is capped at
`MAX_POSITION_FEE_BPS` (100 bps = 1%), mirroring `LeveragePosition.MAX_FEE_BPS` — the contract reverts
above it, and the SDK rejects a higher configured or per-call fee before anything is signed. The rate
and the receiver must also be set together or not at all: the position rejects a rate with no receiver
(borrowed for, paid to nobody) and a receiver with no rate, so the SDK rejects both pairings too.

```ts
const result = await sodax.leverageYield.openLeveragePosition({
  side: 'collateral',                // 'debt' funds with the debt token instead
  params: { srcChainKey, srcAddress, token, amount, eModeCategory, borrowToken, borrowAmount, minCollateralOut },
  walletProvider,
});
if (!result.ok) throw result.error;
// Resolving means the intent is LIVE, not that the position is open.
if (!result.value.notified) warn(result.value.notifyError);
```

**A failed notification is `ok: true`, deliberately.** The money has already moved and the intent is
live on the hub; returning a failure would tell the caller nothing happened, and a caller that retries
on failure would open a second position. It is reported on the value, not raised.

The low-level methods remain for callers driving the relay themselves.

### Writes (low level)

Positions are driven by direct Sonic transactions rather than solver intents, so these are builders returning an `EvmRawTransaction` for the caller to sign with a hub wallet provider.

| Builder | Effect |
|---------|--------|
| `buildCreatePositionAndLeverage(...)` | Clone and lever a position in one transaction. `initialAssets` must ALREADY be at the position's address — see the funding note below |
| `buildCreatePositionFromDebtToken(...)` | Open from the **debt** token with no collateral of your own; the hook supplies the solver's collateral and borrows the shortfall |
| `buildAddLeverage(...)` | Borrow and swap into more collateral |
| `buildDecreaseLeverage(...)` | Give up collateral to repay debt — with the whole balance, this is a close into the debt token |
| `buildPositionWithdraw(...)` | Withdraw collateral out, to any address |
| `buildSettlePosition(...)` | Clear a resolved operation and sweep anything held loose to the owner. Permissionless |
| `buildCancelPositionOperation(...)` | Cancel the in-flight operation |

The two create builders return a `Result` because they need the factory address; the rest target the position directly and return the transaction unwrapped.

**The factory never moves anyone's tokens.** It holds no allowance and pulls from nobody: fund a position by transferring to the address it will be created at — `predictPosition(creator, owner, nextPositionIdFor(owner))` — and the clone supplies whatever it finds. So no approval to a shared contract exists anywhere in the flow. Do the transfer and the create in one batch; if the prediction is stale the create reverts on the missing balance and takes the transfer with it rather than stranding the tokens. `openPosition` / `openPositionFromDebtToken` build that batch for you.

**Do not open two positions for one owner concurrently.** The id is per-owner, so the owner's own second open is the only thing that can advance it between building a payload and executing it. The stale batch's create lands on a fresh, unfunded address and reverts on the factory's `balanceOf(position) < initialAssets` check; on the hub that takes the transfer with it and nothing is lost. Funded from a spoke, the deposit has already landed in the user's hub wallet by the time the relayed batch reverts, and it stays there — recover it with `sodax.recovery` ([RECOVERY.md](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/RECOVERY.md)).

**You can only create a position you own.** The factory requires `cfg.owner == msg.sender`, and the caller there is always the funder's own hub wallet, so there is nothing to choose — which is why `openPosition` takes no `owner`. The binding is what makes the refund address safe: `originAddress` decides where a cancelled operation's funds go and past a deadline anyone may trigger that cancel, so a third-party creator picking it was a standing claim on whatever the owner later contributed. It also means nobody else can advance the id your funding address is predicted from. To fund someone else, supply into a position they already own — `pool.supply(collateral, amount, position, 0)` — which sets no origin and takes nothing away.

Every position write is `onlyOwner`, and the owner is the user's hub wallet — so these must execute *as* that wallet. Building with `from: owner` is not enough; an address cannot send as another address. The methods in the next section do that for you and are the ones to reach for; the builders are the unit they carry.

Three behaviours worth designing around:

- **Leverage changes are asynchronous.** `addLeverage` / `decreaseLeverage` only *post* an intent; a solver fills it afterwards. Poll `getPositionPendingState` instead of treating the transaction receipt as completion. A position refuses a second operation while one is in flight.
- **An intent is invisible to the solver until its transaction hash is reported.** Pass the hash to `notifySolver` after routing, or the intent simply expires unfilled.
- **Cancelling returns nothing, because nothing was escrowed.** Posting a position intent moves no funds; cancelling revokes the outstanding grant and clears the pending slot. A position carrying no debt also returns its whole collateral balance to the owner.

### Sizing the leg — do not skip this

`borrowAmount` and `minCollateralOut` are yours to supply, and computing them from oracle prices **does not work**. A position's leverage is bought through the solver, and the two legs do not trade at their oracle ratio. `LeverageHook` supplies whatever the solver actually paid and only *then* borrows against it, so the pool sees `deposit + solver output`, never `deposit x leverage`. Size from parity and the borrow reverts with Aave `'36'` (COLLATERAL_CANNOT_COVER_NEW_BORROW) — the intent is accepted, the solver fills, and the whole fill unwinds. It has happened twice on mainnet, once at 11.03x where parity predicted 84% LTV against a real 92.06% and a 91% cap.

Use `sizeLeverageBorrow` and `projectLeverageLeg` (exported from `@sodax/sdk`) rather than reimplementing it:

```ts
import { sizeLeverageBorrow, projectLeverageLeg, type LeverageLegRequest } from '@sodax/sdk';

const request: LeverageLegRequest = {
  side: 'collateral',            // 'debt' when funding with the debt token instead
  deposit: parseUnits('100', 18),
  depositDecimals: 18,
  collateralPriceUsd: Number(collateralReserve.priceInUSD),
  borrowPriceUsd: Number(borrowReserve.priceInUSD),
  borrowDecimals: borrowReserve.decimals,
  leverage: 3,
};

// 1. Oracle-sized, because there is nothing else yet. Quote `intentInput`, not `borrowAmount`:
//    on a debt-side open the user's contribution goes to the solver too. Use
//    `getPositionLegQuote` rather than `getQuote`: it names the hub reserves the intent swaps and
//    quotes gross, which are the two details a hand-rolled call gets wrong.
const { borrowAmount, intentInput } = sizeLeverageBorrow(request);
const leg = await sodax.leverageYield.getPositionLegQuote({
  inputHubToken: borrowReserve.underlyingAsset,   // the hub RESERVE address, not the reserve object
  outputHubToken: collateralReserve.underlyingAsset,
  amount: intentInput,
});
if (!leg.ok) throw leg.error;
const quoted = leg.value.quotedAmount;

// 2. Now the honest numbers, from the quote.
const p = projectLeverageLeg(request, { quotedCollateral: quoted, collateralDecimals: 18 }, riskParams, 1);
if (p.exceedsMaxLtv) throw new Error(`too high at this price; max is ~${p.usableMaxLeverage.toFixed(2)}x`);

// `openLeveragePosition`, not `openPosition`: the latter posts the intent and leaves reporting it
// to you, and an unreported intent expires unfilled.
const opened = await sodax.leverageYield.openLeveragePosition({
  params: { ...funding, borrowToken, borrowAmount, minCollateralOut: p.minCollateralOut },
  walletProvider,
});
if (!opened.ok) throw opened.error;
if (!opened.value.notified) warn(opened.value.notifyError);
```

Four things worth knowing about what comes back:

- **`exceedsMaxLtv` is a hard gate, not a warning.** Post through it and the intent is accepted and then fails at fill.
- **`usableMaxLeverage` is the real ceiling, and it is below `1 / (1 - ltv)`.** At `ltv` 91% with the solver returning 98.77% of parity it is 9.88x, so an 11.03x that looks fine against parity was never available.
- **Everything is projected from the FLOOR, not the quote** — the floor is the worst fill the intent permits, so if the floor is safe every fill is. `haircut` and `costUsd` are the exception: they are the *expected* cost of the leg, measured from the quote, which is what a payback period should be measured against.
- **`leverage` is a multiple of the DEPOSIT, and the open position reports more.** The borrow is booked in full while the collateral arrives short by the haircut, leaving `deposit x (1 - (L-1)h)` of equity — so `collateral / equity` reads higher. Always higher, never lower: 2.00x requested at a 4.657% haircut reports **2.0488x**. Display `p.exposureLeverage`, not the number the user chose — and note it is measured at the floor like everything else here, so it reads above the fill by the slippage tolerance.

**On a debt-side open the deposit is not collateral.** It is handed to the solver as part of the input, so the only collateral the position ends up with is what the solver delivers. Counting it on both sides is the other half of that 84%-vs-92% miss; `side: 'debt'` handles it.

### Driving a position from any chain

> **Experimental off the hub.** Everything below is exercised end to end on Sonic. From a spoke, the
> inbound half (deposit, wrap, create, post the intent) is proven only by a fork replay of a real
> relayed message, and the outbound half — an exit or cancellation delivering the underlying back to
> the chain it came from — has never run on mainnet. A non-hub `srcChainKey` is experimental: expect
> to verify it against your own deployment before putting user funds through it.
>
> **Bitcoin is refused outright.** In TRADING mode the deposit is pulled from the Bound trading
> wallet, so the hub wallet has to be derived from that address rather than the personal one — which
> these paths do not do. `openPosition`, `openPositionFromDebtToken` and `operatePosition` return
> `VALIDATION_FAILED` (`field: 'srcChainKey'`) for a Bitcoin source rather than funding the wrong wallet.


Positions live on the hub, but nothing requires the user to. These carry the work there. They post the
intent and stop, so prefer the high-level calls above unless you are driving the relay yourself:

| Method | Effect |
|--------|--------|
| `openPosition({ params, walletProvider })` | Fund with collateral from `srcChainKey`, open, and post the leverage intent |
| `openPositionFromDebtToken({ params, walletProvider })` | The same from the **debt** side |
| `operatePosition({ params: { srcChainKey, srcAddress, calls } })` | Run position calls (add / decrease / withdraw / settle / cancel) as the hub wallet |
| `isPositionFundingAllowanceValid(...)` / `approvePositionFunding(...)` | The approval the deposit needs, against the spender that chain actually uses |
| `encodePositionCalls(txs)` | The hub-wallet payload, if you want to drive `spoke.deposit` / `spoke.sendMessage` yourself |

The hub is not a special case: there the calls route locally through the wallet router, and from a spoke they are relayed and the promise resolves once the hub side lands. `amount` is always in the funding token's own decimals — wrapping into the 18-decimal money-market reserve happens inside the relayed batch, so the deposit and the position are created together and the funds are never sitting on the hub unattached to a position.

Two details that are easy to get wrong:

- **Which hash to report.** Both are returned. `srcChainTxHash` is what the user signed; `dstChainTxHash` is the hub transaction where the intent exists, and that is the one `notifySolver` needs. On the hub they are the same transaction; from a spoke they are not.
- **Who can be paid.** The approve spender differs by chain — the user's own hub wallet on the hub, since the pull happens inside the routed batch, and the spoke asset manager elsewhere. `approvePositionFunding` resolves it; a hand-rolled approval against the wrong one leaves the deposit unpullable.

The position's recorded origin is the funding chain and address, so a leverage intent that never fills refunds to the user where they funded from — not to the position, and not to their hub wallet.

### Closing a position

There are two exits, and they differ in which asset the owner ends up holding.

**Into the collateral.** Sell only as much collateral as the debt is worth (`buildDecreaseLeverage`), wait for the fill, then `buildPositionWithdraw` the remainder. Two operations, and the withdrawal can pay out to any address. Overshoot the debt slightly — it accrues between quoting and filling, and dust debt left behind blocks the withdrawal entirely.

**Into the debt token.** Sell the collateral balance in one `buildDecreaseLeverage`. Net of the position's own `feeBps`: the fee is given up on top of the input, so at a non-zero fee the input is `balance x 10_000 / (10_000 + feeBps)` and the whole balance cannot settle. The solver delivers more debt token than is owed, so the hook repays the debt and leaves the surplus — the owner's equity, now denominated in the debt asset — in the position. `buildSettlePosition` sweeps it, and it goes to the position's `owner`, not to whoever signed.

A full exit cannot half-happen. The hook repays the debt and then withdraws all the collateral to pay the solver; were the delivered amount short of the debt, that withdrawal would leave debt standing against no collateral and the pool's health-factor check rejects it — the whole fill reverts and the position is untouched. So quote the full amount and check the floor would cover the debt before posting, rather than posting an intent that can only expire.

Collateral top-ups and debt repayment need no SDK call — AAVE already accepts both against an arbitrary account (`pool.supply(collateral, amount, position, 0)` and `pool.repay(borrowToken, amount, 2, position)`), so defending a position never waits on a solver fill.
