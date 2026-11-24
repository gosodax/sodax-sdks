---
"@sodax/types": major
"@sodax/sdk": major
"@sodax/wallet-sdk-core": major
"@sodax/wallet-sdk-react": major
"@sodax/dapp-kit": minor
---

Add TON as a spoke chain (`ChainKeys.TON_MAINNET`, chain type `'TON'`).

**Breaking:** code that maps every `SpokeChainKey` or `ChainType` (a `Record`, an exhaustive `switch`) needs a TON entry, and `SpokeServiceType` gains `TonSpokeService`.

TON settles through the **MPC relay** (relay id 607) in memo mode: native TON carries the 32-byte payload hash as a binary comment, and a jetton carries it in the TEP-74 transfer's `forward_payload`. Withdrawals use scheme 5, a TonConnect `signData` over a readable text line, submitted with the public key and the wallet's signing envelope.

**A TON account's SDK address is its 32-byte ed25519 public key**, not a TON address. The relay identifies TON users by public key — a TON address is a hash of the wallet's StateInit and cannot be inverted — so the deposit owner, withdraw sender and hub-wallet identity are all the key. The wallet-v4R2 address derived from the key is what raw-key deposits send from and what a withdrawal pays; a TonConnect wallet of another version (e.g. W5) still deposits from its own address, but its withdrawals release to the key's v4R2 address.

New public surface:

- `@sodax/types` — `TonChainKey`, `TonSpokeChainConfig`, `TonRawTransaction`, `TonReturnType`, `TonRawTransactionReceipt`, `TonGasEstimate`, `TonUnsignedTransaction`, `TonSignedMessage`, `ITonWalletProvider`, `isTonChainKey`, `TON_CHAIN_KEYS`, and the `ton` entries in `spokeChainConfig` and `supportedTokensByChain` (native TON, USDT). `MpcWithdrawScheme` gains `5`.
- `@sodax/sdk` — `sodax.spoke.ton` (`TonSpokeService`, including `resumeDeposit`), `TonDepositNotFoundError` and `TonDepositRecovery`, `isTonChainKeyType`, and the TON encoders (`tonIdentityBytes`, `tonWalletAddress`, `tonAddressHash`, `buildTonCommentBody`, `buildJettonDepositBody`, `tonWithdrawSignText`, `tonSignDataMessage`, …). `encodeRecipient` pays a TON release to the key's 32-byte wallet-v4R2 account hash. `SubmitWithdrawRequest` gains `tonSignData`. `getDeposit`, `getWalletBalance` and `getWalletBalances` take an optional TON-only `accountAddress`, for a TonConnect wallet that is not wallet-v4R2.
- `@sodax/wallet-sdk-core` — `TonWalletProvider` in raw-key and TonConnect modes.
- `@sodax/wallet-sdk-react` — `TonXService` and the TonConnect `TonXConnector`, wired into `chainRegistry`; the `TON` config slot takes the dApp's `manifestUrl`. Needs `@tonconnect/ui` 2.4.4 or later. Closing the TonConnect modal resolves `connect()` to `undefined`.
- `@sodax/dapp-kit` — `useBalances` and `getBalancesQueryOptions` take an optional `accountAddress` for TON.

TON is swap-supported in the **staging** solver environment only (TON and USDT). **Money market** lists USDT only: TON has no vault, so it cannot be a lending-pool reserve. Bridge, partner-fee and recovery include TON automatically.

A TON deposit’s hash comes from the reserve transaction. The SDK verifies the relay memo before signing and matches a jetton notification only when its source is the reserve’s jetton wallet. An uncertain send or discovery timeout keeps a `TonDepositRecovery` handle, including the original request’s `validUntil`. Keep the attempt pending and use `resumeDeposit` with that handle to recover and notify the original hash. `MpcRelayPayoutMinimums` floors USDT payouts to TON at 3 USDT, the cap of the solver's TON release fee; the native TON address has a zero floor.
