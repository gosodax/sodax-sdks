import { ChainKeys, type CreateIntentParams, type IEvmWalletProvider, type Sodax, type XToken } from '@sodax/sdk';

// #region approvals
const allowance = await sodax.swaps.isAllowanceValid({ params, walletProvider });
if (!allowance.ok) throw allowance.error;

if (!allowance.value) {
  const approval = await sodax.swaps.approve({ params, walletProvider });
  if (!approval.ok) throw approval.error;
  // wait for the approval to be mined before calling swap()
}
// #endregion approvals

// #region quote
const quoteResult = await sodax.swaps.getQuote({
  token_src: usdg.address, // token on Robinhood Chain
  token_dst: usdc.address, // token on the destination network
  token_src_blockchain_id: ChainKeys.ROBINHOOD_MAINNET,
  token_dst_blockchain_id: ChainKeys.ARBITRUM_MAINNET,
  amount: 100n * 10n ** BigInt(usdg.decimals), // 100 USDG
  quote_type: 'exact_input', // the only supported quote type
});
// #endregion quote

console.log(quoteResult);

// Supplied by the reader; declared here so the shown regions compile.
declare const sodax: Sodax;
declare const walletProvider: IEvmWalletProvider;
declare const params: CreateIntentParams<typeof ChainKeys.ROBINHOOD_MAINNET>;
declare const usdg: XToken;
declare const usdc: XToken;
