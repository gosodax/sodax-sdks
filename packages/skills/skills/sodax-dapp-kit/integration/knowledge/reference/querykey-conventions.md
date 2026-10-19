# queryKey / mutationKey conventions — `@sodax/dapp-kit`

Mandatory shape rules for every `queryKey` and `mutationKey`. Mechanically enforced on mutation keys by a contract test in the `@sodax/dapp-kit` source (`src/hooks/_mutationContract.test.ts`); reviewer-enforced on query keys.

## The five rules

### Rule 1 — first segment is the feature directory name

| Hook directory | First segment |
|---|---|
| `backend/` | `'backend'` |
| `bitcoin/` | `'bitcoin'` |
| `bridge/` | `'bridge'` |
| `dex/` | `'dex'` |
| `leverageYield/` | `'leverageYield'` |
| `mm/` | `'mm'` |
| `partner/` | `'partner'` |
| `recovery/` | `'recovery'` |
| `shared/` | `'shared'` |
| `staking/` | `'staking'` |
| `swap/` | `'swap'` |
| `migrate/` | `'migrate'` |

No exceptions. A hook in `swap/` whose key starts with `'intent'` is wrong.

### Rule 2 — camelCase for all segments

No kebab-case (`'btc-balance'`), no ad-hoc casing, no `snake_case`. Identifiers are camelCase string literals (`'tradingWalletBalance'`, `'submitSwapTx'`).

### Rule 3 — shape is `[feature, action, ...identifiers]`

Stable order: chain → token/asset → user → amount.

```ts
// @ai-snippets-skip
queryKey: ['mm', 'allowance', srcChainKey, token, action]
// not ['mm', 'allowance', token, srcChainKey, action]
```

### Rule 4 — bigints stringify

React Query's hash uses `JSON.stringify` which throws on raw bigints. Always coerce:

```ts
queryKey: ['staking', 'stakeRatio', amount.toString()]   // ✓
queryKey: ['staking', 'stakeRatio', amount]              // ✗ — runtime crash
```

Exception: query keys that pass bigint via the read hook's typed params and the corresponding invalidations use the same raw value — match the read hook's shape exactly. New code should always stringify.

### Rule 5 — invalidate the narrowest key that could change

If the mutation knows the affected `tokenId` / user / chain, scope the invalidation to it. Bare keys (no segments past the action) are reserved for "we don't know which variant changed" cases and should be commented.

```ts
// Good — narrow scope
queryClient.invalidateQueries({ queryKey: ['dex', 'positionInfo', tokenId, poolKey] });

// Acceptable — when the mutation can't scope further
queryClient.invalidateQueries({ queryKey: ['swap', 'allowance'] }); // wipe all allowance variants on approve
```

## Worked examples

```ts
// @ai-snippets-skip
// Cross-feature pattern: allowance reads. Shapes vary per feature (each carries
// the inputs that actually scope the allowance). Match the read hook's shape exactly
// from invalidations.
queryKey: ['mm', 'allowance', srcChainKey, token, action]
queryKey: ['swap', 'allowance', srcChainKey, srcAddress, inputToken, inputAmount.toString()]
queryKey: ['bridge', 'allowance', srcChainKey, srcAddress, srcToken, amount.toString()]
queryKey: ['bridge', 'detailedStatus', srcChainKey, srcTxHash]        // useBridgeDetailedStatus — apiConfig excluded
queryKey: ['leverageYield', 'detailedStatus', srcChainKey, srcTxHash] // useLeverageYieldDetailedStatus — apiConfig excluded
queryKey: ['dex', 'allowance', srcChainKey, asset, amount.toString()]
queryKey: ['staking', 'allowance', srcChainKey, action, srcAddress, amount.toString()]
//   ^^ action is a fixed literal per hook: 'stake' / 'unstake' / 'instantUnstake'

// User position reads
queryKey: ['mm', 'userReservesData', spokeChainKey, userAddress]
queryKey: ['staking', 'info', srcChainKey, srcAddress]              // useStakingInfo — second segment is 'info', not 'stakingInfo'
queryKey: ['shared', 'balances', chainKey, tokens, address]        // useBalances (SDK-backed)
queryKey: ['shared', 'xBalances', xChainId, tokens, address]       // useXBalances (wallet-layer)
queryKey: ['shared', 'nearStorageCheck', chainId, token, accountId] // useNearStorageCheck

// Mutation default keys
mutationKey: ['swap']                                                // useSwap
mutationKey: ['swap', 'approve']                                     // useSwapApprove
mutationKey: ['swap', 'cancel']                                      // useCancelSwap
mutationKey: ['swap', 'limitOrder', 'create']                        // useCreateLimitOrder
mutationKey: ['swap', 'limitOrder', 'cancel']                        // useCancelLimitOrder
mutationKey: ['mm', 'supply']
mutationKey: ['staking', 'stake']
mutationKey: ['staking', 'approve', 'stake']                         // useStakeApprove (action discriminator inside the key)
mutationKey: ['bridge']                                              // useBridge — single segment (no 'execute' suffix)
mutationKey: ['migrate', 'icxToSoda']
mutationKey: ['dex', 'supplyLiquidity']
mutationKey: ['shared', 'registerNearStorage']                       // useRegisterNearStorage
```

