<!--
 * SODAX Swap Feature Migration Summary (v1 → v2 SDK)

 * React-side migration playbook for moving a swap-feature consumer (e.g. `apps/demo`) from the v1
 * SDK shape (per-chain `*SpokeProvider` instances) to the v2 SDK shape (chain-key + chain-narrowed
 * wallet provider).
 * For the upstream SDK rationale and concept definitions, see:
 *   - `packages/sdk/docs/ARCHITECTURE_REFACTOR_SUMMARY.md` — Concepts 1-6 + types-package breaking
 *     changes.
 *   - `packages/sdk/CHAIN_ID_MIGRATION.md` — full `*_MAINNET_CHAIN_ID` → `ChainKeys.*` mapping table.
 * Diff scope: `sdk-v2-main..HEAD` for `apps/demo/src/{components/swaps,components/bitcoin,
 * constants.ts,providers.tsx,zustand/useAppStore.tsx,lib/{utils,chains}.ts}` and
 * `packages/dapp-kit/src/hooks`. Surface-reduction commenting is excluded.
-->

# SODAX Swap Feature: v1 → v2 Migration Playbook

## TL;DR

The v2 SDK eliminates per-chain `*SpokeProvider` classes and unifies chain identifiers under a single
`ChainKeys` namespace. Consumers wire `walletProvider` from `useWalletProvider(chainKey)` (or equivalent)
into **SDK** calls (`createIntent`, `swap`, `approve`, …), not via a synthesized `*SpokeProvider`.
Wallet-provider narrowing flows from chain key via `GetWalletProviderType<K>`.

**dapp-kit (current):** mutation hooks expose `useXxx({ mutationOptions })`; domain payloads go through
`mutate` / `mutateAsync`, e.g. `swap({ params, walletProvider })` — not positional
`(srcChainKey, walletProvider)` arguments to the hook factory. See § Dapp-kit Hook API Contract.

SDK methods take a discriminated union: `{ raw: false, walletProvider }` for signed execution,
`{ raw: true }` for raw-tx building. All async SDK methods return `Promise<Result<T>>`; per-module
error unions and their type-guards are deleted.

The four mechanical things you need to do:

1. Replace `*_MAINNET_CHAIN_ID` constants with `ChainKeys.*` (see `packages/sdk/CHAIN_ID_MIGRATION.md`).
2. Type renames: `SpokeChainId`/`ChainId` → `SpokeChainKey`; `Token` → `XToken`; `xChainId` → `chainKey`.
3. Drop `useSpokeProvider`; pass `walletProvider` from `useWalletProvider(chainKey)` into SDK args or **dapp-kit** `mutate({ params, walletProvider })`.
4. Add the `raw: false` discriminator to every service call shape that previously took
   `{ intentParams, spokeProvider }`. New shape: `{ params, raw: false, walletProvider }`.

The one new pattern worth understanding: **cast-at-boundary** for chain-narrowing. Where a hook needs
`IBitcoinWalletProvider` (or `IStellarWalletProvider`) but the consumer holds the broad
`IWalletProvider | undefined` from `useWalletProvider`, narrow with the chain-key guard at the
binding site:

```tsx
const sourceBitcoinWallet =
  src.chain === ChainKeys.BITCOIN_MAINNET
    ? (sourceWalletProvider as GetWalletProviderType<typeof ChainKeys.BITCOIN_MAINNET> | undefined)
    : undefined;
```

The cast is local and provably correct given the guard. Don't propagate the cast — use the narrowed
binding everywhere downstream. Alternative: `walletProvider.chainType === 'BITCOIN'` is a runtime
discriminator on every `I*WalletProvider` (no `as` needed) when you don't have the chain key in scope.

## Type / Symbol Rename Cheat Sheet

For full upstream rationale, see `ARCHITECTURE_REFACTOR_SUMMARY.md` "Types package: most significant
breaking changes" and Concepts 1, 4. Demo-specific deltas:

### Field-level renames (the easy-to-miss kind)

