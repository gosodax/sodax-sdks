# Token migration — `MigrationService`

Migration of legacy ICON ecosystem tokens to the SODAX hub. Three sub-services:

- **`IcxMigrationService`** — ICX/wICX → SODA (forward) and SODA → ICX (revert).
- **`BnUSDMigrationService`** — legacy bnUSD (ICON / Sui / Stellar) ↔ new bnUSD (EVM chains) via vault transformations.
- **`BalnSwapService`** — BALN → SODA with lockup periods (0–24 months) that multiply rewards (0.5x–1.5x).

Access: `sodax.migration`. Service class: `MigrationService` (with sub-services `sodax.migration.icxMigration`, `sodax.migration.bnUSDMigrationService`, `sodax.migration.balnSwapService`). Feature tag for errors: `'migration'`.

> Don't confuse this feature (the `MigrationService` SDK module) with the v1 → v2 SDK port itself. They share the word "migration" but are independent concerns. The v1 → v2 port playbook lives at [`features/migration.md`](../../../migration-v1-to-v2/knowledge/features/migration.md).

## How it works

All three sub-services follow the same pattern: deposit on a spoke chain → relay to hub → execute hub-side migration contract → deliver new token.

The `MigrationService` facade exposes 10 async public methods:

- 4 orchestrators (full execution): `migratebnUSD`, `migrateIcxToSoda`, `revertMigrateSodaToIcx`, `migrateBaln`.
- 4 intent creators (raw or signed spoke tx, no full lifecycle): `createMigratebnUSDIntent`, `createMigrateIcxToSodaIntent`, `createRevertSodaToIcxMigrationIntent`, `createMigrateBalnIntent`.
- `approve`, `isAllowanceValid` (action-discriminated like staking and money market).

One more read-only method, `getAvailableAmount`, lives on the `icxMigration` sub-service (not the facade). It reads the migration contract's **total available SODA liquidity** on the hub chain and takes **no arguments** — it is not a per-user "claimable from a partial migration" amount.

`isReverseMigrationEnabled` (also on `icxMigration`, no arguments) reads the contract's reverse-swap switch. The owner can turn SODA → ICX off; while it is off, the ICX revert `approve`, `createRevertSodaToIcxMigrationIntent` and `revertMigrateSodaToIcx` return `VALIDATION_FAILED` with `context.reason: 'reverse migration disabled'` and send nothing. Check it before prompting for the revert approval.

`BalnSwapService` has additional lock-management methods that **still throw** (do not return `Result<T>`): `claim`, `claimUnstaked`, `stake`, `unstake`, `cancelUnstake`, `getDetailedUserLocks`. This is deliberate tech debt; future cleanup. Wrap them in `try/catch` until then.

## Public methods

```ts
sodax.migration.migratebnUSD<K>(action): Promise<Result<TxHashPair, SodaxError>>;
sodax.migration.migrateIcxToSoda<K>(action): Promise<Result<TxHashPair, SodaxError>>;
sodax.migration.revertMigrateSodaToIcx<K>(action): Promise<Result<TxHashPair, SodaxError>>;
sodax.migration.migrateBaln<K>(action): Promise<Result<TxHashPair, SodaxError>>;

sodax.migration.createMigratebnUSDIntent<K, Raw>(...): Promise<Result<...>>;
// + 3 other createXxxIntent methods

sodax.migration.approve<K, Raw>(actionParams, action): Promise<Result<TxReturnType<K, Raw>, SodaxError>>;
sodax.migration.isAllowanceValid<K>(params, action): Promise<Result<boolean, SodaxError>>;

sodax.migration.icxMigration.getAvailableAmount(): Promise<Result<bigint, SodaxError>>;
sodax.migration.icxMigration.isReverseMigrationEnabled(): Promise<Result<boolean, SodaxError>>;

// BalnSwapService — STILL THROW (tech debt; not Result-wrapped):
sodax.migration.balnSwapService.claim(...): Promise<TxReturnType<K, false>>;
sodax.migration.balnSwapService.claimUnstaked(...): Promise<TxReturnType<K, false>>;
sodax.migration.balnSwapService.stake(...): Promise<TxReturnType<K, false>>;
sodax.migration.balnSwapService.unstake(...): Promise<TxReturnType<K, false>>;
sodax.migration.balnSwapService.cancelUnstake(...): Promise<TxReturnType<K, false>>;
sodax.migration.balnSwapService.getDetailedUserLocks(...): Promise<DetailedUserLocks>;
```

