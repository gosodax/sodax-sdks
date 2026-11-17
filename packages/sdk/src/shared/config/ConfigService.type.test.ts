/**
 * Compile-time contract for `ConfigService.ts`: every lookup returns its exact public type, and
 * `getChainConfig` narrows the chain config to the family of the chain key passed in.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type {
  BitcoinSpokeChainConfig,
  BridgeConfig,
  ChainKeys,
  DexConfig,
  EvmSpokeChainConfig,
  GetChainsApiResponse,
  GetMoneyMarketReserveAssetsApiResponse,
  GetMoneyMarketTokensApiResponse,
  GetRelayChainIdMapApiResponse,
  GetSwapTokensApiResponse,
  GetSwapTokensByChainIdApiResponse,
  HubChainKey,
  HubConfig,
  IconSpokeChainConfig,
  InjectiveSpokeChainConfig,
  IntentRelayChainId,
  LeverageYieldConfig,
  MoneyMarketConfig,
  NearSpokeChainConfig,
  OriginalAssetAddress,
  PartnerFee,
  PoolKey,
  RelayConfig,
  Result,
  SodaxConfig,
  SolanaChainConfig,
  SolverConfig,
  SonicSpokeChainConfig,
  SpokeChainConfig,
  SpokeChainKey,
  StacksSpokeChainConfig,
  StellarSpokeChainConfig,
  SuiSpokeChainConfig,
  SwapsConfig,
  XToken,
} from '../../index.js';
import type { ConfigService } from './ConfigService.js';

type R<M extends keyof ConfigService> = ConfigService[M] extends (...args: never[]) => infer T ? T : never;

declare const svc: ConfigService;
declare const anyKey: SpokeChainKey;

// One never-invoked call per chain family the constraint accepts.
const chainConfigs = () =>
  ({
    sonic: svc.getChainConfig('sonic' satisfies typeof ChainKeys.SONIC_MAINNET),
    evm: svc.getChainConfig('0x38.bsc' satisfies typeof ChainKeys.BSC_MAINNET),
    solana: svc.getChainConfig('solana' satisfies typeof ChainKeys.SOLANA_MAINNET),
    stellar: svc.getChainConfig('stellar' satisfies typeof ChainKeys.STELLAR_MAINNET),
    icon: svc.getChainConfig('0x1.icon' satisfies typeof ChainKeys.ICON_MAINNET),
    sui: svc.getChainConfig('sui' satisfies typeof ChainKeys.SUI_MAINNET),
    injective: svc.getChainConfig('injective-1' satisfies typeof ChainKeys.INJECTIVE_MAINNET),
    near: svc.getChainConfig('near' satisfies typeof ChainKeys.NEAR_MAINNET),
    stacks: svc.getChainConfig('stacks' satisfies typeof ChainKeys.STACKS_MAINNET),
    bitcoin: svc.getChainConfig('bitcoin' satisfies typeof ChainKeys.BITCOIN_MAINNET),
    wide: svc.getChainConfig(anyKey),
  }) as const;
const invalid = () =>
  // @ts-expect-error — not a spoke chain key
  svc.getChainConfig('not-a-chain');
const relayIdGuard = (id: bigint) => {
  if (svc.isValidIntentRelayChainId(id)) return id;
  throw new Error('unreachable');
};

describe('ConfigService type contract', () => {
  it('initialize resolves to Result<void>', () => {
    // Error side is `Error | unknown` (= unknown): the catch-all passes the caught value through.
    expectTypeOf<R<'initialize'>>().toEqualTypeOf<Promise<Result<void>>>();
    expectTypeOf<R<'isInitialized'>>().toEqualTypeOf<boolean>();
  });

  it('API-shaped lookups return their response types', () => {
    expectTypeOf<R<'getChains'>>().toEqualTypeOf<GetChainsApiResponse>();
    expectTypeOf<R<'getSwapTokens'>>().toEqualTypeOf<GetSwapTokensApiResponse>();
    expectTypeOf<R<'getSwapTokensByChainId'>>().toEqualTypeOf<GetSwapTokensByChainIdApiResponse>();
    expectTypeOf<R<'getRelayChainIdMap'>>().toEqualTypeOf<GetRelayChainIdMapApiResponse>();
    expectTypeOf<R<'getMoneyMarketTokens'>>().toEqualTypeOf<GetMoneyMarketTokensApiResponse>();
    expectTypeOf<R<'getMoneyMarketReserveAssets'>>().toEqualTypeOf<GetMoneyMarketReserveAssetsApiResponse>();
    expectTypeOf<R<'getSupportedMoneyMarketTokens'>>().toEqualTypeOf<GetMoneyMarketTokensApiResponse>();
    expectTypeOf<R<'getSupportedSwapTokens'>>().toEqualTypeOf<GetSwapTokensApiResponse>();
  });

  it('token lookups return XToken / original asset addresses', () => {
    expectTypeOf<R<'getMoneyMarketToken'>>().toEqualTypeOf<XToken | undefined>();
    expectTypeOf<R<'getXTokenFromHubAsset'>>().toEqualTypeOf<XToken | undefined>();
    expectTypeOf<R<'getSpokeTokenFromOriginalAssetAddress'>>().toEqualTypeOf<XToken | undefined>();
    expectTypeOf<R<'findSupportedTokenBySymbol'>>().toEqualTypeOf<XToken | undefined>();
    expectTypeOf<R<'findTokenByOriginalAddress'>>().toEqualTypeOf<XToken | undefined>();
    expectTypeOf<R<'getSodaToken'>>().toEqualTypeOf<XToken>();
    expectTypeOf<R<'getSupportedTokensPerChain'>>().toEqualTypeOf<Map<SpokeChainKey, readonly XToken[]>>();
    expectTypeOf<R<'getSupportedMoneyMarketTokensByChainId'>>().toEqualTypeOf<readonly XToken[]>();
    expectTypeOf<R<'getSupportedSwapTokensByChainId'>>().toEqualTypeOf<readonly XToken[]>();
    expectTypeOf<R<'getOriginalAssetAddress'>>().toEqualTypeOf<OriginalAssetAddress | undefined>();
    expectTypeOf<R<'getOriginalAssetsFromVault'>>().toEqualTypeOf<OriginalAssetAddress[]>();
    expectTypeOf<R<'getOriginalAssetAddressFromStakedATokenAddress'>>().toEqualTypeOf<OriginalAssetAddress>();
    expectTypeOf<R<'getSodaTokenAddress'>>().toEqualTypeOf<string | undefined>();
    expectTypeOf<R<'getDexPools'>>().toEqualTypeOf<PoolKey[]>();
  });

  it('predicates return boolean, and the relay-id check narrows', () => {
    expectTypeOf<R<'isValidOriginalAssetAddress'>>().toEqualTypeOf<boolean>();
    expectTypeOf<R<'isValidHubAsset'>>().toEqualTypeOf<boolean>();
    expectTypeOf<R<'isSodaVaultHubAsset'>>().toEqualTypeOf<boolean>();
    expectTypeOf<R<'isValidChainHubAsset'>>().toEqualTypeOf<boolean>();
    expectTypeOf<R<'isValidSpokeChainKey'>>().toEqualTypeOf<boolean>();
    expectTypeOf<R<'isValidStakedATokenAddress'>>().toEqualTypeOf<boolean>();
    expectTypeOf<R<'isMoneyMarketSupportedToken'>>().toEqualTypeOf<boolean>();
    expectTypeOf<R<'isMoneyMarketReserveAsset'>>().toEqualTypeOf<boolean>();
    expectTypeOf<ConfigService['isValidIntentRelayChainId']>().guards.toEqualTypeOf<IntentRelayChainId>();
    expectTypeOf(relayIdGuard).returns.toEqualTypeOf<IntentRelayChainId>();
  });

  it('chain lookups return chain keys and hub config', () => {
    expectTypeOf<R<'getSupportedHubChains'>>().toEqualTypeOf<HubChainKey[]>();
    expectTypeOf<R<'getHubChainConfig'>>().toEqualTypeOf<HubConfig>();
    expectTypeOf<R<'getSupportedSpokeChains'>>().toEqualTypeOf<SpokeChainKey[]>();
    expectTypeOf<R<'getSpokeChainKeyFromIntentRelayChainId'>>().toEqualTypeOf<SpokeChainKey>();
  });

  it('getChainConfig narrows to the chain family config', () => {
    type C = ReturnType<typeof chainConfigs>;
    expectTypeOf<C['sonic']>().toEqualTypeOf<SonicSpokeChainConfig>();
    expectTypeOf<C['evm']>().toEqualTypeOf<EvmSpokeChainConfig>();
    expectTypeOf<C['solana']>().toEqualTypeOf<SolanaChainConfig>();
    expectTypeOf<C['stellar']>().toEqualTypeOf<StellarSpokeChainConfig>();
    expectTypeOf<C['icon']>().toEqualTypeOf<IconSpokeChainConfig>();
    expectTypeOf<C['sui']>().toEqualTypeOf<SuiSpokeChainConfig>();
    expectTypeOf<C['injective']>().toEqualTypeOf<InjectiveSpokeChainConfig>();
    expectTypeOf<C['near']>().toEqualTypeOf<NearSpokeChainConfig>();
    expectTypeOf<C['stacks']>().toEqualTypeOf<StacksSpokeChainConfig>();
    expectTypeOf<C['bitcoin']>().toEqualTypeOf<BitcoinSpokeChainConfig>();
    expectTypeOf<C['wide']>().toEqualTypeOf<SpokeChainConfig>();
    expectTypeOf(invalid).returns.toEqualTypeOf<SpokeChainConfig>();
  });

  it('config getters return their config slices', () => {
    expectTypeOf<ConfigService['spokeChainConfig']>().toEqualTypeOf<Record<SpokeChainKey, SpokeChainConfig>>();
    expectTypeOf<ConfigService['relay']>().toEqualTypeOf<RelayConfig>();
    expectTypeOf<ConfigService['solver']>().toEqualTypeOf<SolverConfig>();
    expectTypeOf<ConfigService['swaps']>().toEqualTypeOf<SwapsConfig>();
    expectTypeOf<ConfigService['bridge']>().toEqualTypeOf<BridgeConfig>();
    expectTypeOf<ConfigService['moneyMarket']>().toEqualTypeOf<MoneyMarketConfig>();
    expectTypeOf<ConfigService['leverageYield']>().toEqualTypeOf<LeverageYieldConfig>();
    expectTypeOf<ConfigService['dex']>().toEqualTypeOf<DexConfig>();
    expectTypeOf<ConfigService['sodaxConfig']>().toEqualTypeOf<SodaxConfig>();
    expectTypeOf<ConfigService['swapPartnerFee']>().toEqualTypeOf<PartnerFee | undefined>();
    expectTypeOf<ConfigService['moneyMarketPartnerFee']>().toEqualTypeOf<PartnerFee | undefined>();
    expectTypeOf<ConfigService['bridgePartnerFee']>().toEqualTypeOf<PartnerFee | undefined>();
    expectTypeOf<ConfigService['leverageYieldPartnerFee']>().toEqualTypeOf<PartnerFee | undefined>();
    expectTypeOf<ConfigService['swapUseBackendSubmitTx']>().toEqualTypeOf<boolean>();
    expectTypeOf<ConfigService['bridgeUseBackendSubmitTx']>().toEqualTypeOf<boolean>();
    expectTypeOf<ConfigService['leverageYieldUseBackendSubmitTx']>().toEqualTypeOf<boolean>();
  });
});
