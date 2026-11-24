# Partner — `PartnerService`

Partner-fee handling. `PartnerService` itself only exposes `feeClaim: PartnerFeeClaimService` and `config: ConfigService` as public fields. Every operation lives on `sodax.partners.feeClaim`.

Access: `sodax.partners`. Service class: `PartnerService` (operations on `sodax.partners.feeClaim`). Feature tag for errors: `'partner'`.

## Methods (all on `sodax.partners.feeClaim`)

```ts
// Token approval
sodax.partners.feeClaim.isTokenApproved({ srcChainKey, srcAddress, token }): Promise<Result<boolean, Error>>;
sodax.partners.feeClaim.approveToken<Raw>(args): Promise<Result<TxReturnType, Error>>;

// Auto-swap preferences (whether partner-collected fees auto-swap into a target asset)
sodax.partners.feeClaim.getAutoSwapPreferences(queryAddress): Promise<Result<AutoSwapPreferences, Error>>;
sodax.partners.feeClaim.setSwapPreference<K, Raw>(args): Promise<Result<TxReturnType, Error>>;

// Fee claim flows
sodax.partners.feeClaim.swap(args): Promise<Result<...>>;                           // immediate fee swap
sodax.partners.feeClaim.createIntentAutoSwap<Raw>(args): Promise<Result<...>>;       // intent-driven auto-swap

// Recover a stuck claim. createIntentAutoSwap() (and swap(), which delegates to it) rejects a
// same-token claim (output === fee token) up front with VALIDATION_FAILED. The guard fails closed: if
// the preference lookup it relies on fails, the call returns that error instead of submitting. An
// already-created same-token intent is unfillable and locks the funds. Cancel via ProtocolIntents' own
// cancelIntent — the only authorized path: the intent's creator is the ProtocolIntents contract, so the
// generic SwapService.cancelIntent reverts Unauthorized().
// Tron (an MPC-relay chain) is refused as an auto-swap destination, in setSwapPreference and at claim,
// with VALIDATION_FAILED and context.reason 'mpc-relay-auto-swap-destination'.
sodax.partners.feeClaim.cancelIntent<Raw>(args): Promise<Result<TxReturnType, Error>>; // args.params: { srcChainKey: Hub, srcAddress, fromToken, toToken }

// Reads
sodax.partners.feeClaim.fetchAssetsBalances(queryAddress): Promise<Result<...>>;
sodax.partners.feeClaim.getUserIntent({ user, fromToken, toToken }): Promise<Result<Hex, Error>>; // 0x0…0 = no open intent
sodax.partners.feeClaim.getIntentDetails(intentHash): Promise<Result<Intent, Error>>;
sodax.partners.feeClaim.getOriginalAssetAddress(chainId, hubAsset): OriginalAssetAddress | undefined;
sodax.partners.feeClaim.getSpokeTokenFromOriginalAssetAddress(...): /* … */;
```

## Same-token fees (no conversion) — withdraw directly

When a partner wants the fee token itself (e.g. claim BTC fees as BTC), there is no swap to do — the
solver rejects a same-token swap, so `createIntentAutoSwap` (and `swap()`, which delegates to it)
rejects it up front with `VALIDATION_FAILED` rather than locking the funds in an unfillable intent.
Instead move the wrapped fee token off Sonic with the bridge:
`sodax.bridge.bridge({ params: { srcChainKey: Sonic, srcAddress, srcToken: <hub asset on Sonic>,
amount, dstChainKey: <fee's native chain, or Sonic>, dstToken: <original token on dstChain, or the
hub asset for same-chain delivery>, recipient } })`. Bridging from Sonic pulls via the partner's
hub-wallet router, so it needs a bridge allowance — a different spender than the ProtocolIntents
approval used by the swap claim.

## Common call shape

```ts
// 1. Check whether the partner's fee token is approved on the hub:
const approved = await sodax.partners.feeClaim.isTokenApproved({
  srcChainKey: 'sonic',   // hub chain key (required by the param type)
  srcAddress: partnerAddress,
  token: '0x…',           // hub asset address
});

// 2. Approve once if not:
if (approved.ok && !approved.value) {
  await sodax.partners.feeClaim.approveToken({
    params: { srcChainKey: 'sonic', srcAddress: partnerAddress, token: '0x…' },
    raw: false,
    walletProvider: sonicWp,
  });
}

// 3. Configure auto-swap preference (one-time):
await sodax.partners.feeClaim.setSwapPreference({
  params: { /* preference fields */ },
  raw: false,
  walletProvider: sonicWp,
});
```

## Error codes

`feature: 'partner'`. Action methods get the full exec set; reads get `LookupErrorCode` partitioned by `error.context.method`.

## Cross-references

- v1 → v2 migration of `PartnerService`: [`features/partner.md`](../../../migration-v1-to-v2/knowledge/features/partner.md).
- Hub-wallet asset recovery (separate service): [`./recovery.md`](recovery.md).
- Backend HTTP client (separate service): [`./backend-api.md`](backend-api.md).
- Error model context fields (`error.context.api`, `error.context.method`): [`../reference/`](../reference/) § 3.
