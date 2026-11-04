# Recipe: Chain & Wallet Detection

Aggregate views over the wallet store — what's enabled, what's connected, what's installed. Use these hooks to render chain pickers, "manage connections" panels, install CTAs, and hydration-safe UIs.

**Depends on:** [`setup.md`](./setup.md)

---

## Hooks at a glance

| Hook | Purpose |
|------|---------|
| `useEnabledChains()` | List chain types mounted in `SodaxWalletProvider` config |
| `useChainGroups({ order? })` | One row per enabled chain (with display + connection metadata) — for chain pickers |
| `useConnectedChains({ order? })` | List of currently-connected chains + hydration `status` — for "manage connections" |
| `useIsWalletInstalled({ connectors?, chainType? })` | Cross-chain install check — for gating "Install X" CTA |

EVM **collapses to a single row** — wagmi maintains one connection across every configured EVM network.

---

## `useEnabledChains` — what's mounted

```tsx
import { useEnabledChains } from '@sodax/wallet-sdk-react';

const enabled = useEnabledChains();
// e.g. ['EVM', 'SOLANA', 'BITCOIN']
```

Returns the slot keys in `SodaxWalletConfig` (`config.EVM`, `config.SOLANA`, …), not which chains have a wallet connected. Use cases:

- Render only chain rows the dApp opted into.
- Cross-reference with `useXConnections()` to compute "of N enabled chains, M are connected".
- Drive `<Tabs>` / `<Select>` UIs without hard-coding a list.

`useChainGroups` and `useConnectedChains` already filter by `useEnabledChains` internally — reach for it directly only when you need the raw list.

---

## `useChainGroups` — chain picker model

One `ChainGroup` per enabled chain type, with display metadata + connection status. Designed for the "select a chain" step in modals.

```tsx
'use client';

import { useChainGroups } from '@sodax/wallet-sdk-react';
import type { ChainType } from '@sodax/types';

export function ChainPicker({ onPick }: { onPick: (c: ChainType) => void }) {
  const groups = useChainGroups({ order: ['EVM', 'SOLANA', 'BITCOIN', 'ICON'] });

  return (
    <ul>
      {groups.map((group) => (
        <li key={group.chainType}>
          <button onClick={() => onPick(group.chainType)}>
            {group.iconUrl && <img src={group.iconUrl} alt="" width={24} height={24} />}
            <span>{group.displayName}</span>
            {group.isConnected && <span className="badge">Connected</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}
```

### `ChainGroup` shape

| Field | Type | Source |
|-------|------|--------|
| `chainType` | `ChainType` | The slot key (`'EVM'`, `'SOLANA'`, …) |
| `chainIds` | `readonly SpokeChainKey[]` | All chain keys sharing this `chainType` (e.g. every `ChainKeys.*` whose chain type is EVM, for `'EVM'`) |
| `displayName` | `string` | Default per-chain display name |
| `iconUrl` | `string \| undefined` | `undefined` = SDK doesn't ship one — provide your own |
| `isConnected` | `boolean` | `true` when an account is connected for this chain |
| `account` | `XAccount \| undefined` | Connected account |
| `connectorId` | `string \| undefined` | Active connector id when connected |

EVM's `chainIds` lists every configured EVM `ChainKey`, but the group itself is **one row**. Per-network switching belongs to [`switch-chain.md`](./switch-chain.md), not a separate group.

---

## `useConnectedChains` — connected list with hydration gate

Returns one entry per **currently-connected** chain (skipping the rest), with enriched connector metadata for "manage connections" UIs and status badges.

```tsx
// @ai-snippets-skip
'use client';

import { useConnectedChains } from '@sodax/wallet-sdk-react';

export function ConnectionList() {
  const { chains, total, status } = useConnectedChains();

  if (status === 'loading') return <Skeleton />;
  if (total === 0) return <ConnectCta />;

  return (
    <ul>
      {chains.map((chain) => (
        <li key={chain.chainType}>
          {chain.connectorIcon && <img src={chain.connectorIcon} alt="" />}
          <span>{chain.connectorName ?? chain.connectorId}</span>
          <code>{chain.account.address}</code>
        </li>
      ))}
    </ul>
  );
}
```

### `ConnectedChain` shape

| Field | Type | Notes |
|-------|------|-------|
| `chainType` | `ChainType` | |
| `account` | `XAccount` | Always populated (only included when address is non-empty) |
| `connectorId` | `string` | The persisted active connector |
| `connectorName` | `string \| undefined` | Looked up in `xConnectorsByChain` |
| `connectorIcon` | `string \| undefined` | |

