# v1 → v2 cross-cutting migration checklist

Work this top-down. Each step is independent enough to land as its own commit; the order minimizes typecheck noise.

```
[ ] 1.  Replace every *_MAINNET_CHAIN_ID constant with ChainKeys.* (mechanical).
        See breaking-changes/type-system.md § "Chain IDs".
[ ] 2.  Replace every SpokeChainId / ChainId type alias with SpokeChainKey.
        Mechanical rename. Same value union.
[ ] 3.  Rename XToken.xChainId → XToken.chainKey. Same for any consumer types
        that mirrored that field.
[ ] 4.  Remove any direct dependency on @sodax/types from package.json.
        v2 @sodax/sdk barrel re-exports the entire types surface.
[ ] 5.  Delete every *SpokeProvider class instantiation. Replace with passing
        walletProvider (an I*WalletProvider instance) directly into SDK call
        payloads.
[ ] 6.  Replace every isXxxSpokeProvider(provider) guard with a chain-key
        compare: chainKey === ChainKeys.<X>_MAINNET, or use
        is<Family>ChainKeyType(chainKey) from @sodax/sdk.
[ ] 7.  Add { raw: false } discriminator to every signed call shape that
        previously took a positional spoke provider:
            { intentParams, spokeProvider }   →   { params, raw: false, walletProvider }
[ ] 7b. Cross-cutting rename: every payload field named `spokeProvider:` (incl.
        approve/allowance/utility methods that aren't signed-execution shapes)
        → `walletProvider:`. Mechanical for the OBJECT-LITERAL field key; don't
        blindly rename variable names of the same spelling. See
        [`recipes.md`](recipes.md) § 1 "What's not safe to grep-replace".
[ ] 8.  Add srcChainKey + srcAddress to every action params object that didn't
        carry them in v1 (most MM, staking, dex, bridge, migration param shapes).
[ ] 9.  Convert every await sodax.<service>.<method>(...) call site that previously
        threw to branch on result.ok / result.error. Use isSodaxError(e) for type
        narrowing.
[ ] 10. Delete imports of MoneyMarketError, IntentError, StakingError, BridgeError,
        MigrationError, AssetServiceError, ConcentratedLiquidityError, RelayError,
        plus the five Partner error types and their type-guard helpers.
[ ] 11. Replace any walked global lookup (hubAssets, moneyMarketSupportedTokens,
        SodaTokens, supportedSpokeChains) with the equivalent sodax.config.* /
        sodax.moneyMarket.getSupportedTokens*() call. Per-symbol deleted-vs-
        still-exported status: see breaking-changes/architecture.md § 2.
[ ] 12. Optional: await sodax.config.initialize() at app startup. It fetches nothing
        today; tokens and chains come from the installed SDK version.
[ ] 13. Add { raw: true } to any read-only allowance check that previously took
        a spoke provider but didn't actually consult it (the underlying SDK
        method now requires WalletProviderSlot).
[ ] 14. For every CreateIntentResult consumer: stop destructuring as a tuple;
        the v2 shape is { tx, intent, relayData }. Stop destructuring tx-pair
        results as arrays — every cross-chain mutation returns
        TxHashPair = { srcChainTxHash, dstChainTxHash }.
[ ] 15. For every backend-API call site: every method on IConfigApiV1 now returns
        Promise<Result<T>>. Wrap or unwrap accordingly.
[ ] 16. (Optional) Adopt isSodaxError(e) over instanceof SodaxError in cross-bundle
        / cross-realm contexts.
[ ] 17. Run pnpm tsc --noEmit and start crossing items off the typecheck output.
        Use each remaining error category to navigate to the relevant per-feature
        migration file in features/.
```

After items 1–17 land, the typecheck should be clean. The remaining work is per-feature behavior (cross-chain borrow / repay deltas, staking action discriminators, etc.) covered in [`features/`](features/).

## Reading order while working the checklist

- Items 1–4: [`breaking-changes/type-system.md`](breaking-changes/type-system.md).
- Items 5–6, 11–12: [`breaking-changes/architecture.md`](breaking-changes/architecture.md).
- Items 7–8, 13: [`breaking-changes/architecture.md`](breaking-changes/architecture.md) § "WalletProviderSlot" + per-feature files.
- Items 9–10, 14, 16: [`breaking-changes/result-and-errors.md`](breaking-changes/result-and-errors.md).
- Item 15: [`features/backend-api.md`](features/backend-api.md).
- Item 17 + the long tail: [`features/`](features/), one per feature you use.
