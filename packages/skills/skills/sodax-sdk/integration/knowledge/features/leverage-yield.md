# Leverage Yield — `LeverageYieldService`

Leveraged-yield ERC-4626 vaults on the Sonic hub. A vault loops supply → borrow → swap → re-supply to a target LTV, producing a leveraged long on the `asset` / `borrowToken` peg. The vault's share token (`lsoda*`) is treated as a **solver-tradeable token**, so deposits and withdrawals are intent-based swaps the service executes itself. New in v2 — no v1 equivalent.

Access: `sodax.leverageYield`. Service class: `LeverageYieldService`. Feature tag for errors: `'leverageYield'`.

> **Two products on one service.** Everything above the "Leverage positions" section is the **vault** — one shared ERC-4626 position at a single target LTV, entered and exited as an intent swap. A **leverage position** is the unpooled counterpart: one owner-controlled AAVE account per position, cloned by `LeveragePositionFactory`, with its own eMode category and leverage tier. They share the service and nothing else — vault methods take a `vault` address, position methods take a `position` address or open a new clone.

> **Backend HTTP client:** for the typed `sodax.api.leverageYield` client that calls the backend Leverage Yield API directly (vault reads, deposit/withdraw quotes + intents, submit-tx), see [`leverage-yield-api.md`](leverage-yield-api.md). `vaultSwap` routes through that client's submit-tx flow **by default** (with client-side fallback); opt out with `new Sodax({ leverageYield: { useBackendSubmitTx: false } })`.

## How it works

- A vault holds `asset` (a Sodax vault token like the weETH vault, `SodaTokens.sodaWEETH`) as collateral, borrows `borrowToken` (e.g. sodaETH) from the Sodax-forked AAVE pool, swaps it back into the asset, and re-supplies — to a `targetLTV`.
- The ERC-4626 **share token is the vault proxy address itself** (`lsoda*`). Holding shares = holding the leveraged position.
- **Deposit** = swap any spoke token → `lsoda*`, delivered to the user's **hub wallet** on Sonic. **Withdraw** = swap `lsoda*` (held in the hub wallet) → any token on any chain.
- **Steady-state APR**: `netAprRay = supplyAprRay + leverageMultiplier × (supplyAprRay − borrowAprRay)`, where `leverageMultiplier = targetLTV / (1 − targetLTV)` — the **borrowed** multiple of equity (debt ÷ equity), not total exposure. Exposure (collateral ÷ equity) is `1 + leverageMultiplier` = `1 / (1 − targetLTV)`: at `targetLtvBps` 8200 that is 4.56× borrowed, 5.56× exposure, so a UI label reading "Leverage" shows `1 + multiplier`. Rates are RAY (`1e27`); the multiplier and `healthFactor` are WAD (`1e18`); `targetLtvBps` and the position `ltv` are basis points (`10_000` = 100%). `netAprRay` goes **negative** when the borrow rate exceeds supply — for LSD-backed vaults the LSD's native staking yield (folded in by `getEffectiveApr`) is the real alpha.

## Public methods

