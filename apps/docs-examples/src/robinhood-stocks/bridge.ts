import type { IEvmWalletProvider, Sodax } from '@sodax/sdk';

// #region bridge
import { ChainKeys, hederaSupportedTokens, robinhoodSupportedTokens } from '@sodax/sdk';

const from = hederaSupportedTokens.AAPL;
const to = robinhoodSupportedTokens.AAPL;

if (!sodax.bridge.isBridgeable({ from, to })) throw new Error('Not bridgeable');

const limit = await sodax.bridge.getBridgeableAmount(from, to);
if (!limit.ok) throw new Error('No bridge limit', { cause: limit.error });

const amount = 10n ** BigInt(from.decimals) / 100n; // 0.01 AAPL
// The limit can be in either token's decimals: cross-multiply so both sides share a scale.
if (amount * 10n ** BigInt(limit.value.decimals) > limit.value.amount * 10n ** BigInt(from.decimals)) {
  throw new Error(`Above the current limit: ${limit.value.type}`);
}

const params = {
  srcChainKey: ChainKeys.HEDERA_MAINNET,
  srcAddress: hederaAddress,
  srcToken: from.address,
  amount,
  dstChainKey: ChainKeys.ROBINHOOD_MAINNET,
  dstToken: to.address,
  recipient: robinhoodAddress, // the user's address on Robinhood Chain
};

const allowance = await sodax.bridge.isAllowanceValid({ params, walletProvider: hederaWalletProvider });
if (allowance.ok && !allowance.value) {
  const approve = await sodax.bridge.approve<typeof ChainKeys.HEDERA_MAINNET, false>({
    params,
    walletProvider: hederaWalletProvider,
  });
  if (!approve.ok) throw new Error('Approval failed', { cause: approve.error });
  await hederaWalletProvider.waitForTransactionReceipt(approve.value);
}

const result = await sodax.bridge.bridge({ params, walletProvider: hederaWalletProvider });
if (!result.ok) throw new Error(`Bridge failed: ${result.error.code}`);

const status = await sodax.bridge.getDetailedStatus({
  srcChainKey: ChainKeys.HEDERA_MAINNET,
  srcTxHash: result.value.srcChainTxHash,
});
// #endregion bridge

console.log(status);

// Built earlier on the page, or supplied by the reader; declared here so the shown region compiles.
declare const sodax: Sodax;
declare const hederaWalletProvider: IEvmWalletProvider;
declare const hederaAddress: `0x${string}`;
declare const robinhoodAddress: `0x${string}`;
