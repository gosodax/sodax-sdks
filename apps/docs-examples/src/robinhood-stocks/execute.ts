import { ChainKeys, type IEvmWalletProvider, type Sodax, type XToken } from '@sodax/sdk';

// #region execute
import type { CreateIntentParams } from '@sodax/sdk';

const walletAddress = await hederaWalletProvider.getWalletAddress();

const params: CreateIntentParams<typeof ChainKeys.HEDERA_MAINNET> = {
  inputToken: usdc.address,
  outputToken: aapl.address,
  inputAmount: amount, // from Step 2
  minOutputAmount, // from Step 2, after slippage
  deadline: 0n, // or a deadline from sodax.swaps.getSwapDeadline()
  allowPartialFill: false,
  srcChainKey: ChainKeys.HEDERA_MAINNET,
  dstChainKey: ChainKeys.HEDERA_MAINNET,
  srcAddress: walletAddress,
  dstAddress: walletAddress,
  solver: '0x0000000000000000000000000000000000000000', // any solver
  data: '0x',
};

const allowance = await sodax.swaps.isAllowanceValid({ params, walletProvider: hederaWalletProvider });
if (allowance.ok && !allowance.value) {
  const approve = await sodax.swaps.approve<typeof ChainKeys.HEDERA_MAINNET, false>({
    params,
    walletProvider: hederaWalletProvider,
  });
  if (!approve.ok) throw new Error('Approval failed', { cause: approve.error });
  await hederaWalletProvider.waitForTransactionReceipt(approve.value);
}

const swapResult = await sodax.swaps.swap({ params, walletProvider: hederaWalletProvider });
if (!swapResult.ok) throw new Error(`Swap failed: ${swapResult.error.code}`);

// A one-off read: poll it until a final status, or use useDetailedStatus in React.
const status = await sodax.swaps.getDetailedStatus({
  srcChainKey: ChainKeys.HEDERA_MAINNET,
  srcTxHash: swapResult.value.intentDeliveryInfo.srcTxHash,
});
// #endregion execute

console.log(status);

// Built in the earlier steps; declared here so the shown region compiles.
declare const sodax: Sodax;
declare const hederaWalletProvider: IEvmWalletProvider;
declare const usdc: XToken;
declare const aapl: XToken;
declare const amount: bigint;
declare const minOutputAmount: bigint;