## Action params shape

`MigrationParams<K>` is **not** a shared base record — it is a union of the three concrete param types:

```ts
type MigrationParams<K extends SpokeChainKey> =
  | IcxMigrateParams
  | UnifiedBnUSDMigrateParams<K>
  | BalnMigrateParams;

type UnifiedBnUSDMigrateParams<K extends SpokeChainKey> = {
  srcChainKey: K;
  srcAddress: string;
  srcbnUSD: string;              // legacy or new bnUSD; SDK detects direction from address
  dstChainKey: SpokeChainKey;    // required
  dstbnUSD: string;              // the other side
  amount: bigint;
  dstAddress: string;
};

// ICX and BALN param types are NOT generic over <K>.
type IcxMigrateParams = {
  srcChainKey: IconChainKey;
  srcAddress: IconAddress;
  address: IcxTokenType;         // the ICX or wICX token to migrate (required)
  amount: bigint;
  dstAddress: Address;
};

type IcxCreateRevertMigrationParams = {
  srcChainKey: SonicChainKey;
  srcAddress: Address;
  amount: bigint;
  dstAddress: IconEoaAddress;    // ICON EOA that receives the reverted ICX (required)
};

type BalnMigrateParams = {
  srcChainKey: IconChainKey;
  srcAddress: IconAddress;
  amount: bigint;
  lockupPeriod: LockupPeriod;    // enum in SECONDS: NO_LOCKUP | SIX_MONTHS | TWELVE_MONTHS | EIGHTEEN_MONTHS | TWENTY_FOUR_MONTHS (→ 0/6/12/18/24 months)
  dstAddress: Address;
  stake: boolean;                // required
};
```

## Common call shapes

### bnUSD migrate (forward — legacy → new, e.g. ICON → BASE)

```ts
const result = await sodax.migration.migratebnUSD({
  params: {
    srcChainKey: ChainKeys.ICON_MAINNET,
    srcAddress: 'hx…',
    srcbnUSD: '0x…',                    // legacy bnUSD on ICON
    dstChainKey: ChainKeys.BASE_MAINNET, // required
    dstbnUSD: '0x…',                    // new bnUSD on BASE
    amount: parseUnits('100', 18),
    dstAddress: '0x…',
  },
  raw: false,
  walletProvider: iconWp,
});

if (!result.ok) return;
const { srcChainTxHash, dstChainTxHash } = result.value;
```

The SDK auto-detects direction from `(srcbnUSD, dstbnUSD)` addresses; the `direction` field surfaces on `error.context` if it fails (`'forward' | 'reverse'`).

### ICX → SODA

```ts
await sodax.migration.migrateIcxToSoda({
  params: {
    srcChainKey: ChainKeys.ICON_MAINNET,
    srcAddress: 'hx…',
    address: icxTokenType, // IcxTokenType — the ICX or wICX token to migrate (required)
    amount,
    dstAddress: '0x…',     // required
  },
  raw: false,
  walletProvider: iconWp,
});
```

### Revert SODA → ICX

```ts
await sodax.migration.revertMigrateSodaToIcx({
  params: {
    srcChainKey: ChainKeys.SONIC_MAINNET,
    srcAddress: '0x…',
    amount,
    dstAddress: 'hx…',     // ICON EOA that receives the reverted ICX (required)
  },
  raw: false,
  walletProvider: sonicWp,
});
```

### BALN → SODA with lockup

```ts
await sodax.migration.migrateBaln({
  params: {
    srcChainKey: ChainKeys.ICON_MAINNET,
    srcAddress: 'hx…',
    amount: parseUnits('1000', 18),
    lockupPeriod: LockupPeriod.TWELVE_MONTHS, // 1.0x base; TWENTY_FOUR_MONTHS is 1.5x; NO_LOCKUP is 0.5x
    dstAddress: '0x…',                        // required
    stake: false,                             // required
  },
  raw: false,
  walletProvider: iconWp,
});
```

