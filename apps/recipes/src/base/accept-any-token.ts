import { ChainKeys, SolverIntentStatusCode } from '@sodax/sdk';
import type { IEvmWalletProvider, Sodax, SpokeChainKey, XToken } from '@sodax/sdk';

export const bySymbol = (tokens: readonly XToken[], symbol: string): XToken => {
  const token = tokens.find(t => t.symbol === symbol);
  if (!token) throw new Error(`${symbol} is not a supported token on this network`);
  return token;
};

export type AcceptAnyTokenParams = {
  sodax: Sodax;
  walletProvider: IEvmWalletProvider;
  payChainKey: SpokeChainKey;
  paySymbol: string;
  payAmount: bigint;
  settleSymbol: string;
  appBaseAddress: `0x${string}`;
  slippageBps?: bigint;
};

/** Pays from any network and settles a Base asset at the app's address; resolves with the hub tx hash. */
export async function acceptAnyToken({
  sodax,
  walletProvider,
  payChainKey,
  paySymbol,
  payAmount,
  settleSymbol,
  appBaseAddress,
  slippageBps = 100n,
}: AcceptAnyTokenParams): Promise<`0x${string}`> {
  const payToken = bySymbol(sodax.swaps.getSupportedSwapTokensByChainId(payChainKey), paySymbol);
  const settleToken = bySymbol(sodax.swaps.getSupportedSwapTokensByChainId(ChainKeys.BASE_MAINNET), settleSymbol);

  const quote = await sodax.swaps.getQuote({
    token_src: payToken.address,
    token_dst: settleToken.address,
    token_src_blockchain_id: payChainKey,
    token_dst_blockchain_id: ChainKeys.BASE_MAINNET,
    amount: payAmount,
    quote_type: 'exact_input',
  });
  if (!quote.ok) throw new Error('Quote failed');

  const deadline = await sodax.swaps.getSwapDeadline(300n);
  if (!deadline.ok) throw deadline.error;

  const params = {
    inputToken: payToken.address,
    outputToken: settleToken.address,
    inputAmount: payAmount,
    minOutputAmount: (quote.value.quoted_amount * (10_000n - slippageBps)) / 10_000n,
    deadline: deadline.value,
    allowPartialFill: false,
    srcChainKey: payChainKey,
    dstChainKey: ChainKeys.BASE_MAINNET,
    srcAddress: await walletProvider.getWalletAddress(),
    dstAddress: appBaseAddress,
    solver: '0x0000000000000000000000000000000000000000',
    data: '0x',
  } as const;

  const allowance = await sodax.swaps.isAllowanceValid({ params, walletProvider });
  if (!allowance.ok) throw allowance.error;
  if (!allowance.value) {
    const approval = await sodax.swaps.approve({ params, walletProvider });
    if (!approval.ok) throw approval.error;
  }

  const swap = await sodax.swaps.swap({ params, walletProvider, timeout: 120_000 });
  if (!swap.ok) throw swap.error;

  const hubTxHash = swap.value.intentDeliveryInfo.dstTxHash;
  if (!hubTxHash.startsWith('0x')) throw new Error('Unexpected hub transaction hash');
  return hubTxHash as `0x${string}`;
}

export type SettlementOutcome = 'solved' | 'failed' | 'timed_out';

/** Polls the one-shot getStatus until SOLVED, FAILED, or the budget runs out. */
export async function waitForSettlement(
  sodax: Sodax,
  hubTxHash: `0x${string}`,
  { budgetMs = 10 * 60_000, intervalMs = 2_000 } = {},
): Promise<SettlementOutcome> {
  const until = Date.now() + budgetMs;
  while (Date.now() < until) {
    const status = await sodax.swaps.getStatus({ intent_tx_hash: hubTxHash });
    if (status.ok && status.value.status === SolverIntentStatusCode.SOLVED) return 'solved';
    if (status.ok && status.value.status === SolverIntentStatusCode.FAILED) return 'failed';
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  return 'timed_out';
}
