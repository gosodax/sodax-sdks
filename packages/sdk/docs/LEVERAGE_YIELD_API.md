# Leverage Yield API — `LeverageYieldApiService`

Typed HTTP client for the backend **Leverage Yield API** (`/leverage-yield/*`). Reached on the `Sodax`
facade as `sodax.api.leverageYield` — `sodax.api` is an alias for `sodax.backendApi`, and
`.leverageYield` is the `LeverageYieldApiService` instance.

It mirrors `ILeverageYieldApiV2` (from `@sodax/types`) one method per endpoint (33 total). Every method:

- returns `Promise<Result<T>>` — it **never throws**;
- validates the JSON response at runtime against a valibot schema (a contract drift is surfaced as
  `{ ok: false }`, not returned untyped);
- accepts an optional trailing `RequestOverrideConfig` (`{ baseURL?, timeout?, headers?, apiKey? }`) for
  per-call overrides.

> This is the lower-level backend HTTP surface. For the end-to-end vault-swap orchestrator, use
> `sodax.leverageYield` (see [`LEVERAGE_YIELD.md`](LEVERAGE_YIELD.md)).
>
> A leverage-yield deposit/withdraw **is** an intent-based swap — the vault's `lsoda*` share token is a
> solver-tradeable token — so the intent-relay / gas / fee / submit-tx endpoints share their wire shapes
> and valibot schemas with [`SWAPS_API.md`](SWAPS_API.md) rather than re-declaring them. Only the vault
> registry, the vault reads, and the split deposit/withdraw quote + create-intent routes are
> leverage-yield-specific.

## Methods

