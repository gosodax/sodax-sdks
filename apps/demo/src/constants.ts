import { type SolverConfig, spokeChainConfig, baseChainInfo, ChainKeys, type SpokeChainKey } from '@sodax/dapp-kit';

declare global {
  interface Window {
    hanaWallet: { ethereum: unknown };
  }
}

export function chainIdToChainName(chainId: SpokeChainKey): string {
  return spokeChainConfig[chainId].chain.name;
}

/** Default chain logo URL from @sodax/types (baseChainInfo). */
export function chainIdToChainLogo(chainId: SpokeChainKey): string {
  return spokeChainConfig[chainId].chain.logo;
}

export const stagingSolverConfig = {
  intentsContract: '0x6382D6ccD780758C5e8A6123c33ee8F4472F96ef',
  solverApiEndpoint: 'https://canary-api.sodax.com/v1/intent',
  protocolIntentsContract: '0xaFf2EDb3057ed6f9C1dA6c930b8ddDf2beE573A5' as const,
} satisfies SolverConfig;

export const productionSolverConfig = {
  intentsContract: '0x6382D6ccD780758C5e8A6123c33ee8F4472F96ef',
  solverApiEndpoint: 'https://api.sodax.com/v1/intent',
  protocolIntentsContract: '0xaFf2EDb3057ed6f9C1dA6c930b8ddDf2beE573A5' as const,
} satisfies SolverConfig;

/** Auto default for `swaps.useBackendSubmitTx` and `leverageYield.useBackendSubmitTx`: backend
 *  submit posts to the production swaps API, which only the production solver serves — so Auto is
 *  on only when the EFFECTIVE solver endpoint (env config or settings override) is production's
 *  (gh-401). Leverage yield shares the rule because `/leverage-yield/submit-tx` delegates to that
 *  same swaps pipeline; bridge does not, because a bridge never reaches the solver. */
export function defaultUseBackendSubmitTx(solverApiEndpoint: string): boolean {
  return solverApiEndpoint === productionSolverConfig.solverApiEndpoint;
}

export interface ChainUI {
  id: string;
  name: string;
  icon: string;
}

// Chain logos are sourced from @sodax/types (baseChainInfo[key].logo), keyed by ChainKeys value.
export const EVM_CHAIN_ICONS = [
  ChainKeys.ETHEREUM_MAINNET,
  ChainKeys.BASE_MAINNET,
  ChainKeys.BSC_MAINNET,
  ChainKeys.AVALANCHE_MAINNET,
  ChainKeys.POLYGON_MAINNET,
  ChainKeys.OPTIMISM_MAINNET,
  ChainKeys.ARBITRUM_MAINNET,
  ChainKeys.SONIC_MAINNET,
  ChainKeys.LIGHTLINK_MAINNET,
  ChainKeys.HYPEREVM_MAINNET,
  ChainKeys.KAIA_MAINNET,
  ChainKeys.REDBELLY_MAINNET,
].map(key => baseChainInfo[key].logo);

/**
 * Available chains for UI components with display information.
 * Names + logos come from @sodax/types (baseChainInfo) so the SDK is the single source of truth.
 */
export const availableChains: ChainUI[] = [
  ChainKeys.SONIC_MAINNET,
  ChainKeys.ETHEREUM_MAINNET,
  ChainKeys.SOLANA_MAINNET,
  ChainKeys.TRON_MAINNET,
  ChainKeys.BASE_MAINNET,
  ChainKeys.ARBITRUM_MAINNET,
  ChainKeys.SUI_MAINNET,
  ChainKeys.BSC_MAINNET,
  ChainKeys.POLYGON_MAINNET,
  ChainKeys.AVALANCHE_MAINNET,
  ChainKeys.OPTIMISM_MAINNET,
  ChainKeys.STELLAR_MAINNET,
  ChainKeys.ICON_MAINNET,
  ChainKeys.LIGHTLINK_MAINNET,
  ChainKeys.HYPEREVM_MAINNET,
  ChainKeys.KAIA_MAINNET,
  ChainKeys.REDBELLY_MAINNET,
  ChainKeys.HEDERA_MAINNET,
  ChainKeys.ROBINHOOD_MAINNET,
].map(key => ({ id: key, name: baseChainInfo[key].name, icon: baseChainInfo[key].logo }));

export const ROUTES = {
  SWAPS_SDK: '/swaps-sdk',
  SWAPS_API: '/swaps-api',
  MONEY_MARKET: '/money-market',
  BRIDGE: '/bridge',
  BRIDGE_API: '/bridge-api',
  DEX: '/dex',
  STAKING: '/staking',
  PARTNER_FEE_CLAIM: '/partner-fee-claim',
  RECOVERY: '/recovery',
  LEVERAGE_YIELD: '/leverage-yield',
  LEVERAGE_YIELD_API: '/leverage-yield-api',
  LEVERAGE_POSITIONS: '/leverage-positions',
  ORACLE: '/oracle',
} as const;

/**
 * Helper function to get chain UI data by chain ID
 */
export const getChainUI = (chainId: string): ChainUI | undefined => {
  return availableChains.find(chain => chain.id === chainId);
};

/**
 * Helper function to get chain name by chain ID
 */
export const getChainName = (chainId: string): string | undefined => {
  return getChainUI(chainId)?.name;
};

/**
 * Helper function to get chain icon by chain ID
 */
export const getChainIcon = (chainId: string): string | undefined => {
  return getChainUI(chainId)?.icon;
};

/**
 * Helper function to get chain icon by chain name
 * Searches for a chain by its display name and returns the icon path
 */
export const getChainIconByName = (chainName: string): string | undefined => {
  const chain = availableChains.find(chain => chain.name.toLowerCase() === chainName.toLowerCase());
  return chain?.icon;
};
