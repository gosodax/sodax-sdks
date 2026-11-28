---
"@sodax/types": minor
"@sodax/sdk": minor
"@sodax/dapp-kit": major
---

Let a user associate the Hedera HTS token a swap pays out, instead of the delivery failing after the swap is filled.

**Breaking (`@sodax/dapp-kit`):** `SwapSetupReason` gains `hederaAssociation`, `hederaBlocked` and `hederaCheckFailed`, so an exhaustive `switch` over `useSwapLifecycle`'s `needsSetup` reason needs those cases.

- `@sodax/sdk` (behavior) — a swap, bridge, money-market withdraw or borrow, or other release of an HTS token delivered to Hedera is now refused before signing unless the recipient is already associated with that token. A free or unlimited automatic association slot does not count: an automatic association during delivery costs more gas than the relay's delivery execution provides, so those deliveries failed. The refusal carries `context.reason: 'hedera-<reason>'` (`account_missing`, `not_associated`, `frozen`, `kyc_not_granted`), and a mirror-node failure refuses too rather than sending blind. HBAR deliveries are unchanged.
- `@sodax/sdk` — `sodax.spoke.hedera.checkDestination({ address, token })` reads the Hedera mirror node and says whether the account can receive and why not. `sodax.spoke.hedera.requestAssociation({ srcAddress, token, walletProvider | raw })` associates exactly that token by calling HIP-719 `associate()` on the token's own address through the EVM wallet provider, and resolves to a `Result` with the hash once it is mined and the mirror node shows it; `raw: true` returns the unsigned call. An association whose receipt could not be read fails with an `IndeterminateOutcomeError` carrying its hash. `requiresAssociation(token)` tells an HTS token from HBAR, and `hederaTokenId(address)` maps a long-zero address to its `0.0.N` id.
- `@sodax/types` — `HederaSpokeChainConfig` (the EVM config plus an optional `mirrorNodeUrl`, defaulting to the public mainnet mirror node) and `HederaChainKey`.
- `@sodax/dapp-kit` — `useSwapLifecycle` gates a Hedera HTS-token destination: `hederaAssociation` runs the association from `next()`, `hederaBlocked` covers refusals no association fixes (read `lifecycle.hedera.blockedReason`), and `hederaCheckFailed` retries. `useSwapLifecycle` takes an optional `dstChainSwitch` so the wallet switches to Hedera before the association, and the cache key for the destination check normalises address casing. New hooks `useHederaGate`, `useHederaDestinationCheck` and `useEstablishHederaAssociation` (which, given the checked `address`, refuses a wallet connected to another account before signing, and never retries an association whose outcome is unknown), and the resolver `resolveHederaGate`.
