# Money Market — `@sodax/dapp-kit`

Cross-chain lending and borrowing.

Pair: [`features/money-market.md`](../../../migration-v1-to-v2/knowledge/features/money-market.md).

## Hook surface

```ts
// @ai-snippets-skip
// User mutations (4 actions)
useSupply({ mutationOptions });
useWithdraw({ mutationOptions });
useBorrow({ mutationOptions });
useRepay({ mutationOptions });

// Allowance + approve — useMMAllowance wraps the MM params under `params.payload`
useMMAllowance({ params: { payload: MoneyMarketParams<K> }, queryOptions });   // disabled for borrow/withdraw (data is undefined)
useMMApprove({ mutationOptions });

// Reserves data (read-only)
useReservesData({ queryOptions });                     // All reserve data
useReservesHumanized({ queryOptions });                // Decimal-normalized
useReservesList({ queryOptions });                     // List of reserve asset addresses
useReservesUsdFormat({ queryOptions });                // With USD values

// User position
useUserFormattedSummary({ params, queryOptions });     // Health factor, collateral, debt
useUserReservesData({ params, queryOptions });         // Per-reserve user position

// aTokens
useAToken({ params: { aToken }, queryOptions });                                  // aToken metadata (single)
useATokensBalances({ params: { aTokens, spokeChainKey, userAddress }, queryOptions }); // aToken balances (batched multicall)
```

### Read-hook param shapes

```ts
// @ai-snippets-skip
// useUserFormattedSummary / useUserReservesData — user-position queries
type UseUserFormattedSummaryParams = ReadHookParams<FormatUserSummaryResponse, {
  spokeChainKey: SpokeChainKey | undefined;
  userAddress: string | undefined;
}>;
// Same shape on useUserReservesData. The hook derives the hub wallet from (spokeChainKey, userAddress) internally.
// Bitcoin: always pass the personal address as userAddress — the hook transparently resolves to the
// Bound Exchange trading-wallet-derived hub wallet when a session is active (local lookup, no network).

// useAToken — single aToken metadata; FLAT (no chain/user fields)
type UseATokenParams = ReadHookParams<ATokenData, {
  aToken: Address | string | undefined;
}>;
// ATokenData = Erc20Token & { chainKey: ChainKey }

// useATokensBalances — batched aToken balances
type UseATokensBalancesParams = ReadHookParams<Map<Address, bigint>, {
  aTokens: readonly Address[];
  spokeChainKey: SpokeChainKey | undefined;
  userAddress: string | undefined;
}>;
// Returns a Map keyed by aToken address. The hook resolves the hub wallet from (spokeChainKey, userAddress).
// Bitcoin: always pass the personal address — trading-wallet resolution is automatic when a session exists.
```

> **Read-side chain key is `spokeChainKey`, not `srcChainKey`.** Mutation hooks (`useSupply`/`useBorrow`/etc.) use `srcChainKey` because the request crosses chains and needs a source. Read hooks describe a user's position on a single spoke chain — the field is `spokeChainKey`. Applies to `useATokensBalances`, `useUserFormattedSummary`, and `useUserReservesData` (`useAToken` is metadata-only and takes neither). Don't grep-replace one for the other.

