# Auxiliary services — `@sodax/dapp-kit`

Smaller surfaces grouped together: partner fee claiming, recovery, backend queries (read-only data hooks), and shared utilities.

Pair: [`features/auxiliary-services.md`](../../../migration-v1-to-v2/knowledge/features/auxiliary-services.md).

## Partner

Partner fee claiming and auto-swap preferences.

```ts
// @ai-snippets-skip
useFetchAssetsBalances({ params, queryOptions });   // Partner asset balances
useGetAutoSwapPreferences({ params, queryOptions });
useIsTokenApproved({ params: { payload: FeeTokenApproveParams }, queryOptions });
useApproveToken({ mutationOptions });
useSetSwapPreference({ mutationOptions });
useFeeClaimSwap({ mutationOptions });               // Claim partner fees via swap
```

`useFeeClaimSwap` returns `SafeUseMutationResult<IntentAutoSwapResult, Error, UseFeeClaimSwapVars>` — the success value is `IntentAutoSwapResult` (NOT `SwapResponse`). TVars are `Omit<PartnerFeeClaimSwapAction<HubChainKey, false>, 'raw'>`.

## Recovery

Withdraw stuck hub-wallet assets back to a spoke chain.

```ts
// @ai-snippets-skip
useHubAssetBalances({ params, queryOptions });      // List assets stuck on hub
useWithdrawHubAsset({ mutationOptions });
```

## Backend queries (read-only data)

No wallet connection required.

### Intent tracking

```ts
// @ai-snippets-skip
useBackendIntentByTxHash({ params, queryOptions });   // Polls 1s once a txHash is supplied
useBackendIntentByHash({ params, queryOptions });
useBackendUserIntents({ params, queryOptions });      // Date-filtered user history; data is { items: IntentResponse[], total, offset, limit }
```

### Orderbook

```ts
// @ai-snippets-skip
// `pagination` MUST be nested under `params` — top-level pagination is invalid.
useBackendOrderbook({ params: { pagination: { offset, limit } }, queryOptions });   // staleTime 30s; no auto-refresh
```

### Money market data

```ts
// @ai-snippets-skip
useBackendMoneyMarketPosition({ params, queryOptions });
useBackendMoneyMarketAsset({ params, queryOptions });
useBackendAllMoneyMarketAssets({ queryOptions });
useBackendMoneyMarketAssetSuppliers({ params, queryOptions });
useBackendMoneyMarketAssetBorrowers({ params, queryOptions });
// Pagination required — without it the query is disabled.
useBackendAllMoneyMarketBorrowers({ params: { pagination: { offset, limit } }, queryOptions });
```

### Oracle data

```ts
// @ai-snippets-skip
useBackendOracleMarkets({ queryOptions });   // staleTime 60s; discovery: quote, intervals, symbols
// from/to are UNIX seconds over the half-open range [from, to), at most 5000 buckets; staleTime 10s
useBackendOracleCandles({ params: { symbol, interval, from, to }, queryOptions });
```

### Swaps API (`sodax.api.swaps`)

Typed React Query wrappers over the backend **Swaps API** — one `useSwapsApi*` hook per endpoint of `sodax.api.swaps.*` (21 total: tokens, quote, deadline, allowance, approve, create / submit / cancel intent, status, intent hash / packet / extra-data, intent lookups, limit orders, gas estimate, fees, submit-tx + status). They call the backend HTTP API and are distinct from the on-chain `swap/` hooks (`useQuote`/`useStatus`/`useSwap`/…), which drive `sodax.swaps` (the on-chain `SwapService`). Reads take `{ params, queryOptions }`; the six actions (`approve`, `createIntent`, `submitIntent`, `cancelIntent`, `createLimitOrder`, `submitTx`) are mutations taking `{ mutationOptions }`, with domain inputs flowing through `mutate(vars)`.

```ts
// @ai-snippets-skip
useSwapsApiQuote({ params: { body }, queryOptions });   // query    → sodax.api.swaps.getQuote
useSwapsApiSubmitTx({ mutationOptions });               // mutation → sodax.api.swaps.submitTx
useSwapsApiSubmitTxStatus({ params, queryOptions });    // query    → sodax.api.swaps.getSubmitTxStatus
```

