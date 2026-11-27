// #region viem-chain
import { robinhoodChain } from '@sodax/wallet-sdk-core';

// id 4663, native currency ETH (18 decimals), Blockscout explorer
const chains = [robinhoodChain /* , your other chains */] as const;
// #endregion viem-chain

export { chains };
