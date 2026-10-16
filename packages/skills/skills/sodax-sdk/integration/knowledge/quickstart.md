# Quickstart — `@sodax/sdk` v2

Get a `Sodax` instance running in your project. This guide is **`@sodax/sdk`-only**: no other SODAX packages are imported. Where the SDK needs an `I*WalletProvider` instance, examples use a TypeScript `declare` placeholder so the surface stays Core-SDK-clean.

## Section index

1. [Installation](#1-installation)
2. [TypeScript](#2-typescript)
3. [The wallet-provider contract](#3-the-wallet-provider-contract)
4. [Where to get wallet-provider implementations](#4-where-to-get-wallet-provider-implementations)
5. [Construct + initialize](#5-construct--initialize)
6. [Reads without a wallet](#6-reads-without-a-wallet)
7. [Build raw transactions (no wallet)](#7-build-raw-transactions-no-wallet)
8. [Calling methods that sign](#8-calling-methods-that-sign)
9. [First-time troubleshooting](#9-first-time-troubleshooting)

---

## 1. Installation

```bash
pnpm add @sodax/sdk
# or
npm install @sodax/sdk
# or
yarn add @sodax/sdk
```

**Don't add `@sodax/types` separately.** `@sodax/sdk` re-exports the entire types surface from its barrel. Adding `@sodax/types` as a direct dependency invites version skew on the next minor bump.

## 2. TypeScript

Targets Node 20.12+ and modern browsers. The package ships dual ESM (`.mjs`) + CJS (`.cjs`) + DTS, with `"type": "module"`. No additional TypeScript config needed — the package's `exports` field handles resolution for both `tsc` and `bundler` `moduleResolution` modes.

If you're on `moduleResolution: 'node'` (legacy), upgrade to `'bundler'` or `'node16'` / `'nodenext'` — `'node'` doesn't read the `exports` field and will fall back to `main` / `module` (which still work, but you may see resolution warnings).

## 3. The wallet-provider contract

Methods that sign and broadcast take a `walletProvider` parameter typed as the chain-specific `I*WalletProvider` interface (`IEvmWalletProvider`, `ISolanaWalletProvider`, `ISuiWalletProvider`, `IStellarWalletProvider`, `IIconWalletProvider`, `IInjectiveWalletProvider`, `IStacksWalletProvider`, `INearWalletProvider`, `IBitcoinWalletProvider`). All nine interfaces are exported from `@sodax/sdk`.

`@sodax/sdk` does **not** ship implementations of these interfaces. Read methods (`sodax.config.*`, `sodax.bridge.getBridgeableAmount`, `sodax.staking.getStakingConfig`, etc.) and `raw: true` flows do not require a `walletProvider`.

## 4. Where to get wallet-provider implementations

Two options:

1. **Implement the interface yourself.** Each `I*WalletProvider` is a small set of methods (`getWalletAddress`, plus chain-specific signing / broadcasting). Wrap whatever wallet abstraction your app already owns (`viem`'s `WalletClient` for EVM, `@solana/web3.js` keypairs for Solana, `@stellar/stellar-sdk` for Stellar, etc.) in an object literal that satisfies the interface.
2. **Use `@sodax/wallet-sdk-core`** — a separate SODAX package (not part of `@sodax/sdk`, not a transitive dependency — install it separately) that ships ready-made `I*WalletProvider` implementations for all 9 chain families with both private-key (Node / scripts) and browser-extension (dApp) modes. Refer to that package's own documentation for usage.

Examples in this guide use TypeScript `declare const` placeholders so the surface stays Core-SDK-only — substitute your own object regardless of which option you chose.

## 5. Construct + initialize

```ts
import { Sodax } from '@sodax/sdk';

const sodax = new Sodax();
await sodax.config.initialize();   // load fresh config from backend; falls back to packaged defaults

// All feature services are wired and ready:
//   sodax.swaps, sodax.moneyMarket, sodax.bridge, sodax.staking,
//   sodax.dex, sodax.migration, sodax.partners, sodax.recovery,
//   sodax.config, sodax.backendApi, sodax.hubProvider, sodax.spoke
```

`new Sodax()` accepts an optional `SodaxOptions` for custom RPC endpoints, solver / backend URLs, etc. — see [`recipes/`](recipes/) § "Initialize Sodax". `initialize()` is idempotent.

## 6. Reads without a wallet

Many SDK calls are pure reads — no wallet provider, no signing. They're the cheapest path to verifying an integration:

```ts
import { Sodax, ChainKeys } from '@sodax/sdk';

const sodax = new Sodax();
await sodax.config.initialize();

// Config / token lookups
const usdc = sodax.config.findSupportedTokenBySymbol(ChainKeys.ARBITRUM_MAINNET, 'USDC');
const isValid = sodax.config.isValidSpokeChainKey(ChainKeys.ARBITRUM_MAINNET);

// Money market
const supplyTokens = sodax.moneyMarket.getSupportedTokensByChainId(ChainKeys.ARBITRUM_MAINNET);

// Bridge
const limit = await sodax.bridge.getBridgeableAmount(USDC_ARBITRUM, USDC_STELLAR);
//   limit.value: BridgeLimit = { amount, decimals, type }

// Staking (hub-only reads — no chain context needed)
const stakingConfig = await sodax.staking.getStakingConfig();

// DEX
const pools = sodax.dex.clService.getPools();   // synchronous in v2
```

### Wallet balances (`sodax.spoke.getWalletBalance` / `getWalletBalances`)

Chain-agnostic reads of the balances a user's own address holds — the SDK dispatches to the right
chain family and reads the native coin or that chain's token standard (EVM erc20, Solana SPL, Sui
coin, Soroban contract, IRC-2, NEP-141, SIP-010, Injective bank denom, Bitcoin UTXOs). Distinct from
`getDeposit`, which reads the protocol asset manager rather than the user.

```ts
// @ai-snippets-skip
const one = await sodax.spoke.getWalletBalance({
  srcChainKey: ChainKeys.ARBITRUM_MAINNET,
  srcAddress: '0x…',          // the user
  token: usdc,                // a full XToken living on srcChainKey (token.chainKey is ignored)
});
// one: Result<bigint> — smallest units

const many = await sodax.spoke.getWalletBalances({
  srcChainKey: ChainKeys.ARBITRUM_MAINNET,
  srcAddress: '0x…',
  tokens: [usdc, weth],
});
// many: Result<Record<string, bigint>> — smallest units, keyed by token.address
if (many.ok) console.log(many.value[usdc.address]);
```

Contract worth internalising:

- **A token that could not be read is logged and reported as `0n`**, so one flaky token never
  discards the balances that did resolve. The flip side: a caller cannot tell a failed read from an
  empty wallet. The direction is deliberately conservative — under-reporting blocks a spend, it
  never permits one. Wire a `logger` into `new Sodax({ logger })` to surface those failures.
- The `Result` fails when the whole batch is unusable — an unknown chain key, a single shared
  round-trip every token depends on (ICON's `tryAggregate`, Injective's portfolio fetch), or a batch
  in which NO token could be read, which would otherwise render as "this wallet is empty on every
  asset".
- Batching is per chain: EVM/Sonic use multicall3, ICON one `tryAggregate`, Injective one portfolio
  fetch, Stellar one shared network + account fetch; the rest fan out per token.
- **Chain-specific values.** Stellar XLM reports the *spendable* amount (total minus the minimum
  reserve and selling liabilities). Bitcoin reads native BTC from its UTXO set and returns `0n` for
  Rune tokens, whose amounts that endpoint does not carry. Hedera's native balance is rescaled from
  the EVM layer's 18-decimal "weibar" to HBAR's canonical 8 decimals.

## 7. Build raw transactions (no wallet)

For sign-elsewhere flows (gnosis safe, hardware wallet, custom multi-sig), use `raw: true`. The SDK builds the unsigned payload; your application signs and broadcasts:

```ts
import { Sodax, ChainKeys } from '@sodax/sdk';

const sodax = new Sodax();
await sodax.config.initialize();

const result = await sodax.swaps.createIntent({
  params: {
    srcChainKey: ChainKeys.ARBITRUM_MAINNET,
    dstChainKey: ChainKeys.STELLAR_MAINNET,
    /* … rest of intent params */
  },
  raw: true,
  // walletProvider is FORBIDDEN when raw: true — TypeScript rejects it.
});

if (!result.ok) {
  console.error(result.error.toJSON());
  return;
}
const { tx, intent, relayData } = result.value;
// tx: chain-specific raw-tx payload (EvmRawTransaction, SolanaRawTransaction, …)
// Sign and broadcast `tx` with whatever signer your application owns.
```

## 8. Calling methods that sign

For signed flows, supply an `I*WalletProvider`. The example uses a TypeScript `declare` placeholder — at runtime, substitute an object your application owns (one you implemented to satisfy the interface, or one constructed via `@sodax/wallet-sdk-core`).

```ts
import { Sodax, ChainKeys, type IEvmWalletProvider } from '@sodax/sdk';

declare const evmWallet: IEvmWalletProvider;
//   ↑ At runtime, replace with your application's wallet-provider object.
//     Any object that satisfies IEvmWalletProvider works.

const sodax = new Sodax();
await sodax.config.initialize();

const result = await sodax.swaps.createIntent({
  params: {
    srcChainKey: ChainKeys.ARBITRUM_MAINNET,
    dstChainKey: ChainKeys.STELLAR_MAINNET,
    srcAddress: (await evmWallet.getWalletAddress()) as `0x${string}`,
    /* … rest of intent params */
  },
  raw: false,
  walletProvider: evmWallet,
});

if (!result.ok) {
  console.error(result.error.toJSON());
  return;
}

console.log('intent created:', result.value.tx);
```

The chain key on the payload (`ChainKeys.ARBITRUM_MAINNET`) is what TypeScript narrows the wallet-provider parameter against — passing a Solana wallet would be a compile-time error. See [`architecture.md`](architecture.md) § 6 for the `WalletProviderSlot<K, Raw>` mechanism.

## 9. First-time troubleshooting

The errors most likely to hit on a fresh install or first port.

### "Cannot find module '@sodax/sdk' or its corresponding type declarations"

- TypeScript `moduleResolution` is `'node'` (legacy). Switch to `'bundler'` or `'node16'`/`'nodenext'`.
- Or: clear `node_modules` and reinstall. `@sodax/sdk` ships dual exports; resolution should be automatic.

### "Module '\"@sodax/sdk\"' has no exported member 'SONIC_MAINNET_CHAIN_ID'"

- v1 constant name. Use `ChainKeys.SONIC_MAINNET`. See [`breaking-changes/type-system.md`](../../migration-v1-to-v2/knowledge/breaking-changes/type-system.md) § 1.

### "Object literal may only specify known properties, and 'walletProvider' does not exist in type ..."

- Forgot `raw: false` (or `raw: true`) discriminator on the call. Add it. See [`architecture.md`](architecture.md) § 6.

### "Property 'tx' does not exist on type 'SwapResponse'" or similar

- You're treating the return as the success value directly instead of unpacking `result.value`. v2 returns `Promise<Result<T>>` — branch on `result.ok` first. See [`architecture.md`](architecture.md) § 7.

### `sodax.config.findSupportedTokenBySymbol` returns `undefined`

- `await sodax.config.initialize()` wasn't called. Add it after `new Sodax()`.

### "Property 'xChainId' does not exist on type 'XToken'"

- `XToken.xChainId` was renamed to `XToken.chainKey`. See [`breaking-changes/type-system.md`](../../migration-v1-to-v2/knowledge/breaking-changes/type-system.md) § 4.

### "Type '{ token, amount, action }' does not satisfy the expected type 'MoneyMarketSupplyParams'"

- Missing `srcChainKey` and `srcAddress` (required in v2). See [`features/money-market.md`](features/money-market.md).

### "Argument of type 'string' is not assignable to parameter of type 'GetAddressType<K>'"

- For EVM chains, `GetAddressType<K>` is `` `0x${string}` ``. Cast at the boundary: `(await walletProvider.getWalletAddress()) as \`0x${string}\``. See [`recipes/`](recipes/) § "Chain-key narrowing".

### `sodax.config.initialize()` hangs / errors

- The backend API is unreachable. The SDK should fall back to packaged defaults silently — check your network, then check that `SodaxConfig.api.baseURL` is correct (or omit it for the default).

### Stellar bridge / swap fails with `'Trustline missing'`

- Stellar destinations require a trustline for the destination asset before they can receive it. See [`chain-specifics.md`](chain-specifics.md) § "Stellar trustline".

---

## Cross-references

- v2 architecture: [`architecture.md`](architecture.md).
- Recipes for common patterns: [`recipes/`](recipes/).
- Per-feature usage: [`features/`](features/).
- Lookup tables (chain keys, error codes, public API): [`reference/`](reference/).
- v1 → v2 porting: [`README.md`](../../migration-v1-to-v2/knowledge/README.md).
