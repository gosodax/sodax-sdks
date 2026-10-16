# Recipe: Backend Queries

Read-only data hooks. No wallet connection required.

**Depends on:** [setup.md](setup.md)

## Hooks

### Intents

| Hook | Purpose |
|------|---------|
| `useBackendIntentByTxHash` | Intent by hub chain tx hash (polls 1s) |
| `useBackendIntentByHash` | Intent by intent hash |
| `useBackendUserIntents` | All intents for a user with date filtering |

### Orderbook

| Hook | Purpose |
|------|---------|
| `useBackendOrderbook` | Solver orderbook with pagination (cached 30s, no auto-refetch) |

### Money Market

| Hook | Purpose |
|------|---------|
| `useBackendMoneyMarketPosition` | User's money market position |
| `useBackendMoneyMarketAsset` | Specific asset details |
| `useBackendAllMoneyMarketAssets` | All money market assets |
| `useBackendMoneyMarketAssetSuppliers` | Suppliers for an asset |
| `useBackendMoneyMarketAssetBorrowers` | Borrowers for an asset |
| `useBackendAllMoneyMarketBorrowers` | All borrowers |

### Oracle

| Hook | Purpose |
|------|---------|
| `useBackendOracleMarkets` | Oracle candle discovery: quote, intervals, symbols (cached 60s) |
| `useBackendOracleCandles` | USD OHLC candles for a symbol over `[from, to)` in UNIX seconds (cached 10s) |

### Swaps API (`sodax.api.swaps`)

| Hook | Purpose |
|------|---------|
| `useSwapsApiSubmitTx` | Submit swap tx to backend |
| `useSwapsApiSubmitTxStatus` | Check submitted swap status |

The full Swaps API surface (quote, allowance, approve, create/submit/cancel intent, fees, gas, …) is wrapped one hook per endpoint under the `useSwapsApi*` prefix — see [hooks-index.md](../reference/hooks-index.md).

## Track Intent

```tsx
import { useBackendIntentByTxHash } from '@sodax/dapp-kit';

function IntentTracker({ txHash }: { txHash: string }) {
  const { data: intent, isLoading } = useBackendIntentByTxHash({
    params: { txHash },
  });

  if (isLoading) return <div>Loading...</div>;
  return <pre>{JSON.stringify(intent, null, 2)}</pre>;
}
```

## User Intent History

```tsx
import { useBackendUserIntents } from '@sodax/dapp-kit';

function IntentHistory({ userAddress }: { userAddress: `0x${string}` }) {
  const { data: intents } = useBackendUserIntents({
    params: {
      userAddress,
      startDate: Date.now() - 7 * 24 * 60 * 60 * 1000,
      endDate: Date.now(),
    },
  });

  return (
    <div>
      {intents?.items.map((intent, i) => (
        <div key={i}>
          <p>{intent.intentHash} -- {intent.open ? 'open' : 'closed'}</p>
        </div>
      ))}
    </div>
  );
}
```

## Orderbook

```tsx
import { useBackendOrderbook } from '@sodax/dapp-kit';

function Orderbook() {
  // `pagination` is nested under `params` per the canonical query-hook shape.
  const { data: orderbook } = useBackendOrderbook({
    params: { pagination: { offset: '0', limit: '20' } },
  });
  return <pre>{JSON.stringify(orderbook, null, 2)}</pre>;
}
```

## Oracle Candles

```tsx
import { useState } from 'react';
import { useBackendOracleCandles, useBackendOracleMarkets } from '@sodax/dapp-kit';

function DailyEthCandles() {
  const { data: markets, isLoading } = useBackendOracleMarkets();
  // `from`/`to` are UNIX seconds over the half-open range [from, to), at most 5000 buckets.
  // Hold the window end in state: deriving it from `Date.now()` during render changes the query
  // key on every render that crosses a second boundary, so the query refetches from scratch.
  const [to, setTo] = useState(() => Math.floor(Date.now() / 1000));
  const { data } = useBackendOracleCandles({
    params: { symbol: 'ETH', interval: '1d', from: to - 30 * 86400, to },
  });

  if (isLoading) return <div>Loading...</div>;
  if (!markets?.symbols.includes('ETH')) return <div>No ETH candle data</div>;
  return (
    <>
      <button type="button" onClick={() => setTo(Math.floor(Date.now() / 1000))}>
        Refresh
      </button>
      <ul>
        {data?.candles.map(candle => (
          <li key={candle.timestamp}>
            O {candle.open} H {candle.high} L {candle.low} C {candle.close}
          </li>
        ))}
      </ul>
    </>
  );
}
```

## Money Market Dashboard

```tsx
// @ai-snippets-skip — uses example field name supplyAPY not in MoneyMarketAsset type
import { useBackendMoneyMarketPosition, useBackendAllMoneyMarketAssets } from '@sodax/dapp-kit';

function MMDashboard({ userAddress }: { userAddress: string }) {
  const { data: position } = useBackendMoneyMarketPosition({ params: { userAddress } });
  const { data: assets } = useBackendAllMoneyMarketAssets({});

  return (
    <div>
      {position && <pre>{JSON.stringify(position, null, 2)}</pre>}
      {assets?.map((a, i) => <p key={i}>{a.symbol}: Supply {a.supplyAPY}%</p>)}
    </div>
  );
}
```

## Custom Query Options

All read hooks accept `queryOptions` to override defaults:

```tsx
// @ai-snippets-skip
const { data } = useBackendIntentByTxHash({
  params: { txHash },
  queryOptions: { staleTime: 5000, refetchInterval: 2000, retry: 3 },
});
```

## Submit a Swap Tx

`useSwapsApiSubmitTx` is a mutation hook. The `request` is a `SubmitTxRequestV2`; per-call config (e.g. backend base URL) flows through `mutate(vars)`, and TanStack Query knobs through the optional `mutationOptions` slot:

```tsx
import { useSwapsApiSubmitTx } from '@sodax/dapp-kit';
import type { SubmitTxRequestV2 } from '@sodax/sdk';

function SubmitButton({ request, baseURL }: { request: SubmitTxRequestV2; baseURL: string }) {
  const { mutateAsync: submitSwapTx, isPending } = useSwapsApiSubmitTx({
    mutationOptions: { retry: 5 }, // overrides the default `retryUnlessAuthFailure` (3 retries, never on 401/403)
  });

  const handleSubmit = async () => {
    const response = await submitSwapTx({
      request,
      apiConfig: { baseURL }, // per-call backend override
    });
    console.log('Submitted:', response);
  };

  return <button onClick={handleSubmit} disabled={isPending}>Submit</button>;
}
```

Poll the processing status with `useSwapsApiSubmitTxStatus` — it requires **both** `txHash` and `srcChainKey` (the status endpoint needs the source chain key) and stops polling on `solved` / `failed`:

```tsx
import { useSwapsApiSubmitTxStatus } from '@sodax/dapp-kit';

function SwapStatus({ txHash, srcChainKey }: { txHash: string; srcChainKey: string }) {
  const { data } = useSwapsApiSubmitTxStatus({ params: { txHash, srcChainKey } });
  return <span>{data?.data?.status ?? 'idle'}</span>;
}
```

## Default Polling

| Hook | Interval |
|------|---------|
| `useBackendIntentByTxHash` | 1s |
| `useSwapsApiSubmitTxStatus` | 1s (stops on `solved` / `failed`) |
| `useBackendOrderbook` | none (`staleTime: 30s`, no auto-refetch) |
| Others | No auto-refresh |
