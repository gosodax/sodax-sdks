---
title: "@sodax/wallet-sdk-react"
icon: atom
generatedFrom: packages/wallet-sdk-react/README.md
---

React layer over [`@sodax/wallet-sdk-core`](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-core/README.md) — wallet connection, signing, and account management for the SODAX cross-chain ecosystem. Hooks read from a single Zustand store; per-chain native SDKs (wagmi, `@solana/wallet-adapter`, `@mysten/dapp-kit-react`, …) are wrapped behind a uniform `IXService` / `IXConnector` interface.

## Features

- **Unified wallet connectivity** across every supported chain family
  - EVM (Sonic hub, Ethereum, Arbitrum, Base, BSC, Optimism, Polygon, Avalanche, HyperEVM, Lightlink, Redbelly, Kaia, Hedera, Robinhood) — EIP-6963 + WalletConnect
  - Solana, Sui, Stellar, ICON, Injective, Bitcoin, NEAR, Stacks
- **Single-store state** — `useXAccount`, `useXConnection`, `useXAccounts` all read the same Zustand slice; persisted to `localStorage`
- **Bridge to `@sodax/sdk`** — `useWalletProvider` returns a typed `IXxxWalletProvider` ready to plug into any SDK call
- **Headless wallet modal** — `useWalletModal` state machine (chainSelect → walletSelect → connecting → success | error), render-agnostic
- **Batch operations** — connect/disconnect every chain a wallet identifier covers, in sequence
- **WalletConnect** — opt-in for enterprise custody (Fireblocks, etc.) via `config.EVM.walletConnect`
- **Email login (Privy)** — opt-in "Email (Privy)" EVM wallet via `config.EVM.privy` and `@sodax/wallet-sdk-react/privy`; needs `@privy-io/react-auth` 3.40+ (an optional peer — partners who skip it install nothing). The wallet is custodied by Privy: no signing while Privy is unreachable, addresses belong to your Privy app, a user who loses their email loses the wallet, and your Privy app is billed per signature. Read the [Privy guide](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/WALLET_PRIVY.md) before enabling it.

## Installation

```bash
pnpm add @sodax/wallet-sdk-react
# or
npm install @sodax/wallet-sdk-react
# or
yarn add @sodax/wallet-sdk-react
```

## Peer dependencies

```json
{
  "react": ">=19",
  "@tanstack/react-query": "5.x"
}
```

## Quick start

```tsx
import {
  SodaxWalletProvider,
  type SodaxWalletConfig,
  useXAccount,
  useXConnect,
  useXConnectors,
} from '@sodax/wallet-sdk-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChainKeys } from '@sodax/types';

const queryClient = new QueryClient();

const config: SodaxWalletConfig = {
  EVM: {
    ssr: true,
    chains: {
      [ChainKeys.SONIC_MAINNET]: { rpcUrl: 'https://rpc.soniclabs.com' },
      [ChainKeys.ETHEREUM_MAINNET]: { rpcUrl: 'https://ethereum-rpc.publicnode.com' },
    },
    // Optional: add WalletConnect support (requires wc projectId)
    // walletConnect: { projectId: '...' },
    // Optional: email login — privy() comes from the '@sodax/wallet-sdk-react/privy' sub-path (read the Privy guide first)
    // privy: privy({ appId: '...' }),
  },
  ICON: {
    chains: {
      [ChainKeys.ICON_MAINNET]: { rpcUrl: 'https://ctz.solidwallet.io/api/v3' },
    },
  },
};

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SodaxWalletProvider config={config}>
        <WalletConnect />
      </SodaxWalletProvider>
    </QueryClientProvider>
  );
}

function WalletConnect() {
  const connectors = useXConnectors({ xChainType: 'EVM' });
  const { mutateAsync: connect } = useXConnect();
  const account = useXAccount({ xChainType: 'EVM' });

  if (account.address) {
    return <p>Connected: {account.address}</p>;
  }

  return (
    <div>
      {connectors.map(connector => (
        <button key={connector.id} onClick={() => connect(connector)}>
          {connector.icon && <img src={connector.icon} alt="" width={20} height={20} />}
          {connector.name}
        </button>
      ))}
    </div>
  );
}
```

## Documentation