```ts
// Quote — solver quote sized with the effective leverage-yield fee (NOT sodax.swaps.getQuote)
sodax.leverageYield.getQuote(payload: LeverageYieldQuoteParams): Promise<Result<SolverIntentQuoteResponse, SolverErrorResponse | LeverageYieldLookupError>>;
//   token_dst = vault to quote a deposit, token_src = vault to quote a withdraw
//   pass the same partnerFee here and to deposit()/withdraw()/vaultSwap(), or omit on all — never mix

// Builders — assemble a LeverageYieldSwapPayload (spread into vaultSwap). Do NOT broadcast.
sodax.leverageYield.deposit(params: LeverageYieldSwapDepositParams): Promise<Result<LeverageYieldSwapPayload, SodaxError>>;
sodax.leverageYield.withdraw(params: LeverageYieldSwapWithdrawParams): Promise<Result<LeverageYieldSwapPayload, SodaxError>>;
//   withdraw sets hubWalletSwap: true; both default `deadline` from the hub block timestamp (so withdraw is async)

// Intent create + end-to-end execute (leverage-yield copies of swap's createIntent / swap)
sodax.leverageYield.createVaultIntent<K, Raw>(params: VaultSwapActionParams<K, Raw>): Promise<Result<CreateVaultIntentResult<K, Raw>, SodaxError>>;
sodax.leverageYield.vaultSwap<K>(params: VaultSwapActionParams<K, false>): Promise<Result<VaultSwapResponse, SodaxError>>;
sodax.leverageYield.notifySolver(request: { intent_tx_hash: string }): Promise<Result<SolverExecutionResponse, SodaxError>>;
//   notifySolver is PUBLIC — call it to finish a manual createVaultIntent → relay → notify flow

// Status. getDetailedStatus takes the SOURCE tx (what you hold after vaultSwap) and routes to whichever
// source can answer; getIntentStatus takes the HUB tx and asks the solver directly.
sodax.leverageYield.getDetailedStatus(key: { srcChainKey, srcTxHash }, config?: RequestOverrideConfig):
  Promise<Result<DetailedLeverageYieldStatus, SodaxError>>;
sodax.leverageYield.getIntentStatus(request: { intent_tx_hash: string }): Promise<Result<SolverIntentStatusResponse, SodaxError>>;

// Sonic-direct allowance for the vault's underlying asset — NOT the deposit approval (that is sodax.swaps.isAllowanceValid / approve)
sodax.leverageYield.approve<R>(params: LeverageYieldApproveParams<R>): Promise<Result<TxReturnType<HubChainKey, R>, SodaxError>>;
sodax.leverageYield.isAllowanceValid(params: LeverageYieldAllowanceParams): Promise<Result<boolean, SodaxError>>;

// Reads (all Result<…, SodaxError> with LOOKUP_FAILED on failure)
sodax.leverageYield.getApr(vault): Promise<Result<LeverageYieldApr, SodaxError>>;             // AAVE-only steady-state
sodax.leverageYield.getEffectiveApr(vault): Promise<Result<LeverageYieldEffectiveApr, SodaxError>>; // + LSD staking yield (headline)
sodax.leverageYield.getLsdApr(vault): Promise<Result<LeverageYieldLsdApr, SodaxError>>;       // off-chain DefiLlama; always ok for a known vault
sodax.leverageYield.getPosition(vault): Promise<Result<LeverageYieldPosition, SodaxError>>;
sodax.leverageYield.getTotalAssets(vault): Promise<Result<bigint, SodaxError>>;              // TVL
sodax.leverageYield.previewDeposit(vault, assets): Promise<Result<bigint, SodaxError>>;
sodax.leverageYield.previewWithdraw(vault, assets): Promise<Result<bigint, SodaxError>>;
sodax.leverageYield.previewRedeem(vault, shares): Promise<Result<bigint, SodaxError>>;
sodax.leverageYield.getMaxWithdraw(vault, owner): Promise<Result<bigint, SodaxError>>;
sodax.leverageYield.getMaxWithdrawForUser(vault, srcChainKey, srcAddress): Promise<Result<bigint, SodaxError>>; // dust-buffered
sodax.leverageYield.getShareBalance(vault, owner): Promise<Result<bigint, SodaxError>>;
sodax.leverageYield.getShareBalanceForUser(vault, srcChainKey, srcAddress): Promise<Result<bigint, SodaxError>>;
sodax.leverageYield.getAsset(vault): Promise<Result<Address, SodaxError>>;

// Registry (synchronous)
sodax.leverageYield.listVaults(): readonly LeverageYieldVault[];
sodax.leverageYield.getVault(name): LeverageYieldVault | undefined;
sodax.leverageYield.getVaultByAddress(address): LeverageYieldVault | undefined;
```

## Action params shape

```ts
type LeverageYieldSwapDepositParams = {
  vault: Address;             // the lsoda* vault proxy
  srcChainKey: SpokeChainKey; // chain the user holds inputToken on & signs from
  srcAddress: string;
  inputToken: string;         // spoke-side token paid in
  inputAmount: bigint;
  minOutputAmount: bigint;    // min lsoda* (18 dp), slippage applied
  deadline?: bigint;          // defaults to hub block timestamp + 5 min
  solver?: Address;           // 0x0 = any solver
  partnerFee?: PartnerFee;    // per-intent override; deducted from inputAmount before the swap
};

type LeverageYieldSwapWithdrawParams = {
  vault: Address;
  srcChainKey: SpokeChainKey; // chain the user signs the sendMessage on
  srcAddress: string;
  dstChainKey: SpokeChainKey; // where the swapped-back token is delivered
  outputToken: string;
  inputAmount: bigint;        // lsoda* shares to burn (18 dp)
  minOutputAmount: bigint;
  recipient?: string;         // defaults to srcAddress
  deadline?: bigint;
  solver?: Address;
  partnerFee?: PartnerFee;    // per-intent override; deducted from inputAmount, i.e. in lsoda* shares
};

// The execute-mode wrapper (createVaultIntent / vaultSwap). The two vault execution modifiers
// live HERE, never on the generic swap surface:
type VaultSwapActionParams<K, Raw> = SpokeExecActionParams<K, Raw, CreateIntentParams<K>, LeverageYieldExtras> & {
  hubWalletSwap?: boolean;  // withdraw: inputToken is hub-wallet lsoda*, authorise via Connection.sendMessage
  partnerFee?: PartnerFee;  // beats config.leverageYield.partnerFee for this intent only
};
type LeverageYieldExtras = { apiKey?: string };  // per-action key for the backend submit-tx leg only

// getDetailedStatus — discriminated on `source`, no guards needed. Arms are swap's, not bridge's:
// a vault swap IS a solver intent, so the second source is the solver, not a terminal relay packet.
type DetailedLeverageYieldStatus =
  | { source: 'backend'; data: SubmitTxStatusDataV2 }
  | { source: 'solver'; dstTxHash: Hex; data: SolverIntentStatusResponse };
// On failure: LOOKUP_FAILED. A rejected key stops there with context.status set (isAuthFailure) —
// never routed on. Otherwise branch on error.context.reason: DETAILED_STATUS_NOT_DELIVERED is the one
// ambiguous miss a caller should bound with a retry budget; anything else is a live dependency failure.
```