## Per-feature key tables

Skip if you're writing a feature hook for the first time and want to align with existing conventions.

### Swap

| Key | Hook |
|---|---|
| `['swap', 'quote', { ...payload, amount: payload.amount.toString() }]` | `useQuote` (object segment with bigint stringified) |
| `['swap', 'allowance', srcChainKey, srcAddress, inputToken, inputAmount.toString()]` | `useSwapAllowance` |
| `['swap', 'status', intentTxHash]` | `useStatus` |
| `['swap', 'detailedStatus', srcChainKey, srcTxHash]` | `useDetailedStatus` |
| `['swap', 'approvalStrategy', srcChainKey, srcAddress, inputToken, inputAmount.toString(), allowAccountUpgrade]` | `useSwapApprovalStrategy` |
| `['swap']` | `useSwap` mutation key |
| `['swap', 'approve']` | `useSwapApprove` |
| `['swap', 'swapWithApproval']` | `useSwapWithApproval` |
| `['swap', 'cancel']` | `useCancelSwap` |
| `['swap', 'limitOrder', 'create']` | `useCreateLimitOrder` |
| `['swap', 'limitOrder', 'cancel']` | `useCancelLimitOrder` |

### Money market

| Key | Hook |
|---|---|
| `['mm', 'reservesData']` | `useReservesData` |
| `['mm', 'reservesHumanized']` | `useReservesHumanized` |
| `['mm', 'reservesList']` | `useReservesList` |
| `['mm', 'reservesUsdFormat']` | `useReservesUsdFormat` |
| `['mm', 'userReservesData', spokeChainKey, userAddress]` | `useUserReservesData` |
| `['mm', 'userFormattedSummary', spokeChainKey, userAddress]` | `useUserFormattedSummary` |
| `['mm', 'allowance', srcChainKey, token, action]` | `useMMAllowance` |
| `['mm', 'aToken', aToken]` | `useAToken` |
| `['mm', 'aTokensBalances', aTokens, spokeChainKey, userAddress]` | `useATokensBalances` |
| `['mm', 'supply']` | `useSupply` mutation |
| `['mm', 'borrow']` | `useBorrow` |
| `['mm', 'withdraw']` | `useWithdraw` |
| `['mm', 'repay']` | `useRepay` |
| `['mm', 'approve']` | `useMMApprove` |

### Staking

