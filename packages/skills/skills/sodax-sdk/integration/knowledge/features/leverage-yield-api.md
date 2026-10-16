# Leverage Yield API — `LeverageYieldApiService`

Typed HTTP client for the backend **Leverage Yield API** (`/leverage-yield/*`). Reachable as
`sodax.api.leverageYield` (`sodax.api` is an alias for `sodax.backendApi`; `.leverageYield` is the
`LeverageYieldApiService` instance). One method per endpoint (33 total). Every method returns
`Promise<Result<T>>` — it **never throws** — and every response is validated at runtime against a valibot
schema, so a backend contract drift surfaces as `{ ok: false }` rather than an untyped object.

Access: `sodax.api.leverageYield`. Service class: `LeverageYieldApiService`. **Errors:** every failure
(network, timeout, non-2xx HTTP, or response-shape mismatch) returns
`Result<T, SodaxError<'EXTERNAL_API_ERROR'>>` with `feature: 'backend'`, `context.api: 'leverageYield'`,
and `context.endpoint` (the path). The underlying failure is preserved on `error.cause`. This differs from
the feature service (`sodax.leverageYield`), whose errors carry `feature: 'leverageYield'` — the
leverage-yield **HTTP client** is uniformly `feature: 'backend'`, exactly like `sodax.api.swaps`.

A leverage-yield deposit/withdraw **is** an intent-based swap (the vault's `lsoda*` share token is a
solver-tradeable token), so the intent-relay / gas / fee / submit-tx endpoints share the same wire shapes
as the Swaps API — this client is the leverage-yield sibling of [`swaps-api.md`](swaps-api.md).

## Methods

```ts
// Vault registry
sodax.api.leverageYield.getVaults(config?): Promise<Result<GetLeverageVaultsResponseV2>>;
sodax.api.leverageYield.getVault(name, config?): Promise<Result<GetLeverageVaultResponseV2>>;

// Vault reads — all take a { vault } query (some also { owner } / { assets } / { shares })
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

// Quote (separate deposit / withdraw) · deadline
sodax.api.leverageYield.getDepositQuote(body: LeverageYieldDepositQuoteRequestV2, query?: QuoteQueryV2, config?): Promise<Result<QuoteResponseV2>>;
sodax.api.leverageYield.getWithdrawQuote(body: LeverageYieldWithdrawQuoteRequestV2, query?: QuoteQueryV2, config?): Promise<Result<QuoteResponseV2>>;
sodax.api.leverageYield.getDeadline(query?: DeadlineQueryV2, config?): Promise<Result<DeadlineResponseV2>>;

// Deposit allowance · approve — both share the CreateDepositIntentParamsV2 body (withdraw needs no spoke allowance)
sodax.api.leverageYield.checkAllowance(body: CreateDepositIntentParamsV2, config?): Promise<Result<AllowanceCheckResponseV2>>;
sodax.api.leverageYield.approve(body: CreateDepositIntentParamsV2, config?): Promise<Result<ApproveResponseV2>>;

// Create intent (separate deposit / withdraw)
sodax.api.leverageYield.createDepositIntent(body: CreateDepositIntentParamsV2, config?): Promise<Result<CreateIntentResponseV2>>;
sodax.api.leverageYield.createWithdrawIntent(body: CreateWithdrawIntentParamsV2, config?): Promise<Result<CreateIntentResponseV2>>;

// Intent lifecycle: submit · status · cancel · hash · packet · extra-data · fill · get
sodax.api.leverageYield.submitIntent(body: SubmitIntentRequestV2, config?): Promise<Result<SubmitIntentResponseV2>>;
sodax.api.leverageYield.getStatus(body: StatusRequestV2, config?): Promise<Result<StatusResponseV2>>;
sodax.api.leverageYield.cancelIntent(body: CancelIntentRequestV2, config?): Promise<Result<CancelIntentResponseV2>>;
sodax.api.leverageYield.getIntentHash(body: IntentHashRequestV2, config?): Promise<Result<IntentHashResponseV2>>;
sodax.api.leverageYield.getSolvedIntentPacket(body: IntentPacketRequestV2, config?): Promise<Result<IntentPacketResponseV2>>;
sodax.api.leverageYield.getIntentSubmitTxExtraData(body: IntentExtraDataRequestV2, config?): Promise<Result<IntentExtraDataResponseV2>>;
sodax.api.leverageYield.getFilledIntent(txHash, config?): Promise<Result<IntentStateV2>>;
sodax.api.leverageYield.getIntent(txHash, config?): Promise<Result<GetIntentResponseV2>>;

// Gas · fees
sodax.api.leverageYield.estimateGas(body: GasEstimateRequestV2, config?): Promise<Result<GasEstimateResponseV2>>;
sodax.api.leverageYield.getPartnerFee(query: FeeQueryV2, config?): Promise<Result<FeeResponseV2>>;
sodax.api.leverageYield.getSolverFee(query: FeeQueryV2, config?): Promise<Result<FeeResponseV2>>;

// Submit-tx state machine
sodax.api.leverageYield.submitTx(body: LeverageYieldSubmitTxRequestV2, config?): Promise<Result<SubmitTxResponseV2>>;
sodax.api.leverageYield.getSubmitTxStatus(query: SubmitTxStatusQueryV2, config?): Promise<Result<SubmitTxStatusResponseV2>>;
```

