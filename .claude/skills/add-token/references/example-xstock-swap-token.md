# Worked example — 8 xStock swap tokens on Solana

Real merged change `feat(types): add 8 xStock tokens on Solana`.
**Footprint: the chain token map + the swap opt-in list — no SDK `src/` change.** Canonical reference for the swap-token path.

## Input from the contracts (swap-only, Solana)

| symbol | decimals | hubAddress | solAddress |
| --- | --- | --- | --- |
| CRCLx | 8 | 0x64659130a3373b3527146b38fc1fccf017bc0c61 | XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1 |
| TSLAx | 8 | 0x3cc867f6f4d1817b6230b781125301363fce370c | XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB |
| SPYx | 8 | 0xea66dbe82ebcb6c3a55b2db3d722b676be63a26e | XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W |
| NVDAx | 8 | 0x48303c90f4136bc3101b308c8b50c55745aaf317 | Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh |
| QQQx | 8 | 0x4448b894740198ab76c83c8850d73f7dc8e4b9b3 | Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ |
| MSTRx | 8 | 0xc46c34961802355c5223a115568fdf18a51ad6f6 | XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ |
| COINx | 8 | 0xf444586e95166da0754052f03f344cf1152abe7d | Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu |
| GOOGLx | 8 | 0x024230dd63b27df90d988d6f37a69d4de627ce89 | XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN |

## File 1 — `packages/types/src/chains/tokens.ts`

8 entries appended to the `solanaSupportedTokens` map (declared near line 505). Each maps the
payload onto `XToken`, supplying `name` (authored), `chainKey` (derived), and `vault` (here `= hubAddress`):

```ts
CRCLx: {
  symbol: 'CRCLx',
  name: 'Circle xStock',                                  // authored — not in payload
  decimals: 8,
  address: 'XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1', // solAddress (spoke)
  chainKey: ChainKeys.SOLANA_MAINNET,                     // derived
  hubAsset: '0x64659130a3373b3527146b38fc1fccf017bc0c61', // hubAddress
  vault: '0x64659130a3373b3527146b38fc1fccf017bc0c61',    // = hubAddress for xStocks
},
```

Authored names: Circle / Tesla / SP500 / NVIDIA / Nasdaq / MicroStrategy / Coinbase / Alphabet xStock.

> **Casing note:** these `hubAsset` / `vault` values were stored **lowercase** (as the payload arrived),
> which stays valid — SDK lookups are case-insensitive and viem accepts an all-lowercase address. What
> is **not** valid is mixed case whose EIP-55 checksum fails; `config-address-checksum.test.ts` rejects
> it. Copy the explorer's mixed-case form or keep the payload's lowercase, never a hand-edited blend.

## File 2 — `packages/types/src/swap/swap.ts`

8 lines appended to `swapSupportedTokens[ChainKeys.SOLANA_MAINNET]`:

```ts
spokeChainConfig[ChainKeys.SOLANA_MAINNET].supportedTokens.CRCLx,
spokeChainConfig[ChainKeys.SOLANA_MAINNET].supportedTokens.TSLAx,
spokeChainConfig[ChainKeys.SOLANA_MAINNET].supportedTokens.SPYx,
spokeChainConfig[ChainKeys.SOLANA_MAINNET].supportedTokens.NVDAx,
spokeChainConfig[ChainKeys.SOLANA_MAINNET].supportedTokens.QQQx,
spokeChainConfig[ChainKeys.SOLANA_MAINNET].supportedTokens.MSTRx,
spokeChainConfig[ChainKeys.SOLANA_MAINNET].supportedTokens.COINx,
spokeChainConfig[ChainKeys.SOLANA_MAINNET].supportedTokens.GOOGLx,
```

## Why only these 2 files
- Not added to `moneyMarketSupportedTokens` → **swap-only**.
- `SpokeTokenSymbols`, `isSwapSupportedToken`, `getSupportedSolverTokens` derive from the map automatically.
- `tokens-dedup.test.ts` covers these tokens **because they were added to `swapSupportedTokens`** — note
  the test only checks tokens in the swap / money-market lists (per chain), **not** the raw
  `<chain>SupportedTokens` map; a defined-but-not-opted-in token would not be dedup-checked.
- xStocks are Token-2022 mints; `SolanaSpokeService` already handles that program generically
  (Token-2022 mint support lives in `SolanaSpokeService`), so no SDK `src/` change was required here.

## Scope
This change is purely the `@sodax/types` token wiring shown above (2 files). Releasing/publishing
it is a **separate concern** — see `packages/RELEASE_INSTRUCTIONS.md` — and bumps no versions or
`CONFIG_VERSION` here.
