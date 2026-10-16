# Bridge — `@sodax/dapp-kit`

Cross-chain token transfers via the hub-and-spoke vault architecture.

Pair: [`features/bridge.md`](../../../migration-v1-to-v2/knowledge/features/bridge.md).

## Hook surface

```ts
// @ai-snippets-skip
// Mutation
useBridge({ mutationOptions });
useBridgeApprove({ mutationOptions });

// Queries
// useBridgeAllowance nests payload + walletProvider under params (NOT at top level)
useBridgeAllowance({ params: { payload: CreateBridgeIntentParams<K>, walletProvider }, queryOptions });
// Polls 3s from the source tx; stops on a terminal source, a rejected API key, or 40 consecutive
// ambiguous reads. Result-wrapped — narrow `data.value.source` ('backend' | 'relay').
useBridgeDetailedStatus({ params: { srcChainKey, srcTxHash, apiConfig? }, queryOptions });
useGetBridgeableAmount({ params: { from: XToken, to: XToken }, queryOptions });
useGetBridgeableTokens({ params: { from: SpokeChainKey, to: SpokeChainKey, token: string }, queryOptions });
```

`use*Approve` is unchanged and still resolves to one transaction hash, but the SDK may send **two**
transactions on a token that rejects a non-zero to non-zero allowance change (Ethereum USDT today) —
the user signs twice and the hash is the **last** one's. An `isPending`-driven "Approving…" should say
so. See "Approve hooks can prompt the wallet twice" in [`architecture.md`](../architecture.md).

## Mutation params

```ts
// @ai-snippets-skip
type CreateBridgeIntentParams<K extends SpokeChainKey = SpokeChainKey> = {
  srcChainKey: K;
  srcAddress: string;
  srcToken: string;
  amount: bigint;
  dstChainKey: SpokeChainKey;
  dstToken: string;
  recipient: string;   // non-encoded recipient address on the destination chain
};

const { mutateAsyncSafe: bridge } = useBridge();
const result = await bridge({ params, walletProvider });
if (!result.ok) return;
const { srcChainTxHash, dstChainTxHash } = result.value;   // TxHashPair
```

## Query params

```ts
// @ai-snippets-skip
// useBridgeAllowance — payload + walletProvider nested under params
type UseBridgeAllowanceParams<K extends SpokeChainKey> = ReadHookParams<
  boolean,
  {
    payload: CreateBridgeIntentParams<K> | undefined;
    walletProvider: GetWalletProviderType<K> | undefined;
  }
>;

// useGetBridgeableAmount — flat: pair of XToken objects
type UseGetBridgeableAmountParams = ReadHookParams<BridgeLimit, {
  from: XToken | undefined;
  to: XToken | undefined;
}>;
// BridgeLimit = { amount: bigint; decimals: number; type: 'DEPOSIT_LIMIT' | 'WITHDRAWAL_LIMIT' }

// useGetBridgeableTokens — flat: (from, to, token)
type UseGetBridgeableTokensParams = ReadHookParams<XToken[], {
  from: SpokeChainKey | undefined;
  to: SpokeChainKey | undefined;
  token: string | undefined;
}>;
```

## Return shapes

| Hook | Returns |
|---|---|
| `useBridge` | `SafeUseMutationResult<TxHashPair, Error, ...>` (`{ srcChainTxHash, dstChainTxHash }`) |
| `useBridgeApprove` | `SafeUseMutationResult<TxReturnType<K, false>, Error, UseBridgeApproveVars<K>>` — chain-keyed receipt union (EVM/Stellar/Sui differ) |
| `useBridgeAllowance` | `UseQueryResult<boolean, Error>` — already unwrapped; on SDK `!ok` the queryFn returns `false` (does NOT throw), so `isError` stays clean |
| `useGetBridgeableAmount` | `UseQueryResult<BridgeLimit, Error>` (richer than v1's bare `bigint`) |
| `useGetBridgeableTokens` | `UseQueryResult<XToken[], Error>` |

## Gotchas

1. **`useGetBridgeableAmount` takes XToken objects, not addresses + chain ids.** Each `XToken` carries its own `chainKey`. v1 took 4 separate args; v2 takes 2 objects.
2. **`useGetBridgeableAmount` value is `BridgeLimit`, not a bare bigint.** Access `result.value.amount` and `result.value.decimals` for the limit + scale.
3. **Tokens are bridgeable iff they share the same vault on the hub.** Use `useGetBridgeableTokens` to enumerate compatible destinations for a given source — passing an incompatible pair to `bridge()` rejects with `VALIDATION_FAILED`.
4. **`bridge()` returns `TxHashPair`, not a tuple.** Destructure as `{ srcChainTxHash, dstChainTxHash }` — never `[a, b]`.

## Cross-references

- [`../recipes/bridge.md`](../recipes/bridge.md) — full worked example.
- [`features/bridge.md`](../../../migration-v1-to-v2/knowledge/features/bridge.md) — v1 → v2 porting.
- `sodax-sdk`: `integration/knowledge/features/bridge.md` — underlying SDK bridge surface.
