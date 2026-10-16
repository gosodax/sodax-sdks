---
title: "Relayer API Endpoints"
icon: network-wired
generatedFrom: packages/sdk/docs/RELAYER_API_ENDPOINTS.md
---

> **Error handling conventions:** Relay-layer failures emit one of these stable strings on `error.message`: `'SUBMIT_TX_FAILED'`, `'RELAY_TIMEOUT'`, or `'RELAY_POLLING_FAILED'`, also exported as `RELAY_ERROR_CODES` from `@sodax/sdk`. Only `dex` propagates these errors raw; every other feature module (moneyMarket, bridge, staking, migration, leverageYield, swap) routes them through `mapRelayFailure` into a typed `SodaxError` with `context.relayCode`. The **swap module** wraps them into `SodaxError<SwapErrorCode>` with `context.relayCode` (see [SWAPS.md](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/SWAPS.md) Error Handling).

The intent relay service bridges spoke-chain transactions to the SODAX hub (Sonic). All cross-chain operations — swaps, bridges, money market deposits/withdrawals, staking — submit a spoke-chain transaction hash to the relay, then poll until the hub confirms execution.

## Mainnet

URL: `https://api.sodax.com/v1/relay`

This is the default value of `DEFAULT_RELAYER_API_ENDPOINT` (exported from `@sodax/sdk`). It is set automatically in `relayConfig.relayerApiEndpoint` and picked up by `ConfigService` — no manual configuration is needed unless you are overriding the endpoint.

## Testnet

