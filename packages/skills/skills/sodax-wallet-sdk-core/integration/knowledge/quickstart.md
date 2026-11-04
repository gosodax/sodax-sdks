# Quickstart — Copy/paste examples

Minimal end-to-end snippets per chain family. Pick the chain you need, copy the snippet, and run it. Each snippet covers **both** modes (private-key + browser-extension).

For chain-specific gotchas (Sui's mnemonics, Injective's `secret` wrapper, …) see [`features/<chain>.md`](./features/). For the mental model see [`architecture.md`](./architecture.md).

---

## Install

```bash
pnpm add @sodax/wallet-sdk-core @sodax/types
```

If you plan to call `@sodax/sdk` after constructing the provider, also add it:

```bash
pnpm add @sodax/sdk
```

---

## EVM (14 chains)

```ts
import { EvmWalletProvider } from '@sodax/wallet-sdk-core';
import { ChainKeys } from '@sodax/types';

// Private-key (Node / scripts / CI)
const evmPk = new EvmWalletProvider({
  privateKey: '0x…',
  chainId: ChainKeys.SONIC_MAINNET,
  rpcUrl: 'https://rpc.soniclabs.com',
  defaults: {
    sendTransaction: { gas: 3_000_000n },
  },
});
console.log(await evmPk.getWalletAddress());

// Browser-extension (consumer supplies viem clients)
const evmBrowser = new EvmWalletProvider({
  walletClient: myViemWalletClient,   // from wagmi / viem
  publicClient: myViemPublicClient,
});
```

See [`features/evm.md`](./features/evm.md).

---

## Solana

```ts
import { SolanaWalletProvider } from '@sodax/wallet-sdk-core';

// Private-key — secret key bytes (Uint8Array length 64)
const solanaPk = new SolanaWalletProvider({
  privateKey: new Uint8Array(64),
  endpoint: 'https://api.mainnet-beta.solana.com',
  defaults: {
    connectionCommitment: 'confirmed',
    sendOptions: { skipPreflight: false },
  },
});

// Browser-extension — wallet adapter context
const solanaBrowser = new SolanaWalletProvider({
  wallet: {
    publicKey: myPublicKey,           // PublicKey | null
    signTransaction: mySignTransaction, // SignerWalletAdapterProps['signTransaction'] | undefined
  },
  endpoint: 'https://api.mainnet-beta.solana.com',
});
```

See [`features/solana.md`](./features/solana.md).

---

## Sui

```ts
import { SuiWalletProvider } from '@sodax/wallet-sdk-core';

// Private-key — DERIVED FROM MNEMONIC, not a raw key
const suiPk = new SuiWalletProvider({
  grpcUrl: 'https://fullnode.mainnet.sui.io',
  mnemonics: 'word1 word2 … word12',
});

// Browser-extension — the provider owns the client; you supply the signer
const suiBrowser = new SuiWalletProvider({
  grpcUrl: 'https://fullnode.mainnet.sui.io',
  address: myActiveWalletAccount.address,       // string — from dApp Kit's UiWalletAccount
  // `signTransaction` takes the transaction positionally; dApp Kit's is options-shaped,
  // so wrap it. Name the account — otherwise dApp Kit signs with whichever one happens
  // to be connected.
  signTransaction: async txn =>
    dAppKit.signTransaction({ transaction: await txn.toJSON(), account: myActiveWalletAccount }),
});
```

See [`features/sui.md`](./features/sui.md).

---

## Bitcoin

```ts
import { BitcoinWalletProvider } from '@sodax/wallet-sdk-core';

// Private-key — uses explicit uppercase `type`
const btcPk = new BitcoinWalletProvider({
  type: 'PRIVATE_KEY',
  privateKey: '0x…',
  network: 'TESTNET',
  addressType: 'P2WPKH',                         // optional
  defaults: { defaultFinalize: true },
});

// Browser-extension — uses explicit uppercase `type`
const btcBrowser = new BitcoinWalletProvider({
  type: 'BROWSER_EXTENSION',
  walletsKit: myBitcoinWalletsKit,               // Xverse / Unisat / OKX adapter
  network: 'TESTNET',
});
```

See [`features/bitcoin.md`](./features/bitcoin.md).

