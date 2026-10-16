# Oracle API

Two complementary price surfaces:

| Surface | Path | Best for |
|---------|------|----------|
| **Candles** | `GET /v1/be/oracle/*` | Charts (candlestick / line) with fixed intervals |
| **Solver oracle** | `GET /v1/intent/oracle` | Live USD mark prices used by the solver (per chain + token) |

Both are **unauthenticated** `GET`s. Quote currency for candles is always **USD**. Prices in candle responses are **decimal strings**.

TypeScript consumers can call the candle endpoints through `@sodax/sdk` instead of `fetch` — `sodax.backendApi.getOracleMarkets()` and `sodax.backendApi.getOracleCandles({ symbol, interval, from, to })` return the same payloads, `Result`-wrapped and schema-validated. The solver oracle has no SDK wrapper.

## Base URL

```
https://api.sodax.com/v1/be
```

Canary host: `https://canary-api.sodax.com/v1/be` (oracle reads are served from the same production candle store).

---

## Discover markets

```http
GET /v1/be/oracle/markets
```

```bash
curl -s 'https://api.sodax.com/v1/be/oracle/markets'
```

**Example response**

```json
{
  "quote": "USD",
  "intervals": [
    { "key": "1m", "label": "1 minute",  "seconds": 60 },
    { "key": "5m", "label": "5 minutes", "seconds": 300 },
    { "key": "1h", "label": "1 hour",    "seconds": 3600 },
    { "key": "1d", "label": "1 day",     "seconds": 86400 }
  ],
  "symbols": ["BTC", "ETH", "SOL", "USDC", "…"]
}
```

| Field | Description |
|-------|-------------|
| `quote` | Always `"USD"`. |
| `intervals[].key` | Value for the `interval` query param on `/candles`. |
| `symbols` | Canonical symbols that have candle data (alphabetical). |

Use this to populate a symbol picker and interval switcher.

---

## Fetch candles

```http
GET /v1/be/oracle/candles?symbol=ETH&interval=1h&from=1782234000&to=1782241200
```

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `symbol` | string | yes | From `/oracle/markets` (e.g. `ETH`) |
| `interval` | string | yes | `1m` · `5m` · `1h` · `1d` |
| `from` | integer | yes | Start time, **UNIX seconds**, **inclusive** |
| `to` | integer | yes | End time, **UNIX seconds**, **exclusive** |

`to` is exclusive: range `[from, to)` returns buckets whose start falls inside the half-open interval.

```bash
NOW=$(date +%s)
FROM=$((NOW - 86400))
curl -s "https://api.sodax.com/v1/be/oracle/candles?symbol=ETH&interval=1h&from=${FROM}&to=${NOW}"
```

**Example response**

```json
{
  "symbol": "ETH",
  "quote": "USD",
  "interval": "1h",
  "candles": [
    {
      "timestamp": 1782234000,
      "open": "1665.57",
      "high": "1666.22",
      "low": "1663.01",
      "close": "1665.02"
    },
    {
      "timestamp": 1782237600,
      "open": "1665.02",
      "high": "1670.40",
      "low": "1664.88",
      "close": "1669.13",
      "final": false
    }
  ]
}
```

| Field | Description |
|-------|-------------|
| `timestamp` | Bucket **start**, UNIX seconds. A `1h` candle at `T` covers `[T, T+3600)`. |
| `open` / `high` / `low` / `close` | USD prices as decimal strings. |
| `final` | Present and `false` **only** on the still-forming current bucket. Closed candles omit the field. |

### Conventions

- Candles are ordered **oldest first**.
- The last candle may still be forming — re-poll while `"final": false`.
- **No volume** — candles are sampled from the SODAX price feed, not trade flow.
- A valid range with no stored candles returns **`200` with `"candles": []`**. Render gaps gracefully.
- An unknown symbol also currently returns **`200` with `"candles": []`** rather than `404`. Use `/oracle/markets` when you need to validate the symbol first.
- Max **5000 candles** per request; wider ranges return `400`.
- Responses are cached ~**10 seconds**.

### Chart adapter (JavaScript)

```js
const base = 'https://api.sodax.com/v1/be';
const now = Math.floor(Date.now() / 1000);
const from = now - 24 * 3600;

const res = await fetch(
  `${base}/oracle/candles?symbol=ETH&interval=1h&from=${from}&to=${now}`
);
const { candles } = await res.json();

const series = candles.map((c) => ({
  time: c.timestamp,
  open: Number(c.open),
  high: Number(c.high),
  low: Number(c.low),
  close: Number(c.close),
}));
```

---

## Solver oracle (live prices)

Live USD marks used by the solver, keyed by token address and chain id.

```http
GET /v1/intent/oracle
```

```bash
curl -s 'https://api.sodax.com/v1/intent/oracle' | head
```

**Example item**

```json
{
  "address": "0x…",
  "chainId": "146",
  "symbol": "WETH",
  "priceUsd": 1886.65,
  "decimals": 18,
  "updatedAt": 1786506324836
}
```

| Field | Description |
|-------|-------------|
| `address` | Token address on that chain |
| `chainId` | Numeric chain id as string (`"146"` = Sonic hub) |
| `priceUsd` | Live USD price (JSON number) |
| `updatedAt` | Feed timestamp (ms) |

**When to use which**

| Need | Use |
|------|-----|
| Historical chart / OHLC | `/v1/be/oracle/candles` |
| “What’s the mark right now?” for hub assets | `/v1/intent/oracle` |
| Swap quote | Prefer `POST /v1/swaps/quote` or solver `POST /v1/intent/quote` — not the oracle alone |

Quotes for swaps should go through the [Swaps API](https://docs.sodax.com/developers/http-api/swaps) or the SDK. The solver oracle is for display, sanity checks, and tooling — not a substitute for a firm quote.

---

## Errors

| Situation | Result |
|-----------|--------|
| Missing / invalid query params | `400` |
| Unknown interval | `400` |
| Unknown symbol | `200` + empty `candles` array |
| Zero-width or reversed range (`from >= to`) | `400` |
| Range wider than 5000 candles | `400` |
| Valid range with no stored candles | `200` + empty `candles` array |
