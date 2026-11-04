# Recipe: Setup — browser-extension mode

Construct a `*WalletProvider` from a wallet adapter that the user has already connected (MetaMask via wagmi, Phantom via wallet-adapter, Xverse via a kit, …).

**Depends on:** the consumer app already obtains a chain-specific signer / client from the extension. Inside a React app, prefer `useWalletProvider` from `@sodax/wallet-sdk-react` — see § "When to skip this recipe" below.

---

## Pick the right chain

Each chain has its own browser-extension variant. See [`../features/<chain>.md`](../features/) for exact field shapes.

| Chain | Required inputs |
|---|---|
| EVM       | `walletClient` (viem `WalletClient<Transport, Chain, Account>`) + `publicClient` (viem `PublicClient`) |
| Solana    | `wallet: { publicKey, signTransaction }` + `endpoint` |
| Sui       | `grpcUrl` + `address` + `signTransaction` (returns `{ bytes, signature }`) |
| Bitcoin   | `type: 'BROWSER_EXTENSION'`, `walletsKit` (consumer-supplied adapter), `network` |
| Stellar   | `type: 'BROWSER_EXTENSION'`, `walletsKit`, `network` |
| ICON      | `walletAddress` (optional `hx…`) + `rpcUrl` |
| Injective | `msgBroadcaster` |
| NEAR      | `wallet` (`NearConnector` from `@hot-labs/near-connect`) |
| Stacks    | `address` + optional `provider` (StacksProvider) |

---

## Pattern: EVM (with wagmi clients)

```ts
import { EvmWalletProvider } from '@sodax/wallet-sdk-core';
import type { WalletClient, PublicClient } from '@sodax/wallet-sdk-core';
import { useWalletClient, usePublicClient } from 'wagmi';
// …or wherever your app sources the viem clients

function buildProvider(walletClient: WalletClient, publicClient: PublicClient) {
  return new EvmWalletProvider({
    walletClient,
    publicClient,
    // Optional — `defaults.sendTransaction` and `defaults.waitForTransactionReceipt`
    // are honored. `defaults.transport / publicClient / walletClient` are IGNORED
    // in browser-extension mode (the provider logs a one-time warning).
    defaults: {
      sendTransaction: { gas: 1_000_000n },
    },
  });
}
```

---

## Pattern: Solana (with `@solana/wallet-adapter-react`)

```ts
import { SolanaWalletProvider } from '@sodax/wallet-sdk-core';
import { useWallet } from '@solana/wallet-adapter-react';

function buildProvider() {
  const { publicKey, signTransaction } = useWallet();
  return new SolanaWalletProvider({
    wallet: { publicKey, signTransaction },          // both may be null/undefined until connected
    endpoint: 'https://api.mainnet-beta.solana.com',
    defaults: { sendOptions: { skipPreflight: false } },
  });
}
```

---

## Pattern: Bitcoin / Stellar (explicit `type`)

```ts
import { BitcoinWalletProvider } from '@sodax/wallet-sdk-core';

const provider = new BitcoinWalletProvider({
  type: 'BROWSER_EXTENSION',
  walletsKit: myBitcoinAdapter,                       // implements BitcoinWalletsKit
  network: 'MAINNET',
});
```

The `walletsKit` is a consumer-provided adapter (Xverse / Unisat / OKX) that conforms to the `BitcoinWalletsKit` interface — see [`../features/bitcoin.md`](../features/bitcoin.md).

---

## When to skip this recipe

You almost never construct browser-extension providers **manually** inside a React component. The right path is:

```tsx
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/types';

const evm = useWalletProvider({ xChainId: ChainKeys.SONIC_MAINNET });
// evm: IEvmWalletProvider | undefined  ← already typed, already wired
```

`@sodax/wallet-sdk-react` handles the construction internally — see `sodax-wallet-sdk-react`: `integration/knowledge/recipes/setup.md`. Skip this recipe (the manual path) unless you are:

- Building a custom non-React frontend that talks to a wallet extension directly.
- Writing a thin wrapper around the package for a framework that doesn't have a SODAX integration yet.
- Migrating a legacy non-React app.

---

## Verification

```ts
console.log(await provider.getWalletAddress());      // smoke test
```

```bash
# Type check
pnpm checkTs

# Confirm no deep imports
grep -rn "@sodax/wallet-sdk-core/" <user-src> | grep -v "from '@sodax/wallet-sdk-core'"
# expect empty
```

---

## Common errors

| Error | Cause | Fix |
|---|---|---|
| `signTransaction is not a function` (Solana) | Wallet adapter didn't provide a signer for the connected wallet | Gate construction on `signTransaction != null`. |
| `Cannot read properties of undefined` inside the Sui signer, or a type error on `signTransaction` | `dAppKit.signTransaction` assigned directly | Wrap it — the config's callback takes the transaction positionally, dApp Kit's takes `{ transaction, … }`. |
| Sui wallet signs with the wrong account | `account` omitted from the wrapped `dAppKit.signTransaction` call | Pass it explicitly; dApp Kit defaults to whichever account is connected, not the `address` you configured. |
| `[EvmWalletProvider] defaults.{transport,publicClient,walletClient} ignored…` | Mixed PK-mode defaults with browser-extension config | Move those defaults out — they only apply in private-key mode. |
| Mode picked the wrong variant (TypeScript narrowing fails) | Mixed PK and browser fields | Pick **one** discriminated union variant. Don't pass both. |

---

## Next steps

- [`bridge-to-sdk.md`](./bridge-to-sdk.md) — hand off the provider to `@sodax/sdk` calls.
- [`library-exports.md`](./library-exports.md) — avoid taking `viem` / `@mysten/sui` / etc. as direct deps when importing types.
- [`defaults-and-overrides.md`](./defaults-and-overrides.md) — tune `defaults`.
