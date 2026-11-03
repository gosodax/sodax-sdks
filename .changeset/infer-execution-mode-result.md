---
'@sodax/types': minor
'@sodax/sdk': minor
---

SDK actions now type their result by execution mode without type arguments. A call with a wallet provider resolves to the broadcast result (a transaction hash), and a call with `raw: true` resolves to the unsigned transaction, so `sodax.swaps.approve({ params, walletProvider })` no longer returns `TxHash | EvmRawTransaction`.

`WalletProviderSlot` types `raw` as the bare `Raw` parameter so TypeScript can infer it, and the action methods default `Raw` to `false`. No runtime behaviour changes. Calls that pass explicit type arguments compile unchanged; a generic wrapper that casts an object literal to `WalletProviderSlot<K, Raw>` with an unresolved `Raw` now needs to cast through `unknown`.
