import { ChainKeys, type IEvmWalletProvider, type Sodax, type XToken } from '@sodax/sdk';

// #region borrow
const bnUSD = robinhoodTokens.find(t => t.symbol === 'bnUSD');
if (!bnUSD) throw new Error('bnUSD is not a supported money-market token on Robinhood Chain');

const result = await sodax.moneyMarket.borrow({
  params: {
    srcChainKey: ChainKeys.ROBINHOOD_MAINNET, // where the caller acts from
    srcAddress: userRobinhoodAddress,
    token: bnUSD.address, // token on the destination network
    amount: 50n * 10n ** BigInt(bnUSD.decimals), // 50 bnUSD
    action: 'borrow',
    dstChainKey: ChainKeys.ROBINHOOD_MAINNET, // deliver on Robinhood Chain
    dstAddress: userRobinhoodAddress,
  },
  walletProvider,
});
// #endregion borrow

console.log(result);

// Built in the supply step; declared here so the shown region compiles.
declare const sodax: Sodax;
declare const robinhoodTokens: readonly XToken[];
declare const walletProvider: IEvmWalletProvider;
declare const userRobinhoodAddress: `0x${string}`;
