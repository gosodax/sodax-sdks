---
"@sodax/types": minor
"@sodax/sdk": minor
"@sodax/wallet-sdk-core": minor
"@sodax/wallet-sdk-react": minor
---

Add Monad as a spoke chain (`ChainKeys.MONAD_MAINNET`, EVM network id 143).

Monad is EVM for wallets and addresses — `IEvmWalletProvider`, wagmi and `EvmChainKey` all cover it — but it has **no spoke contracts**: it settles through the **MPC relay** (relay id 48) in **address mode**. A deposit is a plain transfer, native MON or an ERC-20 `transfer`, to a deposit address the relay derives for that one payload and then sweeps into its reserve, so it needs no approval. A withdrawal is authorized with scheme 0, an EIP-191 `personal_sign` over the message hash.

New public surface:

- `@sodax/types` — `MonadChainKey`, `MonadSpokeChainConfig`, `isMonadChainKey`, and the `monad` entries in `spokeChainConfig`, `supportedTokensByChain` (native MON, USDC), `RelayChainIdMap` and `MpcRelayChainMap`. `IEvmWalletProvider` gains an **optional** `signMessage(hash)`, required only to withdraw from Monad, so existing providers stay valid.
- `@sodax/sdk` — `sodax.spoke.monad` (`MonadSpokeService`), `isMonadChainKeyType`, and `randomWithdrawNonce` / `MAX_SAFE_NONCE`, the withdraw-auth nonce every MPC-relay chain now shares. `DepositAddressResponse` is now a union discriminated by `depositMethod`: memo mode carries `reserveAddress` and `memo`, address mode carries `depositAddress`.
- `@sodax/wallet-sdk-core` — `EvmWalletProvider.signMessage` and Monad in `getEvmViemChain`.
- `@sodax/wallet-sdk-react` — Monad in the wagmi config.

A Monad **recipient** — swap `dstAddress`, money-market borrow/withdraw, bridge and recovery — is the plain 20-byte address, not the 32-byte word Tron and XRP use: `encodeRecipient` returns it as-is and rejects a malformed address.

Monad is swap-supported in the **staging** solver environment only (MON and USDC). **Money market** lists USDC only: MON has no vault, so it cannot be a lending-pool reserve. Bridge, partner-fee and recovery include Monad automatically.

`EvmSpokeOnlyChainKey` and `isEvmSpokeChainConfig` exclude Monad, so the EVM asset-manager paths — deposits through `EvmSpokeService`, and the allowance checks in money market, staking, DEX assets and migration — never reach a chain that has no asset manager.