There is no testnet relayer endpoint for integrators. SODAX is mainnet-only: `ChainKeys` contains
only `*_MAINNET` entries, and there are no testnet chain configs or RPC endpoints in the SDK. Build
and test against mainnet with small amounts — see [Testing without a testnet](https://github.com/icon-project/sodax-sdks/blob/main/docs/developers/how-to/testnet.md).

---

## SDK integration

`IntentRelayApiService` (`packages/sdk/src/shared/services/intentRelay/IntentRelayApiService.ts`) is an **internal** module. Callers never construct it directly. The relay is accessed through high-level service methods:

- `sodax.swaps.createIntent(...)` — submits the spoke tx and waits for hub execution internally
- `sodax.bridge.bridge(...)` — similarly manages the full relay lifecycle
- `sodax.moneyMarket.*`, `sodax.staking.*`, and related methods do the same

All of these methods return `Promise<Result<T>>`. They route relay failures through `mapRelayFailure`, so the `Result` carries a typed `SodaxError` — discriminate on `error.code`, and read the raw relay string from `context.relayCode`. Do **not** match on `error.message`: the mapper replaces it with prose.

| Raw relay string | `error.code` | `context.relayCode` |
|---|---|---|
| `SUBMIT_TX_FAILED` | `TX_SUBMIT_FAILED` | `SUBMIT_TX_FAILED` |
| `RELAY_TIMEOUT` | `RELAY_TIMEOUT` | `RELAY_TIMEOUT` |
| `RELAY_POLLING_FAILED` | `RELAY_FAILED` | `RELAY_POLLING_FAILED` |
| anything else | `RELAY_FAILED` | `UNKNOWN` |

Raw `error.message` matching applies only where nothing maps the failure: the `sodax.dex.*` relay legs, and the exported helpers `relayTxAndWaitPacket`, `submitTransaction` and `waitUntilIntentExecuted` when a consumer calls them directly. Those still carry the `RELAY_ERROR_CODES` strings on `error.message`.

---

## Chain IDs used by the relay

The relay API identifies chains by **`IntentRelayChainId`** — a `bigint` value that is distinct from the `ChainKeys.*` string keys used everywhere else in the SDK.

Use `getIntentRelayChainId(chainKey)` (exported from `@sodax/sdk`) to convert a `SpokeChainKey` to its relay chain ID. The SDK does this conversion internally; callers only need it when constructing raw relay requests directly (advanced usage).

Full mapping (`RelayChainIdMap` in `@sodax/sdk`):

| Chain key (`ChainKeys.*`) | Relay chain ID |
|---|---|
| `AVALANCHE_MAINNET` | `6n` |
| `ARBITRUM_MAINNET` | `23n` |
| `BASE_MAINNET` | `30n` |
| `BSC_MAINNET` | `4n` |
| `INJECTIVE_MAINNET` | `19n` |
| `SONIC_MAINNET` | `146n` |
| `OPTIMISM_MAINNET` | `24n` |
| `POLYGON_MAINNET` | `5n` |
| `SOLANA_MAINNET` | `1n` |
| `SUI_MAINNET` | `21n` |
| `STELLAR_MAINNET` | `27n` |
| `ICON_MAINNET` | `1768124270n` |
| `HYPEREVM_MAINNET` | `26745n` |
| `LIGHTLINK_MAINNET` | `27756n` |
| `NEAR_MAINNET` | `15n` |
| `ETHEREUM_MAINNET` | `2n` |
| `BITCOIN_MAINNET` | `627463n` |
| `REDBELLY_MAINNET` | `726564n` |
| `KAIA_MAINNET` | `27489n` |
| `HEDERA_MAINNET` | `18501n` |
| `ROBINHOOD_MAINNET` | `21071n` |
| `STACKS_MAINNET` | `60n` |

---

## Relay API actions

All requests are JSON `POST` to the relay URL. The `action` field selects the operation.

### `submit` — submit a transaction for relaying

```ts
// TypeScript type (from IntentRelayApiService.ts)
type SubmitTxParams = {
  chain_id: string;   // relay chain ID as a decimal string (e.g. "2" for Ethereum)
  tx_hash: string;    // spoke-chain transaction hash
  data?: RelayExtraData; // required only for Solana and Bitcoin (split-tx chains)
};
```

`RelayExtraData` (`{ address: Hex; payload: Hex }`) carries the hub destination address and the full call payload. Solana and Bitcoin use split transactions: the on-chain tx stores only a verification hash; the full call data is submitted off-chain here.

```
curl --location 'https://api.sodax.com/v1/relay/' \
--header 'Content-Type: application/json' \
--data '{
    "action": "submit",
    "params": {
        "chain_id": "2",
        "tx_hash": "0x882370113410cf4db551d89f2a8dc1819a2e4d9e1d5efe19068156d3ff1b91b7"
    }
}'
```

Response (`SubmitTxResponse`):

```json
{ "success": true, "message": "..." }
```

### `get_transaction_packets` — poll for relay packets by tx hash

```ts
type GetTransactionPacketsParams = {
  chain_id: string;
  tx_hash: string;
};
```

```
curl --location 'https://api.sodax.com/v1/relay/' \
--header 'Content-Type: application/json' \
--data '{
    "action": "get_transaction_packets",
    "params": {
        "chain_id": "2",
        "tx_hash": "0x882370113410cf4db551d89f2a8dc1819a2e4d9e1d5efe19068156d3ff1b91b7"
    }
}'
```

Response (`GetTransactionPacketsResponse`):

```ts
type RelayTxStatus = 'pending' | 'validating' | 'executing' | 'executed';

type PacketData = {
  src_chain_id: number;
  src_tx_hash: string;
  src_address: string;
  status: RelayTxStatus;
  dst_chain_id: number;
  conn_sn: number;
  dst_address: string;
  dst_tx_hash: string;   // hub-chain tx hash — use this for subsequent solver queries
  signatures: string[];
  payload: string;
};

type GetTransactionPacketsResponse = {
  success: boolean;
  data: PacketData[];
};
```

The packet is complete when `status === 'executed'`. Use `dst_tx_hash` as the hub-chain transaction hash for subsequent solver interactions.

### `get_packet` — fetch a single packet by connection serial number

```ts
type GetPacketParams = {
  chain_id: string;
  tx_hash: string;
  conn_sn: string;   // connection serial number
};
```

```
curl --location 'https://api.sodax.com/v1/relay/' \
--header 'Content-Type: application/json' \
--data '{
    "action": "get_packet",
    "params": {
        "chain_id": "2",
        "tx_hash": "0x882370113410cf4db551d89f2a8dc1819a2e4d9e1d5efe19068156d3ff1b91b7",
        "conn_sn": "169"
    }
}'
```

Response (`GetPacketResponse`):

```ts
type GetPacketResponse =
  | { success: true; data: PacketData }
  | { success: false; message: string };
```

---

## Low-level functions (advanced usage)

These are exported from `IntentRelayApiService` for callers that need direct relay access (e.g. custom orchestration, bots):

| Function | Signature | Description |
|---|---|---|
| `submitTransaction` | `(payload, apiUrl) => Promise<Result<SubmitTxResponse>>` | Submit a tx to the relay. |
| `getTransactionPackets` | `(payload, apiUrl, timeoutMs?) => Promise<Result<GetTransactionPacketsResponse>>` | Fetch packets for a tx hash. `timeoutMs` bounds the whole read — connection, retries and body parse. Omit it and the call is unbounded; `RELAY_REQUEST_TIMEOUT_MS` (15s) is the per-request budget the polling path uses. |
| `getPacket` | `(payload, apiUrl) => Promise<Result<GetPacketResponse>>` | Fetch a single packet by `conn_sn`. |
| `waitUntilIntentExecuted` | `(payload) => Promise<Result<PacketData>>` | Poll until a packet reaches `'executed'` status or times out. |
| `relayTxAndWaitPacket` | `(params: RelayAndWaitParams) => Promise<Result<PacketData>>` | Submit + poll in one call. Handles `getIntentRelayChainId` conversion and split-tx chains automatically. |

All functions return `Promise<Result<T>>` — no throws across service boundaries. Check `result.ok` before using `result.value`. On failure, `result.error` is an `Error` instance:
- `result.error.message === 'RELAY_TIMEOUT'` — packet did not arrive within the timeout (default: 120 000 ms); polling worked, the relay just didn't deliver in time
- `result.error.message === 'SUBMIT_TX_FAILED'` — the relay rejected the submission (HTTP error, malformed response, or `success: false`); check `result.error.cause.message` for the relay's rejection reason
- `result.error.message === 'RELAY_POLLING_FAILED'` — polling itself never recovered (persistent network errors or exceptions during the wait window); the packet's status is unknown. Check `result.error.cause` for details

`RelayAndWaitParams`:

```ts
type RelayAndWaitParams = {
  srcTxHash: string;
  // `RelayExtraData` ({ address, payload }) for split-tx chains. Bitcoin on-demand
  // borrow/withdraw instead passes the signed payload as an `OnDemandRelayData` JSON object.
  data: RelayExtraData | OnDemandRelayData;
  chainKey: SpokeChainKey;      // e.g. ChainKeys.ETHEREUM_MAINNET
  relayerApiEndpoint: HttpUrl;  // relay base URL
  timeout: number | undefined;  // ms; defaults to DEFAULT_RELAY_TX_TIMEOUT (120 000 ms)
  // Identity used to poll `get_transaction_packets` when it differs from the submit `srcTxHash`
  // (Bitcoin on-demand). Defaults to `srcTxHash` for every other flow.
  pollTxHash?: string;
};
```

Example:

```ts
import { relayTxAndWaitPacket, getIntentRelayChainId } from '@sodax/sdk';
import { ChainKeys, DEFAULT_RELAY_TX_TIMEOUT } from '@sodax/sdk';

// relayData comes from the preceding spoke operation (createIntent / createBridgeIntent).
// It is always required — for non-Solana/Bitcoin chains it is accepted but not forwarded
// to the relay submit payload.
const result = await relayTxAndWaitPacket({
  srcTxHash: '0x...',
  data: relayData,  // RelayExtraData from the preceding spoke operation
  chainKey: ChainKeys.ETHEREUM_MAINNET,
  relayerApiEndpoint: 'https://api.sodax.com/v1/relay',
  timeout: DEFAULT_RELAY_TX_TIMEOUT,
});

if (!result.ok) {
  if (result.error instanceof Error && result.error.message === 'RELAY_TIMEOUT') {
    // timed out waiting for hub execution
  }
  return;
}

const hubTxHash = result.value.dst_tx_hash;
```