## Common call shapes

### Deposit (any token → `lsoda*`)

```ts
const srcChainKey = ChainKeys.ARBITRUM_MAINNET;
const inputToken = '0x…weETHonArbitrum';
const inputAmount = parseUnits('1', 18);
const SLIPPAGE_BPS = 100n; // 1%; take it from the user, capped

// Size the minimum from a live quote: vault as token_dst. Never ship 0n — that accepts any fill.
const quote = await sodax.leverageYield.getQuote({
  token_src: inputToken,
  token_src_blockchain_id: srcChainKey,
  token_dst: vault.vault,
  token_dst_blockchain_id: ChainKeys.SONIC_MAINNET,
  amount: inputAmount,
  quote_type: 'exact_input',
});
if (!quote.ok) return;
const minOutputAmount = (quote.value.quoted_amount * (10_000n - SLIPPAGE_BPS)) / 10_000n;

const built = await sodax.leverageYield.deposit({
  vault: vault.vault,
  srcChainKey,
  srcAddress: '0x…',
  inputToken,
  inputAmount,
  minOutputAmount,
});
if (!built.ok) return;

// deposit()/vaultSwap() never approve: the spoke asset manager pulls inputToken, so approve it swap-style first.
const allowance = await sodax.swaps.isAllowanceValid({ params: built.value.params, walletProvider });
if (!allowance.ok) return;
if (!allowance.value) {
  // Pin the chain so the result narrows to an EVM tx hash.
  const approval = await sodax.swaps.approve<typeof srcChainKey, false>({
    params: { ...built.value.params, srcChainKey },
    walletProvider,
  });
  if (!approval.ok) return;
  const receipt = await walletProvider.waitForTransactionReceipt(approval.value);
  // Providers report a revert as viem's 'reverted' or the JSON-RPC '0x0'.
  if (receipt.status === 'reverted' || receipt.status === '0x0') return;
}

const result = await sodax.leverageYield.vaultSwap({ ...built.value, walletProvider });
if (!result.ok) return;
const { solverExecutionResponse, intent, intentDeliveryInfo } = result.value;
```

### Withdraw (`lsoda*` → any token)

```ts
const outputToken = '0x…weETHonArbitrum';
const SLIPPAGE_BPS = 100n;
// Withdraw quote: vault as token_src, on the hub (the shares live in the hub wallet).
const withdrawQuote = await sodax.leverageYield.getQuote({
  token_src: vault.vault,
  token_src_blockchain_id: ChainKeys.SONIC_MAINNET,
  token_dst: outputToken,
  token_dst_blockchain_id: ChainKeys.ARBITRUM_MAINNET,
  amount: shareBalance,
  quote_type: 'exact_input',
});
if (!withdrawQuote.ok) return;

const built = await sodax.leverageYield.withdraw({
  vault: vault.vault,
  srcChainKey: ChainKeys.ARBITRUM_MAINNET, // user signs the sendMessage here
  srcAddress: '0x…',
  dstChainKey: ChainKeys.ARBITRUM_MAINNET, // token delivered here
  outputToken,
  inputAmount: shareBalance,               // lsoda* to burn
  minOutputAmount: (withdrawQuote.value.quoted_amount * (10_000n - SLIPPAGE_BPS)) / 10_000n,
});
if (!built.ok) return;
// built.value.hubWalletSwap === true — no spoke approval; the hub wallet authorises the spend
await sodax.leverageYield.vaultSwap({ ...built.value, walletProvider });
```

