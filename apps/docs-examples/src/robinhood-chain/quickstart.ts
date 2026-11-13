import type { IEvmWalletProvider } from '@sodax/sdk';

// #region tokens
import { Sodax, ChainKeys, type XToken } from '@sodax/sdk';

const sodax = new Sodax();

// find() returns XToken | undefined, so narrow before using the address
const bySymbol = (tokens: readonly XToken[], symbol: string) => {
  const token = tokens.find(t => t.symbol === symbol);
  if (!token) throw new Error(`${symbol} is not a supported swap token`);
  return token;
};

const eth = bySymbol(sodax.swaps.getSupportedSwapTokensByChainId(ChainKeys.ROBINHOOD_MAINNET), 'ETH');
const usdcBase = bySymbol(sodax.swaps.getSupportedSwapTokensByChainId(ChainKeys.BASE_MAINNET), 'USDC');
// #endregion tokens

// #region swap
import type { SolverIntentQuoteRequest } from '@sodax/sdk';

// 0.01 ETH, built from the token's own decimals
const inputAmount = 10n ** BigInt(eth.decimals) / 100n;

// Quote: 0.01 ETH -> USDC on Base
const quoteResult = await sodax.swaps.getQuote({
  token_src: eth.address,
  token_dst: usdcBase.address,
  token_src_blockchain_id: ChainKeys.ROBINHOOD_MAINNET,
  token_dst_blockchain_id: ChainKeys.BASE_MAINNET,
  amount: inputAmount,
  quote_type: 'exact_input',
} satisfies SolverIntentQuoteRequest);

if (!quoteResult.ok) throw new Error('Quote failed');
const { quoted_amount } = quoteResult.value;

// `deadline` is an absolute Unix timestamp; getSwapDeadline turns an offset into one
const deadlineResult = await sodax.swaps.getSwapDeadline(300n); // 5 minutes from now
if (!deadlineResult.ok) throw new Error('Deadline lookup failed');

// Execute
const swapResult = await sodax.swaps.swap({
  params: {
    inputToken: eth.address,
    outputToken: usdcBase.address,
    inputAmount,
    minOutputAmount: (quoted_amount * 99n) / 100n, // your slippage policy
    deadline: deadlineResult.value,
    allowPartialFill: false,
    srcChainKey: ChainKeys.ROBINHOOD_MAINNET,
    dstChainKey: ChainKeys.BASE_MAINNET,
    srcAddress: await walletProvider.getWalletAddress(),
    dstAddress: recipientOnBase,
    solver: '0x0000000000000000000000000000000000000000',
    data: '0x',
  },
  walletProvider,
  timeout: 120_000,
});

if (swapResult.ok) {
  console.log('Submitted. Hub tx:', swapResult.value.intentDeliveryInfo.dstTxHash);
} else {
  console.error('Swap failed:', swapResult.error);
}
// #endregion swap

// Built in Step 2 and supplied by the reader; declared here so the shown regions compile.
declare const walletProvider: IEvmWalletProvider;
declare const recipientOnBase: `0x${string}`;