| Key | Hook |
|---|---|
| `['staking', 'info', srcChainKey, srcAddress]` | `useStakingInfo` (second segment is `'info'`, NOT `'stakingInfo'`) |
| `['staking', 'unstakingInfo', srcChainKey, srcAddress]` | `useUnstakingInfo` |
| `['staking', 'unstakingInfoWithPenalty', srcChainKey, srcAddress]` | `useUnstakingInfoWithPenalty` |
| `['staking', 'config']` | `useStakingConfig` |
| `['staking', 'stakeRatio', amount.toString()]` | `useStakeRatio` |
| `['staking', 'instantUnstakeRatio', amount.toString()]` | `useInstantUnstakeRatio` |
| `['staking', 'convertedAssets', amount.toString()]` | `useConvertedAssets` |
| `['staking', 'allowance', srcChainKey, action, srcAddress, amount.toString()]` | `useStakeAllowance` / `useUnstakeAllowance` / `useInstantUnstakeAllowance` — `action` is a fixed literal per hook |
| `['staking', 'stake']` | `useStake` mutation |
| `['staking', 'unstake']` | `useUnstake` |
| `['staking', 'instantUnstake']` | `useInstantUnstake` |
| `['staking', 'claim']` | `useClaim` |
| `['staking', 'cancelUnstake']` | `useCancelUnstake` |
| `['staking', 'approve', 'stake' \| 'unstake' \| 'instantUnstake']` | `useStakeApprove` / `useUnstakeApprove` / `useInstantUnstakeApprove` |

### Backend (read)

Backend read hooks (`useBackendIntentByTxHash`, `useBackendIntentByHash`, `useBackendUserIntents`, `useBackendOrderbook`, `useBackendMoneyMarketPosition`, …) follow the `['backend', action, ...]` shape — see the source hook files.

### Swaps API (`sodax.api.swaps`)

Typed wrappers over `sodax.api.swaps.*` (one per Swaps API endpoint), all keyed `['swapsApi', action, ...]`.

| Key | Hook |
|---|---|
| `['swapsApi', 'tokens']` | `useSwapsApiTokens` |
| `['swapsApi', 'tokens', chainKey]` | `useSwapsApiTokensByChain` |
| `['swapsApi', 'quote', …]` | `useSwapsApiQuote` |
| `['swapsApi', 'deadline', …]` | `useSwapsApiDeadline` |
| `['swapsApi', 'allowance', …]` | `useSwapsApiAllowance` |
| `['swapsApi', 'status', …]` | `useSwapsApiStatus` |
| `['swapsApi', 'intentHash', …]` | `useSwapsApiIntentHash` |
| `['swapsApi', 'intentPacket', …]` | `useSwapsApiIntentPacket` |
| `['swapsApi', 'intentExtraData', …]` | `useSwapsApiIntentExtraData` |
| `['swapsApi', 'filledIntent', txHash]` | `useSwapsApiFilledIntent` |
| `['swapsApi', 'intent', txHash]` | `useSwapsApiIntent` |
| `['swapsApi', 'estimateGas', …]` | `useSwapsApiEstimateGas` |
| `['swapsApi', 'partnerFee', amount]` | `useSwapsApiPartnerFee` |
| `['swapsApi', 'solverFee', amount]` | `useSwapsApiSolverFee` |
| `['swapsApi', 'submitTx', 'status', txHash, srcChainKey]` | `useSwapsApiSubmitTxStatus` — both identifiers required |
| `['swapsApi', 'approve']` | `useSwapsApiApprove` mutation |
| `['swapsApi', 'approveAndBroadcast']` | `useSwapsApiApproveAndBroadcast` mutation |
| `['swapsApi', 'createIntent']` | `useSwapsApiCreateIntent` mutation |
| `['swapsApi', 'submitIntent']` | `useSwapsApiSubmitIntent` mutation |
| `['swapsApi', 'cancelIntent']` | `useSwapsApiCancelIntent` mutation |
| `['swapsApi', 'createLimitOrder']` | `useSwapsApiCreateLimitOrder` mutation |
| `['swapsApi', 'submitTx']` | `useSwapsApiSubmitTx` mutation |

### Bridge API (`sodax.api.bridge`)

Typed wrappers over `sodax.api.bridge.*` (one per Bridge API endpoint), all keyed `['bridgeApi', action, ...]`.

