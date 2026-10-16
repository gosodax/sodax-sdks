# Recovery

> **Error handling conventions:** `fetchHubAssetBalances` returns `SodaxError<'LOOKUP_FAILED'>` and
> nothing else. `withdrawHubAsset` is different — failures from the spoke leg are passed through
> unchanged and are **not** guaranteed to be a `SodaxError`. Read the **Error handling** section
> before writing a `catch` branch; the naive `result.error.code` check is wrong on that path.

The `RecoveryService` class, reachable via `sodax.recovery`, resolves assets stranded in a user's
**hub wallet** on Sonic.

## Why assets get stranded

Every cross-chain operation — a swap, a bridge, a money-market supply — runs in two legs: a deposit
on the spoke chain, then execution on the Sonic hub against the user's wallet abstraction contract.
When the second leg fails after the first has landed, the tokens sit in that hub wallet. They are
not lost, and they are not visible in the user's spoke-chain wallet: nothing on the source chain
shows them, because on the source chain the deposit simply succeeded.

Recovery is the read-and-return path for exactly that state:

```
spoke deposit ──✅──▶ hub wallet abstraction ──❌──▶ hub execution
                            │
                            │  fetchHubAssetBalances  (what is sitting here?)
                            ▼
                     withdrawHubAsset  (send it back to the spoke chain)
```

## Read the stranded balances

```typescript
import { ChainKeys } from '@sodax/sdk';

const result = await sodax.recovery.fetchHubAssetBalances({
  chainKey: ChainKeys.ARBITRUM_MAINNET,
  srcAddress: '0xUserAddressOnArbitrum',
});

if (result.ok) {
  for (const asset of result.value) {
    console.log(`${asset.symbol}: ${asset.balance}`); // balance is a bigint
    console.log(`  spoke token: ${asset.spokeTokenAddress}`);
    console.log(`  hub asset:   ${asset.hubAssetAddress}`);
  }
}
```

`srcAddress` is the user's address **on the spoke chain**. The service derives the hub wallet
abstraction address from it internally — you never pass a Sonic address here.

The returned `HubAssetBalance`:

| Field | Type | Meaning |
| --- | --- | --- |
| `spokeTokenAddress` | `Address` | Original token address on the spoke chain, lowercased. This is what `withdrawHubAsset` wants as `token` |
| `hubAssetAddress` | `Address` | Wrapped asset address on Sonic, lowercased |
| `symbol`, `name` | `string` | From the SDK's token config |
| `decimal` | `number` | Decimals of the hub-side asset |
| `balance` | `bigint` | Raw `balanceOf` on the hub asset — already the unit `withdrawHubAsset` expects |

An empty array is a success, not a failure: it means nothing is stranded for that chain.

### What the enumeration covers, and what it deliberately skips

The method walks `spokeChainConfig[chainKey].supportedTokens`, drops tokens whose `hubAsset` is not
a valid address (placeholders for chains where the token is not deployed yet), and reads
`balanceOf(hubWallet)` for the rest in a single multicall with `allowFailure: true` — so one
unreadable asset cannot fail the whole call. Only non-zero balances come back.

