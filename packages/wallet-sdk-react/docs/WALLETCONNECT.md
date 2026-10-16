# WalletConnect

Default EVM wallet discovery uses [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963) — only browser-extension wallets surface. Partners using enterprise custody solutions (Fireblocks, Ledger Live, etc.) cannot install browser extensions; they need WalletConnect protocol to connect.

`@sodax/wallet-sdk-react` enables WalletConnect via the `walletConnect` field on the `EVM` chain-type slot. The field extends wagmi's [`WalletConnectParameters`](https://wagmi.sh/core/api/connectors/walletConnect) directly — every wagmi option is available.

The integration point is [`EvmProvider.tsx`](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/src/providers/evm/EvmProvider.tsx).

## Table of contents

1. [When you need WalletConnect](#when-you-need-walletconnect)
2. [Minimal setup](#minimal-setup)
3. [Restrict the modal — Fireblocks-only example](#restrict-the-modal--fireblocks-only-example)
4. [QR-modal stacking with `useWalletModal`](#qr-modal-stacking-with-usewalletmodal)
5. [Missing `projectId` — silent skip](#missing-projectid--silent-skip)
6. [WalletConnect is EVM-only](#walletconnect-is-evm-only)

---

## When you need WalletConnect

Add WalletConnect when the partner's user can't install a browser extension:

| Custody / wallet | Why WalletConnect |
|---|---|
| Fireblocks | No browser extension — workspace approval flows over WalletConnect |
| Ledger Live | Hardware-wallet wrapper, no EIP-6963 injection |
| Mobile-only wallets (Trust, Rainbow, MetaMask Mobile) | Browser session pairs with phone via QR |
| Coinbase Smart Wallet | Pop-up + WC fallback |

If your dApp only targets desktop browser wallets (MetaMask extension, Hana, Phantom EVM, etc.), you can omit `walletConnect` entirely — EIP-6963 covers them.

---

## Minimal setup

1. Get a WalletConnect Cloud project id at [https://cloud.walletconnect.com](https://cloud.walletconnect.com).
2. Pass it to `config.EVM.walletConnect.projectId`.

```typescript
import { SodaxWalletProvider, type SodaxWalletConfig } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/types';

const walletConfig: SodaxWalletConfig = {
  EVM: {
    ssr: true,
    chains: {
      [ChainKeys.SONIC_MAINNET]: { rpcUrl: 'https://rpc.soniclabs.com' },
      [ChainKeys.ARBITRUM_MAINNET]: { rpcUrl: 'https://arb1.arbitrum.io/rpc' },
    },
    walletConnect: {
      projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID!,
      // showQrModal, isNewChainsStale, qrModalOptions, etc.
    },
  },
};
```

A `walletConnect` connector is added to the wagmi config alongside any EIP-6963 wallets. `EvmHydrator` discovers it automatically — `useXConnectors({ xChainType: 'EVM' })` returns it in the same list as MetaMask, Hana, etc. **No UI changes required**.

The default behavior (`showQrModal: true`) lets wagmi/WalletConnect own the QR display. Pass `showQrModal: false` only if you render a custom QR modal.

---

## Restrict the modal — Fireblocks-only example

Some partners want **only** their custody wallet visible in the QR modal — no Trust / Rainbow / MetaMask Mobile noise. Use `qrModalOptions` to filter the WalletConnect Explorer list:

```typescript
const walletConfig: SodaxWalletConfig = {
  EVM: {
    ssr: true,
    chains: { [ChainKeys.SONIC_MAINNET]: { rpcUrl: 'https://rpc.soniclabs.com' } },
    walletConnect: {
      projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID!,
      qrModalOptions: {
        explorerRecommendedWalletIds: ['225affb176778569276e484e1b92637ad061b01e13a048b35a9d280c3b58970f'], // Fireblocks
        explorerExcludedWalletIds: 'ALL', // hide everything except recommended
      },
    },
  },
};
```

Key `qrModalOptions` fields (extends `QrModalOptions` from `@walletconnect/ethereum-provider`):

| Field | Effect |
|-------|--------|
| `explorerRecommendedWalletIds` | Wallet IDs to surface at the top of the list |
| `explorerExcludedWalletIds` | Wallet IDs to hide. `'ALL'` hides everything except recommended |
| `themeMode` | `'light' \| 'dark'` |
| `themeVariables` | CSS custom-property overrides |

Find wallet IDs in the [WalletConnect Explorer](https://walletconnect.com/explorer) — they're the long hex strings, not the human names.

---

## QR-modal stacking with `useWalletModal`

When the user picks the WalletConnect connector inside `useWalletModal`'s `walletSelect` state, wagmi opens its own QR modal. While that modal is up, `useWalletModal` stays in `connecting` — two dialogs would stack.

The SDK doesn't enforce a hide policy; partners decide. The recommended pattern is to render `null` while wagmi's modal is visible:

```typescript
import { useWalletModal } from '@sodax/wallet-sdk-react';

function WalletModalRoot() {
  const modal = useWalletModal();

  if (
    modal.state.kind === 'connecting' &&
    modal.state.connector.id === 'walletConnect'
  ) {
    return null; // let wagmi's QR modal own the screen
  }

  // ... render the rest of the state machine
}
```

The wagmi connector id is the literal string `'walletConnect'`. Resume rendering when the state transitions to `success` / `error`. See [`WALLET_MODAL.md`](./WALLET_MODAL.md#walletconnect-qr-modal-caveat) for the full discussion.

---

## Missing `projectId` — silent skip

If `walletConnect` is present but `projectId` is missing or empty, the WalletConnect connector is **silently skipped** at wagmi config time and a one-time warning is logged:

```
[wallet-sdk-react] walletConnect.projectId is required — WalletConnect connector skipped.
```

EIP-6963 wallets continue to work normally — the dApp degrades gracefully to extension-only mode. There is no runtime crash.

This behavior intentionally avoids forcing every developer to plumb `projectId` through environment variables in dev — they can leave `walletConnect: { /* no projectId */ }` commented or empty during local work and re-enable for production.

---

## WalletConnect is EVM-only

The `walletConnect` field exists only on the `EVM` slot. Other chain families (`SOLANA`, `BITCOIN`, etc.) use their own native wallet adapters and don't share the WalletConnect protocol layer.

To support Solana via WalletConnect-equivalent protocols (Solana Wallet Standard, Mobile Wallet Adapter), use the appropriate connectors registered in the `SOLANA` chain registry — those don't go through this `walletConnect` field.

---

## Related docs

- [Configure SodaxWalletProvider](./CONFIGURE_PROVIDER.md#walletconnect-evm-only) — full chain-type slot reference
- [Wallet Modal](./WALLET_MODAL.md) — `useWalletModal` state machine + QR-stacking pattern
- [Connect Flow](./CONNECT_FLOW.md) — discover/connect/disconnect lifecycle
- [Connectors](./CONNECTORS.md) — `IXConnector` contract; the WC connector surfaces with `id === 'walletConnect'`
- [wagmi WalletConnect docs](https://wagmi.sh/core/api/connectors/walletConnect) — full `WalletConnectParameters` reference
- [WalletConnect Cloud](https://cloud.walletconnect.com) — get a `projectId`