The optional trailing `config?: RequestOverrideConfig` (`{ baseURL?, timeout?, headers?, apiKey? }`) on
every method applies per-call overrides that take precedence over the service config (see "Per-call
overrides" below).

## Wire shapes — `bigint` vs decimal strings

The intent-bearing request bodies (`cancelIntent`, `getIntentHash`, `getIntentSubmitTxExtraData`,
`submitTx`) take `IntentRequestV2`, whose numeric fields (`intentId`, `inputAmount`, `minOutputAmount`,
`deadline`, `srcChain`, `dstChain`) are **`bigint`**; the client serializes them to decimal strings on the
wire. Server-returned intents (`IntentResponseV2`) and every vault read (`getPosition`, `getApr`,
`getTotalAssets`, previews, `getShareBalance`, …) come back with numeric fields as decimal **`string`**
(outbound JSON can't carry bigint). APR rates are RAY (`1e27` = 100%) as decimal strings; the vault-share
(`lsoda*`) is always 18 decimals. The `amount` / `inputAmount` fields on the quote / create-intent request
bodies are already decimal **strings**.

## Common call shapes

### Vault reads

```ts
const vaults = await sodax.api.leverageYield.getVaults();
if (!vaults.ok) return;
const vault = vaults.value[0].vault;                 // hub proxy address (doubles as the lsoda* token)

const apr = await sodax.api.leverageYield.getEffectiveApr({ vault });
if (apr.ok) apr.value.effectiveNetAprRay;            // RAY decimal string — the headline number
```

### Deposit quote

```ts
const quote = await sodax.api.leverageYield.getDepositQuote({
  vault,
  tokenSrc, tokenSrcChainKey,
  amount: '1000000',          // smallest unit of the input token, decimal string
  quoteType: 'exact_input',
});
if (!quote.ok) return;
quote.value.quotedAmount;     // expected lsoda* shares, decimal string
// Pass query `{ includeTxData: true }` (and srcAddress on the body) to also get `txData`.
```

### Create deposit intent

```ts
const created = await sodax.api.leverageYield.createDepositIntent({
  vault, srcChainKey, srcAddress,
  inputToken,
  inputAmount: '1000000',
  minOutputAmount: '990000',  // quotedAmount minus slippage
  deadline: '0',              // "0" → no expiry; omit to let the backend default from hub block time
});
if (!created.ok) return;
const { tx, intent, relayData } = created.value;
// Withdraw is the mirror: createWithdrawIntent({ vault, srcChainKey, srcAddress, dstChainKey,
//   outputToken, inputAmount /* lsoda* shares */, minOutputAmount, recipient? }) — the backend sets
// hubWalletSwap internally (spends lsoda* from the hub wallet), so withdraw needs no spoke allowance.
```

### Approve can return TWO transactions

```ts
// Only a deposit needs a spoke allowance — a withdraw spends lsoda* from the hub wallet.
const allowance = await sodax.api.leverageYield.checkAllowance(depositBody);
if (allowance.ok && !allowance.value.valid) {
  const plan = await sodax.api.leverageYield.approve(depositBody);
  if (!plan.ok) return;
  const { tx, resetTx } = plan.value;   // ApproveResponseV2
  // `resetTx` appears only for an input token of the 2017 TetherToken lineage, which rejects an
  // allowance change from one non-zero value to another: broadcast AND MINE it before `tx`, or the
  // approve reverts. In @sodax/dapp-kit, useLeverageYieldApiApproveAndBroadcast owns that ordering.
}
```

### Submit tx + poll status

```ts
// `intent` here is the IntentRequestV2 (bigint fields) you hold from createDepositIntent/createWithdrawIntent.
// `LeverageYieldSubmitTxRequestV2` is the swaps body PLUS a required `operation` discriminator, which the
// backend needs to record the queued row as a vault deposit or withdrawal.
const submit = await sodax.api.leverageYield.submitTx({
  txHash, srcChainKey, walletAddress, intent,
  relayData: relayData.payload,   // string — the payload, not the RelayExtraData object
  operation: 'deposit',           // required: 'deposit' | 'withdraw'
});
if (!submit.ok) return;

// Both txHash AND srcChainKey are required by the status endpoint.
const status = await sodax.api.leverageYield.getSubmitTxStatus({ txHash, srcChainKey });
// A vault swap IS a solver swap, so terminal success is 'solved' — NOT the bridge API's 'executed'.
if (status.ok && status.value.data.status === 'solved') { /* settled */ }
// Lifecycle: 'pending' → 'relaying' → 'relayed' → 'posting_execution' → 'solved' | 'failed'.
// A set `abandonedAt` is terminal too, even while `status` is still non-terminal.
```

## Status fields — three distinct `status` values (don't conflate)

| Call | Field | Type | Values |
|---|---|---|---|
| `getStatus` | `StatusResponseV2.status` | **number** (`SwapIntentStatusCodeV2`) | `-1` NOT_FOUND · `1` NOT_STARTED_YET · `2` STARTED_NOT_FINISHED · `3` SOLVED (terminal) · `4` FAILED (terminal). `fillTxHash` is set only when `status === 3`. |
| `submitTx` | `SubmitTxResponseV2.data.status` | string | `'inserted'` (new) or `'duplicate'` (already submitted — submit-tx is idempotent on `(txHash, srcChainKey)`). |
| `getSubmitTxStatus` | `SubmitTxStatusResponseV2.data.status` | string | `'pending'` / `'relaying'` / `'relayed'` / `'posting_execution'` / `'posted_execution'` / `'solved'` / `'failed'` (`'solved'` / `'failed'` terminal, as for swaps — `'executed'` is the *bridge* terminal state). A set `abandonedAt` is terminal too. `data.operation` echoes `'leverage_deposit'` / `'leverage_withdraw'` (`SubmitTxOperationV2`). |

`getStatus` reports the **solver** intent status as a numeric code (shared with the Swaps API —
`SwapIntentStatusCodeV2`); the two submit-tx calls report **string** statuses. They are unrelated — don't
treat one as the other.

## Per-call overrides

Every method accepts a trailing `RequestOverrideConfig` to redirect a single call to a different host or
attach request-specific headers (auth, tracing), overriding the service config:

```ts
await sodax.api.leverageYield.getVaults({ baseURL: 'https://staging.example/v1', headers: { 'X-Trace': 'abc' } });
```

## Custom endpoint for the leverage-yield API

The leverage-yield endpoints are `/leverage-yield/*` sub-paths under the same base URL as
`sodax.backendApi`, and the client shares the **base** backend-API config — there is **no** dedicated
leverage-yield slice on `ApiConfig` (unlike swaps, which has `swapsApiConfig`). So the flat
`BaseApiConfig` (or the `baseApiConfig` slice of `CustomApiConfig`) drives it:

```ts
// The gateway ROOT — the client appends `/leverage-yield/*` itself. A legacy `/be`-suffixed value (the
// data API's own mount) is trimmed back to the root with a warning, configured or per-call.
const sodax = new Sodax({ api: { baseURL: 'https://api.example/v1' } });
```

To send a single leverage-yield call elsewhere, use the per-call `RequestOverrideConfig` above. See
[`backend-api.md`](backend-api.md) § "Custom backend" and [`../architecture.md`](../architecture.md).

## Backend submit-tx flow (SDK option)

`sodax.leverageYield.vaultSwap` routes through this client's `submitTx` + `getSubmitTxStatus` (relay +
post-execution server-side) **by default**, polling until `'solved'` and falling back to the client-side
relay on any non-success — the leverage-yield mirror of `swaps.useBackendSubmitTx`, defaulting on the same
way. Opt out with `new Sodax({ leverageYield: { useBackendSubmitTx: false } })`; read the effective value
on `sodax.config.leverageYieldUseBackendSubmitTx`. `timeout` is a per-attempt budget: the backend attempt
gets it and the fallback relay gets a fresh one.

`POST /leverage-yield/submit-tx` declares an API-key scope (`swaps:write`) where
`GET /leverage-yield/submit-tx/status` declares none. Enforcement is per-deployment, so a keyless submit
is not necessarily rejected; where it is, the caller spends one rejected attempt per vault swap before the
fallback completes it. Configure `apiKey`, pass `extras.apiKey` per call, or opt out. `swaps/submit-tx`
declares the same scope — this is not specific to leverage yield. See [`leverage-yield.md`](leverage-yield.md).

## Error handling

```ts
const r = await sodax.api.leverageYield.getDepositQuote(body);
if (!r.ok) {
  // r.error: SodaxError<'EXTERNAL_API_ERROR'> — feature: 'backend', context.api: 'leverageYield',
  // context.endpoint: '/leverage-yield/quote/deposit'. The transport failure (HTTP_REQUEST_FAILED /
  // REQUEST_TIMEOUT / a shape-validation issue) is on r.error.cause.
  // A non-2xx also lifts its status onto r.error.context.status, so isAuthFailure(r.error) is true for
  // a 401/403 — a rejected key is terminal, so stop rather than retry.
  return;
}
```

## Cross-references

- `sodax.leverageYield` (the `LeverageYieldService` orchestrator that builds/executes vault swaps end-to-end): [`leverage-yield.md`](leverage-yield.md). The API client here is the lower-level HTTP surface; the orchestrator is the higher-level flow.
- `sodax.api.swaps` (the sibling Swaps API client — shares the intent-relay/gas/fee/submit-tx wire shapes): [`swaps-api.md`](swaps-api.md).
- `BackendApiService` (the sibling client for intent/orderbook/money-market reads): [`backend-api.md`](backend-api.md).
- Error model context fields: [`../reference/error-codes.md`](../reference/error-codes.md).
