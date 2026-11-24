# Recipe: Sub-Path Imports (Advanced)

When and how to use deep imports from `@sodax/wallet-sdk-react/xchains/<chain>`. Default to barrel imports — reach for sub-paths only when you need a concrete class for `instanceof` checks, custom connector lists, or chain-specific utilities not exposed through the public hooks.

**Depends on:** [`setup.md`](./setup.md)

---

## When you need it

The package barrel exports hooks, types, abstractions, and `SodaxWalletProvider`. Concrete chain-specific classes (`XverseXConnector`, `EvmXService`, `IconHanaXConnector`, …) live behind sub-paths to keep the barrel small. Reach for a sub-path import in three cases:

| Use case | Example |
|---|---|
| Runtime type check on a connector | `if (connector instanceof XverseXConnector) { … }` |
| Override the default connector list for a chain | Pass `connectors: [new MyConnector()]` to `ChainTypeConfig` |
| Call a chain-specific method not on `IXConnector` | `xverseConnector.setAddressPurpose('payment')` |

If none of the above applies, **stick with barrel imports** — sub-paths are not part of the typical surface.

---

## `instanceof` check (most common)

Tag a connector by class to call methods specific to that wallet:

```tsx
// @ai-snippets-skip
import { useXConnectors } from '@sodax/wallet-sdk-react';
import { XverseXConnector } from '@sodax/wallet-sdk-react/xchains/bitcoin';

function BitcoinConnectButton() {
  const connectors = useXConnectors({ xChainType: 'BITCOIN' });

  return (
    <>
      {connectors.map((connector) => (
        <button
          type="button"
          key={connector.id}
          onClick={async () => {
            // Pre-configure Xverse before connect
            if (connector instanceof XverseXConnector) {
              connector.setAddressPurpose('payment');
            }
            await connector.connect();
          }}
        >
          {connector.name}
        </button>
      ))}
    </>
  );
}
```

The barrel-typed `IXConnector` exposes only `connect()` / `disconnect()` / metadata fields. To reach `setAddressPurpose` (or any class-specific method), narrow via `instanceof` after a sub-path import.

---

## Custom connector list

Override the default connectors a chain ships with by passing `connectors` on the `ChainTypeConfig`:

```tsx
// @ai-snippets-skip
import type { SodaxWalletConfig } from '@sodax/wallet-sdk-react';
import { XverseXConnector, UnisatXConnector } from '@sodax/wallet-sdk-react/xchains/bitcoin';

const walletConfig: SodaxWalletConfig = {
  BITCOIN: {
    // Only mount Xverse + Unisat — drop the OKX connector that ships by default.
    connectors: [new XverseXConnector(), new UnisatXConnector()],
  },
};
```

Use sparingly — the default lists are tuned per chain. Override only when you need to remove a connector you do not support, or add a custom one you implemented yourself.

---

## Available sub-paths

For the per-chain symbol list, see [`../reference/api-surface.md`](../reference/api-surface.md) § "Sub-path exports". That table is the single source of truth — `check:ai-imports` in `@sodax/skills` validates that every sub-path import referenced in this knowledge tree resolves against `src/xchains/`.

---

## Verification

```bash
# 1. Type check
pnpm checkTs

# 2. Sub-path imports must resolve to a real chain folder
grep -rnE "from '@sodax/wallet-sdk-react/xchains/[a-z]+'" <user-src>
# Each match's <chain> must be a folder in node_modules/@sodax/wallet-sdk-react/dist/xchains/
```
