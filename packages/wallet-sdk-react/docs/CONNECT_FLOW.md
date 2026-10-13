# Connect Flow

The connect flow covers the full wallet lifecycle in `@sodax/wallet-sdk-react`: discover available connectors → connect to a wallet → read connected account state → disconnect. Every hook reads from the central Zustand store — no direct chain-SDK hook usage in user code.

The canonical hook surface is exported from [`src/hooks/index.ts`](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/src/hooks/index.ts).

## Table of contents

1. [Lifecycle overview](#lifecycle-overview)
2. [Discover connectors](#discover-connectors)
3. [Connect a wallet](#connect-a-wallet)
4. [Read connected account state](#read-connected-account-state)
5. [Disconnect](#disconnect)
6. [Provider-managed chains caveat](#provider-managed-chains-caveat)
7. [Persisted connections](#persisted-connections)
8. [Error handling](#error-handling)

---

## Lifecycle overview

```
useXConnectors  →  user picks a connector  →  useXConnect.mutateAsync(connector)
       │                                              │
       │                                              ↓
       │                              ChainActions.connect(connectorId)
       │                                              │
       │                                              ↓
       │                              setXConnection(xChainType, { xAccount, xConnectorId })
       │                                              │
       ↓                                              ↓
useXAccount(xChainType) ←─────────────  Zustand store  ─────────────→  useXConnection(xChainType)
                                                      │
                                                      ↓
                                            useXDisconnect({ xChainType })
                                                      │
                                                      ↓
                                              ChainActions.disconnect()
                                                      │
                                                      ↓
                                              unsetXConnection(xChainType)
```

**Single store, single source of truth** — every hook subscribes to the same Zustand slice. Connect mutations write through `setXConnection`; reads (`useXAccount`, `useXConnection`) reflect that immediately. Provider-managed chains (EVM/Solana/Sui) write via their Hydrator components instead of inside the mutation — see [Provider-managed chains caveat](#provider-managed-chains-caveat).

---

## Discover connectors

### `useXConnectors({ xChainType })` — connectors for one chain type

Returns the list of available connectors for a single chain family. Pass `xChainType` (`'EVM' | 'SOLANA' | 'BITCOIN' | …`).

```typescript
import { useXConnectors } from '@sodax/wallet-sdk-react';

function EvmWalletList() {
  const connectors = useXConnectors({ xChainType: 'EVM' });
  // connectors: IXConnector[] with { id, name, icon, isInstalled, installUrl, xChainType }
}
```

If the chain isn't enabled in `SodaxWalletProvider` config, `useXConnectors` returns `[]` and logs a one-time warning per chain.

`connector.isInstalled` reads `window.*` at render time (no extra subscription) — values stay fresh through normal React render triggers (store updates, parent re-renders).

### `useXConnectorsByChain()` — all chains at once

Returns connectors grouped by chain type. Useful for multi-chain wallet pickers.

```typescript
import { useXConnectorsByChain } from '@sodax/wallet-sdk-react';

function MultiChainPicker() {
  const byChain = useXConnectorsByChain();
  // byChain: Partial<Record<ChainType, IXConnector[]>>
  // e.g. { EVM: [...], SOLANA: [...], BITCOIN: [...] }
}
```

### `sortConnectors(connectors, { preferred })` — display ordering

Pure utility that sorts a connector list **stably** by:
1. Position in `preferred[]` (earlier wins)
2. `isInstalled === true`
3. Original order

```typescript
import { useXConnectors, sortConnectors } from '@sodax/wallet-sdk-react';

const PREFERRED = ['hana', 'metamask'] as const;

function ConnectorList() {
  const raw = useXConnectors({ xChainType: 'EVM' });
  const connectors = sortConnectors(raw, { preferred: PREFERRED });
  // Hana first if installed, then MetaMask, then any other installed wallets, then uninstalled.
}
```

---

## Connect a wallet

`useXConnect()` returns a React Query mutation. Pass an `IXConnector` to `mutate` / `mutateAsync` — the hook delegates to the chain's `ChainActions.connect()` and writes the connection state into the store on success.

```tsx
import { useXConnect, useXConnectors, useXAccount } from '@sodax/wallet-sdk-react';

function ConnectButton() {
  const connectors = useXConnectors({ xChainType: 'EVM' });
  const { mutateAsync: connect, isPending, error } = useXConnect();
  const account = useXAccount({ xChainType: 'EVM' });

  if (account.address) {
    return <span>Connected: {account.address}</span>;
  }

  return (
    <div>
      {connectors.map(connector => (
        <button
          key={connector.id}
          onClick={() => connect(connector)}
          disabled={isPending}
        >
          {connector.icon && <img src={connector.icon} alt="" width={20} height={20} />}
          {connector.name}
        </button>
      ))}
      {error && <p style={{ color: 'red' }}>{error.message}</p>}
    </div>
  );
}
```

The mutation throws `Error('Chain "<X>" is not enabled or ChainActions not registered')` if the connector's chain type isn't mounted in `SodaxWalletProvider` config.

---

## Read connected account state

Four read hooks expose the same store data at different granularities:

| Hook | Returns | Use case |
|------|---------|----------|
| `useXAccount({ xChainId })` | `XAccount` for the chain's family (resolves chain id → chain type) | Signing/reading at chain-id level (e.g. `useXAccount({ xChainId: ChainKeys.BSC_MAINNET })`) |
| `useXAccount({ xChainType })` | `XAccount` for that family | Family-level UI (e.g. EVM badge — one wagmi connection covers all 13 EVM chains) |
| `useXAccounts()` | `Partial<Record<ChainType, XAccount>>` for every enabled chain | Account list / multi-chain dashboard |
| `useXConnection({ xChainType })` | `XConnection \| undefined` | When you also need `xConnectorId` (e.g. to drive disconnect UX) |
| `useXConnections()` | `Partial<Record<ChainType, XConnection>>` | Aggregate UIs that care about connector identity per chain |

```typescript
import { useXAccount, useXAccounts, useXConnection } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/types';

// By chain id — narrows to EVM family
const evmAccount = useXAccount({ xChainId: ChainKeys.BSC_MAINNET });
// evmAccount: { address: '0x...' | undefined, xChainType: 'EVM', publicKey?: string }

// By chain type — same data, family-level UI
const solanaAccount = useXAccount({ xChainType: 'SOLANA' });

// All connected accounts at once
const accounts = useXAccounts();
// accounts.EVM, accounts.SOLANA, accounts.BITCOIN, ...

// With connector identity (for disconnect button labels, etc.)
const evmConnection = useXConnection({ xChainType: 'EVM' });
// evmConnection: { xAccount: XAccount, xConnectorId: string } | undefined
```

**`xChainId` vs `xChainType`** — `useXAccount` and `useWalletProvider` accept either, never both. `xChainId` (a `SpokeChainKey` like `ChainKeys.BSC_MAINNET`) is resolved to its family via `getXChainType()` internally. For EVM, the family-level view is correct because wagmi maintains a single connection across all configured EVM networks (see [`EVM_SWITCH_CHAIN.md`](./EVM_SWITCH_CHAIN.md)).

When no wallet is connected, `useXAccount` returns `{ address: undefined, xChainType }` (not `undefined`) so consumers don't need to null-check before reading `xChainType`.

---

## Disconnect

`useXDisconnect()` returns a callback. Invoke with the chain type to disconnect:

```tsx
import { useXDisconnect } from '@sodax/wallet-sdk-react';

function DisconnectButton() {
  const disconnect = useXDisconnect();
  return <button onClick={() => disconnect({ xChainType: 'EVM' })}>Disconnect EVM</button>;
}
```

The callback delegates to `ChainActions.disconnect()`. If no actions are registered (chain not enabled in config), it logs a warning and resolves silently — no throw.

Which layer clears the store differs by chain family. Non-provider chains clear it inside the action implementation: the default `disconnect` calls `unsetXConnection(xChainType)` in a `finally`, so the store clears even when the wallet's native disconnect throws (NEAR overrides `disconnect` with the same pattern). Solana and Sui actions only trigger the native adapter's disconnect and leave the write to their Hydrator. EVM is the exception to that single-writer rule — `EvmActions.disconnect` calls `unsetXConnection('EVM')` and `markUserDisconnected('EVM')` synchronously before awaiting wagmi's disconnect, so the UI stays consistent whether wagmi throws or hangs. It disconnects **every** wagmi connection, not only the current one: the SDK treats EVM as a single connection, so a wallet connected earlier in the session must not come back through a later connect without its own sign-in. Each wallet gets 10 s to confirm; one that stalls is logged and no longer awaited, so the returned promise always settles. wagmi drops a connection only once its disconnect finishes, though, so a wallet that stalls stays connected in wagmi and can come back on its next connect. With `EVM.privy` set, it also ends Privy when wagmi does not list it yet — a page-load restore still waiting on Privy — so that sign-out is never skipped.

---

## Provider-managed chains caveat

EVM, Solana, and Sui mount their native React adapters (wagmi, `@solana/wallet-adapter`, `@mysten/dapp-kit-react`) and use a **Provider/Hydrator/Actions trio**:

- `<ChainProvider>` — wraps native adapter context.
- `<ChainHydrator>` — sole writer of connection state into the store, watching native adapter hooks.
- `<ChainActions>` — registers `ChainActions.connect/disconnect` that trigger native SDK operations only.

Because of this split, **`useXConnect.mutateAsync(connector)` resolves with `undefined`** for EVM/Solana/Sui — connection state lands asynchronously when the Hydrator observes the wallet adapter's status flip from `disconnected` → `connected`. Read the connected account via `useXAccount` / `useXConnection` instead:

```typescript
const { mutateAsync: connect } = useXConnect();
const account = useXAccount({ xChainType: 'EVM' });

await connect(connector); // may resolve before account.address is populated
// Don't read connect's return value — read account.address from the next render.
```

Non-provider chains (Bitcoin, ICON, Injective, Stellar, NEAR, Stacks) write the connection state inside the mutation, so the resolved `XAccount` is reliable for those chains. Code defensively if you support both.

---

## Persisted connections

Connection state is persisted to `localStorage` (key: `xwagmi-store`) by Zustand's `persist` middleware. On page reload:

- **Provider-managed chains** — wagmi/wallet-adapter/dapp-kit auto-reconnect from their own persistence layer; the Hydrator observes and re-writes the store.
- **Non-provider chains** — `useInitChainServices` calls `reconnectIcon()` / `reconnectInjective()` / `reconnectStellar()` after hydration. ICON, Injective, and Stellar attempt to reconnect to the previously-connected wallet automatically.
- **Bitcoin** — `BitcoinXConnector.recreateWalletProvider` rebuilds the provider from `window.*` + the persisted `XAccount` (no popup), so signing works after reload without a reconnect call.
- **NEAR / Stacks** — no auto-reconnect. The user must re-connect manually after a reload.
- **Cleanup** — connections for chains no longer in `SodaxWalletProvider` config are removed via `cleanupDisabledConnections()` after persist hydration completes.

To detect when persisted state is ready (avoid disconnect flash on first paint), use [`useConnectedChains`](./CHAIN_DETECTION.md) and gate UI on `status === 'ready'`.

---

## Error handling

`useXConnect` errors fall into two categories:

**Configuration errors** — chain type isn't enabled. Message: `Chain "<X>" is not enabled or ChainActions not registered`. Fix by adding the slot to `SodaxWalletProvider` config.

**Wallet/runtime errors** — propagated from the underlying wallet SDK. Examples:

| Source | Message style |
|--------|---------------|
| User rejects in wallet popup | Wallet-specific (`"User rejected the request"`, `"User denied account authorization"`, etc.) |
| Wallet not installed | Non-provider chains throw `"<Wallet> is not installed"` (Stacks and Stellar append an install hint); provider-managed chains surface the native SDK error |
| Network mismatch | `"Chain not configured"` (wagmi) |

Read `mutation.error.message` and surface to UI; for install CTA, fall back to `connector.installUrl`:

```tsx
const { mutateAsync: connect, error } = useXConnect();

return (
  <>
    <button onClick={() => connect(connector).catch(() => {})}>Connect</button>
    {error && (
      <div>
        {error.message}
        {!connector.isInstalled && connector.installUrl && (
          <a href={connector.installUrl}>Install {connector.name}</a>
        )}
      </div>
    )}
  </>
);
```

For multi-chain modal flows that wrap connect with status + retry semantics, see [`WALLET_MODAL.md`](./WALLET_MODAL.md).

---

## Related docs

- [Configure SodaxWalletProvider](./CONFIGURE_PROVIDER.md) — chain-type slots, opt-in mounting
- [Wallet Provider Bridge](./WALLET_PROVIDER_BRIDGE.md) — `useWalletProvider` → typed `IXxxWalletProvider` for SDK calls
- [Wallet Modal](./WALLET_MODAL.md) — headless state machine (chainSelect → walletSelect → connecting → success | error)
- [Chain Detection](./CHAIN_DETECTION.md) — aggregate connected-chain views + hydration status
- [EVM Switch Chain](./EVM_SWITCH_CHAIN.md) — single wagmi connection across EVM networks
- [Connectors](./CONNECTORS.md) — `IXConnector` contract, deep imports for concrete classes