| Key | Hook |
|---|---|
| `['bridgeApi', 'tokens']` | `useBridgeApiTokens` |
| `['bridgeApi', 'tokens', chainKey]` | `useBridgeApiTokensByChain` |
| `['bridgeApi', 'allowance', …]` | `useBridgeApiAllowance` |
| `['bridgeApi', 'fee', inputAmount, partnerFee]` | `useBridgeApiFee` |
| `['bridgeApi', 'bridgeableAmount', srcChainKey, dstChainKey, inputToken, outputToken]` | `useBridgeApiBridgeableAmount` |
| `['bridgeApi', 'bridgeable', srcChainKey, dstChainKey, inputToken, outputToken]` | `useBridgeApiIsBridgeable` |
| `['bridgeApi', 'submitTx', 'status', txHash, srcChainKey]` | `useBridgeApiSubmitTxStatus` — both identifiers required |
| `['bridgeApi', 'approve']` | `useBridgeApiApprove` mutation |
| `['bridgeApi', 'approveAndBroadcast']` | `useBridgeApiApproveAndBroadcast` mutation |
| `['bridgeApi', 'createBridgeIntent']` | `useBridgeApiCreateBridgeIntent` mutation |
| `['bridgeApi', 'submitTx']` | `useBridgeApiSubmitTx` mutation |

### Leverage Yield API (`sodax.api.leverageYield`)

Typed wrappers over `sodax.api.leverageYield.*` (one per Leverage Yield API endpoint), all keyed `['leverageYieldApi', action, ...]`.

| Key | Hook |
|---|---|
| `['leverageYieldApi', 'vaults']` | `useLeverageYieldApiVaults` |
| `['leverageYieldApi', 'vault', name]` | `useLeverageYieldApiVault` |
| `['leverageYieldApi', 'asset', vault]` | `useLeverageYieldApiAsset` |
| `['leverageYieldApi', 'position', vault]` | `useLeverageYieldApiPosition` |
| `['leverageYieldApi', 'apr', vault]` | `useLeverageYieldApiApr` |
| `['leverageYieldApi', 'effectiveApr', vault]` | `useLeverageYieldApiEffectiveApr` |
| `['leverageYieldApi', 'lsdApr', vault]` | `useLeverageYieldApiLsdApr` |
| `['leverageYieldApi', 'totalAssets', vault]` | `useLeverageYieldApiTotalAssets` |
| `['leverageYieldApi', 'previewDeposit', vault, assets]` | `useLeverageYieldApiPreviewDeposit` |
| `['leverageYieldApi', 'previewWithdraw', vault, assets]` | `useLeverageYieldApiPreviewWithdraw` |
| `['leverageYieldApi', 'previewRedeem', vault, shares]` | `useLeverageYieldApiPreviewRedeem` |
| `['leverageYieldApi', 'shareBalance', vault, owner]` | `useLeverageYieldApiShareBalance` |
| `['leverageYieldApi', 'maxWithdraw', vault, owner]` | `useLeverageYieldApiMaxWithdraw` |
| `['leverageYieldApi', 'depositQuote', …]` | `useLeverageYieldApiDepositQuote` |
| `['leverageYieldApi', 'withdrawQuote', …]` | `useLeverageYieldApiWithdrawQuote` |
| `['leverageYieldApi', 'deadline', …]` | `useLeverageYieldApiDeadline` |
| `['leverageYieldApi', 'allowance', …]` | `useLeverageYieldApiAllowance` |
| `['leverageYieldApi', 'status', intentTxHash]` | `useLeverageYieldApiStatus` |
| `['leverageYieldApi', 'intentHash', …]` | `useLeverageYieldApiIntentHash` |
| `['leverageYieldApi', 'intentPacket', …]` | `useLeverageYieldApiIntentPacket` |
| `['leverageYieldApi', 'intentExtraData', …]` | `useLeverageYieldApiIntentExtraData` |
| `['leverageYieldApi', 'filledIntent', txHash]` | `useLeverageYieldApiFilledIntent` |
| `['leverageYieldApi', 'intent', txHash]` | `useLeverageYieldApiIntent` |
| `['leverageYieldApi', 'estimateGas', …]` | `useLeverageYieldApiEstimateGas` |
| `['leverageYieldApi', 'partnerFee', amount]` | `useLeverageYieldApiPartnerFee` |
| `['leverageYieldApi', 'solverFee', amount]` | `useLeverageYieldApiSolverFee` |
| `['leverageYieldApi', 'submitTx', 'status', txHash, srcChainKey]` | `useLeverageYieldApiSubmitTxStatus` — both identifiers required |
| `['leverageYieldApi', 'approve']` | `useLeverageYieldApiApprove` mutation |
| `['leverageYieldApi', 'approveAndBroadcast']` | `useLeverageYieldApiApproveAndBroadcast` mutation |
| `['leverageYieldApi', 'createDepositIntent']` | `useLeverageYieldApiCreateDepositIntent` mutation |
| `['leverageYieldApi', 'createWithdrawIntent']` | `useLeverageYieldApiCreateWithdrawIntent` mutation |
| `['leverageYieldApi', 'submitIntent']` | `useLeverageYieldApiSubmitIntent` mutation |
| `['leverageYieldApi', 'cancelIntent']` | `useLeverageYieldApiCancelIntent` mutation |
| `['leverageYieldApi', 'submitTx']` | `useLeverageYieldApiSubmitTx` mutation |

