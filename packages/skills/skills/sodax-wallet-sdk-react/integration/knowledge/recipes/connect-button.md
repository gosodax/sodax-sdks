# Recipe: Connect Button

Single-chain connect/disconnect button — pick a connector, connect, read the account, disconnect. Self-contained.

**Depends on:** [`setup.md`](./setup.md)

---

## Hooks used

| Hook | Purpose |
|------|---------|
| `useXConnectors({ xChainType })` | List available connectors for the chain family |
| `useXConnect()` | React Query mutation — `mutate(connector)` |
| `useXAccount({ xChainType })` | Read connected account (always returns object — `address` is `undefined` when disconnected) |
| `useXDisconnect()` | Returns `(args: { xChainType: ChainType }) => Promise<void>` |
| `sortConnectors(list, { preferred })` | Optional — rank installed/preferred wallets first |

---

## Connect button

```tsx
'use client';

import {
  useXConnectors,
  useXConnect,
  useXAccount,
  useXDisconnect,
  sortConnectors,
  type IXConnector,
} from '@sodax/wallet-sdk-react';

const PREFERRED = ['hana', 'metamask'] as const;

export function EvmConnectButton() {
  const raw = useXConnectors({ xChainType: 'EVM' });
  const connectors = sortConnectors(raw, { preferred: PREFERRED });
  const { mutateAsync: connect, isPending, error } = useXConnect();
  const account = useXAccount({ xChainType: 'EVM' });
  const disconnect = useXDisconnect();

  if (account.address) {
    return (
      <div>
        <code>{account.address}</code>
        <button onClick={() => disconnect({ xChainType: 'EVM' })}>Disconnect</button>
      </div>
    );
  }

  return (
    <div>
      {connectors.map((connector) => (
        <button
          key={connector.id}
          onClick={() => connect(connector).catch(() => {})}
          disabled={isPending}
        >
          {connector.icon && <img src={connector.icon} alt="" width={20} height={20} />}
          {connector.name}
          {!connector.isInstalled && ' (not installed)'}
        </button>
      ))}
      {error && <p style={{ color: 'red' }}>{error.message}</p>}
    </div>
  );
}
```

---

## Install CTA for missing wallets

```tsx
// @ai-snippets-skip
{connectors.map((connector) =>
  connector.isInstalled ? (
    <button key={connector.id} onClick={() => connect(connector)}>
      {connector.name}
    </button>
  ) : (
    <a key={connector.id} href={connector.installUrl} target="_blank" rel="noreferrer">
      Install {connector.name}
    </a>
  ),
)}
```

`isInstalled` reads `window.*` at render time (no extra subscription). For batch install detection across wallet brands, use `useIsWalletInstalled` — see [`batch-operations.md`](./batch-operations.md).

---

## Caveat — provider-managed chains resolve with `undefined`

For EVM, Solana, and Sui, `connect(connector)` resolves with `undefined` because connection state is set asynchronously after the native SDK adapter reports `connected`. Always read the account via `useXAccount`, not the mutation's return value:

```typescript
const { mutateAsync: connect } = useXConnect();
const account = useXAccount({ xChainType: 'EVM' });

await connect(connector); // resolves with undefined for EVM
// account.address is populated on the next render
```

Non-provider chains return the resolved `XAccount` from `connect()` — but reading via `useXAccount` works for both, so default to it.

---

## Multiple chains, one button

For a "connect EVM + Solana + Bitcoin in one click" pattern, use [`batch-operations.md`](./batch-operations.md):

```tsx
import { useBatchConnect } from '@sodax/wallet-sdk-react';

const { run, status } = useBatchConnect({ connectors: ['hana'] });
// Connects every chain Hana supports — sequential, errors collected.
<button onClick={run} disabled={status === 'running'}>
  Connect Hana on all chains
</button>;
```

---

## Variations

### Per-chain-id button (e.g. one button per EVM network)

⚠️ Not recommended for EVM — wagmi treats EVM as a **single connection across every configured network**. A per-Ethereum button rarely matches user expectations. If you really need per-chain-id resolution:

```tsx
// @ai-snippets-skip
import { ChainKeys } from '@sodax/types';

const account = useXAccount({ xChainId: ChainKeys.ETHEREUM_MAINNET });
```

### Sui / Solana / etc.

Replace `'EVM'` with the chain type the button targets:

```tsx
// @ai-snippets-skip
const connectors = useXConnectors({ xChainType: 'SUI' });
const { address } = useXAccount({ xChainType: 'SUI' });
```

---

## Verification

```bash
# 1. Type check
pnpm checkTs

# 2. Manual — load page, click connect, confirm address renders, reload page, confirm connection survives
```