These hooks forward the body verbatim, so `partnerFee` has no default (SDK fee config does not
apply). Put the same value on quote and create-intent:

```ts
// @ai-snippets-skip
const partnerFee = { address: '0xSonicFeeReceiver', percentage: 10 }; // 10 = 0.1% (bps)
const { data: quote } = useSwapsApiQuote({ params: { body: { ...quoteBody, partnerFee } } });
await createIntent({ body: { ...intentBody, partnerFee } });
```

See the `sodax-sdk` skill (integration mode), `swaps-api.md` § `partnerFee`.

### API key (`x-api-key`)

The backend guards `POST /swaps/*` with an API-key check. There is ONE instance-wide key: configure it
once on the provider config — `<SodaxProvider config={{ apiKey }}>` — and every `sodax.api.*` call these
hooks make carries it. `SodaxProvider` runs in the browser, so a key passed there (or read from
`NEXT_PUBLIC_*` / `VITE_*`) is public. To keep it private, leave `apiKey` out, point `api.baseURL` and
`solver.solverApiEndpoint` at the app's own backend proxy, and attach the key there: https://docs.sodax.com/developers/how-to/api-key-good-practices. Override per request via the hooks' existing `apiConfig` param
(`RequestOverrideConfig`), which also accepts `apiKey`:

```ts
// @ai-snippets-skip
const { data: quote } = useSwapsApiQuote({
  params: { body: quoteBody, apiConfig: { apiKey: 'partner-api-key' } },
});
```

Never put the key in a `queryKey` (the hooks already exclude `apiConfig` from their keys). Auth failures
surface with `context.status` `401`/`403` — nothing but a corrected key fixes them, so treat them as
terminal in your UI; the transient verification `503` is retried by the wire client. See the
`sodax-sdk` skill (integration mode), `swaps-api.md` § API key, for the precedence order.

Every retrying `useSwapsApi*`, `useLeverageYieldApi*` and `useBridgeApi*` hook already handles this: its
default `retry` is `retryUnlessAuthFailure` (exported from `@sodax/dapp-kit`), which retries transport
blips up to 3 times but never replays a 401/403. `useSwapsApiStatus`, `useSwapsApiSubmitTxStatus`,
`useLeverageYieldApiSubmitTxStatus` and `useBridgeApiSubmitTxStatus` additionally stop their 1s poll on a
rejected key, instead of re-requesting forever. So an invalid key surfaces once, fast, on `error`.

Override or compose it through `queryOptions` / `mutationOptions` when you want different behaviour:

```ts
// @ai-snippets-skip
const { data: quote } = useSwapsApiQuote({
  params: { body: quoteBody },
  queryOptions: { retry: (count, error) => !isAuthFailure(error) && count < 5 },
});
```

`isAuthFailure` (re-exported from `@sodax/sdk`) is the same guard the default uses — prefer it over
re-deriving `context.status`, so your UI and the hooks agree on what counts as terminal.

`useSwapsApiSubmitTx` is a mutation hook — per-call config (e.g. backend base URL) flows through `mutate(vars)`. The `request` is a `SubmitTxRequestV2` (`{ txHash, srcChainKey, walletAddress, intent, relayData }`):

```ts
// @ai-snippets-skip
const { mutateAsync: submitSwapTx } = useSwapsApiSubmitTx();
// request: SubmitTxRequestV2 — relayData is the string payload; intent carries bigint fields
await submitSwapTx({ request, apiConfig: { baseURL: 'https://...' } });
```

`useSwapsApiSubmitTxStatus` polls the processing status and returns `SubmitTxStatusResponseV2 | undefined`. Its query runs only when **both** `txHash` and `srcChainKey` are supplied — the status endpoint requires the source chain key:

```ts
// @ai-snippets-skip
const { data: status } = useSwapsApiSubmitTxStatus({ params: { txHash, srcChainKey } });
// status?.data?.status: 'pending' | 'relaying' | 'relayed' | 'posting_execution' | 'posted_execution' | 'solved' | 'failed'
```

