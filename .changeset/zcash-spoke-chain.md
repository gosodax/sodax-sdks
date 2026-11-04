---
"@sodax/types": minor
"@sodax/sdk": minor
"@sodax/wallet-sdk-core": minor
"@sodax/wallet-sdk-react": minor
---

Add Zcash as a spoke chain (`ChainKeys.ZCASH_MAINNET`, chain type `'ZCASH'`). Transparent ZEC only.

Zcash settles through the **MPC relay** (relay id 133) in address mode: a deposit pays a t-address the relay derives for that one payload, and is keyed `133-<txid>-<output index>`. A Zcash account's SDK address is its mainnet `t1…` P2PKH address; its identity is the 20-byte hash160 of the compressed public key. Withdrawals use scheme 6, a Bitcoin-style `signmessage` over the text `0x<hash>`.

Deposits take one of two wallet shapes. A raw key signs a transaction the SDK builds: the SDK selects UTXOs, builds a v5 transaction with the deposit at output 0, signs it with ZIP-244 digests, checks the signed bytes pay exactly the deposit address and broadcasts. A browser wallet (Noir Wallet) builds and broadcasts the payment itself, and the SDK finds the output that pays the deposit address. Both need `chains.zcash.rpcUrl` set to a node with address indexing (`getaddressutxos`, `getaddressbalance`, `getrawtransaction`); the packaged default is empty.

New public surface:

- `@sodax/types` — `ZcashChainKey`, `ZcashSpokeChainConfig`, `ZcashUnsignedTransaction`, `ZcashTransparentInput`, `ZcashTransparentOutput`, `ZcashTransferParams`, `ZcashRawTransaction`, `ZcashReturnType`, `ZcashRawTransactionReceipt`, `ZcashGasEstimate`, `IZcashWalletProvider`, `isZcashChainKey`, `ZCASH_CHAIN_KEYS`, and the `zcash` entries in `spokeChainConfig` and `supportedTokensByChain` (native ZEC). `MpcWithdrawScheme` gains `6`.
- `@sodax/sdk` — `sodax.spoke.zcash` (`ZcashSpokeService`), `isZcashChainKeyType`, and the transparent helpers (`zcashIdentityBytes`, `zcashHashToAddress`, `zcashP2pkhScript`, `zcashZip317Fee`, `parseZcashV5Outputs`). `encodeAddress` / `reverseEncodeAddress` handle t-addresses.
- `@sodax/wallet-sdk-core` — `ZcashWalletProvider` in raw-key mode (`signTransaction`) and browser-wallet mode (`sendTransfer`), plus `serializeZcashV5` and `zip244SignatureDigest`.
- `@sodax/wallet-sdk-react` — `ZcashXService` and the Noir Wallet `ZcashXConnector`, wired into `chainRegistry` under the `ZCASH` config slot.

ZEC is swap-supported in the **staging** solver environment only. There is no money market: sodaZEC is not a lending-pool reserve.