| Type | Old field | New field | Notes |
|---|---|---|---|
| `CreateIntentParams<K>` (request) | `srcChain`, `dstChain` | `srcChainKey`, `dstChainKey` | Generic `K` carries the literal chain key for inference. |
| `CreateLimitOrderParams<K>` (request) | `srcChain`, `dstChain` | `srcChainKey`, `dstChainKey` | `Omit<CreateIntentParams<K>, 'deadline'>`. |
| `SubmitSwapTxRequest` (backend) | `srcChainId` | `srcChainKey` | `packages/types/src/backend/backendApi.ts`. |
| `Intent` (read shape) | `srcChain`, `dstChain` (KEEP) | unchanged | These remain `IntentRelayChainId` (bigint). **A blanket grep-replace on `srcChain`→`srcChainKey` will break Intent reads.** |
| `XToken` | `xChainId` | `chainKey` | Type renamed from `Token` → `XToken`. |

### Deleted symbols (replace, don't shim)

- `*SpokeProvider` classes (`BitcoinSpokeProvider`, `StellarSpokeProvider`, etc.) and the union
  `SpokeProvider` — use `(chainKey, walletProvider)` at the SDK / feature boundary (no shim object).
- `isBitcoinSpokeProvider(provider)` — replace with chain-key guard
  (`chainKey === ChainKeys.BITCOIN_MAINNET` or `isBitcoinChainKey(chainKey)` from `@sodax/types`).
- `hubAssets` — use `sodax.config.getOriginalAssetAddress()` /
  `sodax.config.getSupportedTokensPerChain()` instead.
- `CustomProvider` (Hana wallet shim) — gone. Window declaration becomes `unknown` or imports from
  the wallet vendor directly.
- `IntentError<Code>` and the rest of the module-error type-guard family — branch on
  `error.message` (e.g. `'SUBMIT_TX_FAILED'`) and/or `error.cause`. SDK CLAUDE.md "Error message
  convention" has the canonical taxonomy.

### New v2 types worth knowing about (defined in `@sodax/types`)

| Type | Purpose |
|---|---|
| `ChainKeys` const + `ChainKey` union | Replaces 20 individual `*_MAINNET_CHAIN_ID` constants. |
| `GetWalletProviderType<K>` | Conditional type → chain-specific wallet-provider interface (`IEvmWalletProvider`, `IBitcoinWalletProvider`, etc.). |
| `GetChainType<K>` | Chain-family discriminator (`'EVM' | 'BITCOIN' | …`). |
| `WalletProviderSlot<K, Raw>` | Discriminated union: `raw: true` forbids `walletProvider`, `raw: false` requires the chain-narrowed one. Defined in `packages/types/src/common/common.ts`. |
| `TxReturnType<K, Raw>` | Service return shape: `Raw=false` → tx-hash string; `Raw=true` → chain-specific raw-tx payload. |
| `DeepPartial<T>` | Used to build the data-override portion of `SodaxOptions` (`= DeepPartial<SodaxDefaultConfig> & SodaxOptionalConfig`); `new Sodax(config?: SodaxOptions)`. |
| `I*WalletProvider.chainType` | Each wallet-provider interface now declares a `readonly chainType: '<CHAIN>'` literal — usable for runtime narrowing without `instanceof`. |

### Other impacts

- `RpcConfig` is now keyed by `ChainKey` values (`rpcConfig[ChainKeys.SONIC_MAINNET]`).
  `BitcoinRpcConfig` for Bitcoin (`rpcUrl` only — Bound hosts live on `chains[BITCOIN_MAINNET].radfi`), `StellarRpcConfig` for Stellar, `string` for
  EVM URLs.
- `IConfigApi` methods now return `Promise<Result<T>>` (every method).
- Bitcoin types live under `@sodax/types`'s `bitcoin` sub-path (was `btc`).
- `AddressType` renamed to `BtcAddressType` (Bitcoin-specific union: `'P2PKH' | 'P2SH' | 'P2WPKH' | 'P2TR'`).

## The Spoke-Provider Elimination Pattern

### v1 (before)

