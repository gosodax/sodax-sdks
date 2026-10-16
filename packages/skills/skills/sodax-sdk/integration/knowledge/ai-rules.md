# AI rules — `@sodax/sdk` integration

DO / DO NOT / workflow / stop conditions for AI agents writing `@sodax/sdk` v2 code. Read this **before** the per-feature docs — these rules are how you avoid the load-bearing v2 traps.

## Workflow (do these in order)

1. **Survey the project before touching code.**

   ```bash
   pnpm tsc --noEmit           # baseline typecheck
   grep -rE '@sodax/(sdk|types)' --include='*.ts' --include='*.tsx' src/   # see what's already imported
   ```

2. **Always initialize first.** `new Sodax()` constructs the facade; `await sodax.config.initialize()` loads chain/token config from the backend (with packaged-defaults fallback). Skipping `initialize()` works but means stale defaults — `findSupportedTokenBySymbol` may return `undefined` for tokens added after the SDK release.
3. **Pick `raw: true` vs `raw: false` explicitly.** Reads and unsigned-tx-building flows take `raw: true` and don't need a wallet. Signed flows take `raw: false` + a chain-narrowed `walletProvider`. The discriminator is mandatory — without it the type system rejects the call. See [`architecture.md`](architecture.md) § 6.
4. **Branch on `result.ok` before reading `.value` or `.error`.** Every async public method returns `Promise<Result<T, SodaxError>>`. `try/catch` does **not** catch SDK-level failures — see DO NOT § below.
5. **Discriminate errors by `(error.feature, error.code)`.** Use `isSodaxError(e)` first, then switch on the pair. Don't string-match `error.message`.

## DO

- **DO** branch on `result.ok` for every SDK call. Forward sub-`Result`s without re-wrapping (`if (!sub.ok) return sub`).
- **DO** use `isSodaxError(e)` over bare `instanceof SodaxError`. Bundle-safe in cross-realm code (mixed ESM/CJS, monorepos with multiple package copies).
- **DO** discriminate errors via `(error.feature, error.code)`. The narrow per-method code unions (e.g. `CreateSupplyIntentErrorCode`) enable exhaustive `switch`.
- **DO** use `ChainKeys.X` constants for chain identifiers. Never hard-code chain-key string values like `'ethereum'` or `'0xa4b1.arbitrum'`.
- **DO** use `declare const xxxWallet: I*WalletProvider` placeholders in code examples or generated docs. Implementations are not part of `@sodax/sdk`; substitute the consumer's own wallet object at the call site.
- **DO** import everything from `@sodax/sdk` root. Types from `@sodax/types` are re-exported.
- **DO** preserve literal chain keys in generic positions where possible (e.g. `srcChainKey: ChainKeys.ETHEREUM_MAINNET as const`) — TypeScript narrowing flows from the literal, including the `walletProvider` parameter type.

## DO NOT

