import type { IEvmWalletProvider } from '@sodax/sdk';

// #region supply
import { Sodax, ChainKeys } from '@sodax/sdk';

const sodax = new Sodax();

// find() returns XToken | undefined, so narrow before using the address
const robinhoodTokens = sodax.moneyMarket.getSupportedTokensByChainId(ChainKeys.ROBINHOOD_MAINNET);
const usdg = robinhoodTokens.find(t => t.symbol === 'USDG');
if (!usdg) throw new Error('USDG is not a supported money-market token on Robinhood Chain');

const params = {
  srcChainKey: ChainKeys.ROBINHOOD_MAINNET,
  srcAddress: await walletProvider.getWalletAddress(),
  token: usdg.address,
  amount: 100n * 10n ** BigInt(usdg.decimals), // 100 USDG
  action: 'supply',
} as const;

const allowance = await sodax.moneyMarket.isAllowanceValid({ params });
if (!allowance.ok) throw allowance.error;
if (!allowance.value) {
  const approval = await sodax.moneyMarket.approve({ params, walletProvider });
  if (!approval.ok) throw approval.error;
  // wait for the approval to be mined before supplying
}

const result = await sodax.moneyMarket.supply({
  params,
  walletProvider, // IEvmWalletProvider, narrowed by srcChainKey
  timeout: 120_000, // optional relay timeout (default 120 s)
});
// #endregion supply

console.log(result);

// Supplied by the reader; declared here so the shown region compiles.
declare const walletProvider: IEvmWalletProvider;