```tsx
const sourceWalletProvider = useWalletProvider(sourceChain);
const sourceProvider = useSpokeProvider(sourceChain, sourceWalletProvider);

const { mutateAsync: swap } = useSwap(sourceProvider);
const { approve } = useSwapApprove(intentParams, sourceProvider);
const { data: hasAllowed } = useSwapAllowance(intentParams, sourceProvider);

useStellarTrustlineCheck(token, amount, destProvider, dstChainId);

useTradingWalletBalance(
  src === BITCOIN_MAINNET_CHAIN_ID && isBitcoinSpokeProvider(sourceProvider) ? sourceProvider : undefined,
  tradingAddress,
);

await sodax.swaps.createIntent({ intentParams, spokeProvider: sourceProvider });
await requestTrustline({ token, amount, spokeProvider: destProvider });
```

### v2 (after)

```tsx
const sourceWalletProvider = useWalletProvider({ xChainId: src.chain });
const destWalletProvider = useWalletProvider({ xChainId: dst.chain });

const { mutateAsync: swap } = useSwap();
const { mutateAsyncSafe: approve } = useSwapApprove();
const { data: hasAllowed } = useSwapAllowance({
  params: {
    payload: intentParams,
    srcChainKey: src.chain,
    walletProvider: sourceWalletProvider,
  },
});

useStellarTrustlineCheck({
  params: {
    token: intentParams?.outputToken,
    amount: intentParams?.minOutputAmount,
    chainId: intentParams?.dstChainKey,
    walletAddress: destAccount.address, // resolved address keys the cache per account
  },
});

const sourceBitcoinWallet =
  src.chain === ChainKeys.BITCOIN_MAINNET
    ? (sourceWalletProvider as GetWalletProviderType<typeof ChainKeys.BITCOIN_MAINNET> | undefined)
    : undefined;
useTradingWalletBalance(sourceBitcoinWallet, tradingAddress);

// Discriminator + chain-narrowed wallet provider:
await sodax.swaps.createIntent({ params: intentParams, raw: false, walletProvider: sourceWalletProvider });

// Or full solver path via hook (SDK swap() under the hood):
await swap({ params: intentParams, walletProvider: sourceWalletProvider });

await requestTrustline({
  token,
  amount,
  srcChainKey: dstChain as StellarChainKey,
  walletProvider: destWalletProvider as IStellarWalletProvider,
});
```

The mechanism (Concepts 1 + 3): `CreateIntentParams<K>` carries the literal chain key as a generic;
`SwapService.swap<K>` accepts `SwapActionParams<K, false>`, which intersects with
`WalletProviderSlot<K, false> = { raw: false; walletProvider: GetWalletProviderType<K> }`. With `K`
flowing from the call-site literal, TypeScript narrows the wallet-provider parameter to the
chain-specific interface.

## Two swap execution paths (reference: `apps/demo/src/components/swaps/SwapCard.tsx`)

1. **Solver / relayer via `swap`** — `useSwap()` then `mutateAsync({ params, walletProvider })` calls
   `sodax.swaps.swap`, which chains `createIntent`, spoke verification, relay when applicable, and
   `postExecution`; returns `SwapResponse` on success.

2. **Create intent then backend submit API** — `sodax.swaps.createIntent({ params, raw: false, walletProvider })`
   yields `CreateIntentResult` (`{ tx, intent, relayData }`). `relayData.payload` (see `RelayExtraData` in SDK)
   becomes `SubmitSwapTxRequest.relayData` (string). Submit with `useBackendSubmitSwapTx()` +
   `mutateAsyncSafe({ request, apiConfig })`.

Demo switches between them via local UI state (`useSubmitTxApi`); pick one product flow per integration.

## Dapp-kit Hook API Contract (v2)

Shared contracts: `ReadHookParams` / `MutationHookParams` in `packages/dapp-kit/src/hooks/shared/types.ts`.
Mutations use `useSafeMutation` (`packages/dapp-kit/src/hooks/shared/useSafeMutation.ts`): alongside
`mutateAsync` (throws when the SDK returns `{ ok: false }`), every hook exposes **`mutateAsyncSafe`**,
which returns `Promise<Result<T>>` and never rejects for SDK failure — see demo `SwapCard` for approve / backend submit flows.

