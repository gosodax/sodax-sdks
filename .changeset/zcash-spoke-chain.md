---
"@sodax/types": major
"@sodax/sdk": major
"@sodax/wallet-sdk-core": major
"@sodax/wallet-sdk-react": major
---

Add Zcash as a spoke chain (`ChainKeys.ZCASH_MAINNET`, chain type `'ZCASH'`). Transparent ZEC only.

**Breaking:** code that maps every `SpokeChainKey` or `ChainType` (a `Record`, an exhaustive `switch`) needs a Zcash entry, and `SpokeServiceType` gains `ZcashSpokeService`.

Zcash settles through the **MPC relay** (relay id 133) in address mode: a deposit pays a t-address the relay derives for that one payload, and is keyed `133-<txid>-<output index>`. A Zcash account's SDK address is its mainnet `t1…` P2PKH address; its identity is the 20-byte hash160 of the compressed public key. Withdrawals use scheme 6, a Bitcoin-style `signmessage` over the text `0x<hash>`.

Deposits take one of two wallet shapes. A raw key signs a transaction the SDK builds: the SDK selects UTXOs, builds a v5 transaction with the deposit at output 0, signs it with ZIP-244 digests, checks the signed bytes pay exactly the deposit address and broadcasts. A browser wallet (Noir Wallet) builds and broadcasts the payment itself, and the SDK finds the output that pays the deposit address. Both need `chains.zcash.rpcUrl` set to a node with address indexing (`getaddressutxos`, `getaddressbalance`, `getrawtransaction`); the packaged default is empty. A deposit is refused before the relay is asked for an address, and before any ZEC moves, when no RPC is set. A raw-key deposit computes its ZIP-244 txid before broadcasting. If the outcome is uncertain, recover that txid from `IndeterminateOutcomeError.txHash` or `context.srcTxHash` on the feature error and resume with `waitForDeposit`. A failed notify after an acknowledged broadcast keeps the original txid.

New public surface:

- `@sodax/types` — `SodaTokens.sodaZECv2` (and `'sodaZECv2'` in `HubVaultSymbols`), `ZcashChainKey`, `ZcashSpokeChainConfig`, `ZcashUnsignedTransaction`, `ZcashTransparentInput`, `ZcashTransparentOutput`, `ZcashTransferParams`, `ZcashRawTransaction`, `ZcashReturnType`, `ZcashRawTransactionReceipt`, `ZcashGasEstimate`, `IZcashWalletProvider`, `isZcashChainKey`, `ZCASH_CHAIN_KEYS`, and the `zcash` entries in `spokeChainConfig` and `supportedTokensByChain` (native ZEC). `MpcWithdrawScheme` gains `6`.
- `@sodax/sdk` — `sodax.spoke.zcash` (`ZcashSpokeService`), `isZcashChainKeyType`, and the transparent helpers (`zcashIdentityBytes`, `zcashHashToAddress`, `zcashP2pkhScript`, `zcashZip317Fee`, `parseZcashV5Outputs`). `encodeAddress` / `reverseEncodeAddress` handle t-addresses, including the 32-byte padded word an intent stores.
- `@sodax/wallet-sdk-core` — `ZcashWalletProvider` in raw-key mode (`signTransaction`) and browser-wallet mode (`sendTransfer`), plus `serializeZcashV5` and `zip244SignatureDigest`.
- `@sodax/wallet-sdk-react` — `ZcashXService` and the Noir Wallet `ZcashXConnector`, wired into `chainRegistry` under the `ZCASH` config slot.

ZEC is swap-supported in the **staging** solver environment only. **Money market:** ZEC is a reserve through the new `SodaTokens.sodaZECv2` vault (`0xf54339B1DF8D9CeBF69665FDF002310A4F2Fe9EE`), which registers the Zcash and NEAR ZEC hub assets and is listed by the lending pool. Zcash ZEC deposits into it. `SodaTokens.sodaZEC` is unchanged (`0xf4af…`, the legacy, non-reserve ZEC vault kept for compatibility).

`MpcRelayPayoutMinimums` floors ZEC payouts to Zcash at 0.001 ZEC. The relay deducts a live ZEC release fee (about 0.00015 ZEC).