- **DO NOT** wrap `await sodax.<method>(...)` in `try/catch` and expect SDK-level failures (`RELAY_TIMEOUT`, `EXECUTION_FAILED`, etc.) to land there. They don't — the SDK resolves `{ ok: false, error }` instead of throwing. `catch` only fires for synchronous wrapper exceptions.
- **DO NOT** import from `@sodax/sdk/dist/...`. Deep imports are unstable across releases; only the package root barrel is the public contract.
- **DO NOT** add `@sodax/types` as a separate dependency. It's bundled / re-exported via `@sodax/sdk`. Adding it independently invites version skew.
- **DO NOT** destructure cross-chain mutation results as arrays — `[a, b] = result.value` is wrong. The shape is `TxHashPair = { srcChainTxHash, dstChainTxHash }` (object). This applies to `bridge.bridge`, `staking.{stake,unstake,instantUnstake,claim,cancelUnstake}`, `dex.assetService.{deposit,withdraw}`, `dex.clService.{supplyLiquidity,increaseLiquidity,decreaseLiquidity,claimRewards}`, `moneyMarket.{supply,borrow,withdraw,repay}`, `migration.{migratebnUSD,migrateIcxToSoda,revertMigrateSodaToIcx,migrateBaln}` — all of them.
- **DO NOT** look for MM reserve/position reads on `sodax.backendApi`. `getReservesData`, `getUserReservesData`, `getATokensBalances`, `getReservesHumanized`, etc. live on the `sodax.moneyMarket.data` sub-service (`MoneyMarketDataService`), and they throw on failure (bare `Promise<T>`, not a `Result`) — wrap them in try/catch.
- **DO NOT** reach for an `intentRelayApi` property on the `Sodax` instance — there is no such property. The relay layer is exposed as two top-level functions, `relayTxAndWaitPacket` and `submitTransaction` (re-exported from `@sodax/sdk`). Call them directly if you need custom relay orchestration.
- **DO NOT** call `getStakeRatio` and treat its return as `Result<bigint>`. It's `Result<[xSodaAmount, previewDepositAmount]>` — a tuple of two bigints.
- **DO NOT** assume `BalnSwapService` lock-management methods (`stake`, `unstake`, `claim`, `claimUnstaked`, `cancelUnstake`, `getDetailedUserLocks`) return `Result<T>`. They still throw on error in v2 — known carve-out. Wrap them in `try/catch`.
- **DO NOT** call methods that need a wallet provider with `raw: true` — TypeScript rejects `walletProvider` when `raw: true`. Use `raw: false` + `walletProvider`, or stick to read methods.
- **DO NOT** send a zero or hand-picked minimum output (`minOutputAmount: 0n` or a literal). Derive it from a live quote for that exact input minus a slippage tolerance in basis points, show both to the user before they sign, and disable the action while there is no quote. The SDK does not reject a zero minimum (swaps and bridge only enforce the 546-sat dust floor on a BTC payout); a zero minimum accepts any fill.
- **DO NOT** add a `partnerFee` the integrator did not ask for. It is optional; omit it by default, and never copy a fee receiver address from a SODAX demo, doc, or example.
- **DO NOT** pass `skipSimulation: true` in user-facing flows. The simulation replays the hub-side execution and catches an intent that would revert there before the user signs it.

## Stop conditions (defer to user)

| Signal | Why stop |
|---|---|
| User wants a chain not in `ChainKeys.*` | Adding a new chain requires SDK-level changes to `@sodax/types`/`@sodax/sdk` — out of scope for consumer code. |
| User wants to skip `await sodax.config.initialize()` | Explain consequences: stale defaults, no awareness of new tokens / fee parameters. Don't silently skip. |
| User code expects sibling-package imports (e.g. `@sodax/wallet-sdk-core` instances) | Out of scope here — consumer owns the wallet-provider implementation. Document the `I*WalletProvider` shape they need to satisfy or instruct them to install `@sodax/wallet-sdk-core` separately and refer to that package's docs. |
| User wants browser-extension wallet wiring inside SDK code | Not the SDK's concern. Consumer owns the wallet layer. |

## Verification protocol

Before declaring an SDK integration "done":

```bash
# 1. Type-check the consumer.
pnpm -C <consumer> tsc --noEmit

# 2. Confirm no leftover v1 patterns (if porting).
grep -rE '_MAINNET_CHAIN_ID\b|\bxChainId\b|\bSpokeChainId\b|\bSpokeProvider\b' src/

# 3. Confirm Result branching is in place.
grep -rE 'await sodax\.\w+\.\w+\([^)]*\)' src/ | grep -v '\.ok\|\.value\|\.error'   # any SDK call without result.ok / value / error in nearby lines

# 4. Smoke-test a read flow before a signed flow.
#    sodax.config.findSupportedTokenBySymbol(...) etc. — no wallet needed.
```

## Done criteria

- [ ] `await sodax.config.initialize()` runs at app startup (or before first feature call).
- [ ] Every `await sodax.<feature>.<method>(...)` is followed by `if (!result.ok)` branching.
- [ ] No `try/catch` wraps SDK calls expecting to catch `RELAY_TIMEOUT` / `EXECUTION_FAILED`.
- [ ] No `import` from `@sodax/sdk/dist/...`.
- [ ] No standalone `@sodax/types` dependency in `package.json`.
- [ ] Consumer typecheck (`pnpm tsc --noEmit`) is clean.