### Approve / allowance — action-discriminated

`action` is the **second positional argument** (`MigrationAction = 'migrate' | 'revert'`), not a field inside `params`:

```ts
// approve takes the action-wrapped params, then the action arg:
await sodax.migration.approve(
  { params: bnUSDParams, raw: false, walletProvider },
  'migrate', // or 'revert'
);

// isAllowanceValid takes the BARE migration params (no { params, raw, walletProvider } wrapper,
// no `raw` flag — it is not Raw-generic) plus the action arg:
const allowed = await sodax.migration.isAllowanceValid(bnUSDParams, 'migrate');
```

### BALN lock management (carve-out — still throws)

```ts
try {
  const tx = await sodax.migration.balnSwapService.stake({ /* … */ });
} catch (e) {
  // Handle as v1-style throw. Result wrapping for these methods is on the roadmap.
}
```

## Return shapes

| Method | Success type |
|---|---|
| 4 orchestrators (`migratebnUSD`, `migrateIcxToSoda`, `revertMigrateSodaToIcx`, `migrateBaln`) | `TxHashPair` |
| 4 intent creators | `IntentTxResult<K, Raw>` (`{ tx, relayData }`) |
| `approve` | `TxReturnType<K, Raw>` |
| `isAllowanceValid` | `boolean` |
| `getAvailableAmount` | `bigint` |
| `isReverseMigrationEnabled` | `boolean` |
| `BalnSwapService.claim` etc. | `TxReturnType<K, false>` (raw, not `Result`-wrapped) |

`approve` can send **two** transactions on a token that rejects a non-zero to non-zero allowance
change (Ethereum USDT is the only listed one today): `approve(0)` is mined first, then the real
approval, so the user signs twice. The returned value is unchanged — one hash, the **last**
transaction's. Detection simulates the approval, so never gate on a token list. Full note: "ERC-20
approval can take two transactions" in [`architecture.md`](../architecture.md).

## Error codes

`feature: 'migration'`. Per-method narrow unions:

| Method | Codes | `error.context.action` | Notes |
|---|---|---|---|
| `migratebnUSD` | full exec set incl. `TX_VERIFICATION_FAILED` | `'migratebnUSD'` | `error.context.direction: 'forward' \| 'reverse'`. Has secondary `phase: 'destinationExecution'` for the bnUSD `waitUntilIntentExecuted` watcher. |
| `migrateIcxToSoda` | full exec set | `'migrateIcxToSoda'` | |
| `revertMigrateSodaToIcx` | full exec set | `'revertMigrateSodaToIcx'` | `VALIDATION_FAILED` with `reason: 'reverse migration disabled'` when the contract switch is off. |
| `migrateBaln` | full exec set | `'migrateBaln'` | |
| `create*Intent` | `VALIDATION_FAILED`, `INTENT_CREATION_FAILED`, `UNKNOWN` | matches | |
| `approve` | `VALIDATION_FAILED`, `APPROVE_FAILED`, `UNKNOWN` | matches | |
| `isAllowanceValid` | `VALIDATION_FAILED`, `ALLOWANCE_CHECK_FAILED`, `UNKNOWN` | n/a | |
| `getAvailableAmount` | `VALIDATION_FAILED`, `LOOKUP_FAILED`, `UNKNOWN` | n/a | `method: 'getAvailableAmount'` |
| `isReverseMigrationEnabled` | `VALIDATION_FAILED`, `LOOKUP_FAILED`, `UNKNOWN` | n/a | `method: 'isReverseMigrationEnabled'` |

## Cross-references

- v1 → v2 migration of this feature: [`features/migration.md`](../../../migration-v1-to-v2/knowledge/features/migration.md).
- Architecture (relay layer's `phase: 'destinationExecution'` for bnUSD): [`../architecture.md`](../architecture.md) § 9.