**Partner fee is opt-in.** Omit `partnerFee` unless the integrator supplied their own receiver address. To override the fee per intent, pass the same `partnerFee` to `getQuote` and to `deposit()` / `withdraw()`, and quote the gross `inputAmount`: `getQuote` deducts the fee itself, so both sides end up on the same net input.

### Manual create → relay → notify

```ts
const created = await sodax.leverageYield.createVaultIntent({ ...built.value, raw: false, walletProvider });
if (!created.ok) return;
const { tx, relayData } = created.value;
// relay `tx` with the shared relayTxAndWaitPacket helper using relayData, then:
await sodax.leverageYield.notifySolver({ intent_tx_hash: hubIntentTxHash });
```

## Return shapes

| Method | Success type |
|---|---|
| `getQuote` | `SolverIntentQuoteResponse` (`{ quoted_amount }`) — error is `SolverErrorResponse \| LeverageYieldLookupError`, so discriminate with `isSodaxError(error)` before reading `.code` |
| `deposit`, `withdraw` | `LeverageYieldSwapPayload` (`{ params: CreateIntentParams; hubWalletSwap?: true; partnerFee? }`) |
| `createVaultIntent` | `CreateVaultIntentResult<K, Raw>` (`{ tx, intent & feeAmount, relayData }`) |
| `vaultSwap` | `VaultSwapResponse` (`{ solverExecutionResponse, intent, intentDeliveryInfo }`) |
| `notifySolver` | `SolverExecutionResponse` (`{ answer, intent_hash }`) |
| `approve` | `TxReturnType<HubChainKey, R>` |
| `isAllowanceValid` | `boolean` |
| `getApr` | `LeverageYieldApr` (`{ supplyAprRay, borrowAprRay, targetLtvBps, leverageMultiplierWad, netAprRay }` — rates RAY, `targetLtvBps` basis points, multiplier WAD and the **borrowed** multiple) |
| `getEffectiveApr` | `LeverageYieldEffectiveApr` (= `LeverageYieldApr & { lsdApr, effectiveSupplyAprRay, effectiveNetAprRay }`) |
| `getLsdApr` | `LeverageYieldLsdApr` (`{ aprRay, label, stale }`) |
| `getPosition` | `LeverageYieldPosition` (`{ collateral, debt, ltv, healthFactor, idleAsset }` — `ltv` basis points, `healthFactor` WAD, amounts 18 dp) |
| `getTotalAssets`, `preview*`, `getMaxWithdraw*`, `getShareBalance*` | `bigint` |
| `getAsset` | `Address` |
| `listVaults` / `getVault` / `getVaultByAddress` | `LeverageYieldVault[]` / `LeverageYieldVault \| undefined` (synchronous) |

`approve` can send **two** transactions on a token that rejects a non-zero to non-zero allowance
change (Ethereum USDT is the only listed one today): `approve(0)` is mined first, then the real
approval, so the user signs twice. The returned value is unchanged — one hash, the **last**
transaction's. Detection simulates the approval, so never gate on a token list. Full note: "ERC-20
approval can take two transactions" in [`architecture.md`](../architecture.md).

## Error codes

`feature: 'leverageYield'`. Action discriminator on `context.action`: `'deposit' | 'withdraw' | 'approve' | 'allowanceCheck' | 'vaultSwap' | 'openPosition' | 'openPositionFromDebtToken' | 'operatePosition' | 'openLeveragePosition' | 'submitLeveragePositionIntent' | 'runLeveragePositionOperation' | 'getPositionLegQuote'`. Read methods partition on `context.method`.

