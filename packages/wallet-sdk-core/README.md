# @sodax/wallet-sdk-core

The SODAX wallet-sdk-core is a core wallet SDK package containing implementations of wallet providers that enable multi-chain wallet connectivity. This package provides TypeScript implementations of wallet providers for various blockchain networks, making them compatible with the Core SODAX SDK (@sodax/sdk).

> **AI-friendly docs:** shipped via [`@sodax/skills`](https://github.com/gosodax/sodax-sdks/tree/main/packages/skills) — [`skills` CLI](https://github.com/vercel-labs/skills) recommended; npm + `AGENTS.md` pointer as fallback. See [docs/ai-integration-guide.md](https://github.com/gosodax/sodax-sdks/blob/main/docs/ai-integration-guide.md) for all install modes and per-tool wiring.

## Installation

```bash
# Using pnpm (recommended)
pnpm add @sodax/wallet-sdk-core

# Using npm
npm install @sodax/wallet-sdk-core

# Using yarn
yarn add @sodax/wallet-sdk-core
```

## Features

- **Multi-chain Support**: Wallet provider implementations for multiple blockchain networks
- **TypeScript Compatibility**: Fully typed implementations compatible with @sodax/sdk
- **Wallet Provider Interface**: Standardized interface for wallet connectivity across different chains
- **Core Integration**: Seamless integration with the Core SODAX SDK

## Supported Wallet Providers

The package includes wallet provider implementations for:
- EVM-compatible chains ✅
- Solana ✅
- Sui ✅
- Stellar ✅
- ICON ✅
- Injective ✅
- Near ✅
- Stacks ✅
- Bitcoin ✅
- Tron ✅
- TON ✅
- Zcash (transparent) ✅
- Cardano (CIP-30 wallets) ✅

## Public API surface

The package root exports:

- Wallet providers from `src/wallet-providers/*` (e.g. `EvmWalletProvider`, `SolanaWalletProvider`, `BitcoinWalletProvider`)
- `library-exports` from `src/types/library-exports.ts` (types and a few runtime values re-exported from upstream chain SDKs)

Internal utilities (e.g. `shallowMerge` in `src/utils/merge.ts`) are **not** exported from the package root.

## Config variants (private key vs browser/extension)

All providers support two modes, but **the union discriminant depends on the provider**:

- **Field presence (no `type` field in config)**: EVM, Solana, Sui, Near, Stacks, Icon, Injective, Tron, TON, Zcash
- **Single mode**: Cardano (`wallet` only; there is no private-key mode)
- **Explicit uppercase `type` field**: Bitcoin, Stellar (`'PRIVATE_KEY' | 'BROWSER_EXTENSION'`)

### EVM

```ts
import { EvmWalletProvider } from '@sodax/wallet-sdk-core';
import { ChainKeys } from '@sodax/types';

// Private key (Node/scripts/CI)
const evmPk = new EvmWalletProvider({
  privateKey: '0x...',
  chainId: ChainKeys.SONIC_MAINNET,
  rpcUrl: 'https://...',
  defaults: {
    sendTransaction: { gas: 3_000_000n },
  },
});

// Browser/extension (consumer supplies viem clients)
const evmBrowser = new EvmWalletProvider({
  walletClient: myViemWalletClient,
  publicClient: myViemPublicClient,
});
```

A connected wallet can also send several transactions as one atomic [EIP-5792](https://eips.ethereum.org/EIPS/eip-5792)
batch — one signature, all or nothing. A private-key account always reports `'unsupported'`.

```ts
const support = await evmBrowser.getAtomicBatchSupport(8453); // 'supported' | 'ready' | 'unsupported'
if (support !== 'unsupported') {
  const batchId = await evmBrowser.sendAtomicBatch([approveTx, transferTx], { expectedChainId: 8453 });
  const { status, receipts } = await evmBrowser.waitForBatch(batchId);
}
```

To withdraw from Monad, which settles through the MPC relay, the provider signs the withdraw authorization with
`signMessage(hash)`: EIP-191 `personal_sign` over the raw 32-byte hash. A Monad deposit is sent with
`expectedChainId: 143`, so a wallet on another network rejects it before broadcasting.

```ts
const signature = await evmPk.signMessage(withdrawHash); // 0x… 65-byte signature
```

`'ready'` means the wallet asks the user to upgrade the account (MetaMask: an EIP-7702 smart account) when the
first batch is sent.
`waitForBatch` reads the batch status again after a failed read, within its timeout and up to three reads.

### Solana

```ts
import { SolanaWalletProvider } from '@sodax/wallet-sdk-core';

const solanaPk = new SolanaWalletProvider({
  privateKey: new Uint8Array([]),
  endpoint: 'https://api.mainnet-beta.solana.com',
});

const solanaBrowser = new SolanaWalletProvider({
  wallet: {
    publicKey: myPublicKeyOrNull,
    signTransaction: mySignTransactionOrUndefined,
  },
  endpoint: 'https://api.mainnet-beta.solana.com',
});
```

### Bitcoin

```ts
import { BitcoinWalletProvider } from '@sodax/wallet-sdk-core';

const btcPk = new BitcoinWalletProvider({
  type: 'PRIVATE_KEY',
  privateKey: '0x...',
  network: 'TESTNET',
  defaults: { defaultFinalize: true },
});

const btcBrowser = new BitcoinWalletProvider({
  type: 'BROWSER_EXTENSION',
  walletsKit: myWalletsKit,
  network: 'TESTNET',
});
```

### Sui

Sui uses `mnemonics` (not `privateKey`) for private-key mode. Both modes speak gRPC-web — Mysten's public fullnodes stopped serving JSON-RPC in July 2026, and `sui-node` drops it in October 2026. Browser extension supplies the connected address plus a signer callback; the provider builds its own client.

`signTransaction` takes the transaction positionally. `dAppKit.signTransaction` is options-shaped, so wrap it rather than assigning it directly — and pass `account` explicitly, since dApp Kit otherwise signs with whatever account is currently connected, which need not be the `address` given here. `myWalletAccount` is dApp Kit's own `UiWalletAccount`, from `useCurrentAccount()` in React.

```ts
import { SuiWalletProvider } from '@sodax/wallet-sdk-core';

// Private key (Node/scripts/CI) — field presence discriminant
const suiPk = new SuiWalletProvider({
  grpcUrl: 'https://fullnode.mainnet.sui.io',
  mnemonics: '...',
});

// Browser/extension
const suiBrowser = new SuiWalletProvider({
  grpcUrl: 'https://fullnode.mainnet.sui.io',
  address: myWalletAccount.address,
  // The provider has already built the transaction against its client, so serializing it
  // is all the adapter has to do.
  signTransaction: async txn =>
    dAppKit.signTransaction({ transaction: await txn.toJSON(), account: myWalletAccount }),
});
```

### Stellar

Stellar uses an explicit uppercase `type` field (`'PRIVATE_KEY' | 'BROWSER_EXTENSION'`).

```ts
import { StellarWalletProvider } from '@sodax/wallet-sdk-core';

// Private key (Node/scripts/CI)
const stellarPk = new StellarWalletProvider({
  type: 'PRIVATE_KEY',
  privateKey: '0x...',
  network: 'PUBLIC',
  rpcUrl: 'https://...',
});

// Browser/extension
const stellarBrowser = new StellarWalletProvider({
  type: 'BROWSER_EXTENSION',
  walletsKit: myStellarWalletsKit,
  network: 'PUBLIC',
});
```

### Stacks

Stacks discriminates by field presence (no `type` field). The private-key config has `privateKey`; the browser-extension config has `address` (and optionally a `StacksProvider`).

```ts
import { StacksWalletProvider } from '@sodax/wallet-sdk-core';

// Private key (Node/scripts/CI)
const stacksPk = new StacksWalletProvider({
  privateKey: '...',
  endpoint: 'https://...',
});

// Browser/extension
const stacksBrowser = new StacksWalletProvider({
  address: 'SP...',
  endpoint: 'https://...',
  provider: myStacksProvider,
});
```

### ICON

ICON discriminates by field presence. The browser-extension config uses an optional `walletAddress` field (not a client object); `rpcUrl` is required in both modes.

```ts
import { IconWalletProvider } from '@sodax/wallet-sdk-core';

// Private key (Node/scripts/CI)
const iconPk = new IconWalletProvider({
  privateKey: '0x...',
  rpcUrl: 'https://...',
});

// Browser/extension (Hana wallet)
const iconBrowser = new IconWalletProvider({
  walletAddress: 'hx...',
  rpcUrl: 'https://...',
});
```

### Injective

Injective discriminates by field presence. The private-key config uses a nested `secret` object that accepts either `{ privateKey }` or `{ mnemonics }` — it is named `SecretInjectiveWalletConfig` rather than `PrivateKey*` to reflect this dual credential shape.

```ts
import { InjectiveWalletProvider } from '@sodax/wallet-sdk-core';

// Private key path — via secret credential
const injectivePk = new InjectiveWalletProvider({
  secret: { privateKey: '...' },
  chainId: myChainId,
  network: myNetwork,
});

// Mnemonics path — same config shape, different secret variant
const injectiveMnemonic = new InjectiveWalletProvider({
  secret: { mnemonics: '...' },
  chainId: myChainId,
  network: myNetwork,
});

// Browser/extension
const injectiveBrowser = new InjectiveWalletProvider({
  msgBroadcaster: myMsgBroadcaster,
});
```

### NEAR

NEAR discriminates by field presence. The private-key config requires `rpcUrl`, `accountId`, and `privateKey`; the browser-extension config wraps a `NearConnector`.

```ts
import { NearWalletProvider } from '@sodax/wallet-sdk-core';

// Private key (Node/scripts/CI)
const nearPk = new NearWalletProvider({
  rpcUrl: 'https://...',
  accountId: '...',
  privateKey: '...',
});

// Browser/extension
const nearBrowser = new NearWalletProvider({
  wallet: myNearConnector,
});
```

### Tron

Tron discriminates by field presence: `privateKey`, or the wallet's `tronWeb` plus `getProvider` returning the provider it announces over TIP-6963. See [`tron/types.ts`](https://github.com/gosodax/sodax-sdks/blob/main/packages/wallet-sdk-core/src/wallet-providers/tron/types.ts); both configs are constructed in [`TronWalletProvider.test.ts`](https://github.com/gosodax/sodax-sdks/blob/main/packages/wallet-sdk-core/src/wallet-providers/tron/TronWalletProvider.test.ts).

### TON

TON discriminates by field presence: `privateKey` (a 32-byte ed25519 seed; signs locally and sends from the key's
wallet-v4R2 address through toncenter), or `tonConnect` (a `TonConnectUI` instance; the wallet signs). See
[`ton/types.ts`](https://github.com/gosodax/sodax-sdks/blob/main/packages/wallet-sdk-core/src/wallet-providers/ton/types.ts).

`getWalletAddress()` returns the account's `0x`-prefixed ed25519 public key, which SODAX uses as the TON identity.
`getAccountAddress()` returns the friendly address the wallet sends from; pass it as `accountAddress` when reading
TON balances, since a TonConnect wallet need not be wallet-v4R2. In private-key mode, `sendTransaction` rejects a
transaction whose `validUntil` has passed and passes `validUntil` on as the transfer's expiry.

```ts
const tonPk = new TonWalletProvider({ privateKey: process.env.TON_PRIVATE_KEY!, apiKey: process.env.TONCENTER_KEY });
const tonBrowser = new TonWalletProvider({ tonConnect: tonConnectUI });
```

### Zcash

Zcash (transparent only) discriminates by field presence: `privateKey` (a secp256k1 key; the SDK builds the v5
transaction and the provider signs it with ZIP-244 digests through `signTransaction`), or `wallet` (a browser wallet such
as Noir that builds and broadcasts the payment itself through `sendTransfer`). See
[`zcash/types.ts`](https://github.com/gosodax/sodax-sdks/blob/main/packages/wallet-sdk-core/src/wallet-providers/zcash/types.ts).
`getWalletAddress()` returns the mainnet `t1…` address, and `signMessage` returns the 65-byte compact `signmessage`
signature a Zcash withdrawal is authorized with. Deposits also need the SDK's `chains.zcash.rpcUrl` set to an
address-indexed node.

```ts
const zecPk = new ZcashWalletProvider({ privateKey: process.env.ZCASH_PRIVATE_KEY! });
const zecBrowser = new ZcashWalletProvider({ wallet: noirAdapter });
```

### Cardano

Cardano takes a `wallet`: a structural CIP-30 adapter (`getAddress`, `signTx`, `submitTx`, `signData`) over an
injected wallet such as Lace, so the package takes no wallet dependency. There is no private-key mode. See
[`cardano/types.ts`](https://github.com/gosodax/sodax-sdks/blob/main/packages/wallet-sdk-core/src/wallet-providers/cardano/types.ts).
`getWalletAddress()` returns the bech32 `addr1…` key-hash payment address. The SDK builds the deposit itself; the
wallet only signs and submits it, and `signData` returns the COSE_Sign1 and COSE_Key a Cardano withdrawal is
authorized with. `cardanoAddressFromRawHex` turns the raw address hex CIP-30 returns into bech32.

```ts
const ada = new CardanoWalletProvider({ wallet: laceAdapter });
```

## Defaults and merge semantics

Each provider accepts optional `defaults`, and most methods accept per-call options. The SDK combines layers using a **shallow merge**:

- Only top-level keys are merged; **nested objects are replaced**, not deep-merged.
- `undefined` layers are skipped.
- `undefined` values inside a layer are skipped (so `{ field: undefined }` means “don’t override the previous layer”).

## `library-exports`

`library-exports` re-exports types (and a few runtime values) from underlying chain SDKs so consumers can reduce direct dependencies.

Example:

```ts
import type { WalletClient, PublicClient } from '@sodax/wallet-sdk-core';
```