**Leverage-yield vault share tokens are excluded on purpose.** The `lsoda*` tokens appear in
`supportedTokens` so they are discoverable in swaps, and their `hubAsset` is the vault proxy itself
— so a naive balance read would surface a healthy deposited position as if it were stranded. It is
not recoverable this way: `withdrawHubAsset` encodes an asset-manager `transfer`, which reverts for
a vault share (there is no spoke mapping), and the user sees it as a failed gas estimate. Exit those
positions through the
[Leverage Yield](https://docs.sodax.com/developers/packages/foundation/sdk/functional-modules/leverage_yield)
withdraw flow instead.

## Withdraw back to the spoke chain

```typescript
const withdrawal = await sodax.recovery.withdrawHubAsset({
  params: {
    srcChainKey: ChainKeys.ARBITRUM_MAINNET,
    srcAddress: '0xUserAddressOnArbitrum',
    token: asset.spokeTokenAddress, // the SPOKE-side address, not the hub asset
    amount: asset.balance,          // hub-side precision — pass the balance straight through
  },
  raw: false,
  walletProvider, // EVM wallet provider for the spoke chain
});
```

Two parameters are easy to get wrong:

- **`token` is the spoke-side address**, not `hubAssetAddress`. It is the key the SDK uses to look
  up the hub asset. Passing the hub address makes the lookup fail.
- **`amount` is denominated in the hub-side asset**, which is the same unit `fetchHubAssetBalances`
  returned. Pass `asset.balance` through without rescaling.

`raw: true` returns the unsigned spoke transaction and takes no `walletProvider`; `raw: false` (or
omitted) signs and broadcasts, resolving to the chain-specific transaction hash.

Under the hood the withdrawal is not a hub-chain transaction the user signs: the service encodes an
asset-manager `transfer` and relays it from the spoke chain, so the user only ever signs on the
chain they already hold a wallet for.

## Error handling

`RecoveryErrorCode` is declared as `'VALIDATION_FAILED' | 'LOOKUP_FAILED' | 'EXECUTION_FAILED' |
'UNKNOWN'`, but the two public methods do not produce all four. What actually reaches a caller:

| Method | What you get | Notes |
| --- | --- | --- |
| `fetchHubAssetBalances` | `SodaxError<'LOOKUP_FAILED'>` | Every failure is wrapped by `lookupFailed()`, including the unknown-chain-key guard. The original error — a `SodaxError<'VALIDATION_FAILED'>` for a bad chain key — survives only on `error.cause` |
| `withdrawHubAsset` | `SodaxError<'EXECUTION_FAILED'>` | Only when the hub-wallet derivation or payload encoding throws |
| `withdrawHubAsset` | **A plain `Error`, or an arbitrary thrown value** | When the spoke leg fails. The spoke `sendMessage` result is returned unchanged: a failed simulation arrives as `new Error('SIMULATION_FAILED')`, with no `code` and no `feature`, and its own `catch` re-emits whatever was thrown |

So `VALIDATION_FAILED` and `UNKNOWN` are in the type but not reachable from either returned
`Result` today, and the withdrawal path is **not** safe to discriminate on `error.code` alone:

```typescript
import { isSodaxError } from '@sodax/sdk';

if (!withdrawal.ok) {
  const error = withdrawal.error;

  if (isSodaxError(error)) {
    // error.code === 'EXECUTION_FAILED', error.context.phase === 'execution'
    console.error(error.code, error.context);
  } else if (error instanceof Error && error.message === 'SIMULATION_FAILED') {
    // The spoke simulation rejected the message before anything was broadcast.
    console.error('Simulation rejected the withdrawal');
  } else {
    console.error('Unrecognized failure', error);
  }
}
```

Checking `isSodaxError` first is the reliable shape here — `error.code` on a plain `Error` is
`undefined`, and a bare `error.code === 'EXECUTION_FAILED'` test silently drops the simulation
failure into the success-looking branch of an `if/else if` chain.

## React

`@sodax/dapp-kit` wraps both methods:

```tsx
import { useHubAssetBalances, useWithdrawHubAsset } from '@sodax/dapp-kit';

// Note the nested `params` object — the hook takes { params, queryOptions },
// not the query fields directly. It stays disabled while either field is undefined.
const { data: balances } = useHubAssetBalances({ params: { chainKey, srcAddress } });

const { mutateAsync: withdraw } = useWithdrawHubAsset();
await withdraw({ params: { srcChainKey, srcAddress, token, amount }, walletProvider });
```

The mutation takes no `raw` flag — the hook is fixed to the signing path.

The query key is `['recovery', 'hubAssetBalances', chainKey, srcAddress]`, and a successful
withdrawal invalidates it along with the shared balance query — the list refreshes itself, so do not
re-fetch by hand. The hooks throw on failure so React Query's `isError` / `onError` engage, which
means the `Result` unwrapping above happens for you; see
[Backend Query Hooks](https://docs.sodax.com/developers/packages/experience/dapp-kit)
for the shared conventions.

## Runnable example

[`apps/demo/src/pages/recovery`](https://github.com/icon-project/sodax-sdks/tree/main/apps/demo/src/pages/recovery)
is the worked example — chain picker, stranded-balance list and a per-asset withdraw button built on
the two hooks above.

```bash
pnpm build:packages
pnpm dev:demo   # → http://localhost:3000/recovery
```

## See also

- [Configure SDK](https://docs.sodax.com/developers/how-to/configure_sdk) — `sodax.recovery` in the service table.
- [SDK Architecture](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/ARCHITECTURE_REFACTOR_SUMMARY.md) — `Result<T>` and the error convention.
- [Monetize SDK](https://docs.sodax.com/developers/how-to/monetize_sdk) — partner fee claiming has its own recovery path for stuck conversion intents, which is unrelated to this service.