**Swap mutations** (`packages/dapp-kit/src/hooks/swap/`) — hook call: `useXxx({ mutationOptions } = {})`; domain data on `mutate` / `mutateAsync`:

- **`useSwap.ts`** — `mutate({ params, walletProvider [, timeout] })` with `params: CreateIntentParams<K>`. Injects `raw: false` into `sodax.swaps.swap`; success type `SwapResponse`. Default `mutationKey`: `['swap']`. Invalidates shared `xBalances` for src/dst chains on success.
- **`useSwapApprove.ts`** — `mutate({ params, walletProvider })` with `params: CreateIntentParams<K> | CreateLimitOrderParams<K>`. Injects `raw: false` into `sodax.swaps.approve`. Invalidates `['swap','allowance', ...]` queries.
- **`useCreateLimitOrder.ts`** — same mutate shape as swap but calls `sodax.swaps.createLimitOrder`; `mutationKey`: `['swap','limitOrder','create']`.
- **`useCancelSwap.ts`** — `mutate({ srcChainKey, walletProvider, intent })`; forwards to `sodax.swaps.cancelIntent` with nested `params: { srcChainKey, intent }`.
- **`useCancelLimitOrder.ts`** — `mutate({ srcChainKey, walletProvider, intent [, timeout] })` → `sodax.swaps.cancelLimitOrder`.

**Swap reads**

- **`useSwapAllowance.ts`** — `useSwapAllowance({ params: { payload, srcChainKey, walletProvider }, queryOptions })`; `refetchInterval`: **2s**.
- **`useQuote.ts`** — `useQuote({ params: { payload }, queryOptions })` (`SolverIntentQuoteRequest | undefined`); disabled when payload absent; returns the SDK **`Result` unchanged** as query data; **3s** refetch.
- **`useStatus.ts`** — `useStatus({ params: { intentTxHash }, queryOptions })`; same **`Result` as data** pattern; **3s** refetch.

**Shared**

- **`useStellarTrustlineCheck.ts`** — `ReadHookParams` wrapper: **`{ params: { token, amount, chainId, walletAddress }, queryOptions }`**. Pass the resolved **`walletAddress`** (e.g. `useXAccount('STELLAR').address`) — it keys the cache per account. **Breaking vs the earlier RC**: the param is now `walletAddress`, not `walletProvider`. (`chainId` type is **`SpokeChainKey`**.)
- **`useRequestTrustline.ts`** — imperative `requestTrustline({ token, amount, srcChainKey, walletProvider })` (`srcChainKey: StellarChainKey`).
- **`useBackendSubmitSwapTx.ts`** (`hooks/backend/`) — `mutate({ request: SubmitSwapTxRequest, apiConfig? })`; uses `unwrapResult` from **`packages/dapp-kit/src/hooks/backend/unwrapResult.ts`**. Swap feature mutations use **`packages/dapp-kit/src/hooks/shared/unwrapResult.ts`** instead.

**Bitcoin** (`packages/dapp-kit/src/hooks/bitcoin/*`): hooks such as `useRadfiAuth`, `useRadfiSession`, `useTradingWalletBalance`, `useFundTradingWallet`, `useExpiredUtxos`, `useRenewUtxos`, `useRadfiWithdraw` take `walletProvider: IBitcoinWalletProvider | undefined`. `useFundTradingWallet` mutate vars: `bigint` sat amount; `useRadfiWithdraw`: `{ amount: string; tokenId: string; withdrawTo: string }`.

## Worked Example: full `handleSubmitTxSwap` migration

**Before (v1):**

