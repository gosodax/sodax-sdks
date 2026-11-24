# Signed-tx flow

`raw: false` + a chain-narrowed `walletProvider`. The SDK signs and broadcasts; returns a tx hash (or tx-pair for cross-chain methods).

```ts
const result = await sodax.swaps.createIntent({
  params: {
    srcChainKey: ChainKeys.ARBITRUM_MAINNET,
    dstChainKey: ChainKeys.STELLAR_MAINNET,
    srcAddress: '0x…',
    dstAddress: 'G…',
    inputToken,    // XToken
    outputToken,   // XToken
    inputAmount: 1_000_000n,
    minOutputAmount: 998_000n,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 300),
    allowPartialFill: false,
    solver: '0x0000000000000000000000000000000000000000',
    data: '0x',
  },
  raw: false,
  walletProvider: evmWallet,    // IEvmWalletProvider — narrowed by srcChainKey
});

if (!result.ok) return;
const { tx, intent, relayData } = result.value;
// tx: the spoke tx hash (string for EVM, base58 for Solana, …)
```

For cross-chain mutations (`bridge.bridge`, `staking.stake`, `moneyMarket.supply/borrow/withdraw/repay`, `dex.deposit/withdraw/supplyLiquidity/…`, `migration.migratebnUSD/…`) the success value is `TxHashPair = { srcChainTxHash, dstChainTxHash }`, except that a borrow or withdrawal from an MPC-relay source uses `{ trackingId, dstChainTxHash }`. That authorization has no source transaction hash. The destination hash identifies the settled delivery:

```ts
const result = await sodax.bridge.bridge({ params, raw: false, walletProvider });
if (!result.ok) return;
const { srcChainTxHash, dstChainTxHash } = result.value;
```

When an action ends on the same hub transaction that started it, the two hashes are the same. If settlement fails, use the original source hash or withdrawal tracking ID from the error context to resume the existing MPC operation. Do not repeat the signed feature call.

---

## Cross-references

- [`README.md`](README.md) — recipe index.
- [`../architecture.md`](../architecture.md) — concepts behind these patterns.
- [`../reference/`](../reference/) — chain keys, error codes, public API surface.