| Method | Narrow code union |
|---|---|
| `getQuote` | `VALIDATION_FAILED` (non-positive `amount`, or a partner fee that leaves nothing to quote) `\| LOOKUP_FAILED` (unsupported token — solver payload could not be assembled) `\| UNKNOWN`, **or** a non-SodaxError `SolverErrorResponse` (`{ detail: { code, message } }`) straight from the solver. Guard with `isSodaxError(error)`. Context uses `tokenSrcChainKey` / `tokenDstChainKey`, not `srcChainKey` / `dstChainKey` — a withdraw quote's `token_src` is the hub, not the signing chain |
| `deposit`, `withdraw` | `VALIDATION_FAILED \| INTENT_CREATION_FAILED \| LOOKUP_FAILED \| UNKNOWN` (create-intent subset + `LOOKUP_FAILED` with `method: 'resolveDeadline'` when the default-deadline hub-block read fails) |
| `createVaultIntent` | `VALIDATION_FAILED \| INTENT_CREATION_FAILED \| UNKNOWN` (create-intent subset) |
| `vaultSwap` | `VALIDATION_FAILED \| INTENT_CREATION_FAILED \| TX_VERIFICATION_FAILED \| TX_SUBMIT_FAILED \| RELAY_TIMEOUT \| RELAY_FAILED \| EXECUTION_FAILED \| EXTERNAL_API_ERROR \| UNKNOWN` |
| `notifySolver` | `EXECUTION_FAILED \| EXTERNAL_API_ERROR \| UNKNOWN` (with `phase: 'postExecution'`) |
| `approve` | `VALIDATION_FAILED \| APPROVE_FAILED \| UNKNOWN` |
| `isAllowanceValid` | `VALIDATION_FAILED \| ALLOWANCE_CHECK_FAILED \| UNKNOWN` (action `'allowanceCheck'`) |
| Read methods | `VALIDATION_FAILED \| LOOKUP_FAILED \| UNKNOWN` (with `method` discriminator) |
| `openPosition`, `openPositionFromDebtToken`, `openLeveragePosition` | `LeverageYieldSwapError \| LeverageYieldLookupError` — the swap subset plus `LOOKUP_FAILED` (hub-wallet / factory resolution). `VALIDATION_FAILED` with `field: 'srcChainKey'` is the Bitcoin refusal |
| `operatePosition`, `submitLeveragePositionIntent`, `runLeveragePositionOperation` | `LeverageYieldSwapError` |
| `getPositionLegQuote` | same as `getQuote` — a `SolverErrorResponse` arm plus the lookup subset; guard with `isSodaxError` |
| `isPositionFundingAllowanceValid` / `approvePositionFunding` | `ALLOWANCE_CHECK_FAILED` / `APPROVE_FAILED` subsets (actions `'allowanceCheck'` / `'approve'`) |
| Position reads + `getEffectivePositionFee` | `VALIDATION_FAILED \| LOOKUP_FAILED \| UNKNOWN`. A blanked `positionFactory` fails closed here |

Relay/tx-verification codes appear **only** on `vaultSwap` — `createVaultIntent` alone stays within the create-intent subset. `notifySolver` (public, for manual orchestration) emits the post-execution subset, which `vaultSwap` also surfaces.

## Leverage positions

One AAVE account per position, cloned by `LeveragePositionFactory`. AAVE allows one eMode category per address, so a vault forces every depositor into one category and one leverage tier while an owner can hold several positions at different tiers at once. There is **no static registry** — discovery goes through the factory.

The factory ships as a packaged default, so `new Sodax()` drives positions with no configuration. Override only to point at a fork or staging deployment (`new Sodax({ leverageYield: { positionFactory: '0x…' } })`). Blanking it deliberately is honoured and factory-backed methods then fail closed with `LOOKUP_FAILED` rather than guessing an address. Position-only reads (`getPositionInfo`, `getPositionAccount`, `getPositionCollateralBalance`, `getPositionPendingState`) target the position directly and never need the factory.

> **`@experimental` off the hub.** Proven end to end on Sonic only. From a spoke the inbound half is verified by a fork replay of a real relayed message; the outbound half (an exit or cancel delivering the underlying back to the source chain) has never run on mainnet. **Bitcoin is refused outright** — in TRADING mode the deposit is pulled from the Bound trading wallet and these paths do not derive the hub wallet from it, so a Bitcoin `srcChainKey` returns `VALIDATION_FAILED` (`field: 'srcChainKey'`) instead of funding the wrong wallet.

### Reads

```ts
sodax.leverageYield.listPositions(owner: Address): Promise<Result<readonly Address[], LeverageYieldLookupError>>;
sodax.leverageYield.listPositionsForUser(srcChainKey, srcAddress): Promise<Result<readonly Address[], …>>; // POSITIONAL args, not an object
sodax.leverageYield.getPositionInfo(position: Address): Promise<Result<LeveragePosition, …>>;
sodax.leverageYield.getPositionAccount(position: Address): Promise<Result<LeveragePositionAccount, …>>;
sodax.leverageYield.getPositionCollateralBalance(position, collateral?): Promise<Result<LeveragePositionCollateral, …>>;
sodax.leverageYield.getPositionPendingState(position: Address): Promise<Result<LeveragePositionPendingState, …>>;
sodax.leverageYield.predictPosition(creator, owner, positionId?): Promise<Result<Address, …>>; // defaults to the next id
sodax.leverageYield.getEffectivePositionFee(override?): Result<{ feeReceiver: Address; feeBps: number }, …>; // SYNCHRONOUS
```