```tsx
const handleSubmitTxSwap = async (intentOrderPayload: CreateIntentParams) => {
  if (!sourceProvider) return;

  const createIntentResult = await sodax.swaps.createIntent({
    intentParams: intentOrderPayload,
    spokeProvider: sourceProvider,
  });
  if (!createIntentResult.ok) return;

  const [spokeTxHash, intent, relayData] = createIntentResult.value;

  const swapIntentData: SwapIntentData = {
    /* … */
    srcChain: Number(intent.srcChain),
    dstChain: Number(intent.dstChain),
  };

  const request: SubmitSwapTxRequest = {
    txHash: spokeTxHash,
    srcChainId: sourceChain,                          // v1 field name
    walletAddress: sourceAccount.address ?? '',
    intent: swapIntentData,
    relayData,
  };
  await submitSwapTx(request);
};
```

**After (v2):**

```tsx
const handleSubmitTxSwap = async (intentOrderPayload: CreateIntentParams) => {
  if (!sourceWalletProvider) return;

  // sourceWalletProvider is IWalletProvider | undefined here. createIntent accepts it as the
  // walletProvider slot because K defaults to the broad SpokeChainKey union, which makes
  // GetWalletProviderType<K> resolve to the IWalletProvider union — assignable from itself.
  // For tighter narrowing, apply the cast-at-boundary pattern (above) before this handler.
  const createIntentResult = await sodax.swaps.createIntent({
    params: intentOrderPayload,
    raw: false,                                       // discriminator: signed execution
    walletProvider: sourceWalletProvider,
  });
  if (!createIntentResult.ok) return;

  const { tx: spokeTxHash, intent, relayData } = createIntentResult.value;

  const swapIntentData: SwapIntentData = {
    /* … */
    srcChain: Number(intent.srcChain),                // Intent.srcChain unchanged (relay chain id)
    dstChain: Number(intent.dstChain),
  };

  const request: SubmitSwapTxRequest = {
    txHash: spokeTxHash as string,
    srcChainKey: src.chain,
    walletAddress: sourceAccount.address ?? '',
    intent: swapIntentData,
    relayData: relayData.payload,                     // RelayExtraData → backend string payload
  };
  const submitResult = await submitSwapTxAsyncSafe({ request, apiConfig: besApi });
  if (!submitResult.ok) return;
};
```

The meaningful diffs:
1. `sourceProvider` → `sourceWalletProvider` (no `.walletProvider` access).
2. `{ intentParams, spokeProvider }` → `{ params, raw: false, walletProvider }`.
3. `SubmitSwapTxRequest.srcChainId` → `srcChainKey`.
4. `createIntent` success is `CreateIntentResult.value`: **`{ tx, intent, relayData }`** (not a tuple). Use `const { tx: spokeTxHash, intent, relayData }` or equivalent.
5. `spokeTxHash` is `TxReturnType<K, false>` — narrow with `as string` when the consumer expects a plain string (e.g. `SubmitSwapTxRequest.txHash`).
6. Backend `relayData: string` ← `relayData.payload` from the SDK `RelayExtraData` object.
7. With `useBackendSubmitSwapTx`, call `mutateAsyncSafe({ request, apiConfig? })` (or `mutateAsync` and try/catch); do not pass a bare request object unless your wrapper expects it.

The `Intent` literal's `srcChain`/`dstChain` field names are **unchanged**.

## Per-file Migration Checklist (apps/demo)

These files are independent — migrate in any order. Only `providers.tsx` must be done before
runtime smoke-test (config wiring).