> The full `useSwapsApi*` hook list (with polling + types) is in [hooks-index.md](../reference/hooks-index.md); key shapes in [querykey-conventions.md](../reference/querykey-conventions.md). For non-React callers, `sodax.api.swaps` is documented in the `sodax-sdk` skill (integration mode).

### Bridge API (`sodax.api.bridge`)

Typed React Query wrappers over the backend **Bridge API** — `useBridgeApi*` hooks over `sodax.api.bridge.*` (tokens, allowance, approve, create-bridge-intent, submit-tx + status, plus the fee / bridgeable-amount / bridgeable discovery quotes). They are the HTTP-API parallel of the on-chain `bridge/` hooks (`useBridge`/`useBridgeAllowance`/…, which drive `sodax.bridge`). Mirrors the swaps family minus the solver/intent surface; reads take `{ params, queryOptions }`, the three actions (`approve`, `createBridgeIntent`, `submitTx`) are mutations taking `{ mutationOptions }`.

```ts
// @ai-snippets-skip
useBridgeApiTokens({ params, queryOptions });           // query    → sodax.api.bridge.getTokens
useBridgeApiCreateBridgeIntent({ mutationOptions });    // mutation → sodax.api.bridge.createBridgeIntent
useBridgeApiSubmitTxStatus({ params, queryOptions });   // query    → sodax.api.bridge.getSubmitTxStatus
```

Two deltas vs the swaps hooks: the allowance/approve/create body is the **wire DTO** `CreateBridgeIntentParamsV2` (`inputToken`/`inputAmount`/`dstAddress`, not the SDK-domain names), and `useBridgeApiSubmitTx`'s `request` is a `BridgeSubmitTxRequestV2` whose `relayData` is the **FULL `{ address, payload }` object** (no `intent` field):

```ts
// @ai-snippets-skip
const { mutateAsync: submitBridgeTx } = useBridgeApiSubmitTx();
// request: BridgeSubmitTxRequestV2 — { txHash, srcChainKey, walletAddress, relayData } (full envelope)
await submitBridgeTx({ request, apiConfig: { baseURL: 'https://...' } });
```

`useBridgeApiSubmitTxStatus` polls (1s) and returns `BridgeSubmitTxStatusResponseV2 | undefined`, running only when **both** `txHash` and `srcChainKey` are supplied; terminal states are `executed` / `failed` (no `posting_execution`), and it also stops on a set `abandonedAt` or once the backend rejects the API key. Every retrying `useBridgeApi*` hook defaults `retry` to `retryUnlessAuthFailure`, exactly as the swaps and leverage-yield hooks do. The fee / bridgeable-amount / bridgeable quotes are computable client-side (config + vault math) — prefer the on-chain `useGetBridgeableAmount` / `sodax.bridge.*` for a no-round-trip read; `useBridgeApiFee` / `useBridgeApiBridgeableAmount` / `useBridgeApiIsBridgeable` mirror the backend endpoints for HTTP parity.

> Full list in [hooks-index.md](../reference/hooks-index.md); key shapes in [querykey-conventions.md](../reference/querykey-conventions.md). For non-React callers, `sodax.api.bridge` is documented in the `sodax-sdk` skill (integration mode).

### Leverage Yield API (`sodax.api.leverageYield`)

Typed React Query wrappers over the backend **Leverage Yield API** — `useLeverageYieldApi*` hooks over `sodax.api.leverageYield.*` (vault registry, vault reads, split deposit/withdraw quote + create-intent, deadline, allowance/approve, the intent lifecycle, gas/fees, submit-tx + status). They are the HTTP-API parallel of the on-chain `leverageYield/` hooks (`useLeverageYieldDeposit`/`useLeverageYieldWithdraw`/…, which drive `sodax.leverageYield`). A vault deposit/withdraw IS an intent-based swap, so the intent / gas / fee / submit-tx hooks mirror the swaps family; reads take `{ params, queryOptions }` and the actions are mutations taking `{ mutationOptions }`.