```typescript
// Vault registry
sodax.api.leverageYield.getVaults(config?): Promise<Result<GetLeverageVaultsResponseV2>>;
sodax.api.leverageYield.getVault(name: string, config?): Promise<Result<GetLeverageVaultResponseV2>>;

// Vault reads — a { vault } query, some also { owner } / { assets } / { shares }
sodax.api.leverageYield.getAsset(query: VaultQueryV2, config?): Promise<Result<VaultAssetResponseV2>>;
sodax.api.leverageYield.getPosition(query: VaultQueryV2, config?): Promise<Result<LeverageYieldPositionV2>>;
sodax.api.leverageYield.getApr(query: VaultQueryV2, config?): Promise<Result<LeverageYieldAprV2>>;
sodax.api.leverageYield.getEffectiveApr(query: VaultQueryV2, config?): Promise<Result<LeverageYieldEffectiveAprV2>>;
sodax.api.leverageYield.getLsdApr(query: VaultQueryV2, config?): Promise<Result<LeverageYieldLsdAprV2>>;
sodax.api.leverageYield.getTotalAssets(query: VaultQueryV2, config?): Promise<Result<VaultTotalAssetsResponseV2>>;
sodax.api.leverageYield.previewDeposit(query: VaultAssetsQueryV2, config?): Promise<Result<PreviewDepositResponseV2>>;
sodax.api.leverageYield.previewWithdraw(query: VaultAssetsQueryV2, config?): Promise<Result<PreviewWithdrawResponseV2>>;
sodax.api.leverageYield.previewRedeem(query: VaultSharesQueryV2, config?): Promise<Result<PreviewRedeemResponseV2>>;
sodax.api.leverageYield.getShareBalance(query: VaultOwnerQueryV2, config?): Promise<Result<ShareBalanceResponseV2>>;
sodax.api.leverageYield.getMaxWithdraw(query: VaultOwnerQueryV2, config?): Promise<Result<MaxWithdrawResponseV2>>;

// Quote (split deposit / withdraw) · deadline
sodax.api.leverageYield.getDepositQuote(body: LeverageYieldDepositQuoteRequestV2, query?: QuoteQueryV2, config?): Promise<Result<QuoteResponseV2>>;
sodax.api.leverageYield.getWithdrawQuote(body: LeverageYieldWithdrawQuoteRequestV2, query?: QuoteQueryV2, config?): Promise<Result<QuoteResponseV2>>;
sodax.api.leverageYield.getDeadline(query?: DeadlineQueryV2, config?): Promise<Result<DeadlineResponseV2>>;

// Deposit allowance · approve — both take the deposit body (a withdraw needs no spoke allowance)
sodax.api.leverageYield.checkAllowance(body: CreateDepositIntentParamsV2, config?): Promise<Result<AllowanceCheckResponseV2>>;
sodax.api.leverageYield.approve(body: CreateDepositIntentParamsV2, config?): Promise<Result<ApproveResponseV2>>;

// Create intent (split deposit / withdraw)
sodax.api.leverageYield.createDepositIntent(body: CreateDepositIntentParamsV2, config?): Promise<Result<CreateIntentResponseV2>>;
sodax.api.leverageYield.createWithdrawIntent(body: CreateWithdrawIntentParamsV2, config?): Promise<Result<CreateIntentResponseV2>>;

// Intent lifecycle: submit · status · cancel · hash · packet · extra-data · fill · lookup
sodax.api.leverageYield.submitIntent(body: SubmitIntentRequestV2, config?): Promise<Result<SubmitIntentResponseV2>>;
sodax.api.leverageYield.getStatus(body: StatusRequestV2, config?): Promise<Result<StatusResponseV2>>;
sodax.api.leverageYield.cancelIntent(body: CancelIntentRequestV2, config?): Promise<Result<CancelIntentResponseV2>>;
sodax.api.leverageYield.getIntentHash(body: IntentHashRequestV2, config?): Promise<Result<IntentHashResponseV2>>;
sodax.api.leverageYield.getSolvedIntentPacket(body: IntentPacketRequestV2, config?): Promise<Result<IntentPacketResponseV2>>;
sodax.api.leverageYield.getIntentSubmitTxExtraData(body: IntentExtraDataRequestV2, config?): Promise<Result<IntentExtraDataResponseV2>>;
sodax.api.leverageYield.getFilledIntent(txHash: string, config?): Promise<Result<IntentStateV2>>;
sodax.api.leverageYield.getIntent(txHash: string, config?): Promise<Result<GetIntentResponseV2>>;

// Gas · fees
sodax.api.leverageYield.estimateGas(body: GasEstimateRequestV2, config?): Promise<Result<GasEstimateResponseV2>>;
sodax.api.leverageYield.getPartnerFee(query: FeeQueryV2, config?): Promise<Result<FeeResponseV2>>;
sodax.api.leverageYield.getSolverFee(query: FeeQueryV2, config?): Promise<Result<FeeResponseV2>>;

// Submit-tx state machine
sodax.api.leverageYield.submitTx(body: LeverageYieldSubmitTxRequestV2, config?): Promise<Result<SubmitTxResponseV2>>;
sodax.api.leverageYield.getSubmitTxStatus(query: SubmitTxStatusQueryV2, config?): Promise<Result<SubmitTxStatusResponseV2>>;
```

## Deltas vs the Swaps API

- **Deposit and withdraw are separate routes**, not one create-intent with a direction flag:
  `createDepositIntent` (any token → `lsoda*`) and `createWithdrawIntent` (`lsoda*` → any token), each
  with its own quote route. The backend sets `hubWalletSwap` internally for a withdraw — it spends the
  `lsoda*` held in the user's hub wallet — so **only a deposit needs a spoke allowance**;
  `checkAllowance` / `approve` therefore both take the *deposit* body.
- **`submitTx` carries a required `operation` discriminator** (`'deposit' | 'withdraw'`), which the
  backend needs to record the queued row as a vault deposit or withdrawal. `LeverageYieldSubmitTxRequestV2`
  is otherwise the swaps `SubmitTxRequestV2`, `relayData` included (the `.payload` string, not the whole
  envelope).
- **Terminal submit-tx success is `'solved'`**, as for swaps — a vault swap is filled by the solver, so
  the lifecycle runs `'pending'` → `'relaying'` → `'relayed'` → `'posting_execution'` → `'solved'` |
  `'failed'`. (`'executed'` is the *bridge* terminal state; do not poll for it here.)
- **Vault reads are plain GETs** returning decimal strings. APR rates are RAY (`1e27` = 100%); the vault
  share token (`lsoda*`) is always 18 decimals. `getEffectiveApr` is the honest headline number — it folds
  the off-chain LSD staking yield into the supply side, where `getApr` reports AAVE only and can be
  negative when the LSD yield is the alpha.