- **`components/swaps/SwapCard.tsx`** — biggest churn. Drop `useSpokeProvider`. Use `useSwap()` / `useSwapApprove()` + `mutate` / `mutateAsyncSafe`, and `useSwapAllowance({ params: { payload, srcChainKey, walletProvider } })`. Apply field renames on `CreateIntentParams`. Add `raw: false` to `createIntent`. Replace `isBitcoinSpokeProvider` with chain-key guard. Replace `destProvider instanceof StellarSpokeProvider` with `destChain === ChainKeys.STELLAR_MAINNET` guard. Narrow `spokeTxHash` with `as string` for `SubmitSwapTxRequest.txHash`; use `relayData.payload` for `SubmitSwapTxRequest.relayData`. (Demo also collapsed `{sourceChain, sourceToken}` and `{destChain, destToken}` into `{src, dst}` records — a UX-side cleanup, not a migration requirement.)
- **`components/swaps/LimitOrderCard.tsx`** — same patterns as SwapCard, no backend submit-tx.
- **`components/swaps/LimitOrderItem.tsx`** — gotcha: the `Intent` object literal you build for cancel keeps `srcChain`/`dstChain` (those are `IntentRelayChainId` bigints, not chain keys). Method renamed: `sodax.config.getSpokeChainIdFromIntentRelayChainId` → `getSpokeChainKeyFromIntentRelayChainId`. **dapp-kit** cancel: `useCancelLimitOrder()` then `mutate({ intent, srcChainKey, walletProvider [, timeout] })`.
- **`components/swaps/SelectChain.tsx`, `LimitOrderList.tsx`, `OrderStatus.tsx`** — type / import alignment (`SpokeChainId` → `SpokeChainKey`) as needed.
- **`components/bitcoin/BitcoinSetupPanel.tsx`** — prop rename `spokeProvider: BitcoinSpokeProvider` → `walletProvider: IBitcoinWalletProvider`. Internal Bound Exchange calls go through `sodax.spokeService.bitcoinSpokeService.radfi.*` (singleton owned by `Sodax`), not via the per-component provider.
- **`providers.tsx`** — `SodaxProvider`'s `config` prop becomes `SodaxOptions`. Solver endpoints move from `SodaxConfig.swaps` to `SodaxConfig.solver`. (This is the easy-to-miss config-shape pitfall — `swaps` is now `SwapsConfig` for supported-tokens-per-chain; `solver` is the endpoint/contract config.)
- **`zustand/useAppStore.tsx`** — `ChainId` → `SpokeChainKey`; replace string-literal default (`'stacks'`) with a typed `ChainKeys.X` constant.
- **`constants.ts`, `lib/chains.ts`** — chain-ID constant migration (mechanical). `type CustomProvider` → `unknown` in window declaration.
- **`lib/utils.ts`** — drop `hubAssets` import; any helper that walked `hubAssets[chainId]` for vault lookup must move to `sodax.config` lookups.

## New Patterns Worth Knowing

### Pattern: Single-object `{ chain, token }` state per side

Demo collapsed four `useState` calls (`sourceChain`, `destChain`, `sourceToken`, `destToken`) into
two `{ chain, token }` records (`src`, `dst`). Direction-swap is `setSrc(dst); setDst(src);`. The
chain-token coupling (resetting token when chain changes) is enforced at the setter call:

```tsx
setSrc({ chain: chainId, token: getSupportedSolverTokens(chainId)[0] });
```

### Pattern: `Result<T>` unwrap helper for backend hooks

- **Swap / limit-order mutations** (`packages/dapp-kit/src/hooks/swap/useSwap.ts`, `useSwapApprove.ts`, etc.) call `unwrapResult` from `packages/dapp-kit/src/hooks/shared/unwrapResult.ts` inside each hook-owned `mutationFn`.

- **Specific backend mutations** (`packages/dapp-kit/src/hooks/backend/useBackendSubmitSwapTx.ts`, …) call `unwrapResult` from `packages/dapp-kit/src/hooks/backend/unwrapResult.ts`. Both helpers throw when an SDK / fetch layer returns `{ ok: false }`, which drives React Query’s error state (`mutationFn` rejects).

Pick consciously versus **queries** that return `undefined` on disable / soft miss (e.g. `useQuote`, `useStatus`, `useBackendIntentByHash`): some resolve with `undefined` rather than throwing for “no data.”

## Pitfalls