### Result shape

```typescript
type UseConnectedChainsResult = {
  chains: ConnectedChain[];
  total: number;
  status: 'loading' | 'ready';
};
```

---

## `useIsWalletInstalled` — install detection

Read hook for gating "Connect" buttons on actual installation. Same identifier matching as `useBatchConnect` — see [`batch-operations.md`](./batch-operations.md).

```typescript
import { useIsWalletInstalled } from '@sodax/wallet-sdk-react';

// True if any Hana variant is installed across all enabled chains
const hasHana = useIsWalletInstalled({ connectors: ['hana'] });

// True if any wallet is installed for Bitcoin specifically
const hasBitcoinWallet = useIsWalletInstalled({ chainType: 'BITCOIN' });

// AND filter — Hana specifically on EVM
const hanaOnEvm = useIsWalletInstalled({ connectors: ['hana'], chainType: 'EVM' });
```

The type union enforces at compile time that **at least one of `connectors` / `chainType`** is present — `useIsWalletInstalled({})` is a type error. `connectors: []` is explicit "match nothing" — returns `false`.

---

## Hydration status — gate reload flicker

`useConnectedChains` exposes `status: 'loading' | 'ready'`. Use it to avoid the "Connect wallet" → "Connected" flash on page reload while Zustand rehydrates from `localStorage`:

```tsx
// @ai-snippets-skip
const { chains, status } = useConnectedChains();

// ❌ Flicker — `chains` is empty for one render before hydration completes
return chains.length >= 1 ? <Connected /> : <ConnectCta />;

// ✅ No flicker — wait for hydration before deciding
return status === 'loading'
  ? <Skeleton />
  : chains.length >= 1 ? <Connected /> : <ConnectCta />;
```

For first-paint correctness in SSR (Next.js), prefer `useConnectedChains.status` over an ad-hoc `useEffect(() => setMounted(true), [])` pattern — it's the official hydration signal.

`useChainGroups` does **not** expose this flag — its outputs are stable across hydration because connection-status fields (`isConnected`, `account`) start as `false` / `undefined` and gain values atomically when the persist middleware finishes.

---

## Display ordering

Both `useChainGroups` and `useConnectedChains` accept an `order?: readonly ChainType[]`:

1. Chains in the array render in array order.
2. Chains **not** in the array fall to the bottom, sorted alphabetically.
3. Without `order`:
   - `useChainGroups` follows the order of slots in `walletConfig` (config object key order).
   - `useConnectedChains` follows `ChainTypeArr` from `@sodax/types` — stable across reloads.

```typescript
const groups = useChainGroups({ order: ['EVM', 'ICON'] });
// EVM → ICON → the other enabled chains, alphabetically
```

For UIs that must not reflow on reload (header chain list, navigation), always pass `order`.

---

## Common patterns

### Pattern 1 — header connected-account chip

```tsx
// @ai-snippets-skip
function HeaderAccountChip() {
  const { chains, status } = useConnectedChains();

  if (status === 'loading') return null;
  if (chains.length === 0) return <ConnectButton />;

  return <span>{chains.length} chain{chains.length !== 1 ? 's' : ''} connected</span>;
}
```

### Pattern 2 — "install Hana" CTA when not installed

```tsx
// @ai-snippets-skip
function HanaCta() {
  const installed = useIsWalletInstalled({ connectors: ['hana'] });
  return installed ? null : (
    <a href="https://hana-wallet.com" target="_blank" rel="noreferrer">
      Install Hana Wallet
    </a>
  );
}
```

### Pattern 3 — chain selector in swap form

```tsx
// @ai-snippets-skip
function ChainSelector({ value, onChange }: { value: ChainType; onChange: (c: ChainType) => void }) {
  const groups = useChainGroups({ order: ['EVM', 'SOLANA', 'SUI'] });
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as ChainType)}>
      {groups.map((g) => (
        <option key={g.chainType} value={g.chainType}>
          {g.displayName} {g.isConnected ? '✓' : ''}
        </option>
      ))}
    </select>
  );
}
```

---

## Verification

```bash
# 1. Type check
pnpm checkTs

# 2. Manual — load page on slow 3G, confirm no Connect→Connected flash on reload
# 3. Manual — uninstall Hana, confirm CTA appears; reinstall, confirm CTA disappears
```