| Type | Fields |
|---|---|
| `LeveragePosition` | `{ address, owner, collateral, borrowToken, eModeCategory, feeBps, feeReceiver }` — static descriptor, fee fixed at creation |
| `LeveragePositionAccount` | `{ totalCollateralBase, totalDebtBase, availableBorrowsBase, currentLiquidationThreshold, ltv, healthFactor }` — all bigint |
| `LeveragePositionCollateral` | `{ aToken, balance }` — exact aToken balance in the collateral reserve's decimals |
| `LeveragePositionPendingState` | `{ kind: number, isLive: boolean, needsSettle: boolean }` |

`getPositionAccount` reads `getUserAccountData` on the pool, not the position contract (which keeps no accounting). `healthFactor` is WAD (1e18); the `*Base` figures use the pool oracle's 8-decimal base unit and are **display-only**. Any amount going into a transaction comes from `getPositionCollateralBalance` — dividing base currency back out by a price lands only *near* the balance, and a `decreaseLeverage` asking for more collateral than the position holds does not fail on submission: the hook's `transferFrom` reverts at fill time and the intent silently expires.

### Writes — use the high-level calls

`openPosition`, `openPositionFromDebtToken` and `operatePosition` only **post** the intent. Reporting it is a separate `notifySolver` call, and an unreported intent expires unfilled — the owner ends up funded with leverage that never arrives and nothing said so. Three methods pair the two steps, and which one to use is decided by the operation, not by preference:

| operation | method | notifies |
|---|---|---|
| open, either side | `openLeveragePosition({ side?, params, walletProvider })` | yes |
| `buildAddLeverage` / `buildDecreaseLeverage` | `submitLeveragePositionIntent({ params: { srcChainKey, srcAddress, calls }, walletProvider })` | yes |
| `buildPositionWithdraw` / `buildSettlePosition` / `buildCancelPositionOperation` | `runLeveragePositionOperation(…)` | no |

`withdraw`, `settle` and `cancel` are synchronous on the hub and need no notification. **The compiler enforces the rows:** `buildAddLeverage` / `buildDecreaseLeverage` return `PositionIntentCall`, the other three return `PositionDirectCall`, and each method accepts only its own. The brands are type-only and erased at runtime. A direct call may ride along in a reporting batch (`[buildSettlePosition, buildAddLeverage]` is the sequence batching exists for); an intent call on the route-only path is refused.

```ts
sodax.leverageYield.openLeveragePosition<K>(params:
  | ({ side?: 'collateral' } & SpokeExecActionParams<K, false, OpenPositionParams<K>>)
  | ({ side: 'debt' } & SpokeExecActionParams<K, false, OpenPositionFromDebtTokenParams<K>>)
): Promise<Result<LeveragePositionIntentResult, LeverageYieldSwapError | LeverageYieldLookupError>>;

sodax.leverageYield.submitLeveragePositionIntent<K>(
  params: SpokeExecActionParams<K, false, PositionOperationParams<K, PositionBatchCall>>
): Promise<Result<LeveragePositionIntentResult, LeverageYieldSwapError>>;

sodax.leverageYield.runLeveragePositionOperation<K>(
  params: SpokeExecActionParams<K, false, PositionOperationParams<K, PositionDirectCall>>
): Promise<Result<TxHashPair, LeverageYieldSwapError>>;

// LeveragePositionIntentResult = { txHashes: TxHashPair; notified: boolean; notifyError?: string }
```

**A failed notification is `ok: true`, deliberately.** The money has already moved and the intent is live on the hub; returning a failure would tell the caller nothing happened, and a caller that retries on failure would open a second position. Read `notified` on the value — `false` means nothing will fill the intent before it expires.

### Params shape

```ts
type PositionFundingParams<K> = {
  srcChainKey: K;
  srcAddress: string;       // funds come from here; a failed intent refunds here
  token: string;            // token on srcChainKey to fund with
  amount: bigint;           // in `token`'s OWN decimals — wrapping to the 18-dp hub reserve happens in the batch
  eModeCategory?: number;   // fixed for the life of the position; defaults to 0
  minCollateralOut: bigint; // slippage floor on what the solver must deliver
  partnerFee?: PartnerFee;  // percentage variant only; FIXED AT CREATION, capped (see `MAX_POSITION_FEE_BPS` in `packages/sdk/src/leverageYield/LeverageYieldService.ts`); rate and receiver must be set together or not at all; defaults to leverageYield.partnerFee
};
type OpenPositionParams<K>              = PositionFundingParams<K> & { borrowToken: Address; borrowAmount: bigint };
type OpenPositionFromDebtTokenParams<K> = PositionFundingParams<K> & { collateral: Address; totalInput: bigint };
type PositionOperationParams<K, C>      = { srcChainKey: K; srcAddress: string; calls: readonly C[] };
```

