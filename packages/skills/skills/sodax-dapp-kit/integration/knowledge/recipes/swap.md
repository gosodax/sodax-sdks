# Recipe: Swap

Cross-chain token swaps via the intent-based solver.

**Depends on:** [setup.md](setup.md), [wallet-connectivity.md](wallet-connectivity.md)

## Hooks

| Hook | Type | Purpose |
|------|------|---------|
| `useQuote` | Query | Real-time swap quote (auto-refreshes 3s) |
| `useSwap` | Mutation | Execute a complete cross-chain swap |
| `useSwapAllowance` | Query | Check if token approval is needed |
| `useSwapApprove` | Mutation | Approve tokens for the swap contract |
| `useSwapLifecycle` | Composite | The whole swap form as one `state` + `next()`: approval strategy, destination gates, chain switch, swap, status |
| `useSwapWithApproval` | Mutation | `useSwap` with the approval folded in (one EIP-5792 signature where the wallet can batch) |
| `useSwapApprovalStrategy` | Query | Which approval path `useSwapWithApproval` takes |
| `useDetailedStatus` | Query | Track a swap by its source tx, whichever completion path ran (default status read) |
| `useStatus` | Query | Track the solver's status by hub tx hash |
| `useCancelSwap` | Mutation | Cancel an active swap intent |
| `useCreateLimitOrder` | Mutation | Create a limit order (no deadline) |
| `useCancelLimitOrder` | Mutation | Cancel an active limit order |

## Get a Quote

```tsx
import { useQuote } from '@sodax/dapp-kit';
import { ChainKeys } from '@sodax/sdk';

function SwapQuote({ inputAmount }: { inputAmount: bigint }) {
  const { data: quoteResult, isLoading } = useQuote({
    params: {
      payload: inputAmount > 0n
        ? {
            token_src: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
            token_dst: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
            token_src_blockchain_id: ChainKeys.BSC_MAINNET,
            token_dst_blockchain_id: ChainKeys.ARBITRUM_MAINNET,
            amount: inputAmount,
            quote_type: 'exact_input',
          }
        : undefined,
    },
  });

  if (isLoading) return <div>Fetching quote...</div>;
  if (quoteResult?.ok) return <div>Output: {quoteResult.value.quoted_amount}</div>;
  return null;
}
```

## Check Allowance + Approve

```tsx
import { useSwapAllowance, useSwapApprove } from '@sodax/dapp-kit';
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/sdk';
import type { CreateIntentParams } from '@sodax/sdk';

function SwapApproval({ intentParams }: { intentParams: CreateIntentParams }) {
  const walletProvider = useWalletProvider({ xChainId: ChainKeys.BSC_MAINNET });

  // useSwapAllowance wraps the request under params.payload and takes walletProvider + srcChainKey
  // alongside (all under `params`, not at the top level).
  const { data: isApproved } = useSwapAllowance({
    params: {
      payload: intentParams,
      srcChainKey: ChainKeys.BSC_MAINNET,
      walletProvider,
    },
  });
  const { mutateAsync: approve, isPending } = useSwapApprove();

  // useSwapAllowance data is `boolean | undefined` (already unwrapped from Result by the hook).
  if (isApproved) return null;
  return (
    <button onClick={() => walletProvider && approve({ params: intentParams, walletProvider })} disabled={isPending}>
      {isPending ? 'Approving...' : 'Approve Token'}
    </button>
  );
}
```

## Execute Swap

```tsx
import { useSwap } from '@sodax/dapp-kit';
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/sdk';
import type { CreateIntentParams } from '@sodax/sdk';

function SwapButton({ intentParams }: { intentParams: CreateIntentParams }) {
  const walletProvider = useWalletProvider({ xChainId: ChainKeys.BSC_MAINNET });
  const { mutateAsync: swap, isPending } = useSwap();

  const handleSwap = async () => {
    if (!walletProvider) return;
    try {
      const { solverExecutionResponse, intent, intentDeliveryInfo } = await swap({
        params: intentParams,
        walletProvider,
      });
      console.log('Swap successful!', solverExecutionResponse);
    } catch (e) {
      // surfaced via mutation.error / onError
    }
  };

  return (
    <button onClick={handleSwap} disabled={isPending || !walletProvider}>
      {isPending ? 'Swapping...' : 'Swap'}
    </button>
  );
}
```

## Track Status

Read status from the **source** tx you already hold after `swap()` — `useDetailedStatus` works whichever completion
path ran (backend submit-tx or the client-side relay fallback). `summarizeSwapStatus` collapses its two sources into
one vocabulary:

```tsx
import { useDetailedStatus } from '@sodax/dapp-kit';
import { summarizeSwapStatus, type SpokeChainKey } from '@sodax/sdk';

function SwapStatus({ srcChainKey, srcTxHash }: { srcChainKey: SpokeChainKey; srcTxHash: string }) {
  const { data } = useDetailedStatus({ params: { srcChainKey, srcTxHash } });
  if (!data?.ok) return <span>Checking status…</span>;
  const { state, fillTxHash } = summarizeSwapStatus(data.value);
  return <span>{state === 'solved' ? `Filled ${fillTxHash ?? ''}` : state}</span>;
}
```

Feed it `intentDeliveryInfo.srcChainKey` / `srcTxHash` on success. A `swap()` that fails **after** broadcast
(verification, relay or postExecution failure) still carries them on `error.context.srcChainKey` /
`error.context.srcTxHash` — keep polling, since the backend may still complete the swap.

## One Hook for the Whole Form

`useSwapLifecycle` composes the approval strategy, the destination gates (Stellar account + trustline, NEAR
storage), source-chain switching, `useSwapWithApproval` and `useDetailedStatus` into one discriminated `state` and
one `next()` action. Render from `state.kind`; wire the button to `next()`. Chain switching and app-owned setup
(e.g. a Bitcoin trading wallet) are passed in — dapp-kit does not depend on the wallet packages.

```tsx
import { useSwapLifecycle, type CreateIntentParams, type SwapLifecycleState } from '@sodax/dapp-kit';
import { useEvmSwitchChain, useWalletProvider, useXAccount } from '@sodax/wallet-sdk-react';

function buttonLabel(state: SwapLifecycleState): string {
  switch (state.kind) {
    case 'ready':
      if (state.approvalStrategy === 'atomic-batch') return 'Approve & Swap';
      return state.approvalStrategy === 'sequential' ? 'Approve, then Swap' : 'Swap';
    case 'needsChainSwitch':
      return 'Switch network';
    case 'needsSetup':
      if (state.reason === 'stellarActivation') return 'Activate account';
      if (state.reason === 'stellarTrustline') return 'Add trustline';
      if (state.reason === 'stellarCheckFailed') return 'Retry check';
      if (state.reason === 'nearStorage') return 'Register storage';
      if (state.reason === 'nearStorageCheckFailed') return 'Retry check';
      return 'Waiting on setup';
    case 'submitting':
    case 'pending':
      return 'Swapping…';
    case 'settled':
      return 'Swap again';
    case 'failed':
      return 'Try again';
    default:
      return 'Swap';
  }
}

// Nothing to click: waiting, a prerequisite only the user or the app can resolve, or a batch that may still land.
function isPassive(state: SwapLifecycleState): boolean {
  if (state.kind === 'needsSetup') return state.reason === 'stellarFunding' || state.reason === 'external';
  return ['idle', 'checking', 'submitting', 'pending', 'unconfirmed'].includes(state.kind);
}

function SwapButton({ intentParams }: { intentParams: CreateIntentParams }) {
  const srcWalletProvider = useWalletProvider({ xChainId: intentParams.srcChainKey });
  const dstWalletProvider = useWalletProvider({ xChainId: intentParams.dstChainKey });
  const dstAccount = useXAccount({ xChainId: intentParams.dstChainKey });
  const { isWrongChain, handleSwitchChain } = useEvmSwitchChain({ xChainId: intentParams.srcChainKey });

  const { state, error, next, reset, stellar } = useSwapLifecycle({
    intentParams,
    srcWalletProvider,
    dstWalletProvider,
    dstAccountAddress: dstAccount.address,
    chainSwitch: { isWrongChain, switchChain: handleSwitchChain },
  });

  return (
    <>
      <button type="button" onClick={() => void next()} disabled={isPassive(state)}>
        {buttonLabel(state)}
      </button>
      {state.kind === 'needsSetup' && state.reason === 'stellarFunding' && (
        <p>The destination Stellar account needs some XLM before it can add a trustline.</p>
      )}
      {state.kind === 'needsSetup' && state.reason === 'stellarCheckFailed' && <p>{stellar.error?.message}</p>}
      {state.kind === 'pending' && (
        <button type="button" onClick={reset}>
          Stop tracking
        </button>
      )}
      {state.kind === 'unconfirmed' && (
        <p>
          Your wallet sent the swap but it is not confirmed yet. Check your wallet activity before swapping again.{' '}
          <button type="button" onClick={reset}>
            Start over
          </button>
        </p>
      )}
      {error && state.kind !== 'unconfirmed' && <p>{error.message}</p>}
    </>
  );
}
```