- **No token list.** The tradeable set is the solver's, so use the swaps token routes; what this client
  serves instead is the **vault registry** (`getVaults` / `getVault`).

## `feeAmount` never reaches the wire

`sodax.leverageYield.createVaultIntent` returns `Intent & FeeAmount` — the extra `feeAmount` is an
SDK-only display field. It is structurally assignable to the wire `IntentRequestV2`, so it would
otherwise travel wholesale on the intent-bearing calls. The client strips it in `submitTx`,
`cancelIntent`, `getIntentHash`, and `getIntentSubmitTxExtraData` (the same strip `SwapsApiService`
applies), so you can hand the intent straight through:

```typescript
const created = await sodax.leverageYield.createVaultIntent({ ...payload, walletProvider });
if (!created.ok) return;

// `created.value.intent` is Intent & FeeAmount — pass it as-is.
const submitted = await sodax.api.leverageYield.submitTx({
  txHash: created.value.tx,
  srcChainKey,
  walletAddress: srcAddress,
  intent: created.value.intent,
  relayData: created.value.relayData.payload,
  operation: 'deposit',
});
```

## Examples

### Vault registry and the headline APR

```typescript
const vaults = await sodax.api.leverageYield.getVaults();
if (!vaults.ok) return;
const vault = vaults.value[0].vault;              // hub proxy address (doubles as the lsoda* token)

const apr = await sodax.api.leverageYield.getEffectiveApr({ vault });
if (apr.ok) apr.value.effectiveNetAprRay;         // RAY decimal string
```

### Deposit: quote → approve → create → submit

```typescript
const quote = await sodax.api.leverageYield.getDepositQuote({
  vault,
  tokenSrc,
  tokenSrcChainKey,
  amount: '1000000',                              // smallest unit of the input token
  quoteType: 'exact_input',
});
if (!quote.ok) return;

const body = {
  vault,
  srcChainKey,
  srcAddress,
  inputToken: tokenSrc,
  inputAmount: '1000000',
  minOutputAmount: applySlippage(quote.value.quotedAmount),
};

// A guarded input token can need its stale allowance cleared first, so `approve` may return TWO
// transactions: broadcast and mine `resetTx` before `tx`.
const allowance = await sodax.api.leverageYield.checkAllowance(body);
if (allowance.ok && !allowance.value.valid) {
  const plan = await sodax.api.leverageYield.approve(body);
  // plan.value = { tx, resetTx? } — see `approve` can return two transactions, below.
}

const created = await sodax.api.leverageYield.createDepositIntent(body);
if (!created.ok) return;
// Sign + broadcast created.value.tx on srcChainKey, then hand the hash back via submitTx
// (operation: 'deposit') and poll getSubmitTxStatus until 'solved'.
```

Withdraw is the mirror image: `getWithdrawQuote` → `createWithdrawIntent({ vault, srcChainKey,
srcAddress, dstChainKey, outputToken, inputAmount /* lsoda* shares */, minOutputAmount, recipient? })` →
`submitTx({ …, operation: 'withdraw' })`. No allowance step.

## `approve` can return two transactions

`ApproveResponseV2` is `{ tx, resetTx? }`. `resetTx` is present only for a source token of the 2017
TetherToken lineage, which rejects an allowance change from one non-zero value to another: `resetTx`
must be **mined** before `tx` is even a valid state transition. In `@sodax/dapp-kit`, prefer
`useLeverageYieldApiApproveAndBroadcast` — it owns plan → sign → broadcast → wait in that order and
invalidates the allowance query itself — over `useLeverageYieldApiApprove`, which hands back the unsigned
pair and leaves the ordering to you.

## Status fields — three distinct `status` values (don't conflate)

| Call | Field | Type | Values |
|---|---|---|---|
| `getStatus` | `StatusResponseV2.status` | **number** (`SwapIntentStatusCodeV2`) | `-1` NOT_FOUND · `1` NOT_STARTED_YET · `2` STARTED_NOT_FINISHED · `3` SOLVED (terminal) · `4` FAILED (terminal). `fillTxHash` is set only when `status === 3`. |
| `submitTx` | `SubmitTxResponseV2.data.status` | string | `'inserted'` (new) or `'duplicate'` (already submitted — idempotent on `(txHash, srcChainKey)`). |
| `getSubmitTxStatus` | `SubmitTxStatusResponseV2.data.status` | string | `'pending'` / `'relaying'` / `'relayed'` / `'posting_execution'` / `'posted_execution'` / `'solved'` / `'failed'` (last two terminal). A set `abandonedAt` is terminal too, even while `status` is not. The same `data` echoes the row's `operation` as `'leverage_deposit'` / `'leverage_withdraw'` (`SubmitTxOperationV2`). |

