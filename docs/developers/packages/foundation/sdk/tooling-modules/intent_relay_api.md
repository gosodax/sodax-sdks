---
title: "Intent Relay API"
icon: tower-broadcast
generatedFrom: packages/sdk/docs/INTENT_RELAY_API.md
---

## Intent Relay API Service

> **Error handling conventions:** Failures from `submitTransaction` / `relayTxAndWaitPacket` follow the **relay-layer contract**: `error.message` is one of the literal strings exported as `RELAY_ERROR_CODES` (`'SUBMIT_TX_FAILED'`, `'RELAY_TIMEOUT'`, `'RELAY_POLLING_FAILED'`). Only `dex` propagates these errors raw; every other feature module (moneyMarket, bridge, staking, migration, leverageYield, swap) routes them through `mapRelayFailure` into a typed `SodaxError` with `context.relayCode`. The **swap module** wraps them into `SodaxError<SwapErrorCode>` with `context.relayCode` (see [SWAPS.md](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/SWAPS.md) Error Handling).

The Intent Relay API Service provides functionality for submitting transactions and retrieving transaction packets across different chains. This service is part of the cross-chain communication infrastructure.

Source: `packages/sdk/src/shared/services/intentRelay/IntentRelayApiService.ts`

### Available Actions

1. `submit` — Submit a transaction to the intent relay service.
2. `get_transaction_packets` — Get all packets associated with a transaction.
3. `get_packet` — Get a specific packet by connection sequence number.

### Transaction Status Types

- `pending` — No signatures yet.
- `validating` — Not enough signatures collected.
- `executing` — Enough signatures collected, no confirmed destination tx hash yet.
- `executed` — Has a confirmed destination transaction hash.

### Chain IDs vs Chain Keys

The relay API uses its own numeric chain ID space (`IntentRelayChainId`) — bigint values defined in `RelayChainIdMap` — that is **distinct** from the `SpokeChainKey` string keys used everywhere else in the SDK. For example, Sonic's relay chain ID is `146n` while its chain key is `ChainKeys.SONIC_MAINNET`.

Use `getIntentRelayChainId(chainKey)` (from `@sodax/sdk`) to convert a `SpokeChainKey` to its `IntentRelayChainId`. The relay API wire format expects these IDs serialized as strings (call `.toString()` before passing them in `chain_id` fields).

`PacketData` fields `src_chain_id` and `dst_chain_id` are returned as `number` by the relay API; use `getChainKeyFromRelayChainId()` to convert back to a `SpokeChainKey` if needed.

### Result\<T\> Return Types

All public functions in this module return `Promise<Result<T>>`:

```ts
type Result<T> = { ok: true; value: T } | { ok: false; error: Error | unknown };
```

On failure, check `result.error.message` for CODE-form errors such as `'SUBMIT_TX_FAILED'` or `'RELAY_TIMEOUT'`. Check `result.error.cause` for the underlying error when present. There are no typed error discriminators (`RelayError`, etc.) — those have been removed.

### High-Level Entry Point: `relayTxAndWaitPacket`

For most use cases, call `relayTxAndWaitPacket` rather than invoking `submitTransaction` / `waitUntilIntentExecuted` separately. It submits the transaction and polls until the relay packet reaches `'executed'` status.

```typescript
import { relayTxAndWaitPacket } from '@sodax/sdk';
import { ChainKeys } from '@sodax/sdk';

// relayData ({ address, payload }) comes from the preceding spoke operation,
// e.g. createIntent() or createBridgeIntent() returns { tx, relayData }.
// It is always required — pass it through even for non-Solana/Bitcoin chains.
const result = await relayTxAndWaitPacket({
  srcTxHash: '0x123...',
  data: relayData,          // RelayExtraData from the preceding spoke operation
  chainKey: ChainKeys.ETHEREUM_MAINNET,
  relayerApiEndpoint: 'https://api.example.com/relay' as HttpUrl,
  timeout: 120_000,         // optional; defaults to DEFAULT_RELAY_TX_TIMEOUT (120 s)
});

if (!result.ok) {
  if (result.error instanceof Error && result.error.message === 'RELAY_TIMEOUT') {
    // packet did not arrive within timeout
  }
  // handle other errors via result.error.message / result.error.cause
  return;
}

const packet = result.value; // PacketData — status === 'executed'
console.log('hub tx hash:', packet.dst_tx_hash);
```

**Solana and Bitcoin note:** These chains use split transactions — the on-chain tx carries only a verification hash, while the full call data is submitted off-chain via the relayer. Pass a `RelayExtraData` object as `data`:

```typescript
const result = await relayTxAndWaitPacket({
  srcTxHash: '5xL...',
  data: { address: '0xabc...', payload: '0xcafe...' }, // required for Solana/Bitcoin
  chainKey: ChainKeys.SOLANA_MAINNET,
  relayerApiEndpoint: 'https://api.example.com/relay' as HttpUrl,
  timeout: undefined, // use default
});
```

### Low-Level API Examples

#### Submit Transaction

```typescript
import { submitTransaction } from '@sodax/sdk';

const request = {
  action: 'submit',
  params: {
    chain_id: '146',    // IntentRelayChainId as string — use getIntentRelayChainId(chainKey).toString()
    tx_hash: '0x123',
  },
} satisfies IntentRelayRequest<'submit'>;

const result = await submitTransaction(request, 'https://api.example.com/relay' as HttpUrl);

if (!result.ok) {
  // result.error.message === 'SUBMIT_TX_FAILED' on relay rejection
  // result.error.cause contains the underlying relay error message
  return;
}
// result.value: SubmitTxResponse
// { success: true, message: 'Transaction registered' }
```

