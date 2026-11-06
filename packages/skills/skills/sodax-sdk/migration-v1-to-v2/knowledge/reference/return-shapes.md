# Return-shape diffs per method

### `SwapService.createIntent`

```diff
- const [spokeTxHash, intent, relayData] = result;
+ const { tx, intent, relayData } = result.value;
```

v1 returned a tuple. v2 returns an object: `{ tx, intent, relayData }` where:
- `tx` is `TxReturnType<K, false>` (the spoke tx hash for `raw: false`, or the raw tx payload for `raw: true`).
- `intent` is the intent struct.
- `relayData` is `RelayExtraData` (`{ payload: string; ... }`).

If you use the backend submit-swap-tx API, the v1 `relayData` field on the request expects the **string**, not the object — pass `relayData.payload`.

### `BridgeService.bridge` and similar full-execution methods

```diff
- const txHash: string = await sodax.bridge.bridge(...);
+ const result = await sodax.bridge.bridge({ params, raw: false, walletProvider });
+ if (!result.ok) return;
+ const { srcChainTxHash, dstChainTxHash } = result.value;
```

v2 cross-chain mutation methods return `TxHashPair = { srcChainTxHash, dstChainTxHash }` so the consumer has both legs of the relay. The same shape applies to `staking.stake`, `staking.unstake`, `staking.instantUnstake`, `staking.claim`, `staking.cancelUnstake`, `dex.assetService.deposit/withdraw`, `dex.clService.supplyLiquidity/increaseLiquidity/decreaseLiquidity/claimRewards`, and the 4 `migration.*` orchestrators (`migratebnUSD`, `migrateIcxToSoda`, `revertMigrateSodaToIcx`, `migrateBaln`). Consumers on the hub chain still get both fields populated (with the same hash) for shape consistency.

### `MoneyMarketService.{supply, borrow, withdraw, repay}`

```diff
- const txHash = await sodax.moneyMarket.supply(...);
+ const result = await sodax.moneyMarket.supply({ params, raw: false, walletProvider });
+ const { srcChainTxHash, dstChainTxHash } = result.value;
```

Same `TxHashPair` shape as every other cross-chain mutation in v2, except `borrow` / `withdraw` (and `dex.assetService.withdraw`) from Tron: see [`ai-rules.md`](../../../integration/knowledge/ai-rules.md).

### Everything else

If a v1 method returned a single `string` tx hash, the v2 return is `Result<TxReturnType<K, false>>` — destructure as `result.value` (which is the hash for `raw: false`, or the chain-specific raw tx payload for `raw: true`).

---


## Cross-references

- [`README.md`](README.md) — migration reference index.
- [`../README.md`](../README.md) — migration overview.
- [`../checklist.md`](../checklist.md) — top-level migration checklist.
