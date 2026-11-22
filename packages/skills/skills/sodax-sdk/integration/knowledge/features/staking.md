# Staking — `StakingService`

SODA token staking via an ERC4626 vault (xSoda). Stake, unstake (with penalty curve), instant unstake (slippage), claim, cancel-unstake. All operations are cross-chain — staking writes happen on the hub even when the user is on a spoke chain.

Access: `sodax.staking`. Service class: `StakingService`. Feature tag for errors: `'staking'`.

## How it works

- **SODA** (the staked asset) → **xSoda** (ERC4626 vault shares, proportional to current exchange rate).
- **Unstake** has a configurable waiting period with a piecewise penalty (max 1–100%): the flat `maxPenalty` applies during the minimum period, then decays linearly to zero by the full unstaking period, and is none after.
- **Instant unstake** bypasses the waiting period but pays slippage (via `StakingRouter`).
- **Claim** redeems SODA after the unstaking period expires.
- **Cancel unstake** restores xSoda from a pending unstake request before claim.

## Public methods

```ts
sodax.staking.stake<K>(action: StakeAction<K, false>): Promise<Result<TxHashPair, SodaxError>>;
sodax.staking.unstake<K>(action: UnstakeAction<K, false>): Promise<Result<TxHashPair, SodaxError>>;
sodax.staking.instantUnstake<K>(action: InstantUnstakeAction<K, false>): Promise<Result<TxHashPair, SodaxError>>;
sodax.staking.claim<K>(action: ClaimAction<K, false>): Promise<Result<TxHashPair, SodaxError>>;
sodax.staking.cancelUnstake<K>(action: CancelUnstakeAction<K, false>): Promise<Result<TxHashPair, SodaxError>>;
// every staking action refuses a Tron source

sodax.staking.createStakeIntent<K, Raw>(...): Promise<Result<...>>;
// + the 4 other createXxxIntent methods

sodax.staking.approve<K, Raw>(args): Promise<Result<TxReturnType<K, Raw>, SodaxError>>;
sodax.staking.isAllowanceValid<K, Raw>(args): Promise<Result<boolean, SodaxError>>;

// Reads (hub-only — no chain context needed):
sodax.staking.getStakingConfig(): Promise<Result<StakingConfig, SodaxError>>;
sodax.staking.getStakeRatio(amount): Promise<Result<[bigint, bigint], SodaxError>>;
//   value: [xSodaAmount, previewDepositAmount]
sodax.staking.getInstantUnstakeRatio(amount): Promise<Result<bigint, SodaxError>>;
sodax.staking.getConvertedAssets(amount): Promise<Result<bigint, SodaxError>>;

// Reads (hub-address — caller already has the hub wallet):
sodax.staking.getStakingInfo(hubAddress: Address): Promise<Result<StakingInfo, SodaxError>>;

// Reads (cross-chain — derive hub wallet from src chain):
sodax.staking.getStakingInfoFromSpoke(srcAddress, srcChainKey): Promise<Result<StakingInfo, SodaxError>>;
//   internally calls hubProvider.getUserHubWalletAddress(srcAddress, srcChainKey), then delegates to getStakingInfo
sodax.staking.getUnstakingInfo(srcAddress, srcChainKey): Promise<Result<UnstakingInfo, SodaxError>>;
//   value: { userUnstakeSodaRequests: UserUnstakeInfo[]; totalUnstaking: bigint }
sodax.staking.getUnstakingInfoWithPenalty(srcAddress, srcChainKey): Promise<Result<UnstakingInfo & { requestsWithPenalty: UnstakeRequestWithPenalty[] }, SodaxError>>;
//   each request adds penalty, penaltyPercentage, claimableAmount
```

## Action params shape

```ts
type StakeParams<K extends SpokeChainKey> = {
  srcChainKey: K;
  srcAddress: GetAddressType<K>;
  amount: bigint;
  minReceive: bigint;       // min xSoda after slippage; gate against bad rates
  action: 'stake';
};

type UnstakeParams<K> = { srcChainKey: K; srcAddress; amount: bigint; action: 'unstake' };
type InstantUnstakeParams<K> = { srcChainKey: K; srcAddress; amount: bigint; minAmount: bigint; action: 'instantUnstake' };
type ClaimParams<K> = { srcChainKey: K; srcAddress; requestId: bigint; amount: bigint; action: 'claim' };
type CancelUnstakeParams<K> = { srcChainKey: K; srcAddress; requestId: bigint; action: 'cancelUnstake' };
```

`StakingParamsUnion<K, Raw>` is the union of all 5; consumed by `staking.approve` and `staking.isAllowanceValid` (action-discriminated).

## Common call shapes

### Stake

