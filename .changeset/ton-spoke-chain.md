---
"@sodax/types": minor
"@sodax/sdk": minor
"@sodax/wallet-sdk-core": minor
"@sodax/wallet-sdk-react": minor
---

Add TON as a spoke chain (`ChainKeys.TON_MAINNET`, chain type `'TON'`).

TON settles through the **MPC relay** (relay id 607) in memo mode: native TON carries the 32-byte payload hash as a binary comment, and a jetton carries it in the TEP-74 transfer's `forward_payload`. Withdrawals use scheme 5, a TonConnect `signData` over a readable text line, submitted with the public key and the wallet's signing envelope.

**A TON account's SDK address is its 32-byte ed25519 public key**, not a TON address. The relay identifies TON users by public key — a TON address is a hash of the wallet's StateInit and cannot be inverted — so the deposit owner, withdraw sender and hub-wallet identity are all the key. The wallet-v4R2 address derived from the key is what raw-key deposits send from and what a withdrawal pays; a TonConnect wallet of another version (e.g. W5) still deposits from its own address, but its withdrawals release to the key's v4R2 address.

New public surface:

- `@sodax/types` — `TonChainKey`, `TonSpokeChainConfig`, `TonRawTransaction`, `TonReturnType`, `TonRawTransactionReceipt`, `TonGasEstimate`, `TonUnsignedTransaction`, `TonSignedMessage`, `ITonWalletProvider`, `isTonChainKey`, `TON_CHAIN_KEYS`, and the `ton` entries in `spokeChainConfig` and `supportedTokensByChain` (native TON, USDT). `MpcWithdrawScheme` gains `5`.
- `@sodax/sdk` — `sodax.spoke.ton` (`TonSpokeService`), `isTonChainKeyType`, and the TON encoders (`tonIdentityBytes`, `tonWalletAddress`, `tonAddressHash`, `buildTonCommentBody`, `buildJettonDepositBody`, `tonWithdrawSignText`, `tonSignDataMessage`, …). `encodeRecipient` pays a TON release to the key's 32-byte wallet-v4R2 account hash. `SubmitWithdrawRequest` gains `tonSignData`.
- `@sodax/wallet-sdk-core` — `TonWalletProvider` in raw-key and TonConnect modes.
- `@sodax/wallet-sdk-react` — `TonXService` and the TonConnect `TonXConnector`, wired into `chainRegistry`; the `TON` config slot takes the dApp's `manifestUrl`.

TON is swap-supported in the **staging** solver environment only (TON and USDT). **Money market** lists USDT only: TON has no vault, so it cannot be a lending-pool reserve. Bridge, partner-fee and recovery include TON automatically.
