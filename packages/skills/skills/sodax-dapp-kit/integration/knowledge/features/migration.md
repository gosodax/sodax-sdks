# Migration — `@sodax/dapp-kit`

Token migration: ICX/wICX → SODA, BALN → SODA, legacy bnUSD ↔ new bnUSD. Six per-action hooks plus shared allowance/approve.

Pair: [`features/migration.md`](../../../migration-v1-to-v2/knowledge/features/migration.md).

## Hook surface

```ts
// @ai-snippets-skip — hook-surface listing; `<inner>` is a type placeholder, not real code
// Mutations (one per action)
useMigrateIcxToSoda({ mutationOptions });
useRevertMigrateSodaToIcx({ mutationOptions });
useMigratebnUSD({ mutationOptions });               // Bidirectional (auto-detects direction)
useMigrateBaln({ mutationOptions });

// Allowance + approve (action-discriminated)
useMigrationApprove({ mutationOptions });
// useMigrationAllowance — params nest `{ params: <inner-migration-params>, action }` under the outer `params`
useMigrationAllowance({ params: { params: <inner>, action: 'migrate' | 'revert' }, queryOptions });

// ICX reverse-migration switch (global, no params)
useIcxReverseMigrationEnabled({ queryOptions });
```

`use*Approve` is unchanged and still resolves to one transaction hash, but the SDK may send **two**
transactions on a token that rejects a non-zero to non-zero allowance change (Ethereum USDT today) —
the user signs twice and the hash is the **last** one's. An `isPending`-driven "Approving…" should say
so. See "Approve hooks can prompt the wallet twice" in [`architecture.md`](../architecture.md).

## Mutation params

```ts
// @ai-snippets-skip
// useMigrateIcxToSoda — wICX (ICON) → SODA (Sonic)
type IcxMigrateParams = {
  srcChainKey: IconChainKey;   // typeof ChainKeys.ICON_MAINNET
  srcAddress: IconAddress;     // `hx${string}` | `cx${string}`
  address: IcxTokenType;       // narrow union: wICX address OR native-ICX address
  amount: bigint;
  dstAddress: Address;         // `0x${string}` — Sonic recipient
};

// useRevertMigrateSodaToIcx — SODA (Sonic) → wICX (ICON)
type IcxCreateRevertMigrationParams = {
  srcChainKey: SonicChainKey;  // typeof ChainKeys.SONIC_MAINNET
  srcAddress: Address;         // `0x${string}` — Sonic
  amount: bigint;
  dstAddress: IconEoaAddress;  // `hx${string}` — ICON recipient
};

// useMigratebnUSD — bidirectional, swap srcbnUSD/dstbnUSD + chains for the other direction
type UnifiedBnUSDMigrateParams<K extends SpokeChainKey> = {
  srcChainKey: K;
  srcAddress: string;          // SDK keeps this loose (cross-chain)
  srcbnUSD: string;            // legacy or new bnUSD
  dstChainKey: SpokeChainKey;
  dstbnUSD: string;            // the other one
  amount: bigint;
  dstAddress: string;
};

// useMigrateBaln — BALN (ICON) → SODA with optional lock
type BalnMigrateParams = {
  srcChainKey: IconChainKey;
  srcAddress: IconAddress;
  amount: bigint;
  lockupPeriod: LockupPeriod;  // enum (values in SECONDS), see below
  dstAddress: Address;
  stake: boolean;              // REQUIRED — auto-stake migrated SODA into xSODA vault
};

// `LockupPeriod` is an enum with 5 members (values are in seconds, NOT months):
//   NO_LOCKUP            = 0                       (0.5x reward multiplier)
//   SIX_MONTHS           = 6  * 30 * 24 * 60 * 60  (0.75x)
//   TWELVE_MONTHS        = 12 * 30 * 24 * 60 * 60  (1.0x)
//   EIGHTEEN_MONTHS      = 18 * 30 * 24 * 60 * 60  (1.25x)
//   TWENTY_FOUR_MONTHS   = 24 * 30 * 24 * 60 * 60  (1.5x)

// All wrapped as TVars: { params: <ParamsType>, walletProvider }
```