```ts
const result = await sodax.staking.stake({
  params: {
    srcChainKey: ChainKeys.ARBITRUM_MAINNET,
    srcAddress: '0x…',
    amount: parseUnits('100', 18),    // 100 SODA
    minReceive: parseUnits('99', 18), // expect ~1% slippage tolerance
    action: 'stake',
  },
  raw: false,
  walletProvider: evmWp,
});

if (!result.ok) return;
const { srcChainTxHash, dstChainTxHash } = result.value;
```

### Unstake (with penalty curve)

```ts
await sodax.staking.unstake({
  params: { srcChainKey, srcAddress, amount: xSodaAmount, action: 'unstake' },
  raw: false,
  walletProvider,
});
```

Creates a pending unstake request. After the staking period expires, call `claim`. Use `getUnstakingInfoWithPenalty` to see the current penalty for early withdrawal.

### Instant unstake

```ts
await sodax.staking.instantUnstake({
  params: {
    srcChainKey, srcAddress,
    amount: xSodaAmount,
    minAmount: minSodaAfterSlippage,
    action: 'instantUnstake',
  },
  raw: false,
  walletProvider,
});
```

Bypasses the waiting period; pays slippage via `StakingRouter`.

### Approve / allowance — action-discriminated

The `approve` method routes by `params.action` to approve the right token (SODA for `stake`, xSoda for `unstake` and `instantUnstake`):

```ts
await sodax.staking.approve({
  params: { srcChainKey, srcAddress, amount, action: 'stake' /* or 'unstake' or 'instantUnstake' */ },
  raw: false,
  walletProvider,
});

const allowed = await sodax.staking.isAllowanceValid({
  params: { srcChainKey, srcAddress, amount, action: 'stake' },
  raw: true,    // read-only
});
```

## Return shapes

| Method | Success type |
|---|---|
| `stake`, `unstake`, `instantUnstake`, `claim`, `cancelUnstake` | `TxHashPair` |
| `create*Intent` | `CreateIntentResult<K, Raw>` |
| `approve` | `TxReturnType<K, Raw>` |
| `isAllowanceValid` | `boolean` |
| `getStakingConfig` | `{ unstakingPeriod, minUnstakingPeriod, maxPenalty }` |
| `getStakeRatio` | `[xSodaAmount: bigint, previewDepositAmount: bigint]` (estimated xSoda shares + vault's `previewDeposit` preview) |
| `getInstantUnstakeRatio` | `bigint` |
| `getConvertedAssets` | `bigint` (SODA per xSoda) |
| `getStakingInfo` | `StakingInfo` (totals + user's xSoda balance + SODA value). Takes a hub address directly. |
| `getStakingInfoFromSpoke` | `StakingInfo` (same shape). Takes `(srcAddress, srcChainKey)`; resolves hub wallet internally. |
| `getUnstakingInfo` | `UnstakingInfo` (object; carries `userUnstakeSodaRequests` array + aggregate amount) |
| `getUnstakingInfoWithPenalty` | `UnstakingInfo & { requestsWithPenalty: UnstakeRequestWithPenalty[] }` (each entry adds `penalty`, `penaltyPercentage`, `claimableAmount`) |

> All 5 mutation methods return `TxHashPair = { srcChainTxHash, dstChainTxHash }` because the SDK relays spoke→hub internally. When the user is already on the hub, both fields hold the same hash.

`approve` can send **two** transactions on a token that rejects a non-zero to non-zero allowance
change (Ethereum USDT is the only listed one today): `approve(0)` is mined first, then the real
approval, so the user signs twice. The returned value is unchanged — one hash, the **last**
transaction's. Detection simulates the approval, so never gate on a token list. Full note: "ERC-20
approval can take two transactions" in [`architecture.md`](../architecture.md).

## Error codes

`feature: 'staking'`. Per-method narrow unions:

| Method | Codes | Action |
|---|---|---|
| `stake` | full exec set incl. `TX_VERIFICATION_FAILED` (only stake calls verifyTxHash) | `'stake'` |
| `unstake`, `instantUnstake`, `claim`, `cancelUnstake` | full exec set minus `TX_VERIFICATION_FAILED` | matches action |
| `approve` | `VALIDATION_FAILED`, `APPROVE_FAILED`, `UNKNOWN` | matches action |
| `isAllowanceValid` | `VALIDATION_FAILED`, `ALLOWANCE_CHECK_FAILED`, `UNKNOWN` | matches action |
| Read methods (8 of them) | `VALIDATION_FAILED`, `LOOKUP_FAILED`, `UNKNOWN` | (use `error.context.method`) |

`StakingLogic` (a static utility class for contract encoding and on-chain reads) keeps its throw-on-error contract — wrapping happens only in `StakingService` public methods.

## Cross-references

- v1 → v2 staking migration: [`features/staking.md`](../../../migration-v1-to-v2/knowledge/features/staking.md).
- ERC4626 vault concept (xSoda): see SODAX docs site or `@sodax/sdk` source.