`next()` resolves to the action's `Result` (a setup step or the swap); show a failed setup action from there. A failed
swap lands in `state`:

- before anything was sent → `failed`, and `next()` starts over;
- after the source tx was sent → `pending` with `error` set, because the backend may still complete it. It stays
  `pending` until the status read answers `solved` or `failed`. The read can stop polling without an error (after its
  budget of ambiguous reads), so keep a "stop tracking" `reset()` reachable throughout `pending`; it cancels nothing
  on-chain;
- an approve + swap batch the wallet accepted but that was not confirmed in time → `unconfirmed`. It may still land,
  so `next()` won't retry it; only `reset()` clears it.

Those last two hold even when `intentParams` changes (a refreshed quote rebuilds them), so a param edit cannot
re-enable the swap while the first one may still land. `next()` also ignores a call while the previous one is still
running, so a double click swaps once. A setup step reads `checking`, not `needsSetup`, while its tx is in flight and
until the check it invalidated has refreshed, so a second click cannot resend it.

A user who declines the smart-account upgrade a `'ready'` wallet asks for lands in `failed` with a `USER_REJECTED`
whose `context.reason` is `ACCOUNT_UPGRADE_DECLINED`. They refused the upgrade, not the swap: keep an
`allowAccountUpgrade` flag in your own state, pass it to `useSwapLifecycle`, and offer "swap without upgrading" by
setting it to `false` and calling `reset()`. The strategy then reads `'sequential'` and the next swap approves
separately. Whether to remember that choice across sessions is up to the app.

`submitting` covers the whole swap call: signing, and on the default backend path settlement too, so label it as
swapping, not as waiting for the wallet. Build `intentParams` once per confirmation (a rebuilt `deadline` is fine):
changing any other field starts a new lifecycle once the current swap is done (one that may still land holds until
`reset()`). `stellarFunding` and
`external` setup reasons are for the app to resolve; `next()` does nothing for them.

## Full Example

```tsx
import { useState } from 'react';
import { useQuote, useSwap, useSwapAllowance, useSwapApprove } from '@sodax/dapp-kit';
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/sdk';
import type { CreateIntentParams, SolverIntentQuoteRequest } from '@sodax/sdk';
import { parseUnits } from 'viem';

const SRC_TOKEN = '0x2170Ed0880ac9A755fd29B2688956BD959F933F8';
const DST_TOKEN = '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f';

export function SwapPage() {
  const [inputAmount, setInputAmount] = useState('');
  const walletProvider = useWalletProvider({ xChainId: ChainKeys.BSC_MAINNET });
  const parsedAmount = inputAmount ? parseUnits(inputAmount, 18) : 0n;

  // 1. Quote — useQuote takes { params: { payload: SolverIntentQuoteRequest } }.
  const { data: quoteResult, isLoading: isQuoting } = useQuote({
    params: {
      payload: parsedAmount > 0n
        ? {
            token_src: SRC_TOKEN,
            token_dst: DST_TOKEN,
            token_src_blockchain_id: ChainKeys.BSC_MAINNET,
            token_dst_blockchain_id: ChainKeys.ARBITRUM_MAINNET,
            amount: parsedAmount,
            quote_type: 'exact_input',
          }
        : undefined,
    },
  });

  // 2. Build intent params. The request-side fields are `srcChainKey` / `dstChainKey`
  // (distinct from the read-side `Intent.srcChain` / `Intent.dstChain` which are
  // `IntentRelayChainId` bigints — a separate shape).
  const intentParams: CreateIntentParams | undefined =
    quoteResult?.ok
      ? {
          inputToken: SRC_TOKEN,
          outputToken: DST_TOKEN,
          inputAmount: parsedAmount,
          minOutputAmount: BigInt(quoteResult.value.quoted_amount),
          deadline: 0n,
          allowPartialFill: false,
          srcChainKey: ChainKeys.BSC_MAINNET,
          dstChainKey: ChainKeys.ARBITRUM_MAINNET,
          srcAddress: '0x0000000000000000000000000000000000000000', // connected wallet address
          dstAddress: '0x0000000000000000000000000000000000000000', // destination address
          solver: '0x0000000000000000000000000000000000000000',
          data: '0x',
        }
      : undefined;

  // 3. Allowance — useSwapAllowance nests payload + srcChainKey + walletProvider under params.
  const { data: isApproved } = useSwapAllowance({
    params: intentParams
      ? { payload: intentParams, srcChainKey: ChainKeys.BSC_MAINNET, walletProvider }
      : undefined,
  });

  // 4. Approve + Swap (using mutateAsyncSafe — no try/catch, no unhandled rejections)
  const { mutateAsyncSafe: approve, isPending: isApproving } = useSwapApprove();
  const { mutateAsyncSafe: swap, isPending: isSwapping } = useSwap();

  const handleSwap = async () => {
    if (!intentParams || !walletProvider) return;
    if (!isApproved) {
      const r = await approve({ params: intentParams, walletProvider });
      if (!r.ok) { alert(r.error instanceof Error ? r.error.message : 'Approve failed'); return; }
    }
    const r = await swap({ params: intentParams, walletProvider });
    if (r.ok) alert('Swap successful!');
    else alert(r.error instanceof Error ? r.error.message : 'Swap failed');
  };

  return (
    <div>
      <input placeholder="Amount" value={inputAmount} onChange={(e) => setInputAmount(e.target.value)} />
      {isQuoting && <p>Fetching quote...</p>}
      {quoteResult?.ok && <p>Output: {quoteResult.value.quoted_amount}</p>}
      <button onClick={handleSwap} disabled={isSwapping || isApproving || !intentParams}>
        {isApproving ? 'Approving...' : isSwapping ? 'Swapping...' : 'Swap'}
      </button>
    </div>
  );
}
```