```ts
// @ai-snippets-skip
useLeverageYieldApiVaults({ params, queryOptions });          // query    → sodax.api.leverageYield.getVaults
useLeverageYieldApiEffectiveApr({ params, queryOptions });    // query    → sodax.api.leverageYield.getEffectiveApr
useLeverageYieldApiCreateDepositIntent({ mutationOptions });  // mutation → sodax.api.leverageYield.createDepositIntent
useLeverageYieldApiSubmitTxStatus({ params, queryOptions });  // query    → sodax.api.leverageYield.getSubmitTxStatus
```

Four deltas worth knowing:

- **Create-intent is split.** `useLeverageYieldApiCreateDepositIntent` (any token → `lsoda*`) vs `useLeverageYieldApiCreateWithdrawIntent` (`lsoda*` → any token), each with its own quote hook. Only the deposit path has an allowance step — a withdraw spends `lsoda*` from the hub wallet — so `useLeverageYieldApiAllowance` / `useLeverageYieldApiApprove` take the **deposit** body.
- **`useLeverageYieldApiSubmitTx`'s `request` carries `operation`.** `LeverageYieldSubmitTxRequestV2` is the swaps `SubmitTxRequestV2` plus a required `operation: 'deposit' | 'withdraw'`; `relayData` is the payload **string**, as for swaps.
- **Terminal submit-tx status is `solved`**, not the bridge API's `executed` — a vault swap is filled by the solver, so `posting_execution` applies too. `useLeverageYieldApiSubmitTxStatus` polls (1s) while both `txHash` and `srcChainKey` are supplied and stops on `solved` / `failed`, on a set `abandonedAt`, or once the backend rejects the API key.
- **`lsoda*` shares live in the derived HUB wallet, not the EOA.** Resolve it with `useGetUserHubWalletAddress` before reading `useLeverageYieldApiShareBalance` / `useLeverageYieldApiMaxWithdraw`, or the balance reads as zero.

```ts
// @ai-snippets-skip
const { mutateAsync: submitVaultTx } = useLeverageYieldApiSubmitTx();
// request: LeverageYieldSubmitTxRequestV2 — { txHash, srcChainKey, walletAddress, intent, relayData, operation }
await submitVaultTx({ request, apiConfig: { baseURL: 'https://...' } });
```

Prefer `useLeverageYieldApiApproveAndBroadcast` over `useLeverageYieldApiApprove`: a guarded deposit token can need its stale allowance cleared first, and the approve-and-broadcast hook owns plan → sign → broadcast → wait in that order (reporting each step through `onProgress`) and invalidates `['leverageYieldApi','allowance']` itself.

> Full list in [hooks-index.md](../reference/hooks-index.md); key shapes in [querykey-conventions.md](../reference/querykey-conventions.md). For non-React callers, `sodax.api.leverageYield` is documented in the `sodax-sdk` skill (integration mode).

## Shared utilities

Cross-cutting hooks used by other features.

```ts
// @ai-snippets-skip
useSodaxContext();                                  // Access the Sodax SDK instance
useHubProvider();                                   // Hub chain (Sonic) provider
useBalances({ params, queryOptions });              // SDK-backed wallet balances (no xService)
useXBalances({ params, queryOptions });             // Cross-chain token balances (needs xService)
useDeriveUserWalletAddress({ params, queryOptions }); // Hub wallet address (CREATE3)
useGetUserHubWalletAddress({ params, queryOptions }); // Hub wallet via wallet router
useEstimateGas({ mutationOptions });                // Gas estimation for raw tx
useStellarTrustlineCheck({ params, queryOptions });
useEstablishTrustline({ mutationOptions });         // useRequestTrustline is its deprecated 2.0.0 wrapper
useNearStorageCheck({ params, queryOptions });      // NEP-141 storage registration check (NEAR)
useRegisterNearStorage({ mutationOptions });        // NEP-141 storage_deposit (NEAR)
useNearStorageGate({ dstChainKey, token, accountId, walletProvider }); // composite NEAR receive-side gate
resolveNearStorageGate(chainKey, check);            // unwrapped util: gate-state from a useNearStorageCheck result
```

