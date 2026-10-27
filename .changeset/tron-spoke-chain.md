---
"@sodax/types": minor
"@sodax/sdk": minor
"@sodax/wallet-sdk-core": minor
"@sodax/wallet-sdk-react": minor
---

Add Tron as a spoke chain (`ChainKeys.TRON_MAINNET`, chain type `'TRON'`).

Tron settles through the **MPC relay** rather than the intent relay: a deposit is a transfer to the shared reserve carrying a 32-byte payload-hash memo spliced into the raw transaction, and a withdrawal is authorized with scheme 1 — a TIP-191-wrapped signature the contract recovers the signer from. The reserve address comes from the relay per call rather than being fixed, so a client must pay the address from the current response.

New public surface:

- `@sodax/types` — `TronChainKey`, `TronSpokeChainConfig`, `TronRawTransaction`, `TronReturnType`, `TronRawTransactionReceipt`, `TronGasEstimate`, `TronUnsignedTransaction` and the `ITronWalletProvider` interface, plus the `tron` entries in `spokeChainConfig` and `supportedTokensByChain` (native TRX and USDT), and the `MpcRelayChainMap` / `MpcRelayChainKey` registry with `isMpcRelayChainKey` and `getMpcRelayChainInfo`.
- `@sodax/sdk` — `sodax.spoke.tron` (`TronSpokeService`), the MPC relay REST helpers (`getDepositAddress`, `notify`, `waitForDeposit`, `submitWithdraw`, `waitForWithdrawal`), and `SpokeService.settle()`: one settlement seam that swap, bridge and money market call after `create*Intent`, and DEX deposit/withdraw from an MPC-relay chain, routing MPC-relay chains to their relay service and everything else to the intent relay. It reports the hub mint (or the release) as `dstChainTxHash`, never the source id, and an MPC relay that runs out of time fails as `RELAY_TIMEOUT`. Existing chains keep the same verify-then-relay behavior and the same `SodaxError` codes. `BridgeService.getDetailedStatus` gains a `source: 'mpcRelay'` arm carrying the relay's deposit record.
- `@sodax/sdk` — `encodeRecipient(spokeChainKey, address)`, the encoding for an address that **receives** funds, as distinct from `encodeAddress`, which encodes an address as an **identity** (deriving a hub wallet, signing a message). They differ only on MPC-relay chains, where a recipient is the 32-byte word the asset manager expects and an identity is the bare 20-byte account. Feature services that deliver to a spoke — money market (borrow, withdraw), bridge, recovery, swap intents (`dstAddress`), partner auto-swap preferences and DEX withdraw — use it. `SetSwapPreferenceParams.outputToken` takes the destination chain's own token format (base58 on Tron).
- `@sodax/wallet-sdk-core` — `TronWalletProvider` in both raw-key and TronLink modes.
- `@sodax/wallet-sdk-react` — `TronXService` and `TronXConnector`, wired into `chainRegistry` and `SodaxWalletConfig`.

Tron is money-market listed for USDT (TRX's vault is not a money-market reserve), and TRX and USDT are swap-supported in the **staging** solver environment only — read the full staging set with `getStagingSolverTokens`. Bridge and recovery include Tron automatically. Swap and bridge skip the backend submit-tx path for a Tron source, since the backend relays only through the intent relay.

An MPC-relay source chain is refused before signing where the SDK could not confirm its message: leverage yield (vault swaps and positions), concentrated liquidity, and swap `cancelIntent`, whose refund would pay the intent's identity-encoded `srcAddress`.

Also wires Tron into `GetTxReceiptType`, so `waitForTransactionReceipt` on `tron` resolves to `TronRawTransactionReceipt` instead of `unknown`.
