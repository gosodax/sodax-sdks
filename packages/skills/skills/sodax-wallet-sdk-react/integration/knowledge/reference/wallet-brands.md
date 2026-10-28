# Reference: Wallet Brand Identifiers

`useBatchConnect`, `useBatchDisconnect`, and `useIsWalletInstalled` accept a `connectors: readonly string[]` of **wallet brand identifiers** — short strings that match by **case-insensitive substring** against `connector.id` and `connector.name` (see [`../recipes/batch-operations.md`](../recipes/batch-operations.md)).

The identifiers are **open**: any string works. The table below lists every brand the package ships connectors for so you can pick an identifier short enough to match across chain families. To target a specific connector (not a brand), bypass this API and use `useXConnectors({ xChainType }).find(c => c.id === '…')` directly — see [`../recipes/sub-path-imports.md`](../recipes/sub-path-imports.md).

---

## Known wallet brands

| Identifier | Chains it matches | Underlying connector id / name |
|---|---|---|
| `'hana'` | EVM, ICON, Sui, Stellar, Bitcoin | EVM via EIP-6963 RDNS (e.g. `io.havah.hana`); ICON id `hana`; Bitcoin id `hana-bitcoin`; Sui/Stellar — connector names containing "Hana" |
| `'phantom'` | EVM, Solana | EVM RDNS `app.phantom`; Solana adapter name `Phantom` |
| `'metamask'` | EVM, Injective | EVM RDNS `io.metamask`; Injective `Wallet.Metamask` strategy |
| `'xverse'` | Bitcoin, Stacks | Bitcoin id `xverse`; Stacks id `XverseProviders.BitcoinProvider` |
| `'unisat'` | Bitcoin | id `unisat` |
| `'okx'` | Bitcoin | id `okx-bitcoin` |
| `'leather'` | Stacks | id `LeatherProvider` |
| `'asigna'` | Stacks | id `AsignaProvider` |
| `'fordefi'` | Stacks | id `FordefiProviders.UtxoProvider` |
| `'tronlink'` | Tron | id `TronLink` |
| `'solflare'`, `'backpack'`, `'coinbase'`, `'trust'`, `'ledger'`, … | Solana | Adapter names from `@solana/wallet-adapter-wallets` |
| `'freighter'`, `'albedo'`, `'lobstr'`, `'xbull'`, … | Stellar | Names from `@creit.tech/stellar-wallets-kit` |

EVM (via EIP-6963), Solana, Sui, Stellar, and Injective surface connectors **dynamically** — the actual ids depend on what's installed in the user's browser. The table reflects names the upstream libraries ship by default.

---

## Picking a short identifier

Substring match is greedy. `'hana'` matches `Hana`, `io.havah.hana`, `hana-anything`. Trade-offs:

- **Shorter = broader.** `'hana'` matches everywhere Hana appears across chain families. Good for batch ops targeting a brand across many chains.
- **Longer = narrower.** `'io.metamask'` only matches the EIP-6963 RDNS — not Injective's MetaMask connector (which uses a different name string). Use when you specifically want one connector and nothing else.
- **`< 3 chars`** triggers a dev-mode warning — substring matching on 1–2 char identifiers (e.g. `'ok'`) hits unintended connectors. The package will keep working but logs once per identifier.

---

## Runtime discovery — list what's actually installed

The table above is a guide, not authoritative. Browser extensions evolve and RDNS strings change. To inspect the real environment:

```tsx
'use client';

import { useXConnectors } from '@sodax/wallet-sdk-react';
import { ChainTypeArr, type ChainType } from '@sodax/types';

const CHAINS: readonly ChainType[] = ChainTypeArr;

export function DevConnectorLister() {
  return (
    <table>
      <thead>
        <tr><th>Chain</th><th>id</th><th>name</th><th>installed</th></tr>
      </thead>
      <tbody>
        {CHAINS.flatMap((chainType) => (
          <ChainRow key={chainType} chainType={chainType} />
        ))}
      </tbody>
    </table>
  );
}

function ChainRow({ chainType }: { chainType: ChainType }) {
  const connectors = useXConnectors({ xChainType: chainType });
  return (
    <>
      {connectors.map((c) => (
        <tr key={`${chainType}-${c.id}`}>
          <td>{chainType}</td>
          <td><code>{c.id}</code></td>
          <td>{c.name}</td>
          <td>{c.isInstalled ? '✓' : '—'}</td>
        </tr>
      ))}
    </>
  );
}
```

Drop this component into your app during integration to print the live connector roster. Pick a short identifier from the `id` or `name` columns and feed it into `useBatchConnect({ connectors: [...] })`.

For one-off inspection (no UI):

```tsx
// @ai-snippets-skip
useEffect(() => {
  const all = CHAINS.flatMap((chainType) =>
    useXConnectors({ xChainType: chainType }).map((c) => ({ chainType, id: c.id, name: c.name, isInstalled: c.isInstalled })),
  );
  console.table(all);
}, []);
```

---

## When brand identifiers are the wrong tool

Reach for `useXConnectors({ xChainType }).find(c => c.id === '…')` + `useXConnect` directly when:

- **The brand list and chain list don't align.** e.g. "Connect Hana on EVM only, even though Hana also covers ICON" — the brand identifier API targets the wallet, not a chain/wallet pair.
- **You need to disambiguate two wallets with overlapping names.** `'wallet'` would match every wallet-named connector.
- **You're building a chain picker UI**, not a one-shot batch. Per-chain selection naturally uses `useXConnectors` per chain anyway.

See [`../recipes/sub-path-imports.md`](../recipes/sub-path-imports.md) for the worked code path.
