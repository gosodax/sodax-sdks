---
title: "Backend API"
icon: plug
generatedFrom: packages/sdk/docs/BACKEND_API.md
---

The `BackendApiService` provides a comprehensive HTTP client for the SODAX backend API, covering intent lookup, swap submission, solver orderbook, money market data, USD OHLC price candles, and runtime configuration. It implements `IConfigApiV1` so that `ConfigService` and other services can fetch dynamic chain/token configuration without coupling to a concrete HTTP implementation.

The service is automatically instantiated when you create a `Sodax` instance and is available as `sodax.backendApi`.

All public methods return `Promise<Result<T>>` — they never throw. On network failure, timeout, or a non-2xx HTTP response the returned `Result` has `ok: false` with a descriptive `Error` in the `error` field.

## Table of Contents

- [Initialization](#initialization)
- [Configuration](#configuration)
- [Result\<T\> and Error Handling](#resultt-and-error-handling)
- [Intent Endpoints](#intent-endpoints)
- [Swap Endpoints](#swap-endpoints)
- [Solver Endpoints](#solver-endpoints)
- [Money Market Endpoints](#money-market-endpoints)
- [Oracle Endpoints](#oracle-endpoints)
- [Config Endpoints](#config-endpoints)
- [Utility Methods](#utility-methods)
- [Complete Example](#complete-example)
- [Notes](#notes)

## Initialization

`BackendApiService` is automatically created when you construct a `Sodax` instance. Access it via `sodax.backendApi`.

### Basic Initialization

```typescript
import { Sodax } from '@sodax/sdk';

const sodax = new Sodax();
const backendApi = sodax.backendApi;
```

### Custom Configuration

```typescript
import { Sodax } from '@sodax/sdk';

const sodax = new Sodax({
  api: {
    baseURL: 'https://your-custom-api-endpoint.com',
    timeout: 60000, // 60 seconds
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Custom-Header': 'custom-value',
    },
  },
});

const backendApi = sodax.backendApi;
```

### Initialization with `sodax.config`

If you need dynamic chain/token config fetched from the backend, call `initialize()` on `ConfigService` after construction. `BackendApiService` is the underlying HTTP transport that `ConfigService` uses.

```typescript
const sodax = new Sodax();
const result = await sodax.config.initialize();
if (!result.ok) {
  console.error('Config initialization failed:', result.error);
}
```

## Configuration

### `ApiConfig` Type

`ApiConfig` is either a flat `BackendApiConfig` (shared by `sodax.backendApi` and the swaps client `sodax.api.swaps`) or a nested `CustomApiConfig` that points the swaps API at its own endpoint:

```typescript
type BaseApiConfig = {
  baseURL: string;                   // Gateway ROOT — origin + version prefix (default: 'https://api.sodax.com/v1')
  timeout: number;                   // Request timeout in milliseconds (default: 30000)
  headers: Record<string, string>;   // Request headers (default: Content-Type and Accept)
};

// The backend data API's routes are mounted below the gateway root; `basePath` is that mount.
type BackendApiConfig = BaseApiConfig & { basePath?: string }; // default: '/be'

// Point the swaps and/or sponsoring APIs at their own hosts, separate from the base backend API
// (at least one slice required). Only sponsoring carries a slice `apiKey` — it is routed
// independently, so it owns its credential; every other service takes the instance-wide key.
type SwapsApiConfig = BaseApiConfig;
type SponsoringApiConfig = BaseApiConfig & { apiKey?: string };

type CustomApiConfig =
  | { baseApiConfig: BackendApiConfig; swapsApiConfig?: SwapsApiConfig; sponsoringApiConfig?: SponsoringApiConfig }
  | { baseApiConfig?: BackendApiConfig; swapsApiConfig: SwapsApiConfig; sponsoringApiConfig?: SponsoringApiConfig }
  | { baseApiConfig?: BackendApiConfig; swapsApiConfig?: SwapsApiConfig; sponsoringApiConfig: SponsoringApiConfig };

type ApiConfig = BackendApiConfig | CustomApiConfig;
```

**`baseURL` is the gateway root, never a service path.** Every service resolves the same root and appends
its own path below it — `/be` here, `/swaps` for the swaps client, `/bridge` for the bridge client,
`/leverage-yield` for the leverage-yield client, `/sponsorships/stellar` for sponsoring. A `baseURL` ending in `/be` is trimmed with a warning: that was
the previous packaged default, and inheriting it nested the sibling services a level too deep
(`/v1/be/swaps/submit-tx`). See
[CONFIGURE_SDK.md](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/CONFIGURE_SDK.md)
for the full URL model.

`basePath` is read only by `sodax.backendApi`. Set it to `''` when addressing a backend directly at its
origin instead of through the gateway (`{ baseURL: 'http://localhost:4000', basePath: '' }` →
`http://localhost:4000/config/all`).

Slices layer on top of the flat fields rather than replacing them: an `api` object that carries both a
top-level `baseURL`/`timeout`/`headers` and a slice keeps applying those flat values wherever the slice
does not define its own, so adding `swapsApiConfig` or `sponsoringApiConfig` to an existing flat config
never silently re-routes the base API back to the packaged default. The resolution order is
defaults → top-level flat fields → `baseApiConfig` → `swapsApiConfig`, so the most specific slice wins
per field.

The sponsoring slice resolves differently from the others on purpose: its `baseURL` never inherits
from `baseApiConfig` (it defaults to the same gateway root but reaches it independently, so pointing the
base API at a private proxy never drags sponsoring along), and neither do
its `headers` — a credential is scoped to the origin it was set for, so a base-API token is not
transmitted to the sponsoring host. `timeout` does inherit. For the same reason,
`backendApi.setHeaders(...)` reaches `swaps` but NOT `sponsoring`; set sponsoring headers on the
slice, or via `sodax.api.sponsoring.setHeaders(...)`.

### API key

There is one instance-wide backend key: `new Sodax({ apiKey })`, sent as `x-api-key` on this client,
`sodax.api.swaps`, `sodax.api.bridge`, and `sodax.api.leverageYield`. Override it for a single call with
`apiKey` on the trailing `RequestOverrideConfig`. The key follows a per-call `baseURL` override on these
gateway clients too —
including a plaintext local target — so point one only at a trusted SODAX-related deployment.
Sponsoring is the exception — its slice key wins there, and the instance-wide
key reaches it only when the call targets a SODAX gateway root. See
[CONFIGURE_SDK.md § API key](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/CONFIGURE_SDK.md#api-key)
for the full precedence order. The key belongs server-side; when this client runs in a browser, point
`baseURL` at your own proxy instead — see [API key good practices](https://docs.sodax.com/developers/how-to/api-key-good-practices).

### `RequestOverrideConfig` Type

Every public method accepts an optional `RequestOverrideConfig` as its last argument. These per-call overrides take precedence over the `ApiConfig` the service was constructed with.

```typescript
type RequestOverrideConfig = {
  baseURL?: string;   // gateway root; the calling service's own path still applies
  timeout?: number;
  headers?: Record<string, string>;
  apiKey?: string;    // per-call x-api-key; an explicit headers['x-api-key'] here still wins
};
```

### Default Configuration

```typescript
const DEFAULT_API_BASE_URL = 'https://api.sodax.com/v1'; // gateway root, shared by every service
const BACKEND_API_BASE_PATH = '/be';                      // this service's mount below that root
const DEFAULT_BACKEND_API_TIMEOUT = 30000; // 30 seconds
const DEFAULT_BACKEND_API_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
};
```

## Result\<T\> and Error Handling

All public methods return `Promise<Result<T>>`, defined as:

```typescript
type Result<T, E = Error | unknown> =
  | { ok: true; value: T }
  | { ok: false; error: E };
```

**Never use `try/catch` around `backendApi` calls** — errors are always captured in the `Result`.

**Response validation.** Data, token, and money-market responses are validated at runtime against valibot schemas (mirroring `sodax.api.swaps`): a 2xx body that fails the contract resolves to `EXTERNAL_API_ERROR` with `context.reason: 'invalid_response_shape'`, not a mistyped value. The config/relay reads — `getAllConfig`, `getSpokeChainConfig`, `getRelayChainIdMap` — are not schema-validated (`SodaxConfig` is too large to mirror faithfully, and `ConfigService` already version-gates and falls back to packaged defaults).

### Checking results

```typescript
const result = await sodax.backendApi.getOrderbook({ offset: '0', limit: '10' });
if (!result.ok) {
  // result.error is an Error instance
  console.error(result.error.message); // e.g. 'HTTP_REQUEST_FAILED', 'REQUEST_TIMEOUT'
  if (result.error instanceof Error && result.error.cause) {
    console.error('Underlying cause:', result.error.cause);
  }
  return;
}
console.log(result.value); // OrderbookResponse
```

### Error codes on `error.message`

| `error.message` | Meaning |
|---|---|
| `'HTTP_REQUEST_FAILED'` | Non-2xx HTTP response. Check `error.cause` for `HTTP <status>: <body>`. |
| `'REQUEST_TIMEOUT'` | Request exceeded the configured timeout. Check `error.cause` for the timeout duration. |
| `'UNKNOWN_REQUEST_ERROR'` | Any other unexpected failure. |

Those sentinels are this client's surface only. The typed sibling clients — `sodax.api.swaps` and
`sodax.api.bridge` — take their `error.message` from the wire client they wrap, so discriminate on
`error.context.code` there instead (see [Bridge Endpoints](#bridge-endpoints)).

## Intent Endpoints

### Get Intent by Transaction Hash

Retrieves swap intent details using a hub-chain transaction hash.

```typescript
const result = await sodax.backendApi.getIntentByTxHash('0x123...abc');
if (result.ok) {
  console.log(result.value); // IntentResponse
}
```

**Signature:**
```typescript
getIntentByTxHash(
  txHash: string,
  config?: RequestOverrideConfig,
): Promise<Result<IntentResponse>>
```

- **Method:** GET
- **Endpoint:** `/intent/tx/{txHash}`

**Response type:**
```typescript
interface IntentResponse {
  intentHash: string;
  txHash: string;
  logIndex: number;
  chainId: number;
  blockNumber: number;
  open: boolean;
  intent: {
    intentId: string;
    creator: string;
    inputToken: `0x${string}`;
    outputToken: `0x${string}`;
    inputAmount: string;
    minOutputAmount: string;
    deadline: string;
    allowPartialFill: boolean;
    srcChain: number;
    dstChain: number;
    srcAddress: `0x${string}`;
    dstAddress: `0x${string}`;
    solver: string;
    data: string;
  };
  events: unknown[];
}
```

### Get Intent by Intent Hash

Retrieves swap intent details using a canonical intent hash.

```typescript
const result = await sodax.backendApi.getIntentByHash('0x456...def');
```

**Signature:**
```typescript
getIntentByHash(
  intentHash: string,
  config?: RequestOverrideConfig,
): Promise<Result<IntentResponse>>
```

- **Method:** GET
- **Endpoint:** `/intent/{intentHash}`

**Response:** Same as `IntentResponse` above.

### Get User Intents

Retrieves a paginated list of all swap intents created by a specific wallet address, with optional date-range filtering.

`startDate` and `endDate` are Unix timestamps in **milliseconds**.

```typescript
const result = await sodax.backendApi.getUserIntents({
  userAddress: '0x789...ghi',
  startDate: Date.now() - 7 * 24 * 60 * 60 * 1000, // 7 days ago
  endDate: Date.now(),
  limit: '20',
  offset: '0',
});
```

**Signature:**
```typescript
getUserIntents(
  params: {
    userAddress: Address;
    startDate?: number;
    endDate?: number;
    limit?: string;
    offset?: string;
  },
  config?: RequestOverrideConfig,
): Promise<Result<UserIntentsResponse>>
```

- **Method:** GET
- **Endpoint:** `/intent/user/{userAddress}?startDate=…&endDate=…&limit=…&offset=…`

**Response type:**
```typescript
interface UserIntentsResponse {
  total: number;
  offset: number;
  limit: number;
  items: IntentResponse[];
}
```

## Swap Endpoints

Swap-tx submission and the rest of the typed Swaps API moved off `BackendApiService` onto the swaps
client — `sodax.api.swaps` (`SwapsApiService`). Submit a signed spoke-chain swap transaction with
`sodax.api.swaps.submitTx(...)` and poll it with
`sodax.api.swaps.getSubmitTxStatus({ txHash, srcChainKey })` (both fields required). See
[`SWAPS_API.md`](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/SWAPS_API.md) for the full 21-endpoint reference (quote, create-intent, submit-tx,
status, fees, …).

## Bridge Endpoints

The Bridge API is a sibling typed client — `sodax.api.bridge` (`BridgeApiService`), also reached via the
`sodax.api` alias and sharing the same backend host (`/bridge/*` sub-paths). It mirrors the swaps client
minus the solver/intent surface: allowance/approve/create-bridge-intent, submit-tx + status, tokens, and
the fee/bridgeable-amount/bridgeable discovery quotes. Submit a signed spoke-deposit with
`sodax.api.bridge.submitTx(...)` (passing the FULL `relayData { address, payload }` envelope, not just the
payload). See [`BRIDGE_API.md`](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/BRIDGE_API.md) for the full reference.

`BridgeApiService` is a thin adapter over the standalone
[`@sodax/bridge-api`](https://github.com/icon-project/sodax-sdks/tree/main/packages/bridge-api) client —
the same split as `sodax.api.swaps` over `@sodax/swaps-api` — so the wire behaviour below is shared by both:

- **Errors.** Every method returns `Result<T>` and never throws. A failure carries
  `SodaxError<'EXTERNAL_API_ERROR'>` with `feature: 'backend'`, `context.api: 'bridge'` and
  `context.endpoint`; `error.cause` is the underlying `BridgeApiError`, whose `code`
  (`NETWORK_ERROR` | `TIMEOUT_ERROR` | `HTTP_ERROR` | `PARSE_ERROR` | `VALIDATION_ERROR`) is mirrored on
  `error.context.code`, with `context.status` set for HTTP failures. Discriminate on `context.code`, not
  on the message. `BridgeApiError` and `BridgeApiErrorCode` are re-exported from `@sodax/sdk`.
- **Retries.** Idempotent calls — reads, `getSubmitTxStatus` polls, and pure-compute POSTs like `getFee` —
  replay transient failures (network errors and 408/429/5xx), up to **3 attempts** (the first try plus two
  retries) issued back to back with no delay. Mutations (`approve`, `createBridgeIntent`, `submitTx`) never
  retry, except on the API-key guard's transient verification `503`: that one is rejected before the route
  handler runs, so replaying it cannot double-apply anything, and it is the one case that backs off.
  A `timeout` bounds the whole call, retries included, and is never replayed.
- **Budgets multiply.** This wire budget is *per call*, so a caller that also retries multiplies against it.
  The `@sodax/dapp-kit` backend hooks default to three React Query retries, which is four executions of a
  query — against three wire attempts each, a persistently failing idempotent endpoint can cost up to 12
  requests before the error surfaces. A terminal API-key rejection (401/403) is never replayed at the wire
  level, and the `swapsApi`, `leverageYieldApi` and `bridgeApi` hooks stop retrying it at the query level
  too (`retryUnlessAuthFailure`). Lower either with `queryOptions.retry` (or `mutationOptions.retry`) when
  you want a tighter ceiling.

## Leverage Yield Endpoints

The Leverage Yield API is a third sibling typed client — `sodax.api.leverageYield`
(`LeverageYieldApiService`), also reached via the `sodax.api` alias and sharing the same backend host
(`/leverage-yield/*` sub-paths). A leverage-yield deposit/withdraw **is** an intent-based swap (the vault's
`lsoda*` share token is a solver-tradeable token), so its intent-relay / gas / fee / submit-tx endpoints
reuse the swaps wire shapes; what is its own is the vault registry (`getVaults` / `getVault`), the vault
reads (position, APRs, ERC-4626 previews, share balance, max-withdraw), and the split deposit/withdraw
quote + create-intent routes. `sodax.api.leverageYield.submitTx(...)` additionally carries a required
`operation: 'deposit' | 'withdraw'` discriminator — echoed back by `getSubmitTxStatus` as
`data.operation: 'leverage_deposit' | 'leverage_withdraw'` — and its terminal submit-tx status is
`'solved'` (the solver filled), not the bridge's `'executed'`. See
[`LEVERAGE_YIELD_API.md`](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/LEVERAGE_YIELD_API.md) for the full reference.

## Solver Endpoints

### Get Orderbook

Retrieves a paginated snapshot of the solver orderbook — open swap intents waiting to be filled.

```typescript
const result = await sodax.backendApi.getOrderbook({ offset: '0', limit: '10' });
if (result.ok) {
  console.log(result.value.total, result.value.data);
}
```

**Signature:**
```typescript
getOrderbook(
  params: { offset: string; limit: string },
  config?: RequestOverrideConfig,
): Promise<Result<OrderbookResponse>>
```

- **Method:** GET
- **Endpoint:** `/solver/orderbook?offset={offset}&limit={limit}`

**Response type:**
```typescript
interface OrderbookResponse {
  total: number;
  data: Array<{
    intentState: {
      exists: boolean;
      remainingInput: string;
      receivedOutput: string;
      pendingPayment: boolean;
    };
    intentData: {
      intentId: string;
      creator: string;
      inputToken: string;
      outputToken: string;
      inputAmount: string;
      minOutputAmount: string;
      deadline: string;
      allowPartialFill: boolean;
      srcChain: number;
      dstChain: number;
      srcAddress: string;
      dstAddress: string;
      solver: string;
      data: string;
      intentHash: string;
      txHash: string;
      blockNumber: number;
    };
  }>;
}
```

## Money Market Endpoints

### Get User Position

Retrieves the current money market position for a wallet address — all reserves where the user holds aTokens (supplied collateral) or variable-debt tokens (outstanding borrows).

```typescript
const result = await sodax.backendApi.getMoneyMarketPosition('0x789...ghi');
if (result.ok) {
  console.log(result.value.positions);
}
```

**Signature:**
```typescript
getMoneyMarketPosition(
  userAddress: string,
  config?: RequestOverrideConfig,
): Promise<Result<MoneyMarketPosition>>
```

- **Method:** GET
- **Endpoint:** `/moneymarket/position/{userAddress}`

**Response type:**
```typescript
interface MoneyMarketPosition {
  userAddress: string;
  positions: Array<{
    reserveAddress: string;
    aTokenAddress: string;
    variableDebtTokenAddress: string;
    aTokenBalance: string;
    variableDebtTokenBalance: string;
    blockNumber: number;
  }>;
}
```

### Get All Money Market Assets

Retrieves on-chain state snapshots for every active money market reserve asset.

```typescript
const result = await sodax.backendApi.getAllMoneyMarketAssets();
if (result.ok) {
  console.log(result.value); // MoneyMarketAsset[]
}
```

**Signature:**
```typescript
getAllMoneyMarketAssets(
  config?: RequestOverrideConfig,
): Promise<Result<MoneyMarketAsset[]>>
```

- **Method:** GET
- **Endpoint:** `/moneymarket/asset/all`

**Response type:**
```typescript
interface MoneyMarketAsset {
  reserveAddress: string;
  aTokenAddress: string;
  totalATokenBalance: string;
  variableDebtTokenAddress: string;
  totalVariableDebtTokenBalance: string;
  liquidityRate: string;
  symbol: string;
  totalSuppliers: number;
  totalBorrowers: number;
  variableBorrowRate: string;
  stableBorrowRate: string;
  liquidityIndex: string;
  variableBorrowIndex: string;
  blockNumber: number;
}
```

### Get Specific Money Market Asset

Retrieves the on-chain state snapshot for a single money market reserve asset.

```typescript
const result = await sodax.backendApi.getMoneyMarketAsset('0xabc...123');
```

**Signature:**
```typescript
getMoneyMarketAsset(
  reserveAddress: string,
  config?: RequestOverrideConfig,
): Promise<Result<MoneyMarketAsset>>
```

- **Method:** GET
- **Endpoint:** `/moneymarket/asset/{reserveAddress}`

**Response:** `MoneyMarketAsset` (same interface as above).

### Get Asset Borrowers

Retrieves a paginated list of wallets with an outstanding borrow against a specific reserve.

```typescript
const result = await sodax.backendApi.getMoneyMarketAssetBorrowers(
  '0xabc...123',
  { offset: '0', limit: '10' },
);
```

**Signature:**
```typescript
getMoneyMarketAssetBorrowers(
  reserveAddress: string,
  params: { offset: string; limit: string },
  config?: RequestOverrideConfig,
): Promise<Result<MoneyMarketAssetBorrowers>>
```

- **Method:** GET
- **Endpoint:** `/moneymarket/asset/{reserveAddress}/borrowers?offset={offset}&limit={limit}`

**Response type:**
```typescript
interface MoneyMarketAssetBorrowers {
  borrowers: string[];
  total: number;
  offset: number;
  limit: number;
}
```

### Get Asset Suppliers

Retrieves a paginated list of wallets with an active supply (aToken balance) in a specific reserve.

```typescript
const result = await sodax.backendApi.getMoneyMarketAssetSuppliers(
  '0xabc...123',
  { offset: '0', limit: '10' },
);
```

**Signature:**
```typescript
getMoneyMarketAssetSuppliers(
  reserveAddress: string,
  params: { offset: string; limit: string },
  config?: RequestOverrideConfig,
): Promise<Result<MoneyMarketAssetSuppliers>>
```

- **Method:** GET
- **Endpoint:** `/moneymarket/asset/{reserveAddress}/suppliers?offset={offset}&limit={limit}`

**Response type:**
```typescript
interface MoneyMarketAssetSuppliers {
  suppliers: string[];
  total: number;
  offset: number;
  limit: number;
}
```

### Get All Money Market Borrowers

Retrieves a paginated list of all wallet addresses that hold an active borrow position across any reserve.

```typescript
const result = await sodax.backendApi.getAllMoneyMarketBorrowers({
  offset: '0',
  limit: '10',
});
```

**Signature:**
```typescript
getAllMoneyMarketBorrowers(
  params: { offset: string; limit: string },
  config?: RequestOverrideConfig,
): Promise<Result<MoneyMarketBorrowers>>
```

- **Method:** GET
- **Endpoint:** `/moneymarket/borrowers?offset={offset}&limit={limit}`

**Response type:**
```typescript
interface MoneyMarketBorrowers {
  borrowers: string[];
  total: number;
  offset: number;
  limit: number;
}
```

## Oracle Endpoints

USD OHLC price candles for charting, served from the backend's oracle candle store. Both reads are plain `GET`s with no authentication requirement beyond the usual API key handling.

### Get Oracle Markets

Retrieves the candle store's discovery payload: the quote currency, the selectable intervals, and the canonical symbols that have candle data. Use it to populate a symbol picker and interval switcher before requesting candles.

```typescript
const result = await sodax.backendApi.getOracleMarkets();

if (result.ok) {
  const { quote, intervals, symbols } = result.value;
  console.log(quote); // 'USD'
  console.log(intervals.map(i => i.key)); // ['1m', '5m', '1h', '1d']
  console.log(symbols); // ['BTC', 'ETH', 'SOL', ...]
}
```

**Signature:**
```typescript
getOracleMarkets(
  config?: RequestOverrideConfig,
): Promise<Result<OracleMarketsResponse>>
```

- **Method:** GET
- **Endpoint:** `/oracle/markets`

**Response type:**
```typescript
type OracleCandleInterval = '1m' | '5m' | '1h' | '1d';

// Exported alongside the union: the raw list, and the guard that narrows a `key` to it.
const ORACLE_CANDLE_INTERVALS: readonly OracleCandleInterval[];
function isOracleCandleInterval(value: string): value is OracleCandleInterval;

interface OracleMarketInterval {
  // `string`, not `OracleCandleInterval` — see the note under this section.
  key: string;
  label: string;
  seconds: number;
}

interface OracleMarketsResponse {
  quote: string;
  intervals: OracleMarketInterval[];
  symbols: string[];
}
```

`intervals[].key` is typed `string` on purpose: discovery is what tells you which intervals exist, so this read stays tolerant of an interval a newer backend serves and this SDK version does not know. Membership-test it before passing it to `getOracleCandles`, which accepts only the four literals:

```typescript
import { isOracleCandleInterval } from '@sodax/sdk';

// `filter` would leave `key` as `string`; narrowing inside `flatMap` yields the union.
const selectable = result.value.intervals.flatMap(i => (isOracleCandleInterval(i.key) ? [i.key] : []));
```

`ORACLE_CANDLE_INTERVALS` is also exported if you need the raw list (to render every option, say).

### Get Oracle Candles

Retrieves USD OHLC candles for one symbol over the half-open time range `[from, to)`.

```typescript
import { isSodaxError } from '@sodax/sdk';

const now = Math.floor(Date.now() / 1000);

const result = await sodax.backendApi.getOracleCandles({
  symbol: 'ETH',
  interval: '1h',
  from: now - 86400, // last 24 hours
  to: now,
});

if (!result.ok) {
  // `result.error` is `unknown` — narrow before reading `.message` / `.context`.
  if (isSodaxError(result.error)) console.error(result.error.message, result.error.context?.status);
  return;
}

const series = result.value.candles.map(c => ({
  time: c.timestamp,
  open: Number(c.open),
  high: Number(c.high),
  low: Number(c.low),
  close: Number(c.close),
}));
```

**Signature:**
```typescript
getOracleCandles(
  params: { symbol: string; interval: OracleCandleInterval; from: number; to: number },
  config?: RequestOverrideConfig,
): Promise<Result<OracleCandlesResponse>>
```

- **Method:** GET
- **Endpoint:** `/oracle/candles?symbol={symbol}&interval={interval}&from={from}&to={to}`

**Response type:**
```typescript
interface OracleCandle {
  timestamp: number;
  open: string;
  high: string;
  low: string;
  close: string;
  final?: boolean;
}

interface OracleCandlesResponse {
  symbol: string;
  quote: string;
  interval: OracleCandleInterval;
  candles: OracleCandle[];
}
```

**Conventions:**

- `open` / `high` / `low` / `close` are USD prices as **decimal strings** — convert them yourself; never assume a JSON number.
- `timestamp` is the bucket **start** in UNIX seconds. A `1h` candle at `T` covers `[T, T + 3600)`.
- `from` and `to` are UNIX **seconds** (integers). `to` is **exclusive** and must be greater than `from`; a zero-width or reversed range returns HTTP 400.
- A request may cover at most **5000 buckets** of the requested interval. A wider range (or an invalid parameter) returns HTTP 400, which surfaces as `ok: false` with `error.message === 'HTTP_REQUEST_FAILED'` and `error.context.status === 400` (narrow with `isSodaxError(result.error)` first).
- A valid range with no stored candles resolves `ok: true` with `candles: []`. Render the gap rather than branching on an error.
- An unknown symbol also currently resolves `ok: true` with `candles: []` rather than a 404; use `getOracleMarkets()` when you need to distinguish selectable symbols before requesting data.
- Candles are ordered **oldest first**, and the last one may still be forming. Branch on the value, not the field's presence: `final === false` means still forming, so re-poll while that holds; absent (the backend's usual encoding for a closed candle) means closed.
- There is **no volume field** — candles are sampled from the SODAX price feed, not trade flow.
- `interval` on the response echoes what you sent and is validated strictly — an unrecognized value resolves `ok: false` with `error.context.reason === 'invalid_response_shape'` rather than a value outside `OracleCandleInterval`.
- Responses are cached server-side for roughly 10 seconds per distinct URL.

## Config Endpoints

These methods implement `IConfigApiV1` and are consumed internally by `ConfigService`. You generally do not call them directly — use `sodax.config` instead. They are documented here for completeness and for custom `IConfigApiV1` implementations.

| Method | Endpoint | Returns |
|---|---|---|
| `getAllConfig()` | `GET /config/all` | `GetAllConfigApiResponse` — full `SodaxConfig` bundle |
| `getChains()` | `GET /config/spoke/chains` | `GetChainsApiResponse` — array of supported `SpokeChainKey` strings |
| `getSwapTokens()` | `GET /config/swap/tokens` | `GetSwapTokensApiResponse` — `Record<SpokeChainKey, readonly XToken[]>` |
| `getSwapTokensByChainId(chainKey)` | `GET /config/swap/{chainKey}/tokens` | `GetSwapTokensByChainIdApiResponse` |
| `getMoneyMarketTokens()` | `GET /config/money-market/tokens` | `GetMoneyMarketTokensApiResponse` |
| `getMoneyMarketTokensByChainId(chainKey)` | `GET /config/money-market/{chainKey}/tokens` | `GetMoneyMarketTokensByChainIdApiResponse` |
| `getMoneyMarketReserveAssets()` | `GET /config/money-market/reserve-assets` | `GetMoneyMarketReserveAssetsApiResponse` — array of reserve `Address` strings |
| `getRelayChainIdMap()` | `GET /config/relay/chain-id-map` | `GetRelayChainIdMapApiResponse` — `SpokeChainKey → relay chain ID` map |
| `getSpokeChainConfig()` | `GET /config/spoke/all-chains-configs` | `GetSpokeChainConfigApiResponse` — full `SpokeChainConfigMap` |

All methods accept an optional `RequestOverrideConfig` as their last argument and return `Promise<Result<T>>`.

## Utility Methods

### Set Custom Headers

Merges additional headers into the service's default header set. Useful for injecting authentication tokens or tracing headers at runtime without constructing a new service instance.

```typescript
sodax.backendApi.setHeaders({
  'Authorization': 'Bearer new-token',
  'X-Trace-Id': 'req-abc123',
});
```

### Get Base URL

Returns the gateway root the service is currently pointing at, and the data API's mount below it.
Requests go to `getBaseURL() + getBasePath() + <route>`.

```typescript
console.log('Gateway root:', sodax.backendApi.getBaseURL()); // 'https://api.sodax.com/v1'
console.log('Data API mount:', sodax.backendApi.getBasePath()); // '/be'
```

## Complete Example

```typescript
import { Sodax } from '@sodax/sdk';

async function example() {
  const sodax = new Sodax({
    api: {
      baseURL: 'https://api.sodax.com/v1',
      timeout: 60000,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Authorization': 'Bearer your-api-token',
      },
    },
  });

  // Get solver orderbook
  const orderbookResult = await sodax.backendApi.getOrderbook({ offset: '0', limit: '5' });
  if (!orderbookResult.ok) {
    console.error('Orderbook error:', orderbookResult.error.message);
    return;
  }
  console.log('Orderbook:', orderbookResult.value);

  // Get user's money market position
  const positionResult = await sodax.backendApi.getMoneyMarketPosition('0x789...ghi');
  if (!positionResult.ok) {
    console.error('Position error:', positionResult.error.message);
    return;
  }
  console.log('User Position:', positionResult.value);

  // Get all money market assets
  const assetsResult = await sodax.backendApi.getAllMoneyMarketAssets();
  if (!assetsResult.ok) {
    console.error('Assets error:', assetsResult.error.message);
    return;
  }
  console.log('Available Assets:', assetsResult.value);

  // Get intent by transaction hash
  const intentResult = await sodax.backendApi.getIntentByTxHash('0x123...abc');
  if (!intentResult.ok) {
    console.error('Intent error:', intentResult.error.message);
    if (intentResult.error instanceof Error && intentResult.error.cause) {
      console.error('Cause:', intentResult.error.cause);
    }
    return;
  }
  console.log('Intent Details:', intentResult.value);
}

example();
```

## Notes

- All string amounts in responses are in wei format (18 decimals) unless the specific field description says otherwise.
- Pagination parameters (`offset` and `limit`) are strings, not numbers.
- All endpoints return JSON responses.
- Error messages follow the CODE form (`SCREAMING_SNAKE_CASE`) for transport failures (`HTTP_REQUEST_FAILED`, `REQUEST_TIMEOUT`). Check `error.cause` for the underlying detail.
- `XToken.chainKey` is the field used on token objects to identify the chain (not `xChainId`).
- Chain constants are accessed via `ChainKeys.*` (e.g. `ChainKeys.ETHEREUM_MAINNET`), not legacy `*_CHAIN_ID` constants.
