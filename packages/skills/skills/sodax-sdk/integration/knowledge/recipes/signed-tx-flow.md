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

For cross-chain mutations (`bridge.bridge`, `staking.stake`, `moneyMarket.supply/borrow/withdraw/repay`, `dex.deposit/withdraw/supplyLiquidity/…`, `migration.migratebnUSD/…`) the success value is `TxHashPair = { srcChainTxHash, dstChainTxHash }` — the spoke transaction hash on the source chain plus the relayed hub transaction hash (from Tron, see [`ai-rules.md`](../ai-rules.md)):

```ts
const result = await sodax.bridge.bridge({ params, raw: false, walletProvider });
if (!result.ok) return;
const { srcChainTxHash, dstChainTxHash } = result.value;
```

The same shape is used by every cross-chain mutation in v2 — there is no array-form variant. When the user is already on the hub, both fields hold the same hash.

---

## Cross-references

- [`README.md`](README.md) — recipe index.
- [`../architecture.md`](../architecture.md) — concepts behind these patterns.
- [`../reference/`](../reference/) — chain keys, error codes, public API surface.
