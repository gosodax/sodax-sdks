---
"@sodax/wallet-sdk-react": patch
---

Stop `useWalletProvider` and `useXConnectors` from warning that a chain is not enabled when it is. `useInitChainServices` fills `enabledChains` from an effect, and React runs children before parent effects, so every child of a correctly-configured `SodaxWalletProvider` observed an empty list on its first render and logged the warning.

The one-shot that suppresses repeats is keyed by chain type, so this was not only noise: the spurious warning consumed the warning a genuine misconfiguration on that chain would have needed, and a real missing-chain mistake was then never reported. Both hooks now stay silent until chain services have initialized, and warn as before after that.