### Leverage Yield

| Key | Hook |
|---|---|
| `['leverageYield', 'quote', payload]` | `useLeverageYieldQuote` (payload object with `amount` and any `partnerFee.amount` stringified — React Query hashes keys with `JSON.stringify`, which throws on bigint) |
| `['leverageYield', 'effectiveApr', vault]` | `useLeverageYieldEffectiveApr` |
| `['leverageYield', 'position', vault]` | `useLeverageYieldPosition` |
| `['leverageYield', 'totalAssets', vault]` | `useLeverageYieldTotalAssets` |
| `['leverageYield', 'previewRedeem', vault, shares.toString()]` | `useLeverageYieldPreviewRedeem` |
| `['leverageYield', 'shareBalance', vault, chainKey, address]` | `useLeverageYieldShareBalances` (singular `shareBalance`; one query per holder) |
| `['leverageYield', 'deposit']` | `useLeverageYieldDeposit` mutation |
| `['leverageYield', 'withdraw']` | `useLeverageYieldWithdraw` mutation |
| `['leverageYield', 'vaultSwap']` | `useLeverageYieldVaultSwap` mutation |
| `['leverageYield', 'notifySolver']` | `useLeverageYieldNotifySolver` mutation |

### Bridge / DEX / Migration / Bitcoin / etc.

Follow the same shape. See the source hook files (`packages/dapp-kit/src/hooks/<feature>/`) for current keys.

## v1 → v2

In v1 dapp-kit, queryKey conventions were ad-hoc:

```ts
// @ai-snippets-skip — queryKey-shape examples; `...` is a placeholder, not real code
// ai-keys-allow — v1 keys shown for migration context; not real v2 source keys
// v1 examples
queryKey: ['xBalances', ...]                  // missing feature prefix
queryKey: ['btc-balance', ...]                // kebab-case
queryKey: ['api', 'mm', ...]                  // wrong feature prefix
mutationKey: undefined                         // many hooks had no default

// v2
queryKey: ['shared', 'xBalances', ...]        // feature-prefixed
queryKey: ['bitcoin', 'balance', ...]         // camelCase
queryKey: ['backend', 'mm', ...]              // correctly nested under 'backend'
mutationKey: ['mm', 'supply']                 // every hook has a default; consumer can override via mutationOptions.mutationKey
```

For migration code grafting onto dapp-kit's cache invalidation, see [`breaking-changes/querykey-conventions.md`](../../../migration-v1-to-v2/knowledge/breaking-changes/querykey-conventions.md).

## Cross-references

- [`../architecture.md`](../architecture.md) § "queryKey / mutationKey conventions" — full design rationale.
- [`hooks-index.md`](hooks-index.md) — full hook table.