1. **Over-broad regex on `srcChain`/`dstChain`** — request types renamed, `Intent` (read shape) didn't. Distinguish "I'm building a request" from "I'm reading an intent."
2. **Casting wallet provider at the wrong site** — apply the cast next to the chain-key guard, not deep inside event handlers. The narrowed binding should flow downstream; don't repeat the cast.
3. **Forgetting `raw: false`** — without the discriminator field, TypeScript can't pick the signed branch of `WalletProviderSlot`, and `walletProvider` is rejected as `?: never`. Error message: `Object literal may only specify known properties, and 'walletProvider' does not exist in type ...`.
4. **`isBitcoinSpokeProvider(provider)`** — replace with chain-key compares (`chainKey === ChainKeys.BITCOIN_MAINNET`) or `isBitcoinChainKey(chainKey)` from `@sodax/types`. Same for `destProvider instanceof StellarSpokeProvider` → chain-key compare.
5. **`Intent.deadline` is `bigint`** — `Math.floor(Date.now() / 1000) + 60 * 5` returns a number; wrap in `BigInt(...)`.
6. **`IntentResponse` from backend has `srcChain`/`dstChain` as relay chain id (number)**, not chain keys. Convert via `sodax.config.getSpokeChainKeyFromIntentRelayChainId(BigInt(intent.dstChain))` when displaying as a chain key.
7. **`createIntent` success shape** — `CreateIntentResult.value` is `{ tx, intent, relayData }` (`packages/sdk/src/swap/SwapService.ts`), not a tuple. Map `relayData.payload` into `SubmitSwapTxRequest.relayData` (`string`). Narrow `tx` with `as string` when passing to APIs that expect a plain string hash.
8. **`hubAssets` is gone** — anything that walked `hubAssets[chainId]` for vault lookup must move to `sodax.config` (`getOriginalAssetAddress`, `getSupportedTokensPerChain()`).
9. **`SodaxConfig.swaps` vs `.solver`** — `swaps` is the `SwapsConfig` listing supported solver tokens per chain. `solver` holds endpoint/contract addresses (`{ intentsContract, solverApiEndpoint, protocolIntentsContract }`). The v1 demo passed solver endpoints under `swaps`; v2 requires the `solver` field. Don't put endpoints under `swaps`.
10. **`CustomProvider` window typedecl** — gone. Type as `unknown` or import directly from the wallet vendor.

## Verification Recipe

When migrating a swap-feature consumer:

1. `pnpm -C packages/dapp-kit run build` — must produce ESM + CJS + DTS. Failures are usually stale `SpokeProvider`-typed imports inside dapp-kit hooks, not consumer issues.
2. `pnpm -C apps/<your-app> run checkTs` — fix in this order **per file** (independent across files, sequential within each):
   - Mechanical chain-key constant renames first (`*_MAINNET_CHAIN_ID` → `ChainKeys.*`).
   - Type renames (`SpokeChainId` → `SpokeChainKey`, `Token` → `XToken`, `xChainId` → `chainKey`).
   - Drop `useSpokeProvider` callsites; pass `walletProvider` from `useWalletProvider` into **SDK** methods or into **dapp-kit** `mutate({ params, walletProvider })` (see hook source under `packages/dapp-kit/src/hooks/swap/`).
   - Add the `raw: false` field to every service call shape that previously took `{ intentParams, spokeProvider }`.
   - Apply the cast-at-boundary pattern for Bitcoin / Stellar / EVM-specific helpers.
3. `pnpm -C apps/<your-app> run build` — Vite/Rollup will catch any runtime-string `*_CHAIN_ID` reference (e.g. inside config) that the typechecker missed because it was being read as a generic `string`.
4. **Manual smoke test in dev** — connect a wallet, hit `/swap` (or your route), verify approve → submit → status flow end-to-end. The TypeScript checker can't tell you if your runtime narrowing guards are correct.

## Out-of-scope

`apps/web` consumes `useSpokeProvider` in **17 live call sites across 16 files** (stake, save, pool,
partner-dashboard, migrate, `hooks/useTokenSupplyBalances.ts`). Not part of this migration; will fail
to typecheck once the deprecated shim is finally deleted from dapp-kit. The migration pattern matches
the demo: remove `useSpokeProvider(chainKey, walletProvider)` and pass `walletProvider` (and chain key
inside `params` where required) into the **feature hook’s `mutate` payload** or **SDK** call — not as
positional arguments to `useSwap` / similar hook factories.