### `useXBalances` shape

```ts
// @ai-snippets-skip
type UseXBalancesParams = ReadHookParams<Record<string, bigint>, {
  xService: IXServiceBase | undefined;       // From @sodax/wallet-sdk-react's useXService
  xChainId: SpokeChainKey | undefined;
  xTokens: readonly XToken[];                // Tokens to fetch balances for
  address: string | undefined;
}>;
```

Note: the **request-side** field is `xChainId` (kept for the cross-chain abstraction it overlays). This is distinct from the v2-renamed token-side `chainKey` — don't conflate them.

Consumer must supply `xService` from `@sodax/wallet-sdk-react`:

```tsx
// @ai-snippets-skip
import { useXService, getXChainType } from '@sodax/wallet-sdk-react';
const xService = useXService({ xChainType: getXChainType(xChainId) });
const { data: balances } = useXBalances({ params: { xService, xChainId, xTokens, address } });
```

### `useBalances` shape (SDK-backed, no `xService`)

`useBalances` is the SDK-backed successor to `useXBalances`: it reads wallet balances straight from the core SDK (`sodax.spoke.getWalletBalances`) via the `SodaxProvider` context, so it needs **no** `xService` from `@sodax/wallet-sdk-react`. Both hooks still exist — prefer `useBalances` when the app already has a `SodaxProvider`; keep `useXBalances` when you're wiring balances through the wallet layer.

```ts
// @ai-snippets-skip
type UseBalancesParams = ReadHookParams<Record<string, bigint>, {
  chainKey: SpokeChainKey | undefined;       // the chain the read executes against
  tokens: readonly XToken[];                 // tokens to fetch balances for
  address: string | undefined;
}>;
```

The query runs only when `chainKey`, `address`, and `tokens.length > 0` are all present, refetching every 5s (same interval as `useXBalances`). `data` is a `Record<string, bigint>` mapping each token address to its balance in smallest units. queryKey: `['shared', 'balances', chainKey, tokens.map(t => [t.symbol, t.address]), address]`.

**`chainKey` decides the chain that is read.** The SDK ignores `token.chainKey`, so a token that does not live on `chainKey` reads as `0n` rather than erroring — commit the chain and the token list in the same state update. (`useXBalances` is the opposite: it derives the chain from `xTokens[0].chainKey` and ignores the `xChainId` you pass.)

**Failure model.** A token that could not be read is logged by the SDK and reported as `0n` — a flaky RPC and an empty wallet look the same, always in the conservative direction (under-reporting blocks a spend, never permits one). The query errors only when the whole batch is unusable: a mismatched `token.chainKey`, an RPC every token depends on, or a batch in which no token could be read at all.

**Chain-specific values.** Stellar XLM reports the *spendable* amount — total minus the minimum reserve and selling liabilities, not the raw balance. Bitcoin returns `0n` for Rune tokens, whose amounts the UTXO endpoint does not carry.

```tsx
// @ai-snippets-skip
// No `xService` — just the SodaxProvider context the hook reads internally.
const { data: balances } = useBalances({ params: { chainKey, address, tokens } });
const usdcBalance = balances?.[usdc.address] ?? 0n;
```

After a mutation, invalidate with the `invalidateBalances(queryClient, chainKey)` helper exported from `@sodax/dapp-kit` — it covers both `['shared','balances']` and `['shared','xBalances']`, which never match each other. Every dapp-kit mutation hook already calls it.

### Stellar prerequisites — use `useStellarGate`

Stellar has ordered prerequisites for a destination account, and they are invisible until they bite:
the account must **exist** on-chain, must **trust** the destination token, and — only if it does not —
must be able to **pay** for the trustline it needs. `useStellarGate` sequences them; prefer it over
wiring the pieces yourself.

