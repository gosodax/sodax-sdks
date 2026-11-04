---
"@sodax/types": minor
"@sodax/sdk": minor
"@sodax/wallet-sdk-core": minor
"@sodax/wallet-sdk-react": minor
---

Add Cardano as a spoke chain (`ChainKeys.CARDANO_MAINNET`, chain type `'CARDANO'`). Native ADA only.

Cardano settles through the **MPC relay** (relay id 1815) in memo mode: a deposit is one payment to the shared reserve at output 0, carrying the payload hash as CIP-20 label-674 metadata, and is keyed `1815-<txhash>-0`. A Cardano account's SDK address is its mainnet `addr1…` key-hash payment address; its identity is the 28-byte blake2b-224 payment key hash. Withdrawals use scheme 7, a CIP-30 `signData` over the text `0x<hash>` submitted with the wallet's COSE_Sign1 and COSE_Key.

A CIP-30 wallet signs and submits but does not build transactions, so the SDK builds the deposit itself: it selects the account's pure-ADA UTXOs (outputs holding native tokens are never spent), prices the fee at the current protocol parameters, and checks that the wallet submitted exactly the transaction it built. The transaction bytes are pinned to the relay's contract vectors. Chain reads go to Koios through `chains.cardano.rpcUrl` (default `https://api.koios.rest/api/v1`); public Koios sends no CORS headers on responses, so a browser app must point it at a CORS-enabled endpoint or its own proxy.

The SDK refuses to pay a relay reserve that is not the configured one. A payout to Cardano must be at least 1 ADA, because the contract refuses a smaller release after the hub has burned it: the SDK refuses it first, through the new `MpcRelayPayoutFloors` (a floor the amount may equal, unlike `MpcRelayPayoutMinimums`).

New public surface:

- `@sodax/types` — `CardanoChainKey`, `CardanoSpokeChainConfig`, `CardanoRawTransaction`, `CardanoReturnType`, `CardanoRawTransactionReceipt`, `CardanoGasEstimate`, `CardanoDataSignature`, `CardanoSignDataWire`, `CardanoDepositMetadata`, `ICardanoWalletProvider`, `isCardanoChainKey`, `CARDANO_CHAIN_KEYS`, `MpcRelayPayoutFloors`, and the `cardano` entries in `spokeChainConfig` and `supportedTokensByChain` (native ADA). `MpcWithdrawScheme` gains `7`, and `MpcPayoutMinimum` gains `inclusive`.
- `@sodax/sdk` — `sodax.spoke.cardano` (`CardanoSpokeService`), `isCardanoChainKeyType`, and the helpers (`parseCardanoAddress`, `cardanoIdentityBytes`, `cardanoRecipientBytes`, `cardanoAddressFromRecipientBytes`, `cardanoDepositMetadata`, `cardanoSignDataPayload`, `cardanoSignDataFields`, `CARDANO_MIN_RELEASE_LOVELACE`). `encodeAddress` / `encodeRecipient` / `reverseEncodeAddress` handle Cardano addresses; `encodeRecipient` returns the raw 29- or 57-byte address.
- `@sodax/wallet-sdk-core` — `CardanoWalletProvider` over a structural CIP-30 wallet, and `cardanoAddressFromRawHex`.
- `@sodax/wallet-sdk-react` — `CardanoXService` and the Lace `CardanoXConnector`, wired into `chainRegistry` under the `CARDANO` config slot.

ADA is swap-supported in the **staging** solver environment only. There is no money market: sodaADA is not a lending-pool reserve.