There is **no `owner`**: the factory requires `cfg.owner == msg.sender` and the caller is always the funder's own hub wallet. That binding is what makes the refund address safe — `originAddress` decides where a cancelled operation's funds go, and past a deadline anyone may trigger that cancel. To fund someone else, supply into a position they already own: `pool.supply(collateral, amount, position, 0)`.

### Funding approval

**Nothing is ever approved to the factory** — it pulls from nobody. Funding is a transfer to `predictPosition(...)` and the clone supplies whatever it finds, batched with the create so a stale prediction reverts and takes the transfer with it rather than stranding tokens. Do not open two positions for one owner concurrently: the owner's own second open is the only thing that can advance the id, and off the hub the deposit has already reached the hub wallet when the batch reverts — recover it with `sodax.recovery`. The one approval that does exist has a spender that **differs by chain** — the user's own hub wallet on the hub (the pull happens inside the routed batch), the spoke asset manager elsewhere:

```ts
sodax.leverageYield.isPositionFundingAllowanceValid({ srcChainKey, srcAddress, token, amount }): Promise<Result<boolean, …>>;
sodax.leverageYield.approvePositionFunding({ srcChainKey, srcAddress, token, amount, walletProvider? }): Promise<Result<TxReturnType<K, false>, …>>;
```

`approvePositionFunding` waits for the approve to land before resolving — `verifyTxHash` returns `{ ok: true }` for EVM without waiting, which is why hand-rolled callers were asking users to approve twice.

### Sizing the leg — do not skip

`borrowAmount` / `minCollateralOut` are yours to supply and **computing them from oracle prices does not work**. Leverage is bought through the solver and the two legs do not trade at their oracle ratio: `LeverageHook` supplies whatever the solver actually paid and only *then* borrows against it, so the pool sees `deposit + solver output`, never `deposit × leverage`. Parity sizing gets the borrow rejected with Aave `'36'` (COLLATERAL_CANNOT_COVER_NEW_BORROW) *after* the solver has filled, unwinding the whole fill. It happened twice on mainnet — once at 11.03x where parity predicted 84% LTV against a real 92.06% and a 91% cap.

```ts
import { sizeLeverageBorrow, projectLeverageLeg, type LeverageLegRequest } from '@sodax/sdk';

// LeverageLegRequest = { side, deposit, depositDecimals, collateralPriceUsd, borrowPriceUsd,
//                        borrowDecimals, leverage, feeBps? }
// 1. Oracle-sized, because there is nothing else yet.
const { borrowAmount, intentInput } = sizeLeverageBorrow(request);
//    LeverageBorrowSizing = { borrowAmount, intentInput, depositUsd, borrowUsd, feeAmount }

// 2. Quote `intentInput`, NOT `borrowAmount` — on a debt-side open the user's contribution goes to
//    the solver too. Use getPositionLegQuote: it names the hub reserves the intent actually swaps
//    and quotes gross, the two details a hand-rolled getQuote gets wrong.
const leg = await sodax.leverageYield.getPositionLegQuote({
  inputHubToken: borrowReserve.underlyingAsset,    // the hub RESERVE ADDRESS, not the reserve object
  outputHubToken: collateralReserve.underlyingAsset,
  amount: intentInput,
});
if (!leg.ok) throw leg.error;                       // PositionLegQuote = { quotedAmount }

// 3. Now the honest numbers, from the quote.
const p = projectLeverageLeg(
  request,
  { quotedCollateral: leg.value.quotedAmount, collateralDecimals },  // LeverageLegQuote
  { ltv, liquidationThreshold },                                     // ReserveRiskParams (numbers, not bps)
  slippagePct,
);
if (p.exceedsMaxLtv) throw new Error(`max ~${p.usableMaxLeverage.toFixed(2)}x at this price`);
// open with { borrowAmount, minCollateralOut: p.minCollateralOut }
```

`LeverageLegProjection = { minCollateralOut, collateralUsd, debtUsd, ltv, healthFactor, exceedsMaxLtv, usableMaxLeverage, haircut, inputUsd, costUsd, exposureLeverage }`. Four things about it:

- **`exceedsMaxLtv` is a hard gate, not a warning.** Post through it and the intent is accepted, then fails at fill.
- **`usableMaxLeverage` is the real ceiling, strictly below `1 / (1 - ltv)`.** At `ltv` 91% with the solver returning 98.77% of parity it is 9.88x — so an 11.03x that looked fine against parity was never available.
- **Everything is projected from the FLOOR, not the quote** — the floor is the worst fill the intent permits, so if the floor is safe every fill is. `haircut` and `costUsd` are the exception: expected cost measured from the quote, which is what a payback period should use.
- **`leverage` is a multiple of the DEPOSIT and the open position reports more.** The borrow is booked in full while the collateral arrives short by the haircut, leaving `deposit × (1 - (L-1)h)` of equity. Always higher, never lower: 2.00x requested at a 4.657% haircut reports **2.0488x**. Display `exposureLeverage`, not the number the user chose.

