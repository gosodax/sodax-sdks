# Bridge — `BridgeService`

Cross-chain token transfer via the hub-and-spoke vault architecture. Tokens are bridgeable if they share the same hub-side vault. The flow: spoke deposit → relay to hub → vault balance moves → spoke withdrawal on the destination chain.

Access: `sodax.bridge`. Service class: `BridgeService`. Feature tag for errors: `'bridge'`.

## How it works

A bridge call deposits the source token into its vault on the hub, then triggers a withdrawal of the same vault's destination-chain wrapper. Different tokens that share the same vault (e.g. multiple wrappings of the same underlying) are bridgeable to each other; tokens with different vaults are not.

`bridge()` handles the full lifecycle in one call. For custom relay control, use `createBridgeIntent()` (spoke-only) and call the relay layer manually.

## Public methods

```ts
sodax.bridge.bridge<K>(action: BridgeParams<K, false>): Promise<Result<TxHashPair, SodaxError>>;
sodax.bridge.createBridgeIntent<K, Raw>(action: BridgeParams<K, Raw>): Promise<Result<IntentTxResult<K, Raw>, SodaxError>>;
sodax.bridge.approve<K, Raw>(args): Promise<Result<TxReturnType<K, Raw>, SodaxError>>;
// Unsigned callers only: returns both transactions when a stale allowance must be cleared first.
sodax.bridge.buildApproveTxs<K>(action: BridgeParams<K, true>): Promise<Result<ApprovalTxs<K>, SodaxError>>;
sodax.bridge.isAllowanceValid<K, Raw>(args): Promise<Result<boolean, SodaxError>>;

// Routes from the source tx to whichever source can answer — the backend record while it is in
// play, else the delivered relay packet. Covers a bridge the client-side fallback completed.
sodax.bridge.getDetailedStatus({ srcChainKey, srcTxHash }, config?): Promise<Result<DetailedBridgeStatus, SodaxError>>;

sodax.bridge.getBridgeableAmount(from: XToken, to: XToken): Promise<Result<BridgeLimit, SodaxError>>;
sodax.bridge.getBridgeableTokens(from: SpokeChainKey, to: SpokeChainKey, token: string): Result<XToken[], SodaxError>;
// Plus the sync helpers:
sodax.bridge.isBridgeable({ from: XToken, to: XToken }): boolean;
// partnerFee defaults to the configured `bridge.partnerFee`; pass one to preview an `extras.partnerFee` override.
sodax.bridge.getFee(inputAmount: bigint, partnerFee?: PartnerFee): bigint;
```

## Action params shape

```ts
type BridgeParams<K extends SpokeChainKey, Raw extends boolean> = {
  params: CreateBridgeIntentParams<K>;
  extras?: BridgeExtras<K>;
  skipSimulation?: boolean;
  timeout?: number;              // per-attempt budget (backend attempt, then fallback relay); defaults to DEFAULT_RELAY_TX_TIMEOUT
} & WalletProviderSlot<K, Raw>;  // raw: true ⇒ no walletProvider; raw: false ⇒ required, chain-narrowed

type CreateBridgeIntentParams<K extends SpokeChainKey> = {
  srcChainKey: K;
  srcAddress: string;            // source wallet (spoke chain)
  srcToken: string;              // source token address (spoke chain)
  amount: bigint;
  dstChainKey: SpokeChainKey;
  dstToken: string;              // destination token address (must share vault with srcToken)
  recipient: string;             // destination receiver (chain-specific format)
};
```

### extras (per-action overrides)

Chain-specific slots are keyed off `K`, so a non-Stacks action can't set `srcPublicKey` and a non-Bitcoin action can't set `bound`:

```ts
type BridgeExtras<K extends SpokeChainKey> = (GetChainType<K> extends 'STACKS'
  ? { srcPublicKey?: string }
  : { srcPublicKey?: never }) &
  (GetChainType<K> extends 'BITCOIN' ? { bound?: { accessToken?: string } } : { bound?: never }) & {
    partnerFee?: PartnerFee;
    apiKey?: string;
  };
```

| Slot | When | Notes |
|---|---|---|
| `partnerFee` | any chain, optional | Takes precedence over the config-level `bridge.partnerFee` for this call. Omit to use the configured fee. |
| `apiKey` | any chain, optional | Overrides the configured backend API key (`x-api-key`) for this action's backend submit-tx leg. Omit to use `new Sodax({ apiKey })`. |
| `srcPublicKey` | Stacks source + `raw: true` — **required** | A Stacks address can't yield the signer public key at raw-tx build time. Omitting it fails `VALIDATION_FAILED` (`field: 'srcPublicKey'`). |
| `bound` | raw Bitcoin TRADING source, optional | Bound Exchange (Radfi) access token; falls back to the `RadfiProvider` instance token. |