---

## Stellar

```ts
import { StellarWalletProvider } from '@sodax/wallet-sdk-core';

// Private-key — explicit uppercase `type`
const stellarPk = new StellarWalletProvider({
  type: 'PRIVATE_KEY',
  privateKey: '0x…',
  network: 'PUBLIC',                              // 'PUBLIC' | 'TESTNET'
  rpcUrl: 'https://horizon.stellar.org',
});

// Browser-extension — explicit uppercase `type`
const stellarBrowser = new StellarWalletProvider({
  type: 'BROWSER_EXTENSION',
  walletsKit: myStellarWalletsKit,                // Freighter / xBull / Lobstr kit
  network: 'PUBLIC',
});
```

See [`features/stellar.md`](./features/stellar.md).

---

## ICON

```ts
import { IconWalletProvider } from '@sodax/wallet-sdk-core';

// Private-key (Node / scripts / CI)
const iconPk = new IconWalletProvider({
  privateKey: '0x…',
  rpcUrl: 'https://ctz.solidwallet.io/api/v3',
});

// Browser-extension — Hana wallet
const iconBrowser = new IconWalletProvider({
  walletAddress: 'hx…',                            // optional; resolved at first signing call if omitted
  rpcUrl: 'https://ctz.solidwallet.io/api/v3',
});
```

See [`features/icon.md`](./features/icon.md).

---

## Injective

```ts
import { InjectiveWalletProvider } from '@sodax/wallet-sdk-core';
import type { ChainId, Network } from '@sodax/wallet-sdk-core';

// Secret-credential variant: private key
const injectivePk = new InjectiveWalletProvider({
  secret: { privateKey: '…' },
  chainId: 'injective-1' as ChainId,
  network: 'Mainnet' as Network,
});

// Secret-credential variant: mnemonic
const injectiveMnemonic = new InjectiveWalletProvider({
  secret: { mnemonics: 'word1 word2 …' },
  chainId: 'injective-1' as ChainId,
  network: 'Mainnet' as Network,
});

// Browser-extension — caller supplies a configured MsgBroadcaster
const injectiveBrowser = new InjectiveWalletProvider({
  msgBroadcaster: myMsgBroadcaster,
});
```

> Note: the private-key variant uses a nested `secret` wrapper instead of a top-level `privateKey`. See [`features/injective.md`](./features/injective.md).

---

## NEAR

```ts
import { NearWalletProvider } from '@sodax/wallet-sdk-core';

// Private-key — accountId + raw key
const nearPk = new NearWalletProvider({
  rpcUrl: 'https://rpc.mainnet.near.org',
  accountId: 'alice.near',
  privateKey: 'ed25519:…',
});

// Browser-extension — NearConnector
const nearBrowser = new NearWalletProvider({
  wallet: myNearConnector,                          // from @hot-labs/near-connect
});
```

See [`features/near.md`](./features/near.md).

---

## Stacks

```ts
import { StacksWalletProvider } from '@sodax/wallet-sdk-core';

// Private-key (Node / scripts / CI)
const stacksPk = new StacksWalletProvider({
  privateKey: '…',
  endpoint: 'https://api.mainnet.hiro.so',
});

// Browser-extension — Leather / Xverse / Asigna
const stacksBrowser = new StacksWalletProvider({
  address: 'SP…',
  endpoint: 'https://api.mainnet.hiro.so',
  provider: myStacksProvider,                       // StacksProvider from @stacks/connect
});
```

See [`features/stacks.md`](./features/stacks.md).

---

## Next steps

After construction:

- **Get the wallet address** — every provider exposes `getWalletAddress(): Promise<string>` (narrowed to a chain-specific brand by subclasses).
- **Sign and broadcast** — see [`recipes/sign-and-broadcast.md`](./recipes/sign-and-broadcast.md) for the per-chain flow.
- **Hand off to `@sodax/sdk`** — see [`recipes/bridge-to-sdk.md`](./recipes/bridge-to-sdk.md).
- **Tune defaults** — see [`recipes/defaults-and-overrides.md`](./recipes/defaults-and-overrides.md).
- **Avoid direct chain-SDK deps** — see [`recipes/library-exports.md`](./recipes/library-exports.md).