```ts
// @ai-snippets-skip — illustrative only; real types pulled into agents below.
// Mirrors useNearStorageGate. Pass the DESTINATION chain/token/amount/account plus the destination
// wallet provider; the gate owns the `=== STELLAR_MAINNET` test and the native-token exemption.
const stellar = useStellarGate({ dstChainKey, token, amount, address, walletProvider });

// Exactly one of these is ever true, in this order:
if (stellar.needsActivation) await stellar.activate();        // account does not exist — sponsor pays
if (stellar.needsFunding) { /* send it XLM — needs no trustline */ }
if (stellar.needsTrustline) await stellar.requestTrustline();

// A check FAILED — state unknown, not unmet. Say so and offer the retry; otherwise the action is
// disabled with nothing on screen explaining why.
if (stellar.checkFailed) { /* render stellar.error?.message + a button calling stellar.retry() */ }

// Gate the downstream action on the whole gate, which also covers the checking and errored windows.
const disabled = stellar.blocksAction || /* … */ false;
```

Affordability is checked **after** the trustline, and the order matters: an account that already trusts
the asset needs no XLM, because the sender pays the fee and the subentry reserve is already locked.
Checking affordability first blocks a correctly-configured user who has merely spent their spendable
XLM, and tells them to fund an account that needs nothing.

`blocksAction` is fail-closed on an unknown state, deliberately: a payment to a non-existent account, or
of an untrusted asset, fails on-chain, so letting the action through on a failed check risks stranding
funds. That makes `checkFailed` load-bearing — it is the only way a UI can tell "we could not check"
apart from "you are missing something", and without it a transient Horizon failure reads to the user as
an inexplicably dead button.

Do NOT hand-roll this as `useStellarTrustlineCheck` + `useEstablishTrustline`. `hasSufficientTrustline`
**throws** for an account that does not exist, so a `!data` test reads a missing account as "needs a
trustline" and offers a button that cannot work. Read `isLoading`, never `isPending` — `isPending` stays
`true` for a disabled query and blocks forever.

The lower-level pieces remain available for custom wiring: `useStellarAccountStatus` (existence,
`canAffordTrustline`, and `trustlineMinXlmStroops` — the XLM one more trustline needs at the network's
current base reserve — from one Horizon account read), `useStellarAccountActive` (existence only),
`useStellarTrustlineCheck`, and `useEstablishTrustline` — a canonical mutation hook whose vars are
`{ token, amount, srcChainKey, walletProvider }` (NOT `account` / `asset`). `useRequestTrustline` still
exists as a deprecated wrapper preserving the 2.0.0 shape (`{ requestTrustline, isLoading, isRequested,
error, data }`, positional token ignored); write new code against `useEstablishTrustline`.

### NEAR storage registration

NEP-141 accounts must pay a one-time storage bond before they can receive a token — delivering to an unregistered account fails. The receive-side analogue of Stellar trustlines: gate any flow that delivers a token to the user on NEAR (swap output on NEAR, bridge into NEAR, money-market borrow/withdraw to NEAR). Use `useNearStorageGate` for app UI; use the lower-level `useNearStorageCheck` + `useRegisterNearStorage` pair when you need custom wiring.

```ts
// @ai-snippets-skip — illustrative only; real types pulled into agents below.
// useNearStorageCheck is a canonical read hook: { params: { token, accountId, chainId }, queryOptions }.
// `chainId` is a SpokeChainKey typed loosely — the hook returns `true` for non-NEAR chains (safe to
// gate conditionally) and `true` for native NEAR (not a NEP-141 token). data is a boolean;
// queryKey: ['shared', 'nearStorageCheck', chainId, token, accountId].
const { data: isRegistered, isLoading } = useNearStorageCheck({
  params: { token, accountId, chainId: ChainKeys.NEAR_MAINNET },
});

// useRegisterNearStorage IS a canonical mutation hook: { mutationOptions }, returns
// SafeUseMutationResult. Domain inputs flow through mutate / mutateAsync / mutateAsyncSafe.
// Vars: { token, accountId, walletProvider, deposit? } — deposit defaults to the NEP-141
// storage bond (0.00125 NEAR). mutationKey: ['shared', 'registerNearStorage'].
const { mutateAsyncSafe: registerStorage } = useRegisterNearStorage();
if (isRegistered === false) {
  await registerStorage({ token, accountId, walletProvider });
}
```

