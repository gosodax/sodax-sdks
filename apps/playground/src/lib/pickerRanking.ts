/**
 * The curated half of the picker's order, ported from the exchange's `token-picker-ranking`. It only
 * decides the assets a wallet does not hold: what the wallet holds sorts above all of this.
 *
 * Group A is the undisputed top tier by market cap and DeFi usage. Group B is the runners-up —
 * strong fundamentals, and each one has a SODAX spoke chain or ecosystem behind it. Everything else
 * falls through to alphabetical. Symbols are display symbols and match case-insensitively; a wrapped
 * or bridged variant (`WBTC`, `ETH.LL`) is deliberately its own entry, never merged into the asset
 * it represents. Review against the exchange's list rather than editing this one in isolation.
 */
export const PICKER_GROUP_A: readonly string[] = ['BTC', 'ETH', 'SOL', 'USDC', 'BNB', 'AVAX'];

export const PICKER_GROUP_B: readonly string[] = [
  'SUI',
  'HYPE',
  'WBTC',
  'cbBTC',
  'BTCB',
  'wstETH',
  'weETH',
  'INJ',
  'XLM',
  'bnUSD',
  'ETH.LL',
  'BTC.LL',
];