## Allowance / approve

The migration approve/allowance hooks are **action-discriminated** — same hook handles all migrations, with `action` disambiguating which token is being approved:

```ts
// @ai-snippets-skip
const { data: isApproved } = useMigrationAllowance({
  params: { params: bnUSDParams, action: 'migrate' },   // 'migrate' | 'revert'
});
const { mutateAsync: approve } = useMigrationApprove();
await approve({ params: bnUSDParams, walletProvider, action: 'migrate' });
```

## Migration paths summary

| Migration | Approval needed? | Hook |
|---|---|---|
| ICX/wICX (ICON) → SODA | No (ICON has no ERC-20 allowance) | `useMigrateIcxToSoda` |
| SODA → wICX (revert) | Yes | `useRevertMigrateSodaToIcx` + `useMigrationApprove({ action: 'revert' })` |
| Legacy bnUSD ↔ new bnUSD (EVM) | Yes | `useMigratebnUSD` + `useMigrationApprove({ action: 'migrate' })` |
| Legacy bnUSD (Stellar/Sui) ↔ new bnUSD | Maybe (depends on chain) | Same as above |
| BALN (ICON) → SODA | No | `useMigrateBaln` |

## Return shapes

| Hook | Returns |
|---|---|
| `useMigrateIcxToSoda` / `useRevertMigrateSodaToIcx` / `useMigratebnUSD` / `useMigrateBaln` | `SafeUseMutationResult<TxHashPair, Error, ...>` |
| `useMigrationApprove` | `SafeUseMutationResult<TxReturnType<K, false>, Error, ...>` — chain-keyed receipt union (EVM/Stellar differ) |
| `useMigrationAllowance` | `UseQueryResult<boolean, Error>` (already unwrapped) |
| `useIcxReverseMigrationEnabled` | `UseQueryResult<boolean, Error>` — errors on a failed read rather than reporting `false` |

## Gotchas

1. **`useMigratebnUSD` is bidirectional.** v2 detects direction from `(srcbnUSD, dstbnUSD)` token addresses. To go the other direction, swap the params; no separate hook.
2. **BALN `lockupPeriod` is the `LockupPeriod` enum, NOT a literal number union.** Use `LockupPeriod.NO_LOCKUP`, `LockupPeriod.SIX_MONTHS`, `LockupPeriod.TWELVE_MONTHS`, `LockupPeriod.EIGHTEEN_MONTHS`, or `LockupPeriod.TWENTY_FOUR_MONTHS`. Enum values are in **seconds** (e.g. `TWELVE_MONTHS = 12 * 30 * 24 * 60 * 60`), not months. Reward multiplier ranges 0.5x (no lockup) → 1.5x (24 months). Also note: `BalnMigrateParams` requires `stake: boolean` — set `true` to auto-stake migrated SODA into the xSODA vault.
3. **ICON-side migrations don't need approval.** ICON has no ERC-20 allowance mechanism.
4. **`useRevertMigrateSodaToIcx` requires SODA approval on Sonic.** Use `useMigrationAllowance` + `useMigrationApprove` with `action: 'revert'`. Gate both on `useIcxReverseMigrationEnabled()`: the contract owner can switch reverse migration off, and then the approve and the revert both fail with `VALIDATION_FAILED`.
5. **`useMigratebnUSD` errors include `direction: 'forward' | 'reverse'` on context.** When surfacing errors, distinguish forward vs reverse for clearer messaging.

## Cross-references

- [`../recipes/migration.md`](../recipes/migration.md) — full worked examples.
- [`features/migration.md`](../../../migration-v1-to-v2/knowledge/features/migration.md) — v1 → v2 porting (the v1 dapp-kit had a single `useMigrate(spokeProvider)`-style hook; v2 split into 6).
- `sodax-sdk`: `integration/knowledge/features/migration.md` — underlying SDK migration surface.
