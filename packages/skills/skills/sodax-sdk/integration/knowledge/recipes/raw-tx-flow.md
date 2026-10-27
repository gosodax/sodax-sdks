# Raw-tx flow

`raw: true`. The SDK builds the unsigned payload; you sign it elsewhere (gnosis safe, hardware wallet, multi-sig, etc.).

```ts
const result = await sodax.swaps.createIntent({
  params: { /* same as signed flow */ },
  raw: true,
  // walletProvider is FORBIDDEN — TypeScript rejects it.
});

if (!result.ok) return;
const { tx, intent, relayData } = result.value;
// tx is now a chain-specific raw-tx payload:
//   - EVM: EvmRawTransaction { to, data, value, chainId }
//   - Solana: SolanaRawTransaction
//   - Stellar: StellarRawTransaction
//   - …
```

### Chain-specific raw inputs (`extras`)

Some chains need a per-action input on the **raw** path, supplied via the chain-key-gated `extras` slot:

- **Stacks** (`raw: true`): `extras.srcPublicKey` is **required** — the unsigned source tx is built from the signer public key (a `SP…` address can't yield it). Omitting it fails fast with a `VALIDATION_FAILED` `SodaxError` before any network call.
- **Bitcoin** TRADING mode (`raw: true`): `extras.bound.accessToken` carries a Bound Exchange token so the PSBT build authenticates (`bound` is the Bitcoin-gated slot that groups Bound/Radfi inputs). It falls back to the RadfiProvider instance token (`new Sodax({ ... })` with `radfi.accessToken`, or `radfi.setRadfiAccessToken(token)`) when omitted; with no token anywhere the call fails with a legible `RadfiApiError`.

```ts
// Stacks raw intent — srcPublicKey is mandatory:
await sodax.swaps.createIntent({
  params: { ...params, srcChainKey: ChainKeys.STACKS_MAINNET },
  extras: { srcPublicKey },
  raw: true,
});

// Bitcoin raw intent (TRADING) — bound.accessToken (or a seeded radfi token):
await sodax.swaps.createIntent({
  params: { ...params, srcChainKey: ChainKeys.BITCOIN_MAINNET },
  extras: { bound: { accessToken } },
  raw: true,
});
```

> **Note (Bitcoin):** even on the `raw: true` path, a Bitcoin TRADING intent makes a live Bound Exchange call to resolve the trading-wallet address (`getEffectiveWalletAddress`) before the PSBT is built. The unsigned PSBT is returned for you to sign offline, but the address lookup is **not** offline — Bound must be reachable, and a valid `accessToken` (per-action or seeded) is required for it.

Submit the raw tx via your own signing infrastructure. Once you have the spoke tx hash, you'll typically need to manually call the relay to complete the cross-chain flow:

```ts
import { relayTxAndWaitPacket, type RelayExtraData } from '@sodax/sdk';

// After your custom signer broadcasts and you have the spoke tx hash:
const spokeTxHash = await mySigningInfra.signAndBroadcast(tx);

// `relayTxAndWaitPacket` is a top-level function (not a class). Pass your
// relayer endpoint (same one you'd configure on the `Sodax` instance) and
// the relay payload returned by `createIntent`.
const relayResult = await relayTxAndWaitPacket({
  relayerApiEndpoint,
  chainKey: params.srcChainKey,
  srcTxHash: spokeTxHash,
  data: relayData,            // the whole RelayExtraData ({ address, payload }), not just .payload
  timeout: 60_000,
});
```

> **Note (Tron):** Tron settles through the MPC relay, so there is no intent-relay packet. The raw `tx` is a `TronRawTransaction`: send `value` of `token` to `to`, the reserve the relay returned for this call (never a cached address), with `data` as the transaction memo (`raw_data.data`). After broadcasting, call `sodax.spoke.settle({ chainKey: ChainKeys.TRON_MAINNET, tx: txId, direction: 'inbound', relayData })` instead of `relayTxAndWaitPacket`, with `txId` as 64 hex characters without `0x`. It notifies the relay, re-notifies until the deposit lands, and returns the hub mint hash as `dstChainTxHash`.

This pattern is rare. Prefer signed flow unless you have a specific reason to defer signing.

### Type narrowing

```ts
// Discriminate raw return shapes by chain family at runtime:
if (getChainType(srcChainKey) === 'EVM') {
  const evmTx = result.value.tx as EvmRawTransaction;
  // …
}
```

Or use the chain-key generic to narrow at the type level (most useful when `srcChainKey` is a literal):

```ts
const result = await sodax.swaps.createIntent({
  params: { ...params, srcChainKey: ChainKeys.ETHEREUM_MAINNET as const },
  raw: true,
});
// result.value.tx is statically narrowed to EvmRawTransaction
```

---


## Cross-references

- [`README.md`](README.md) — recipe index.
- [`../architecture.md`](../architecture.md) — concepts behind these patterns.
- [`../reference/`](../reference/) — chain keys, error codes, public API surface.