`getStatus` reports the **solver** intent status as a numeric code (shared with the Swaps API); the two
submit-tx calls report **string** statuses. They are unrelated.

## Configuration

`sodax.api.leverageYield` shares the backend API config: `baseURL` is the gateway root and this client
appends `/leverage-yield/*` below it — a sibling of the data API's `/be` mount, not a child of it, so a
`baseURL` must never carry a service segment. There is deliberately **no** `leverageYieldApiConfig` slice:
retarget the whole backend (this client included) with the top-level `baseURL` or the `baseApiConfig`
slice of the `CustomApiConfig` variant of `SodaxConfig.api`, or send a single call elsewhere with the
per-call `RequestOverrideConfig`. A legacy `/be`-suffixed value — configured or per-call — is trimmed back
to the root, exactly as for swaps and bridge. See [`SWAPS_API.md`](SWAPS_API.md) § Configuration and
[`BACKEND_API.md`](BACKEND_API.md).

The end-to-end orchestrator routes through this API by default: `leverageYield.useBackendSubmitTx`
resolves to `true` when omitted, like the swaps and bridge toggles. Opt out with
`new Sodax({ leverageYield: { useBackendSubmitTx: false } })` to keep the client-side relay. On any
backend non-success — including a rejected key — `vaultSwap` falls back to that relay on its own, so
the default costs one wasted attempt at worst. `POST /leverage-yield/submit-tx` declares the
`swaps:write` scope; whether a deployment checks the key at all is its own setting, so pass one
(`new Sodax({ apiKey })`, or per action via `extras.apiKey`, both server-side — see [API key good practices](https://docs.sodax.com/developers/how-to/api-key-good-practices)) rather than
assume either. See
[`CONFIGURE_SDK.md`](CONFIGURE_SDK.md) and [`LEVERAGE_YIELD.md`](LEVERAGE_YIELD.md).

## Result\<T\> and Error Handling

Every method returns `Result<T, SodaxError<'EXTERNAL_API_ERROR'>>`. On any failure (network, timeout,
non-2xx HTTP, or response-shape mismatch), the result is `{ ok: false }` with a `SodaxError` carrying
`feature: 'backend'`, `context.api: 'leverageYield'`, and `context.endpoint` (the path); the underlying
transport failure is preserved on `error.cause`. A non-2xx also lifts its HTTP status onto
`error.context.status`, so `isAuthFailure(error)` recognizes a `401`/`403` — that is what lets the SDK's
submit-tx poll and the dapp-kit hooks stop on a rejected API key instead of retrying it.

```typescript
const r = await sodax.api.leverageYield.getDepositQuote(body);
if (!r.ok) {
  // r.error.feature === 'backend'; r.error.context.api === 'leverageYield';
  // r.error.context.endpoint === '/leverage-yield/quote/deposit'
  // r.error.cause: the HTTP_REQUEST_FAILED / REQUEST_TIMEOUT / validation failure
  return;
}
```

Note the contrast with the feature service: `sodax.leverageYield` errors carry
`feature: 'leverageYield'`, while this HTTP client is uniformly `feature: 'backend'` — exactly like
`sodax.api.swaps`.

## See also

- [`LEVERAGE_YIELD.md`](LEVERAGE_YIELD.md) — `sodax.leverageYield` (`LeverageYieldService`), the
  end-to-end vault-swap orchestrator.
- [`SWAPS_API.md`](SWAPS_API.md) — `sodax.api.swaps`, the sibling client whose intent-relay / gas / fee /
  submit-tx wire shapes this one reuses.
- [`BRIDGE_API.md`](BRIDGE_API.md) — `sodax.api.bridge`, the other gateway-sibling HTTP client.
- [`BACKEND_API.md`](BACKEND_API.md) — `sodax.backendApi`, the read client for intent / orderbook /
  money-market reads plus config.
