// #region quote
import { ChainKeys, hederaSupportedTokens, Sodax, type SolverIntentQuoteRequest } from '@sodax/sdk';

const sodax = new Sodax();
await sodax.initialize();

const usdc = hederaSupportedTokens.USDC;
const aapl = hederaSupportedTokens.AAPL;
const amount = 10n * 10n ** BigInt(usdc.decimals); // 10 USDC

const quoteResult = await sodax.swaps.getQuote({
  token_src: usdc.address,
  token_dst: aapl.address,
  token_src_blockchain_id: ChainKeys.HEDERA_MAINNET,
  token_dst_blockchain_id: ChainKeys.HEDERA_MAINNET,
  amount,
  quote_type: 'exact_input',
} satisfies SolverIntentQuoteRequest);

if (!quoteResult.ok) {
  // Branch on quoteResult.error.code, never on the message. Keep the buy button disabled.
  throw new Error('No quote', { cause: quoteResult.error });
}

const slippageBps = 100n; // 1%
const minOutputAmount = (quoteResult.value.quoted_amount * (10_000n - slippageBps)) / 10_000n;
console.log('Minimum AAPL out, in its smallest unit:', minOutputAmount);
// #endregion quote