> **Bitcoin `userAddress`**: always pass the **personal** address (the user's wallet address), not the Bound Exchange trading address. The read hooks (`useATokensBalances`, `useUserReservesData`, `useUserFormattedSummary`, `useGetUserHubWalletAddress`) automatically resolve to the trading-wallet-derived hub wallet when a Bound Exchange session is active — this is a local lookup with no network call and no throw on an unauthenticated session. See [`features/bitcoin.md`](bitcoin.md) for Bound Exchange session setup.

`use*Approve` is unchanged and still resolves to one transaction hash, but the SDK may send **two**
transactions on a token that rejects a non-zero to non-zero allowance change (Ethereum USDT today) —
the user signs twice and the hash is the **last** one's. An `isPending`-driven "Approving…" should say
so. See "Approve hooks can prompt the wallet twice" in [`architecture.md`](../architecture.md).

## Mutation params

All four user mutations share the same TVars shape (only the `action` literal differs):

```ts
// @ai-snippets-skip
type UseSupplyVars<K extends SpokeChainKey = SpokeChainKey> = {
  params: MoneyMarketSupplyParams<K>;
  walletProvider: GetWalletProviderType<K>;
};

// MoneyMarketSupplyParams<K>:
// {
//   srcChainKey: K;
//   srcAddress: GetAddressType<K>;
//   token: string;
//   amount: bigint;
//   action: 'supply';
//   dstChainKey?: SpokeChainKey;  // optional cross-chain delivery
//   dstAddress?: string;
// }
```

`borrow`, `withdraw`, `repay` follow the same shape with their respective `action` literals (`'borrow'` / `'withdraw'` / `'repay'`). **All four actions** accept optional `dstChainKey`/`dstAddress` for cross-chain delivery — supply on chain A and credit collateral on chain B, withdraw from chain A into a wallet on chain B, etc.

```ts
// @ai-snippets-skip
const { mutateAsyncSafe: supply } = useSupply();
const result = await supply({
  params: { srcChainKey: ChainKeys.BASE_MAINNET, srcAddress: '0x...', token: '0x...', amount: 1_000_000n, action: 'supply' },
  walletProvider,
});
if (!result.ok) return;
const { srcChainTxHash, dstChainTxHash } = result.value;   // TxHashPair
```

## Approve / allowance

```ts
// @ai-snippets-skip
// useMMAllowance reads `params.payload` (the MM params); no walletProvider — the read calls
// `isAllowanceValid` with `raw: true` internally. For borrow/withdraw, returns true automatically.
const { data: isApproved } = useMMAllowance({ params: { payload: supplyParams } });
const { mutateAsync: approve } = useMMApprove();
if (!isApproved) await approve({ params: supplyParams, walletProvider });
```

`useMMAllowance` skips the on-chain check entirely for `'borrow'` / `'withdraw'` actions — the query is `enabled: false` for those, so `data` stays `undefined`. Treat "absent allowance for borrow/withdraw" as "approval not required" at the call site (these actions never need ERC-20 approval).

## Reserves data hooks

| Hook | Returns | When to use |
|---|---|---|
| `useReservesData` | `[ReserveData[], ...]` | Raw data for custom rendering |
| `useReservesHumanized` | `ReserveDataHumanized[]` | Decimal-normalized (most common for UI) |
| `useReservesList` | `Address[]` | Just the reserve addresses |
| `useReservesUsdFormat` | `ReserveUsdFormat[]` | With USD price overlays |
| `useUserFormattedSummary` | `{ totalCollateralUSD, totalBorrowsUSD, healthFactor, ... }` | Dashboard-ready summary |
| `useUserReservesData` | `UserReserveData[]` | Per-reserve user position |

## Return shapes

| Hook | Returns |
|---|---|
| `useSupply` / `useBorrow` / `useWithdraw` / `useRepay` | `SafeUseMutationResult<TxHashPair, Error, ...>` (`{ srcChainTxHash, dstChainTxHash }`) |
| `useMMApprove` | `SafeUseMutationResult<TxReturnType<K, false>, Error, ...>` — chain-keyed receipt union |
| `useMMAllowance` | `UseQueryResult<boolean, Error>` — already unwrapped; for `borrow`/`withdraw` actions the query is `enabled: false` and `data` is `undefined` |
| Reserve / position hooks | `UseQueryResult<TData, Error>` — already unwrapped; queries throw on SDK `!ok` |

## Gotchas

1. **Health factor < 1.0 is liquidation territory.** `healthFactor` is a **string** — coerce before comparing (`summary.healthFactor < 1.05` is a TS type error). A user with **no debt** returns the sentinel `'-1'`, so guard against it or you'll warn on a safe position: `const hf = Number(summary.healthFactor); if (hf !== -1 && hf < 1.05) { /* warn */ }` (use whatever margin your UX needs).
2. **Cross-chain delivery via `dstChainKey`/`dstAddress`** — supported on all four actions (supply / withdraw / borrow / repay). Omit for same-chain operations; don't pass `dstChainKey === srcChainKey` (let the default kick in).
3. **`useMMAllowance` is `enabled: false` for borrow/withdraw** — `data` stays `undefined` (not `true`). Treat "no allowance result for borrow/withdraw" as "approval not required" — those actions never need ERC-20 approval.
4. **Position queries take `{ spokeChainKey, userAddress }`** (NOT `srcChainKey`/`srcAddress` — those are mutation-side names). The hub wallet derivation is automatic.

## Cross-references

- [`../recipes/money-market.md`](../recipes/money-market.md) — full worked examples.
- [`features/money-market.md`](../../../migration-v1-to-v2/knowledge/features/money-market.md) — v1 → v2 porting.
- `sodax-sdk`: `integration/knowledge/features/money-market.md` — underlying SDK MM surface.
