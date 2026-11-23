---
"@sodax/types": major
"@sodax/sdk": major
"@sodax/wallet-sdk-core": major
"@sodax/wallet-sdk-react": major
---

Add the XRP Ledger as a spoke chain (`ChainKeys.XRP_MAINNET`, chain type `'XRP'`).

**Breaking:** code that maps every `ChainType` or `SpokeChainKey` (a `Record`, an exhaustive `switch`) needs an XRP entry.

Like Tron, XRPL settles through the **MPC relay** rather than the intent relay: a deposit is a Payment to the shared reserve carrying a 32-byte payload-hash memo, and a withdrawal is authorized with **scheme 3** — a raw ed25519 signature over the message hash, submitted with the account's 33-byte `0xED`-prefixed public key, because an ed25519 signature cannot recover its signer the way secp256k1 does. Feature flows need no XRPL-specific code: `spoke.settle()` routes it by its `MpcRelayChainMap` entry.

New public surface:

- `@sodax/types` — `isXrpChainKey`, `XRP_CHAIN_KEYS`, `XrpChainKey`, `XrpSpokeChainConfig`, `XrpRawTransaction`, `XrpReturnType`, `XrpRawTransactionReceipt`, `XrpGasEstimate`, `XrpUnsignedTransaction`, `XrpSignedTransaction` and the `IXrpWalletProvider` interface, plus the `xrp` entries in `spokeChainConfig` and `supportedTokensByChain` (native XRP, RLUSD, USDC).
- `@sodax/sdk` — `sodax.spoke.xrp` (`XrpSpokeService`: `deposit`, `getDeposit`, `estimateGas`, `checkDestination`, `sendMessage`, `waitForDeposit`, `waitForWithdrawal`, `waitForTransactionReceipt`), `isXrpChainKeyType` and the XRPL encoding helpers `xrpIdentityBytes`, `xrpCurrencyCode`, `xrpHashToClassicAddress`, `decodeAccountId` and `encodeAccountId`.
- `@sodax/wallet-sdk-core` — `XrpWalletProvider` in both raw-key and GemWallet modes.
- `@sodax/wallet-sdk-react` — `XrpXService` and the GemWallet `XrpXConnector`, wired into `chainRegistry` and `SodaxWalletConfig`.

Feature support: all three assets are **swap**-supported (`XRP_XRP_ASSET`, `XRP_USDC_ASSET` and `XRP_RLUSD_ASSET` are on the production solver oracle, and quotes were verified live in both directions). **Money market** lists XRP and USDC; RLUSD is swap-only, since `sodaRLUSD` is not a lending-pool reserve. The XRP vault is added to `moneyMarketReserveAssets`, matching the pool. Bridge, partner-fee and recovery include XRPL automatically.

Money-market `withdraw` and `borrow` to an XRPL destination fail with `VALIDATION_FAILED` before anything is signed when the destination cannot receive the release: the account does not exist, or has no trustline (or no limit headroom) for the IOU. The relay treats those as terminal after the hub has burned the funds. An XRPL IOU swap or leverage-yield vault swap rejects a `minOutputAmount` below half the current exact-input quote. A swap or leverage-yield vault swap to an XRPL IOU checks room for twice `minOutputAmount`. A fill above that bound, or a trustline change before settlement, can still prevent release. Call `sodax.spoke.xrp.checkDestination` to check ahead of time.

Also routes `xrp` in `SpokeService.settle` — `getMpcRelayService` recognised only Tron, so every XRPL feature flow (bridge, and money-market supply/borrow/withdraw/repay) threw at settlement, after the Payment had already landed on ledger.

And wires XRPL into the per-family conditional types it was missing from, so `deposit` on `xrp` now resolves to `XrpReturnType` instead of the loose default and `waitForTransactionReceipt` resolves to `XrpRawTransactionReceipt` instead of `unknown`.

An unanswered or provisional XRPL submit reply, including `tec*` or `tef*`, preserves the signed deposit hash in `IndeterminateOutcomeError` and still notifies the relay. Use that hash to recover the original deposit. GemWallet must confirm XRPL Mainnet before submission.

GemWallet replies without a transaction hash expose an `XrpPaymentRecovery` handle. Reconcile the original payment before notifying or starting another deposit. Explicit wallet rejections remain definite.