## Limit Orders

```tsx
import { useCreateLimitOrder, useCancelLimitOrder } from '@sodax/dapp-kit';
import type { Intent } from '@sodax/sdk';

const { mutateAsync: createLimitOrder } = useCreateLimitOrder();
const { mutateAsync: cancelLimitOrder } = useCancelLimitOrder();

// Limit orders have no deadline, must be cancelled manually.
// `useCancelLimitOrder` TVars are FLAT: `{ srcChainKey, intent, walletProvider }` (no `params` wrapper).
async function flow(intent: Intent) {
  if (!walletProvider) return;
  await createLimitOrder({ params: limitOrderParams, walletProvider });
  await cancelLimitOrder({ srcChainKey, intent, walletProvider });
}
```

## Customize TanStack Query behavior

Every mutation hook accepts an optional `mutationOptions` slot for consumers to override TanStack Query knobs (`retry`, `onError`, `mutationKey`, etc.). The hook's `mutationFn` throws on SDK failure (so `mutation.error`, `onError`, and `retry` engage natively); its own `onSuccess` invalidations run first on real success, then the consumer's `onSuccess` is awaited.

```tsx
import { useSwap } from '@sodax/dapp-kit';
import { useIsMutating } from '@tanstack/react-query';

const { mutateAsync: swap, isError, error } = useSwap({
  mutationOptions: {
    retry: 5,
    onError: err => toast.error(err.message),
    onSuccess: swapResponse => {
      // Runs AFTER dapp-kit's xBalances invalidations — only on confirmed success.
      trackSwap(swapResponse);
    },
  },
});

// Track in-flight swaps anywhere in the app via the default mutationKey
const swapsInFlight = useIsMutating({ mutationKey: ['swap'] });
console.log({ swap, isError, error, swapsInFlight });
```

## Gotchas

### Token list has duplicate addresses

`sodax.swaps.getSupportedSwapTokens()` returns `Record<SpokeChainKey, readonly XToken[]>`. Flattening it (e.g. `Object.values(...).flat()`) yields multiple tokens sharing the same contract address (same token on different chains). When rendering token lists, use a composite key like `${token.address}-${token.chainKey}` — not `token.address` alone. (`XToken` carries `chainKey`; there is no `blockchain_id` field.)

### Balance display

Two options, both in dapp-kit: `useBalances` (SDK-backed, needs only a `SodaxProvider`) or `useXBalances` (wallet-layer, needs an `xService` from `@sodax/wallet-sdk-react`). See `wallet-connectivity.md`.

## Types

```typescript
type CreateIntentParams = {
  inputToken: string;
  outputToken: string;
  inputAmount: bigint;
  minOutputAmount: bigint;
  deadline: bigint;            // 0n = no deadline
  allowPartialFill: boolean;
  srcChain: SpokeChainId;
  dstChain: SpokeChainId;
  srcAddress: string;
  dstAddress: string;
  solver: Address;             // address(0) = any solver
  data: Hex;
};
```