Read `ltv` / `liquidationThreshold` from the eMode category whenever the position sets one — a category's LTV replaces the reserve's own. **On a debt-side open the deposit is not collateral**: it is handed to the solver as part of the input, so the only collateral the position ends up with is what the solver delivers. Counting it on both sides is the other half of that 84%-vs-92% miss; `side: 'debt'` handles it.

### Fees — read them from the POSITION, not from config

`getEffectivePositionFee()` answers what a position created *now* would carry, which is what an **open** needs. An existing position's fee was fixed at creation, so config changes and per-call overrides make the two disagree — `getPositionInfo` returns that position's own `feeBps` / `feeReceiver`, and an adjust or exit has to charge those. The fee is given up **on top of** what the solver is paid, so at a non-zero fee an exit sized at the whole collateral balance leaves nothing for it and cannot settle: the input is `balance × 10_000 / (10_000 + feeBps)`.

### Low-level builders

Builders return an `EvmRawTransaction` for the caller to run as the hub wallet. Every position write is `onlyOwner` and the owner is the hub wallet, so a builder's transaction sent from the signing address reverts — setting `from` does not help, an address cannot send as another address. Reach for the three high-level methods above; these are the unit they carry.

| Builder | Effect |
|---|---|
| `buildCreatePositionAndLeverage(…)` | Clone and lever in one tx. `initialAssets` must ALREADY be at the position's address |
| `buildCreatePositionFromDebtToken(…)` | Open from the **debt** token with no collateral of your own |
| `buildAddLeverage(…)` | Borrow and swap into more collateral → `PositionIntentCall` |
| `buildDecreaseLeverage(…)` | Give up collateral to repay debt; with the whole balance this is a close into the debt token → `PositionIntentCall` |
| `buildPositionWithdraw(…)` | Withdraw collateral out, to any address → `PositionDirectCall` |
| `buildSettlePosition(…)` | Clear a resolved operation and sweep loose funds to the owner. Permissionless → `PositionDirectCall` |
| `buildCancelPositionOperation(…)` | Cancel the in-flight operation → `PositionDirectCall` |

The two create builders return a `Result` (they need the factory address); the rest target the position directly and return the transaction unwrapped. `encodePositionCalls(txs)` gives the hub-wallet payload if you want to drive `spoke.deposit` / `spoke.sendMessage` yourself.

Three behaviours to design around:

- **Leverage changes are asynchronous.** `addLeverage` / `decreaseLeverage` only post an intent; poll `getPositionPendingState` instead of treating the receipt as completion. A position refuses a second operation while one is in flight.
- **Which hash to report.** `TxHashPair` returns both. `srcChainTxHash` is what the user signed; **`dstChainTxHash`** is the hub transaction the intent exists in, and that is the one `notifySolver` needs. On the hub they are the same transaction; from a spoke they are not.
- **Cancelling returns nothing, because nothing was escrowed.** Posting a position intent moves no funds; cancelling revokes the grant and clears the pending slot.

### Closing a position

Two exits, differing in what the owner ends up holding. **Into the collateral:** sell only as much collateral as the debt is worth (`buildDecreaseLeverage`), wait for the fill, then `buildPositionWithdraw` the remainder — two operations, and the withdrawal can pay out to any address. Overshoot the debt slightly; it accrues between quoting and filling, and dust debt left behind blocks the withdrawal entirely. **Into the debt token:** sell the collateral balance in one `buildDecreaseLeverage` (net of `feeBps`, see above); the solver delivers more debt token than is owed, the hook repays and leaves the surplus for `buildSettlePosition` to sweep to the position's `owner` — not to whoever signed.

A full exit cannot half-happen: were the delivered amount short of the debt, the hook's withdrawal would leave debt against no collateral and the pool's health-factor check rejects it, reverting the whole fill. Quote the full amount and check the floor covers the debt before posting.

Collateral top-ups and debt repayment need no SDK call — AAVE accepts both against an arbitrary account (`pool.supply(collateral, amount, position, 0)`, `pool.repay(borrowToken, amount, 2, position)`), so defending a position never waits on a solver fill.

## Cross-references

- ERC-4626 share-as-token model, APR math, and the deliberate swap-domain duplication: SDK source `packages/sdk/docs/LEVERAGE_YIELD.md`.
- For React Query hooks over this surface, load the `sodax-dapp-kit` skill (integration mode) — its `features/leverage-yield.md`.
- v2-only feature — no migration sibling.