For the common UI path, `useNearStorageGate` returns `{ isNear, needsRegistration, blocksAction, isChecking, isRegistering, registerStorage }`.

Derive UI gate flags with the unwrapped `resolveNearStorageGate` util (no hook) when you need custom check/register composition:

```ts
// @ai-snippets-skip — illustrative only.
// resolveNearStorageGate(chainKey, check) reads `isLoading` + `data` off the useNearStorageCheck
// result and returns { isNear, needsRegistration, blocksAction }:
//   needsRegistration — show the register action (check resolved AND not registered)
//   blocksAction      — keep the downstream action disabled (still checking OR needs registration)
const check = useNearStorageCheck({ params: { token, accountId, chainId: dstChainKey } });
const { needsRegistration, blocksAction } = resolveNearStorageGate(dstChainKey, check);
```

The underlying SDK methods (`isStorageRegistered` / `registerStorage` on the NEAR spoke service, and the `NEAR_STORAGE_DEPOSIT` constant) are documented in the `sodax-sdk` skill (integration mode).

## Stellar account activation (sponsoring)

A Stellar account must exist on-chain before it can hold or receive anything, and a brand-new user
holds 0 XLM. The SODAX sponsoring service pays the account's base reserve via Stellar's
sponsored-reserve flow. **The user's own wallet must sign** — their signature is what authorises the
`endSponsoringFutureReserves` operation — so this can never be a server-only call.

```ts
// @ai-snippets-skip
useStellarAccountActive({ params: { address }, queryOptions });   // does the account exist on-chain?
useSponsorConfig({ queryOptions });                               // sponsor account, network, fee band
useActivateStellarAccount({ mutationOptions });                   // activate via the sponsor
```

Mutation vars:

```ts
// @ai-snippets-skip
// An alias for the SDK's own params — every option the service accepts is accepted here.
type UseActivateStellarAccountVars = ActivateStellarAccountParams;
//   address: string                        // must be the account walletProvider signs with
//   walletProvider: IStellarWalletProvider // useWalletProvider({ xChainId: ChainKeys.STELLAR_MAINNET })
//   allowSequenceRetry?: boolean           // default true — one rebuild + re-sign on a sequence conflict
//   maxHorizonRetries?: number             // default 2 — no-prompt re-submits of the SAME payload
//   onSignatureRequired?: (info: { attempt: 1 | 2; reason: 'initial' | 'sequenceConflict' }) => void
//   forceConfigRefresh?: boolean
//   requestConfig?: RequestOverrideConfig
```

Four things consumers get wrong:

1. **Activation makes the account able to RECEIVE, not to SEND.** A freshly activated account holds
   **zero spendable XLM** (the sponsor covers its reserve; `startingBalance` is `0`), so it cannot pay a
   fee or the reserve its own first trustline would lock. Use `useStellarGate`, which sequences
   activation → trustline → funding; pairing `useStellarTrustlineCheck` with `useEstablishTrustline`
   directly conflates "account missing" with "trustline missing" and offers a button that cannot work.
   Always render `checkFailed` / `error` / `retry` too — a fail-closed gate that cannot explain itself
   is a dead button.

2. **`alreadyActive` is a SUCCESS, not a no-op failure.** The result is
   `{ status: 'submitted', hash, attempts }` or `{ status: 'alreadyActive', hash: null, attempts }`.
   Render the second as "already active", not as an error. `attempts: 0` means the client pre-flight
   caught it and the user was never prompted.
3. **A sequence conflict costs a SECOND wallet prompt.** The sponsor's sequence number is baked into
   the signed payload, so if another activation lands first the transaction must be rebuilt and
   re-signed. Wire `onSignatureRequired` and show the explanation *before* the wallet steals focus —
   it fires immediately before each prompt.
4. **Never hardcode the sponsor account.** It comes from `useSponsorConfig` / the SDK's own fetch,
   which is what makes sponsor rotation a config change instead of a client release.

