# Error codes

All 14 codes the SDK can emit. Each error is `SodaxError<C>` where `C` is one of these. The producing feature is on `error.feature`.

| Code | Meaning | Common `error.context` fields | Retry advice |
|---|---|---|---|
| `USER_REJECTED` | User cancelled the wallet prompt (signing / approval / connection). Classified at the source by `intentCreationFailed` / `approveFailed` wrappers via a built-in detector that recognises viem `4001` / `UserRejectedRequestError`, ICON Hana `CANCEL_SIGNING` / `-31002`, and name + message patterns from Solana / Sui / Stellar / Stacks / NEAR / Injective wallets. | `phase` (set to whichever phase the wrapper was wrapping: `'intentCreation'` or `'approve'`), `action` | No — user-initiated. Render a "Cancelled" UI, not a failure. |
| `VALIDATION_FAILED` | Pre-flight invariant tripped (input shape, unsupported chain, etc.). | `field`, `reason`, `phase: 'validate'` | No — fix the input. |
| `INTENT_CREATION_FAILED` | Building the intent / payload failed. | `phase: 'intentCreation'`, `action` | Sometimes — depends on root cause (`error.cause`). |
| `EXECUTION_FAILED` | Orchestrator-level catch-all (multi-step op didn't complete). | `action`, `phase: 'execution'` or `'postExecution'` | Sometimes — inspect cause. |
| `TX_VERIFICATION_FAILED` | Spoke `verifyTxHash` returned false / threw. | `phase: 'verify'`, `srcChainKey` | Sometimes — RPC / indexer issue is transient. |
| `TX_SUBMIT_FAILED` | Spoke tx landed; relay POST submit failed. | `phase: 'submit'`, `relayCode: 'SUBMIT_TX_FAILED'` | Yes — relay submit is retryable; backoff and re-run with the same payload. |
| `RELAY_TIMEOUT` | Destination packet didn't reach `executed` within timeout. | `phase: 'relay'`, `srcChainKey`, `dstChainKey`, `relayCode: 'RELAY_TIMEOUT'` | Yes — increase timeout or re-poll; the spoke tx already landed. |
| `RELAY_FAILED` | Relay polling outage / unrecognised relay error. | `phase: 'relay'`, `relayCode` | Yes — exponential backoff. |
| `APPROVE_FAILED` | Token approval call failed. | `phase: 'approve'` | Sometimes — gas / RPC issues are retryable. |
| `ALLOWANCE_CHECK_FAILED` | Reading on-chain allowance failed. | `phase: 'allowanceCheck'` | Yes — read-only retry is cheap. |
| `GAS_ESTIMATION_FAILED` | Gas estimation returned an error. | `phase: 'gasEstimation'` | Yes — re-estimate is the norm. |
| `LOOKUP_FAILED` | Read-only on-chain query / off-chain config fetch. | `method`, `phase: 'lookup'` | Yes — read-only retry is cheap. |
| `EXTERNAL_API_ERROR` | Upstream API call failed (solver, backend). | `api: 'solver' \| 'backend'`; for solver: `solverCode`, `solverDetail` | Sometimes — depends on `solverCode`. |
| `UNKNOWN` | Last-resort catch in an outer `try`. | (none guaranteed) | Treat as unrecoverable; surface the underlying cause. |

### Features

```ts
type SodaxFeature =
  | 'swap'
  | 'moneyMarket'
  | 'bridge'
  | 'staking'
  | 'migration'
  | 'dex'
  | 'partner'
  | 'recovery'
  | 'backend' // HTTP-client layer (BackendApiService / SwapsApiService) — not a domain feature
  | 'leverageYield';
```

The `(feature, code)` pair is the canonical discriminator. Loggers tag both fields; switch statements branch on both.

### Phase tags (`error.context.phase`)

```ts
type SodaxPhase =
  | 'validate'           // pre-flight invariant
  | 'intentCreation'     // building intent / payload
  | 'verify'             // spoke verifyTxHash
  | 'submit'             // spoke→relay submit
  | 'relay'              // primary relayTxAndWaitPacket wait
  | 'destinationExecution' // secondary watcher (migration's bnUSD waitUntilIntentExecuted)
  | 'execution'          // orchestrator-level catch
  | 'postExecution'      // swap-only post-relay solver step
  | 'approve'            // ERC20 approval call
  | 'allowanceCheck'     // on-chain allowance read
  | 'gasEstimation'      // gas-estimation read
  | 'lookup';            // generic read-only query
```

### `RelayCode` (`error.context.relayCode`)

```ts
type RelayCode =
  | 'SUBMIT_TX_FAILED'
  | 'RELAY_TIMEOUT'
  | 'RELAY_POLLING_FAILED'
  | 'UNKNOWN';
```

This is the lower-level relay-layer code that `mapRelayFailure` maps from. Surfaces on `error.context.relayCode` when the error originated in `IntentRelayApiService`.

---


## Per-method error codes

Narrow code unions per public method. Use these for exhaustive `switch` discrimination.

### Common helper unions (used across features)

```ts
// 'create*Intent' methods
type CreateIntentErrorCode = 'USER_REJECTED' | 'VALIDATION_FAILED' | 'INTENT_CREATION_FAILED' | 'UNKNOWN';

// 'approve' methods
type ApproveErrorCode = 'USER_REJECTED' | 'VALIDATION_FAILED' | 'APPROVE_FAILED' | 'UNKNOWN';

// 'isAllowanceValid' methods
type AllowanceCheckErrorCode = 'VALIDATION_FAILED' | 'ALLOWANCE_CHECK_FAILED' | 'UNKNOWN';

// 'estimateGas' methods
type GasEstimationErrorCode = 'VALIDATION_FAILED' | 'GAS_ESTIMATION_FAILED' | 'UNKNOWN';

// All read-only lookups
type LookupErrorCode = 'VALIDATION_FAILED' | 'LOOKUP_FAILED' | 'UNKNOWN';
```

### Swap (`feature: 'swap'`)

| Method | Narrow code union |
|---|---|
| `createIntent` | `CreateIntentErrorCode` |
| `swap` | All of {`USER_REJECTED`, `VALIDATION_FAILED`, `INTENT_CREATION_FAILED`, `EXECUTION_FAILED`, `TX_VERIFICATION_FAILED`, `TX_SUBMIT_FAILED`, `RELAY_TIMEOUT`, `RELAY_FAILED`, `EXTERNAL_API_ERROR`, `UNKNOWN`} |
| `swapWithApproval` | `SwapWithApprovalErrorCode`: the `swap` codes plus `APPROVE_FAILED \| ALLOWANCE_CHECK_FAILED`. See [Atomic approval batches](#atomic-approval-batches-contextreason) for the batch reasons |
| `getApprovalStrategy` | `ApprovalStrategyErrorCode` (`ALLOWANCE_CHECK_FAILED` only) |
| `postExecution` | `EXECUTION_FAILED \| EXTERNAL_API_ERROR \| UNKNOWN` (with `phase: 'postExecution'`) |
| `createLimitOrder`, `createLimitOrderIntent` | `CreateIntentErrorCode` |
| `cancelIntent`, `cancelLimitOrder` | `EXECUTION_FAILED \| VALIDATION_FAILED \| UNKNOWN` |

#### Atomic approval batches (`context.reason`)

When the approval and the deposit go out as one EIP-5792 batch (`swapWithApproval`, or the shared
`sendApprovalBatch` / `confirmApprovalBatch` helpers), these codes carry a `context.reason` that changes
what the caller should do. Check it before the generic retry advice above.

| Code | `context.reason` | Meaning | Retry? |
|---|---|---|---|
| `USER_REJECTED` | `ACCOUNT_UPGRADE_DECLINED` | The user declined the smart-account upgrade, not the swap. | Offer it again with `allowAccountUpgrade: false` (two signatures). |
| `INTENT_CREATION_FAILED` | `ATOMIC_BATCH_REFUSED` | The wallet refused the batch before signing, or cannot batch. Nothing was sent. | Yes, approve separately. `swapWithApproval` does this itself; a caller of `sendApprovalBatch` does it. Test with `isAtomicBatchRefusal(error)`. |
| `INTENT_CREATION_FAILED` | `'atomic-batch-failed'` (with `batchId`, `statusCode`) | The batch was never included or fully reverted. Nothing was deposited. | Yes. |
| `TX_VERIFICATION_FAILED` | `ATOMIC_BATCH_UNCONFIRMED` (with `batchId`) | The wallet took the batch but it did not confirm in time. **It may still land.** | **No.** Do not let the user send it again; tell them to check the wallet's activity. |

`sendApprovalBatch` and `confirmApprovalBatch` return `ApprovalBatchErrorCode`
(`USER_REJECTED | INTENT_CREATION_FAILED | TX_VERIFICATION_FAILED`) on the `feature` the caller passes.
`confirmApprovalBatch` resumes a batch that came back unconfirmed, from the `batchId` that
`sendApprovalBatch` reported through `onBatchSent`. `resolveApprovalStrategy` does not fail: a wallet
whose capabilities cannot be read resolves to `'sequential'`.

### Money Market (`feature: 'moneyMarket'`)

| Method | Narrow code union |
|---|---|
| `supply`, `borrow`, `withdraw`, `repay` | `USER_REJECTED \| VALIDATION_FAILED \| INTENT_CREATION_FAILED \| EXECUTION_FAILED \| TX_VERIFICATION_FAILED \| TX_SUBMIT_FAILED \| RELAY_TIMEOUT \| RELAY_FAILED \| UNKNOWN` (with `action` discriminator) |
| `createSupplyIntent`, `createBorrowIntent`, `createWithdrawIntent`, `createRepayIntent` | `CreateIntentErrorCode` |
| `approve` | `ApproveErrorCode` |
| `isAllowanceValid` | `AllowanceCheckErrorCode` |
| `estimateGas` | `GasEstimationErrorCode` |
| Read methods (`sodax.moneyMarket.data.*` — reserves, user data, aToken balances) | throw on failure (bare `Promise<T>`, **not** a `Result`) — wrap in try/catch |

### Staking (`feature: 'staking'`)

| Method | Narrow code union |
|---|---|
| `stake` | All exec codes including `TX_VERIFICATION_FAILED` (only stake calls verifyTxHash). |
| `unstake`, `instantUnstake`, `claim`, `cancelUnstake` | All exec codes minus `TX_VERIFICATION_FAILED`. |
| `approve` | `ApproveErrorCode` |
| `isAllowanceValid` | `AllowanceCheckErrorCode` |
| `getStakingInfo`, `getUnstakingInfo`, `getStakingConfig`, `getStakeRatio`, `getInstantUnstakeRatio`, `getConvertedAssets`, `getUnstakingInfoWithPenalty`, `getStakingInfoFromSpoke` | `LookupErrorCode` (with `method` discriminator) |

### Bridge (`feature: 'bridge'`)

| Method | Narrow code union |
|---|---|
| `bridge` | All exec codes. |
| `createBridgeIntent` | `CreateIntentErrorCode` |
| `approve` | `ApproveErrorCode` |
| `isAllowanceValid` | `AllowanceCheckErrorCode` |
| `getBridgeableAmount`, `getBridgeableTokens` | `LookupErrorCode` (with `method` discriminator) |

### DEX (`feature: 'dex'`)

| Method | Narrow code union |
|---|---|
| `assetService.deposit`, `assetService.withdraw` | All exec codes. |
| `clService.supplyLiquidity`, `clService.increaseLiquidity`, `clService.decreaseLiquidity`, `clService.claimRewards` | All exec codes. |
| `assetService.approve` | `ApproveErrorCode` |
| `assetService.isAllowanceValid` | `AllowanceCheckErrorCode` |
| `clService.getPoolData`, `clService.getPositionInfo`, `assetService.getDeposit` | `LookupErrorCode` |

### Migration (`feature: 'migration'`)

| Method | Narrow code union |
|---|---|
| `migratebnUSD` | All exec codes; `direction: 'forward' \| 'reverse'` on context. |
| `migrateIcxToSoda`, `revertMigrateSodaToIcx`, `migrateBaln` | All exec codes. |
| `createXxxIntent` (4 of these) | `CreateIntentErrorCode` |
| `approve` | `ApproveErrorCode` |
| `isAllowanceValid` | `AllowanceCheckErrorCode` |

> `getAvailableAmount` is **not** a public `MigrationService` method — it's an internal `icxMigration` sub-service helper, so it carries no public narrow code union.

### Partner (`feature: 'partner'`) and Recovery (`feature: 'recovery'`)

Both follow the same shape: action methods get the full exec union (`'EXECUTION_FAILED' \| 'INTENT_CREATION_FAILED' \| ...`), read methods get `LookupErrorCode`, approve methods get `ApproveErrorCode` (so partner's `approve` can emit `'USER_REJECTED'`).

### Backend / Swaps API (`feature: 'backend'`)

`BackendApiService` (`sodax.backendApi`) and the Swaps API client (`sodax.api.swaps`) are the HTTP-client layer — not domain features. Every method returns `Result<T, SodaxError<'EXTERNAL_API_ERROR'>>` with `context.endpoint`, and the transport failure (timeout / non-2xx / response-shape mismatch) preserved on `error.cause`. `context.api` distinguishes the two clients: `'backend'` for `BackendApiService`, `'swaps'` for the `sodax.api.swaps` client.

### Leverage Yield (`feature: 'leverageYield'`)

Action discriminator on `context.action`: `'deposit' \| 'withdraw' \| 'approve' \| 'allowanceCheck' \| 'vaultSwap'`.

| Method | Narrow code union |
|---|---|
| `deposit`, `withdraw`, `createVaultIntent` | `CreateIntentErrorCode` (create-intent subset) |
| `vaultSwap` | All exec codes: `VALIDATION_FAILED \| INTENT_CREATION_FAILED \| TX_VERIFICATION_FAILED \| TX_SUBMIT_FAILED \| RELAY_TIMEOUT \| RELAY_FAILED \| EXECUTION_FAILED \| EXTERNAL_API_ERROR \| UNKNOWN` |
| `notifySolver` | `EXECUTION_FAILED \| EXTERNAL_API_ERROR \| UNKNOWN` (with `phase: 'postExecution'`) |
| `approve` | `ApproveErrorCode` |
| `isAllowanceValid` | `AllowanceCheckErrorCode` (action `'allowanceCheck'`) |
| `getApr`, `getEffectiveApr`, `getLsdApr`, `getPosition`, `getTotalAssets`, `previewDeposit`, `previewWithdraw`, `previewRedeem`, `getMaxWithdraw`, `getMaxWithdrawForUser`, `getShareBalance`, `getShareBalanceForUser`, `getAsset` | `LookupErrorCode` (with `method` discriminator) |

Relay/tx-verification codes appear only on `vaultSwap`; `createVaultIntent` stays within the create-intent subset. `notifySolver` is public (manual create→relay→notify) and emits the post-execution subset.

---


## Cross-references

- [`README.md`](README.md) — reference index.
- [`../architecture.md`](../architecture.md) § 7–8 — error model concepts.
