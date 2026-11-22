// #region verify-backing
import {
  ChainKeys,
  erc20Abi,
  hederaSupportedTokens,
  robinhoodSupportedTokens,
  Sodax,
  spokeChainConfig,
} from '@sodax/sdk';

const sodax = new Sodax();
const hedera = sodax.spoke.evm.getPublicClient(ChainKeys.HEDERA_MAINNET);
const robinhood = sodax.spoke.evm.getPublicClient(ChainKeys.ROBINHOOD_MAINNET);

// The SODAX SpokeAssetManager: the same address on Hedera and on Robinhood Chain.
const assetManager = spokeChainConfig[ChainKeys.HEDERA_MAINNET].addresses.assetManager;
const hederaToken = hederaSupportedTokens.AAPL; // change the ticker to check another stock
const robinhoodToken = robinhoodSupportedTokens.AAPL;

const [hederaSupply, hederaHeldBySodax, robinhoodLocked] = await Promise.all([
  hedera.readContract({ address: hederaToken.address, abi: erc20Abi, functionName: 'totalSupply' }),
  hedera.readContract({ address: hederaToken.address, abi: erc20Abi, functionName: 'balanceOf', args: [assetManager] }),
  robinhood.readContract({
    address: robinhoodToken.address,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [assetManager],
  }),
]);

const hederaCirculating = hederaSupply - hederaHeldBySodax;
const scale = 10n ** BigInt(robinhoodToken.decimals - hederaToken.decimals);

console.log(`In users' hands on Hedera: ${hederaCirculating} (${hederaToken.decimals} decimals)`);
console.log(`Locked on Robinhood Chain: ${robinhoodLocked} (${robinhoodToken.decimals} decimals)`);
console.log('Covers Hedera:', robinhoodLocked >= hederaCirculating * scale);
// #endregion verify-backing