Failure handling: `error.context.nextAction` carries the caller's next step —
`fixIntegration` | `checkApiKey` | `rebuildAndResign` | `retrySameRequest` | `backoff` |
`contactOperator` | `abort` — alongside `retryable` and `requiresNewSignature`. Branch on those
rather than on the HTTP status.

When the server rate-limits a key it also supplies `error.context.retryAfterSeconds`; render "try again
in Ns" instead of a generic "try later". The SDK never auto-retries a rate limit.

Sponsoring needs its own sponsoring-specific key, issued by the SODAX team — a partner portal key is
rejected there. Set it on `api.sponsoringApiConfig.apiKey`; it wins wherever the slice points. Without it,
the instance-wide key from `<SodaxProvider config={{ apiKey }}>` is sent to sponsoring whenever the call
targets a SODAX gateway root, and a portal key sent there fails. An api key
in a browser bundle is public by nature; the service's per-key quotas, fleet cap, per-IP throttle,
and origin gating are the real controls. Proxy through your own backend if that is not acceptable.

## Default polling intervals

| Hook | Polling | Notes |
|---|---|---|
| `useBackendIntentByTxHash` | 1s | once a `txHash` is supplied (refetch is unconditional, not "while pending") |
| `useSwapsApiSubmitTxStatus` | 1s | requires `txHash` + `srcChainKey`; stops on `solved` / `failed` |
| `useSwapsApiStatus` | 1s | solver intent status; stops on status `3` / `4` |
| `useBackendOrderbook` | none | `staleTime: 30s` — fresh-window, no background refetch |
| `useBackendOracleMarkets` | none | `staleTime: 60s` |
| `useBackendOracleCandles` | none | `staleTime: 10s` — matches the ~10s server-side cache |
| `useExpiredUtxos` (bitcoin) | 60s | refetchInterval |
| `useQuote` (swap) | 3s | refetchInterval |
| `useStatus` (swap) | 3s | stops on status `3`/`4`, and after 40 consecutive NOT_FOUND fetches |
| `useSwapAllowance` (swap) | 2s | refetchInterval |
| `useMMAllowance` (mm) | 5s | refetchInterval; `enabled: false` for borrow/withdraw actions |
| Reserves data (mm) | 5s | `useReservesData` / `useReservesHumanized` / user position hooks |
| `useBalances` | 5s | refetchInterval |
| `useXBalances` | 5s | refetchInterval |
| `useLeverageYieldQuote` | 3s | refetchInterval; solver prices go stale |
| `useLeverageYieldDetailedStatus` | 3s | stops on the answering source's terminal state |
| `useLeverageYieldApiStatus` / `useLeverageYieldApiSubmitTxStatus` | 1s | stop on a terminal status |
| `useLeverageYieldShareBalances` | 15s | per holder |
| `useLeverageYieldPosition` | 30s | refetchInterval |
| `useLeverageYieldEffectiveApr` / `useLeverageYieldTotalAssets` / `useLeverageYieldPreviewRedeem` | 60s | Sonic RPC reads with no multicall: one APR refresh is six `eth_call`s per vault, so don't shorten these on a vault grid |
| `useLeveragePositionAccount` / `useLeveragePositionCollateral` | 30s | refetchInterval |
| `useLeveragePositionPending` | 15s | refetchInterval |
| Most others | None | |

All overridable via `queryOptions.refetchInterval`.

## Cross-references

- [`../recipes/backend-queries.md`](../recipes/backend-queries.md) — worked examples for intent tracking, orderbook, MM data.
- [`../recipes/wallet-connectivity.md`](../recipes/wallet-connectivity.md) — `useBalances` / `useXBalances` worked examples.
- [`features/auxiliary-services.md`](../../../migration-v1-to-v2/knowledge/features/auxiliary-services.md) — v1 → v2 porting.
- `sodax-sdk`: `integration/knowledge/features/auxiliary-services.md` — underlying SDK auxiliary surfaces (partner, recovery, backendApi).
