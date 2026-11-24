# Recovery migration — v1 → v2

Pure-SDK migration playbook for `RecoveryService`.

Pair: [`features/recovery.md`](../../../integration/knowledge/features/recovery.md).

## TL;DR

**`RecoveryService` is new in v2.** No v1 equivalent — there's no migration to do for code that didn't exist before. This file exists so the v1 → v2 audit doesn't miss the addition.

If you have v1 code that worked around the absence (e.g. manually walked the hub wallet abstraction to find stuck assets), replace it with `fetchHubAssetBalances` + `withdrawHubAsset`:

```ts
const balances = await sodax.recovery.fetchHubAssetBalances({ chainKey, srcAddress });
if (balances.ok && balances.value.length > 0) {
  await sodax.recovery.withdrawHubAsset({
    params: { /* token (the spoke-side token address, i.e. spokeTokenAddress), amount, srcChainKey, srcAddress (also the withdrawal destination) */ },
    raw: false,
    walletProvider: sonicWp,
  });
}
```

See [`features/recovery.md`](../../../integration/knowledge/features/recovery.md) for the full method signatures and error codes.

## Pitfalls

1. **Recovery is not a replacement for real error handling.** Use it after investigating why the original cross-chain operation failed — resume settlement using the original source hash or withdrawal tracking ID after a relay timeout. Resolve structural problems before attempting a new operation.

## Cross-references

- v2 recovery usage: [`features/recovery.md`](../../../integration/knowledge/features/recovery.md).
- Partner migration (separate service): [`./partner.md`](partner.md).
- Backend API migration (separate service): [`./backend-api.md`](backend-api.md).
- Result/error model: [`../breaking-changes/result-and-errors.md`](../breaking-changes/result-and-errors.md).
