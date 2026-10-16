# Wallet Modal

`useWalletModal` is a headless multi-chain wallet-connect lifecycle exposed as a discriminated state machine. It owns transitions between `closed → chainSelect → walletSelect → connecting → success | error`, dedupes concurrent connect attempts, and waits for provider-managed chains' Hydrators to land an account before signaling success. The hook is render-agnostic — pair it with any dialog, drawer, or inline UI.

For non-modal flows (single button with status + retry), use [`useConnectionFlow`](#useconnectionflow--non-modal-alternative) instead.

The canonical state union is [`WalletModalState`](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/src/useWalletModalStore.ts).

## Table of contents

1. [State machine](#state-machine)
2. [Hook API](#hook-api)
3. [Rendering — switch on `state.kind`](#rendering--switch-on-statekind)
4. [`selectWallet` lifecycle](#selectwallet-lifecycle)
5. [Smart `back()` navigation](#smart-back-navigation)
6. [`onConnected` side-effect callback](#onconnected-side-effect-callback)
7. [Hydration timeout](#hydration-timeout)
8. [WalletConnect QR modal caveat](#walletconnect-qr-modal-caveat)
9. [Cancellation semantics](#cancellation-semantics)
10. [`useConnectionFlow` — non-modal alternative](#useconnectionflow--non-modal-alternative)

---

## State machine

```
                       open()
        ┌──────────────────────────────────────┐
        │                                      ▼
   ┌─────────┐                          ┌──────────────┐
   │ closed  │ ◀─── close() ─────────── │ chainSelect  │
   └─────────┘                          └──────────────┘
        ▲                                      │
        │                                      │ selectChain(chainType)
        │ close() / back() ◀── success ◀───────┤
        │                                      ▼
        │                              ┌──────────────┐
        │                              │ walletSelect │ ◀─── back() ─────┐
        │                              └──────────────┘                  │
        │                                      │                          │
        │                          selectWallet(connector)                │
        │                                      │                          │
        │                                      ▼                          │
        │                              ┌──────────────┐                   │
        │                              │  connecting  │ ─── back() ───────┤
        │                              └──────────────┘                   │
        │                                  │       │                       │
        │                              ok  │       │  err                  │
        │                                  ▼       ▼                       │
        │                            ┌─────────┐  ┌────────┐               │
        └────── back() ◀──────────── │ success │  │ error  │ ──── back() ──┘
                                     └─────────┘  └────────┘
                                          │            │
                                     onConnected     retry()
                                          │
                                       (consumer
                                        calls
                                        close())
```

Six discriminated states:

| `state.kind` | Extra fields | Meaning |
|---|---|---|
| `'closed'` | — | Modal is dismissed |
| `'chainSelect'` | — | User picks a chain family (EVM / SOLANA / …) |
| `'walletSelect'` | `chainType` | User picks a wallet within the chosen family |
| `'connecting'` | `chainType`, `connector` | `selectWallet` in flight, waiting for wallet popup |
| `'success'` | `chainType`, `connector`, `account` | Connect resolved with a usable `XAccount` |
| `'error'` | `chainType`, `connector`, `error` | Connect failed; consumer can call `retry()` |

The state lives in `useWalletModalStore` — a Zustand slice **separate** from `useXWalletStore`. Modal lifecycle is ephemeral UI state with no persistence concerns; connection state is persisted independently. Direct store access is intentionally not part of the public surface — go through `useWalletModal()`.

---

## Hook API

```typescript
import { useWalletModal } from '@sodax/wallet-sdk-react';

const modal = useWalletModal({
  onConnected: async (chainType, account) => {
    // app side-effects after a successful connect
  },
  hydrationTimeoutMs: 5_000, // optional, default 5000ms
});

// modal.state           — current WalletModalState (discriminated by `kind`)
// modal.open()          — closed → chainSelect
// modal.close()         — any → closed
// modal.back()          — smart back (see below)
// modal.selectChain(chainType)
// modal.selectWallet(connector)  → Promise<XAccount | undefined>
// modal.retry()         → Promise<XAccount | undefined>  — re-runs from `error` state
```

The `selectWallet` and `retry` promises **never reject**. Failures populate `state.kind === 'error'` instead — render the error branch and offer a retry button.

---

## Rendering — switch on `state.kind`

```tsx
import { useEffect } from 'react';
import { useWalletModal } from '@sodax/wallet-sdk-react';

// Side effects (closing the modal, navigation, etc.) must run from useEffect, not directly
// during render — Strict Mode double-invokes renders in dev and would fire the effect twice.
function AutoClose({ onMount }: { onMount: () => void }) {
  useEffect(() => {
    onMount();
  }, [onMount]);
  return null;
}

function WalletModalRoot() {
  const modal = useWalletModal();

  switch (modal.state.kind) {
    case 'closed':
      return <button onClick={modal.open}>Connect Wallet</button>;

    case 'chainSelect':
      return (
        <Dialog onClose={modal.close}>
          <ChainList onPick={modal.selectChain} />
        </Dialog>
      );

    case 'walletSelect':
      return (
        <Dialog onClose={modal.close} onBack={modal.back}>
          <WalletList chainType={modal.state.chainType} onPick={modal.selectWallet} />
        </Dialog>
      );

    case 'connecting':
      return (
        <Dialog onClose={modal.close} onBack={modal.back}>
          <Spinner connector={modal.state.connector} />
          <p>Approve in {modal.state.connector.name}…</p>
        </Dialog>
      );

    case 'success':
      // Auto-close after onConnected fires.
      return <AutoClose onMount={modal.close} />;

    case 'error':
      return (
        <Dialog onClose={modal.close} onBack={modal.back}>
          <p>{modal.state.error.message}</p>
          {!modal.state.connector.isInstalled && modal.state.connector.installUrl && (
            <a href={modal.state.connector.installUrl}>Install {modal.state.connector.name}</a>
          )}
          <button onClick={modal.retry}>Retry</button>
        </Dialog>
      );
  }
}
```

Render the modal in **one place** at the app root — the state lives in a Zustand slice, so any header CTA or inline button can dispatch `modal.open()` without prop drilling.

---

## `selectWallet` lifecycle

`selectWallet(connector)` runs:

1. **Pre-check `connector.isInstalled`** — if false, transition straight to `error` with an install hint. Avoids legacy connectors imperatively opening install pages from inside `connect()` and leaving the state stuck in `connecting`.
2. **Transition to `connecting`** — sets `state = { kind: 'connecting', chainType, connector }`.
3. **Call `useXConnect.mutateAsync(connector)`** — opens the wallet popup. Non-provider chains return the `XAccount` directly; provider-managed chains (EVM/Solana/Sui) return `undefined`.
4. **For provider-managed chains, wait for the Hydrator** — subscribe to `useXWalletStore` and resolve when an `xConnections[chainType]` entry appears whose **`xConnectorId` matches the picked connector's id** (not just any address — see [`Cancellation semantics`](#cancellation-semantics)).
5. **Transition to `success`** with the resolved account, then fire `onConnected`.
6. **On error or timeout**, transition to `error`.

The promise returned by `selectWallet` resolves with the `XAccount` on success or `undefined` on error/cancellation — never rejects.

---

## Smart `back()` navigation

| From | `back()` goes to |
|------|------------------|
| `'walletSelect'` | `'chainSelect'` |
| `'connecting'` | `'walletSelect'` (preserves `chainType`) |
| `'error'` | `'walletSelect'` (preserves `chainType`) |
| `'success'` | `'closed'` |
| `'closed'` / `'chainSelect'` | no-op |

`connecting` → back preserves the chain so the user can pick a different wallet without reselecting the chain. The in-flight connect attempt is **dropped** when `back()` fires (see [`Cancellation semantics`](#cancellation-semantics)).

---

## `onConnected` side-effect callback

Fires once after a successful connect initiated through the modal. Use for app-specific side effects that don't belong in the SDK:

```typescript
const modal = useWalletModal({
  onConnected: async (chainType, account) => {
    await registerIfNew(chainType, account.address);
    if (await needsTosAcceptance(account.address)) {
      router.push('/terms');
    }
  },
});
```

Throwing inside `onConnected` is **non-fatal** — it's logged and the modal stays in `success`. The connection is already persisted in the store; downgrading to `error` would mislead the UI into showing a retry button for a connect that actually succeeded.

---

## Hydration timeout

For provider-managed chains (EVM/Solana/Sui), the connection becomes visible only when the Hydrator observes the native SDK's status flip. `hydrationTimeoutMs` caps how long `selectWallet` waits before transitioning to `error` with `Connection did not complete. Did you close the wallet popup?`.

```typescript
const modal = useWalletModal({
  hydrationTimeoutMs: 15_000, // raise for slow networks / wallets
});
```

Default: `5_000` ms. Ignored for non-provider chains (Bitcoin, ICON, Stellar, NEAR, Stacks, Injective) — those return the account directly from `connect()`.

---

## WalletConnect QR modal caveat

When the user picks an EVM WalletConnect connector, wagmi opens **its own** QR modal as a third-party UI. While that QR modal is visible, `useWalletModal` stays in `connecting` — two dialogs would stack visually. "Email (Privy)" behaves the same way with Privy's login dialog.

The SDK doesn't bake in a hide policy because partners want different UX. Detect those connectors and conditionally render `null`:

```typescript
if (
  modal.state.kind === 'connecting' &&
  ['walletConnect', 'privy'].includes(modal.state.connector.id)
) {
  return null; // let wagmi's QR modal / Privy's login dialog own the screen
}
```

The connector ids are `'walletConnect'` and `'privy'`. Resume rendering when the state transitions to `success` / `error`.

---

## Cancellation semantics

The state machine handles three concurrency cases that would otherwise corrupt the UI:

**Same connector double-clicked** — `selectWallet(connector)` returns the **same in-flight promise**, so two popups don't open and two state writes don't race.

**Different connector picked mid-attempt** — starts a new attempt; the previous attempt's late resolution is dropped. The previous connect's wallet popup may still be open, but the modal won't transition to `success`/`error` for it.

**`back()` / `close()` mid-attempt** — the in-flight attempt is cancelled at the modal layer. The wallet may already have approved by the time the user cancels — in that case `xConnections[chainType]` is populated by `useXConnect` / the Hydrator independently, but the modal stays in the user's chosen state (`walletSelect` or `closed`). **The account stays connected.** If full rollback is required, call `useXDisconnect({ xChainType })` from the same handler:

```tsx
const disconnect = useXDisconnect();

<button
  onClick={async () => {
    modal.close();
    if (modal.state.kind === 'connecting') {
      await disconnect({ xChainType: modal.state.chainType });
    }
  }}
>
  Cancel
</button>
```

The cancellation guard is implemented by reading the store directly (not the React snapshot) so user-driven transitions are observable inside the in-flight callback. See [`useWalletModal.ts`](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/src/hooks/useWalletModal.ts) for the exact `isStillCurrent` check.

---

## `useConnectionFlow` — non-modal alternative

When you don't need a multi-step modal — just `connect → status → retry` for a single button — use `useConnectionFlow`. It wraps `useXConnect` + `useXDisconnect` and surfaces the error on state instead of throwing.

```tsx
import { useConnectionFlow } from '@sodax/wallet-sdk-react';

function ConnectButton({ connector }: { connector: IXConnector }) {
  const { status, error, activeConnector, connect, retry, reset } = useConnectionFlow();

  if (status === 'error' && error) {
    if (activeConnector && !activeConnector.isInstalled) {
      return <a href={activeConnector.installUrl ?? '#'}>Install {activeConnector.name}</a>;
    }
    return (
      <div>
        <p>{error.message}</p>
        <button onClick={retry}>Retry</button>
        <button onClick={reset}>Dismiss</button>
      </div>
    );
  }

  return (
    <button onClick={() => connect(connector)} disabled={status === 'connecting'}>
      {status === 'connecting' ? 'Waiting for wallet…' : `Connect ${connector.name}`}
    </button>
  );
}
```

`useConnectionFlow` returns:

| Field | Type | Meaning |
|-------|------|---------|
| `status` | `'idle' \| 'connecting' \| 'success' \| 'error'` | Current attempt state |
| `error` | `Error \| null` | Last failure |
| `activeConnector` | `XConnector \| null` | Connector of the last attempt |
| `activeChainType` | `ChainType \| null` | Convenience accessor |
| `connect(connector)` | `Promise<XAccount \| undefined>` | Connect; never throws |
| `disconnect({ xChainType })` | `Promise<void>` | Same as `useXDisconnect` |
| `retry()` | `Promise<XAccount \| undefined>` | Re-runs the last `connect` |
| `reset()` | `void` | Clears `status` / `error` / `activeConnector` |

`connect()` and `retry()` never reject — errors flow into `error` so render code stays linear without `try/catch`.

---

## Related docs

- [Connect Flow](./CONNECT_FLOW.md) — the underlying `useXConnect` lifecycle
- [Configure SodaxWalletProvider](./CONFIGURE_PROVIDER.md) — opt in chain-type slots before users can pick them
- [Chain Detection](./CHAIN_DETECTION.md) — `useChainGroups` for the chain picker, `useIsWalletInstalled` for filtering
- [WalletConnect](./WALLETCONNECT.md) — `walletConnect` slot config + Fireblocks/custody filters
- [Email login with Privy](./WALLET_PRIVY.md) — `privy` slot config, the Privy user, custody trade-offs
- [Connectors](./CONNECTORS.md) — `IXConnector` contract for `selectWallet` argument