The full guide lives in [`docs/`](https://github.com/icon-project/sodax-sdks/tree/main/packages/wallet-sdk-react/docs). Start with the topic that matches what you're building.

| Topic | What it covers |
|-------|----------------|
| [Configure SodaxWalletProvider](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/CONFIGURE_PROVIDER.md) | `SodaxWalletConfig` shape, opt-in chain mounting, per-chain RPC + wallet defaults, breaking changes from v1 |
| [Connect Flow](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/CONNECT_FLOW.md) | Discover connectors, connect, read account, disconnect; provider-managed vs non-provider chains; persisted reconnect |
| [Wallet Provider Bridge](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/WALLET_PROVIDER_BRIDGE.md) | `useWalletProvider` → typed `IXxxWalletProvider` for `@sodax/sdk` calls; `useXService` / `useXServices` |
| [Wallet Modal](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/WALLET_MODAL.md) | Headless state machine for multi-chain modal UIs; `useConnectionFlow` non-modal alternative |
| [WalletConnect](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/WALLETCONNECT.md) | Enterprise custody integration (Fireblocks, Ledger); `qrModalOptions` filtering |
| [Email login (Privy)](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/WALLET_PRIVY.md) | `EVM.privy` setup, the Privy user in your app, sessions, custody and recovery, availability, chains, cost |
| [Batch Operations](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/BATCH_OPERATIONS.md) | Sequential multi-chain connect/disconnect by wallet identifier |
| [Chain Detection](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/CHAIN_DETECTION.md) | `useChainGroups`, `useConnectedChains`, `useIsWalletInstalled`, `useEnabledChains`; hydration status |
| [Sign Message](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/SIGN_MESSAGE.md) | `useXSignMessage` cross-chain; Bitcoin BIP-322 vs ECDSA auto-detect |
| [EVM Switch Chain](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/EVM_SWITCH_CHAIN.md) | Single wagmi connection across all configured EVM networks |
| [Connectors](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/CONNECTORS.md) | `IXConnector` contract, deep-import concrete classes, custom connectors |
| [Sub-path Exports](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/SUB_PATH_EXPORTS.md) | The `.` / `./xchains/*` export map, deep-import paths, and what is deliberately not exported |
| [Architecture](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/ARCHITECTURE.md) | Zustand store, Provider/Hydrator/Actions trio, persist hydration caveat |
| [Adding a New Chain](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/ADDING_A_NEW_CHAIN.md) | `ChainMeta` extension, chain registry, sub-path export wiring |

### Chain-not-enabled warnings

`useWalletProvider` and `useXConnectors` warn once per chain type when you ask for a chain that is not in `SodaxWalletProvider` `config.chains`, then return `undefined` / `[]`. The warning is a misconfiguration signal, so it is suppressed until `SodaxWalletProvider` has initialized its chain services — on the very first render `enabledChains` is still empty for every app, correctly configured or not. If you relied on seeing that warning during mount, it now arrives only once services are up, and only when the chain is genuinely absent from your config.

### Solana balance batching

Multi-token Solana balance reads batch the legacy SPL Token and Token-2022 associated-account candidates in requests of at most 100 accounts. Native SOL remains a separate balance request. If any of these RPC requests fails, `getBalances` rejects instead of reporting zero balances, so callers such as `useXBalances` surface an error and keep their last good data.

## AI agent docs

AI-readable docs for `@sodax/wallet-sdk-react` (and the other `@sodax/*` packages) are shipped via [`@sodax/skills`](https://github.com/icon-project/sodax-sdks/tree/main/packages/skills) — a separate npm package bundling Claude-Code SKILL.md files and a long-form knowledge tree.

**Recommended: [`skills` CLI](https://github.com/vercel-labs/skills)** — from your project root:

```bash
npx skills@latest add icon-project/sodax-sdks/packages/skills
```

**npm + `AGENTS.md` pointer** (fallback for web chats, or when you prefer a devDependency over the CLI):

```bash
pnpm add -D @sodax/skills
```

Then point your agent at `node_modules/@sodax/skills/AGENTS.md`. See [docs/ai-integration-guide.md](https://github.com/icon-project/sodax-sdks/blob/main/docs/ai-integration-guide.md) for all install modes and per-tool wiring.

---

## Sub-path exports

Concrete connector / service classes are **not** exported from the package barrel — they live behind sub-path imports to prevent accidental coupling to internals:

```typescript
// ✅ Normal usage — barrel import
import { useXConnect, useXAccount, type IXConnector } from '@sodax/wallet-sdk-react';

// ✅ Advanced — concrete class via deep import
import { XverseXConnector } from '@sodax/wallet-sdk-react/xchains/bitcoin';
if (connector instanceof XverseXConnector) {
  connector.setAddressPurpose('payment');
}
```

`@sodax/wallet-sdk-react/privy` is the one sub-path that is a feature, not a deep import: it exports `privy()` for `EVM.privy` and is the only entry that loads `@privy-io/react-auth`.

See [Connectors](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/CONNECTORS.md) for the full list of deep-import sub-paths.

## Requirements

- Node.js >= 22.12.0
- React >= 19
- TypeScript

## Development

```bash
pnpm install     # Install dependencies
pnpm build       # Build the package (ESM + CJS, multi-entry)
pnpm dev         # Watch mode
pnpm checkTs     # Type checking
pnpm test        # Run tests
pnpm pretty      # Format code
pnpm lint        # Lint code
```

## Contributing

Contributions welcome — see the repo [Contributing Guide](https://github.com/icon-project/sodax-sdks/blob/main/CONTRIBUTING.md). For onboarding a new chain family, follow [`docs/ADDING_A_NEW_CHAIN.md`](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/ADDING_A_NEW_CHAIN.md).

## License

[MIT](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/LICENSE)

## Support

- [GitHub Issues](https://github.com/icon-project/sodax-sdks/issues)
- [Discord Community](https://discord.gg/sodax-formerly-icon-880651922682560582)