```ts
const result = await sodax.bridge.bridge({
  params: { /* … */ },
  raw: false,
  walletProvider: evmWp,
  extras: { partnerFee: { address: '0xPartner…', percentage: 100 } }, // 100 = 1%
});
```

## Validation rules to respect

- **Native BTC dust limit (`BITCOIN_DUST_SATS` = 546 sats).** Native BTC is denominated in satoshis, and outputs below the dust limit are unspendable/rejected by nodes. Bitcoin as **source**: `amount >= 546`. Bitcoin as **destination**: the *post-fee delivered* amount must clear 546 — the partner fee is deducted on the hub in 18-dp vault units, so a percentage fee or a wei-denominated fixed `PartnerFee.amount` can push a nominally valid `amount` under the limit. Both fail `VALIDATION_FAILED` on `field: 'amount'`.
- **Stacks + `raw: true`** requires `extras.srcPublicKey` (above).
- Amount must be `> 0n`; both chain keys must be registered spoke chains; both tokens must be supported on their chain and share a vault.

## Routing the spoke deposit through the backend

`bridge()` routes the spoke-deposit through the backend Bridge API by default (`bridge.useBackendSubmitTx`, default ON) — `sodax.api.bridge` relays server-side and falls back to the client-side relay on any non-success — safe because re-relaying is idempotent. Set `new Sodax({ bridge: { useBackendSubmitTx: false } })` to force the client-side path. As with swaps, the SDK does not verify the deposit on-chain before handing it over — the backend verifies itself, so `verifyTxHash` runs on the client-side path only. `timeout` (defaults to `DEFAULT_RELAY_TX_TIMEOUT`) is a PER-ATTEMPT budget, same terms as swaps: the backend attempt gets it and the fallback relay gets a fresh one starting after verification, so neither a stalled backend nor a slow confirmation shortens the fallback. Worst case is `createBridgeIntent + timeout + verification + max(timeout, RELAY_FALLBACK_FLOOR_MS)` — intent creation and verification (the source chain's `pollingConfig.maxTimeoutMs`) are not bounded by `timeout`. Bridge has no post-execution term. See [`bridge-api.md`](bridge-api.md).

## Common call shapes

### Full bridge (recommended for most flows)

```ts
const result = await sodax.bridge.bridge({
  params: {
    srcChainKey: ChainKeys.ARBITRUM_MAINNET,
    srcAddress: '0x…',
    srcToken: USDC_ARBITRUM.address,
    amount: parseUnits('100', 6),
    dstChainKey: ChainKeys.STELLAR_MAINNET,
    dstToken: USDC_STELLAR.address,
    recipient: 'G…',
  },
  raw: false,
  walletProvider: evmWp,
});

if (!result.ok) return;
const { srcChainTxHash, dstChainTxHash } = result.value;
```

### Create-intent (custom relay control)

```ts
const result = await sodax.bridge.createBridgeIntent({
  params: { /* same as above */ },
  raw: false,
  walletProvider: evmWp,
});

if (!result.ok) return;
const { tx, relayData } = result.value;
// Submit relayData.payload via your own relay infrastructure if needed.
```

### Hub as source (Sonic → spoke)

`srcChainKey` accepts `ChainKeys.SONIC_MAINNET` too — the SDK routes through the user's hub-wallet abstraction (instead of a spoke deposit) and then triggers the destination withdrawal. The call shape is the same; only the chain key changes:

```ts
const sodaSonic = sodax.config.findSupportedTokenBySymbol(ChainKeys.SONIC_MAINNET, 'SODA');
const sodaBase  = sodax.config.findSupportedTokenBySymbol(ChainKeys.BASE_MAINNET,  'SODA');
if (!sodaSonic || !sodaBase) throw new Error('SODA missing from config');

// 1. Confirm the pair is vault-bridgeable (synchronous, config-derived).
if (!sodax.bridge.isBridgeable({ from: sodaSonic, to: sodaBase })) {
  // Fall back to swap if needed — different vaults aren't bridgeable.
  return;
}

// 2. (Optional) check the vault-side cap.
const limit = await sodax.bridge.getBridgeableAmount(sodaSonic, sodaBase);

// 3. Execute. srcChainKey is the hub.
const result = await sodax.bridge.bridge({
  params: {
    srcChainKey: ChainKeys.SONIC_MAINNET,
    srcAddress: (await evmWp.getWalletAddress()) as `0x${string}`,
    srcToken: sodaSonic.address,
    amount: parseUnits('1', sodaSonic.decimals),
    dstChainKey: ChainKeys.BASE_MAINNET,
    dstToken: sodaBase.address,
    recipient: recipientOnBase,
  },
  raw: false,
  walletProvider: evmWp,
});
```

Internally `bridge()` branches on `isHubChainKeyType(srcChainKey)` and uses the user's hub wallet abstraction as the spender (the assetManager spoke address is used for non-hub sources). For allowance and approval flows, treat Sonic-as-source the same as any other EVM source — `isAllowanceValid` and `approve` use the same parameter shape.

### Bridgeable-amount check

Respects vault deposit limits (spoke→hub) and asset-manager balance (hub→spoke). Pass the source and destination tokens as full `XToken` objects (each carries its own `chainKey`):

```ts
const result = await sodax.bridge.getBridgeableAmount(USDC_ARBITRUM, USDC_STELLAR);
if (result.ok) {
  const { amount, decimals, type } = result.value;   // BridgeLimit
  console.log(`Up to ${amount} (${decimals} decimals) can be bridged`);
}
```

### Find compatible tokens

Synchronous (config-derived). Pass source-chain key, destination-chain key, and the source token address; the SDK filters the destination's supported tokens by matching vault:

```ts
const result = sodax.bridge.getBridgeableTokens(
  ChainKeys.ARBITRUM_MAINNET,
  ChainKeys.STELLAR_MAINNET,
  USDC_ARBITRUM.address,
);
if (result.ok) {
  // result.value: XToken[] — Stellar-side tokens that share USDC_ARBITRUM's vault
  for (const token of result.value) {
    console.log(token.chainKey, token.symbol);
  }
}
```

## Return shapes

| Method | Success type |
|---|---|
| `bridge` | `TxHashPair` |
| `createBridgeIntent` | `IntentTxResult<K, Raw>` = `{ tx: TxReturnType<K, Raw>, relayData }` |
| `approve` | `TxReturnType<K, Raw>` |
| `buildApproveTxs` | `ApprovalTxs<K> = { approveTx, resetTx? }` |
| `isAllowanceValid` | `boolean` |
| `getBridgeableAmount` | `BridgeLimit = { amount, decimals, type }` |
| `getBridgeableTokens` | `XToken[]` |

`approve` can send **two** transactions on a token that rejects a non-zero to non-zero allowance
change (Ethereum USDT is the only listed one today): `approve(0)` is mined first, then the real
approval, so the user signs twice. The returned value is unchanged — one hash, the **last**
transaction's. Detection simulates the approval, so never gate on a token list. Full note: "ERC-20
approval can take two transactions" in [`architecture.md`](../architecture.md).

Unsigned callers cannot get that from `approve({ raw: true })`, which returns a single transaction.
Use `buildApproveTxs` instead — it returns `{ approveTx, resetTx? }`, and when `resetTx` is present
you must broadcast it and wait for it to be mined before `approveTx`. It resolves the same spender as
`approve` and `isAllowanceValid` (the caller's own hub wallet router on the hub, the asset manager on
an EVM spoke), so do not substitute `sodax.swaps.buildApproveTxs` for a bridge — swaps approves a
different contract on the hub.

## Error codes

`feature: 'bridge'`. Per-method narrow unions:

| Method | Codes | `error.context` |
|---|---|---|
| `bridge` | full exec set | `action: 'bridge'` |
| `createBridgeIntent` | `VALIDATION_FAILED`, `INTENT_CREATION_FAILED`, `UNKNOWN` | `action: 'bridge'` |
| `approve` | `VALIDATION_FAILED`, `APPROVE_FAILED`, `UNKNOWN` | n/a |
| `isAllowanceValid` | `VALIDATION_FAILED`, `ALLOWANCE_CHECK_FAILED`, `UNKNOWN` | n/a |
| `getBridgeableAmount`, `getBridgeableTokens` | `VALIDATION_FAILED`, `LOOKUP_FAILED`, `UNKNOWN` | `method: 'getBridgeableAmount' \| 'getBridgeableTokens'` |

## Cross-references

- v1 → v2 bridge migration: [`features/bridge.md`](../../../migration-v1-to-v2/knowledge/features/bridge.md).
- Stellar destinations need a trustline first: [`../chain-specifics.md`](../chain-specifics.md).
- NEAR destinations need NEP-141 storage registration first: [`../chain-specifics.md`](../chain-specifics.md).
- Hub-and-spoke vault architecture: [`../architecture.md`](../architecture.md) § 1.