#### Get Transaction Packets

```typescript
import { getTransactionPackets } from '@sodax/sdk';

const request = {
  action: 'get_transaction_packets',
  params: {
    chain_id: '146',
    tx_hash: '0x123',
  },
} satisfies IntentRelayRequest<'get_transaction_packets'>;

const result = await getTransactionPackets(request, 'https://api.example.com/relay' as HttpUrl);

if (!result.ok) return;
// result.value: GetTransactionPacketsResponse
// {
//   "success": true,
//   "data": [
//     {
//       "src_chain_id": 6,
//       "src_tx_hash": "0x23a7eae34f6acf5cfadc43e714a4d188b0d6526b95c82c9b969e69d7222df5de",
//       "src_address": "a8e168789b1fa96de2fb816df56757ad950438a4",
//       "status": "executed",
//       "dst_chain_id": 146,
//       "conn_sn": 54,
//       "dst_address": "67a8cf2543a30b292a443430df213983951dca08",
//       "dst_tx_hash": "0xd7f1cf40154d3123eda3a94622bae13d879307fd3526cb45dd50951fee9cd244",
//       "signatures": [
//         "c172723dba3aec0f98d6602fcfbbcae9873ce3f4fc0eded70d64b6ad3f7806aa0b22d0fa3ea57679ec05f8c51a8562c9c979d247330966e9aaaf34a4dfae64e001"
//       ],
//       "payload": "cafebabe"
//     }
//   ]
// }
```

#### Get Packet

```typescript
import { getPacket } from '@sodax/sdk';

const request = {
  action: 'get_packet',
  params: {
    chain_id: '146',
    tx_hash: '0x123...abc',
    conn_sn: '54',
  },
} satisfies IntentRelayRequest<'get_packet'>;

const result = await getPacket(request, 'https://api.example.com/relay' as HttpUrl);

if (!result.ok) return;
// result.value: GetPacketResponse
// On success:
// {
//   "success": true,
//   "data": {
//     "src_chain_id": 6,
//     "src_tx_hash": "0x781554a94bbd2ebd79ebaa01c645781ddf46610e5f1af8e5735d58b95ca6fbd6",
//     "src_address": "1d790ac96a0da4c249fd8838a7cc46b91fee3c5a",
//     "status": "executing",
//     "dst_chain_id": 21,
//     "dst_address": "0x26f83c5996f79229ef16cf7ca49eeb8682535e81ab59c30e561cc317bcc96a4a::sampledapp::...",
//     "conn_sn": 14,
//     "signatures": ["c172723dba3aec0f98d6602fcfbbcae9873ce3f4fc0eded70d64b6ad3f7806aa0b22d0fa3ea57679ec05f8c51a8562c9c979d247330966e9aaaf34a4dfae64e001"],
//     "payload": "cafebabe"
//   }
// }
```

### Type Definitions

All types are exported from `packages/sdk/src/shared/services/intentRelay/IntentRelayApiService.ts`.

```typescript
export type RelayTxStatus = 'pending' | 'validating' | 'executing' | 'executed';

export type RelayAction = 'submit' | 'get_transaction_packets' | 'get_packet';

// chain_id is always a string representation of an IntentRelayChainId bigint value
export type IntentRelayRequest<T extends RelayAction> = {
  action: T;
  params: T extends 'submit'
    ? { chain_id: string; tx_hash: string; data?: RelayExtraData | OnDemandRelayData }
    : T extends 'get_transaction_packets'
      ? { chain_id: string; tx_hash: string }
      : T extends 'get_packet'
        ? { chain_id: string; tx_hash: string; conn_sn: string }
        : never;
};

// Extra data required for Solana and Bitcoin split-tx chains
export type RelayExtraData = { address: Hex; payload: Hex };

// Signed Bitcoin on-demand payload (money-market borrow/withdraw), carried as a JSON object.
// public_key is required by the relay to verify the BIP-322 signature (not key-recoverable).
export type OnDemandRelayData = { payload_hex: string; signature?: string; public_key?: string };

export type PacketData = {
  src_chain_id: number;    // IntentRelayChainId as number (not a SpokeChainKey)
  src_tx_hash: string;
  src_address: string;
  status: RelayTxStatus;
  dst_chain_id: number;
  conn_sn: number;
  dst_address: string;
  dst_tx_hash: string;
  signatures: string[];
  payload: string;
};

export type SubmitTxResponse = {
  success: boolean;
  message: string;
};

export type GetTransactionPacketsResponse = {
  success: boolean;
  data: PacketData[];
};

export type GetPacketResponse =
  | { success: true; data: PacketData }
  | { success: false; message: string };

export type RelayAndWaitParams = {
  srcTxHash: string;
  data: RelayExtraData | OnDemandRelayData;  // used in submit payload for Solana/Bitcoin
  chainKey: SpokeChainKey;
  relayerApiEndpoint: HttpUrl;
  timeout: number | undefined;
  pollTxHash?: string;          // identity used to poll get_transaction_packets when it differs from srcTxHash (Bitcoin on-demand); defaults to srcTxHash
};

export type IntentDeliveryInfo = {
  srcChainKey: SpokeChainKey;
  srcTxHash: string;
  srcAddress: string;
  dstChainKey: SpokeChainKey;
  dstTxHash: string;
  dstAddress: string;
};

export type WaitUntilIntentExecutedPayload = {
  intentRelayChainId: string;   // IntentRelayChainId serialized as string
  srcTxHash: string;
  timeout?: number;
  apiUrl: HttpUrl;
  selectPacket?: (packets: PacketData[]) => PacketData | undefined;  // disambiguates when one src tx emits multiple packets; defaults to first candidate
};
```
