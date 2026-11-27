import {
  type Address,
  type GetChainsApiResponse,
  type GetMoneyMarketReserveAssetsApiResponse,
  type GetRelayChainIdMapApiResponse,
  type HubChainKey,
  type IntentRelayChainId,
  type OriginalAssetAddress,
  type SpokeChainKey,
  type XToken,
  hubConfig,
  type GetMoneyMarketTokensApiResponse,
  type GetSwapTokensByChainIdApiResponse,
  type GetSwapTokensApiResponse,
  type SpokeChainConfig,
  type MoneyMarketConfig,
  type SodaxConfig,
  type HubConfig,
  type RelayConfig,
  type SolverConfig,
  type DexConfig,
  type PoolKey,
  type Result,
  type SwapsConfig,
  type BridgeConfig,
  type GetSpokeChainConfigType,
  type SodaxLogger,
  type PartnerFee,
  type SodaxOptions,
  type LeverageYieldConfig,
  type RadfiSigner,
} from '@sodax/types';
import { isAddress } from 'viem';
import type { BackendApiService } from '../../backendApi/BackendApiService.js';
// import { mergeSodaxConfig } from './mergeSodaxConfig.js'; // TODO(config-v2): restore when initialize() dynamic fetch is re-enabled
import { resolveLogger } from '../logger.js';
import { noopAnalytics, type ResolvedAnalytics } from '../analytics.js';

export type ConfigServiceConstructorParams = {
  api: BackendApiService;
  config: SodaxConfig;
  /** Raw user overrides (not the merged config), re-applied over dynamic config so a fetch never clobbers them. */
  userConfig?: SodaxOptions;
  /** Held outside the swappable `SodaxConfig` so a dynamic config fetch never replaces it. */
  logger?: SodaxLogger;
  /** Held outside the swappable `SodaxConfig`; defaults to the no-op (disabled) emitter. */
  analytics?: ResolvedAnalytics;
  /** Global partner fee; client-side only and held outside the swappable `SodaxConfig`. */
  fee?: PartnerFee;
  /** Global backend API key, sent as `x-api-key`; held outside the swappable `SodaxConfig`. */
  apiKey?: string;
  /** RadFi/Bound request signer; held outside the swappable `SodaxConfig`. */
  radfiSigner?: RadfiSigner;
};

/**
 * Holds the SDK config (packaged defaults merged with constructor overrides) and lookups built from it.
 * `initialize()` does not fetch backend config yet, so supported chains and tokens are the packaged ones.
 */
export class ConfigService {
  private sodax: SodaxConfig;
  // TODO(config-v2): restore `api` / `userConfig` when initialize() dynamic fetch is re-enabled.
  // private readonly api: BackendApiService;
  // private readonly userConfig?: SodaxOptions;

  public readonly logger: SodaxLogger;

  public readonly analytics: ResolvedAnalytics;

  /** Global partner fee; per-feature overrides live on the feature config. */
  public readonly fee: PartnerFee | undefined;

  /** Never logged; read by the swap, leverage-yield and partner solver flows, which bypass `BackendApiService`. */
  public readonly apiKey: string | undefined;

  /** Holds the function reference only, never a credential. */
  public readonly radfiSigner: RadfiSigner | undefined;

  private initialized = false;

  private supportedHubAssetsSet!: Set<Address>;
  private supportedSodaVaultAssetsSet!: Set<Address>;
  private intentRelayChainIdToSpokeChainKeyMap!: Map<IntentRelayChainId, SpokeChainKey>;
  private supportedTokensPerChain!: Map<SpokeChainKey, readonly XToken[]>;
  private moneyMarketReserveAssetsSet!: Set<Address>;
  private spokeChainKeysSet!: Set<SpokeChainKey>;
  private stakedATokenAddressesSet!: Set<Address>;
  private chainToSupportedTokenAddressMap!: Map<SpokeChainKey, Set<string>>;
  private hubAssetToXTokenMap!: Map<Address, XToken>;

  // `api` / `userConfig` stay unused until the TODO(config-v2) fetch is re-enabled.
  constructor({
    api,
    config,
    userConfig,
    logger,
    analytics,
    fee,
    apiKey,
    radfiSigner,
  }: ConfigServiceConstructorParams) {
    this.sodax = config;
    this.logger = logger ?? resolveLogger(undefined);
    this.analytics = analytics ?? noopAnalytics;
    this.fee = fee;
    this.apiKey = apiKey;
    this.radfiSigner = radfiSigner;
    this.loadSodaxConfigDataStructures(config);
  }

  public async initialize(): Promise<Result<void>> {
    try {
      // TODO(config-v2): enable once the config v2 endpoint is live. The dynamic fetch + re-layer is
      // intentionally disabled — initialize() is a no-op that keeps the constructor-merged config.
      // const result = await this.api.getAllConfig();
      // if (!result.ok) return result;
      // const response = result.value;

      // if (!response.version || response.version < CONFIG_VERSION) {
      //   this.logger.warn(
      //     `Dynamic config version is less than the current version, resorting to the default one. Current version: ${CONFIG_VERSION}, response version: ${response.version}`,
      //   );
      // } else {
      //   // Dynamic config replaces the static defaults, but explicit user overrides must still win —
      //   // re-layer them on top so initialize() never clobbers config the caller passed to `new Sodax(...)`.
      //   const next = this.userConfig ? mergeSodaxConfig(response.config, this.userConfig) : response.config;
      //   // Rebuild the lookup structures from `next` before committing it, so a failure here leaves the
      //   // previously committed config and its derived maps intact (no torn state).
      //   this.loadSodaxConfigDataStructures(next);
      //   this.sodax = next;
      //   this.initialized = true;
      // }

      return { ok: true, value: undefined };
    } catch (error) {
      return { ok: false, error };
    }
  }

  public getChains(): GetChainsApiResponse {
    return Object.keys(this.sodax.chains) as SpokeChainKey[];
  }

  public getSwapTokens(): GetSwapTokensApiResponse {
    return this.sodax.swaps.supportedTokens;
  }

  public getSwapTokensByChainId(chainId: SpokeChainKey): GetSwapTokensByChainIdApiResponse {
    return this.sodax.swaps.supportedTokens[chainId];
  }

  public getRelayChainIdMap(): GetRelayChainIdMapApiResponse {
    return this.sodax.relay.relayChainIdMap;
  }

  public getMoneyMarketTokens(): GetMoneyMarketTokensApiResponse {
    return this.sodax.moneyMarket.supportedTokens;
  }

  public getMoneyMarketToken(chainId: SpokeChainKey, token: string): XToken | undefined {
    return this.sodax.moneyMarket.supportedTokens[chainId].find(t => t.address.toLowerCase() === token.toLowerCase());
  }

  public getMoneyMarketReserveAssets(): GetMoneyMarketReserveAssetsApiResponse {
    return this.sodax.moneyMarket.supportedReserveAssets;
  }

  public isValidOriginalAssetAddress(chainId: SpokeChainKey, asset: OriginalAssetAddress): boolean {
    return this.chainToSupportedTokenAddressMap.get(chainId)?.has(asset.toLowerCase()) ?? false;
  }

  public getOriginalAssetAddress(chainId: SpokeChainKey, hubAsset: Address): OriginalAssetAddress | undefined {
    return this.hubAssetToXTokenMap.get(hubAsset.toLowerCase() as Address)?.address;
  }

  /** Resolves a hub-asset address to its XToken, e.g. a BTC hub asset held directly on Sonic. */
  public getXTokenFromHubAsset(hubAsset: string): XToken | undefined {
    return this.hubAssetToXTokenMap.get(hubAsset.toLowerCase() as Address);
  }

  public getSpokeTokenFromOriginalAssetAddress(
    chainId: SpokeChainKey,
    originalAssetAddress: OriginalAssetAddress,
  ): XToken | undefined {
    return this.supportedTokensPerChain
      .get(chainId)
      ?.find(token => token.address.toLowerCase() === originalAssetAddress.toLowerCase());
  }

  public isValidHubAsset(hubAsset: Address): boolean {
    return this.supportedHubAssetsSet.has(hubAsset.toLowerCase() as Address);
  }

  /** Input MUST be a hub-chain address: a spoke address can collide with a hub vault (e.g. SODA on Base). */
  public isSodaVaultHubAsset(hubAsset: Address): boolean {
    return this.supportedSodaVaultAssetsSet.has(hubAsset.toLowerCase() as Address);
  }

  public isValidChainHubAsset(chainId: SpokeChainKey, hubAsset: Address): boolean {
    return this.chainToSupportedTokenAddressMap.get(chainId)?.has(hubAsset.toLowerCase() as Address) ?? false;
  }

  public isValidSpokeChainKey(chainId: SpokeChainKey): boolean {
    return this.spokeChainKeysSet.has(chainId);
  }

  public isValidIntentRelayChainId(chainId: bigint): chainId is IntentRelayChainId {
    return typeof chainId === 'bigint' && Object.values(this.sodax.relay.relayChainIdMap).some(id => id === chainId);
  }

  public getSupportedHubChains(): HubChainKey[] {
    return Object.keys(hubConfig) as HubChainKey[];
  }

  public getHubChainConfig(): HubConfig {
    return hubConfig;
  }

  public getSupportedSpokeChains(): SpokeChainKey[] {
    return Object.keys(this.sodax.chains) as SpokeChainKey[];
  }

  public getSpokeChainKeyFromIntentRelayChainId(intentRelayChainId: IntentRelayChainId): SpokeChainKey {
    const spokeChainId = this.intentRelayChainIdToSpokeChainKeyMap.get(intentRelayChainId);

    if (!spokeChainId) {
      throw new Error(`Invalid intent relay chain id: ${intentRelayChainId}`);
    }

    return spokeChainId;
  }

  public getSupportedTokensPerChain(): Map<SpokeChainKey, readonly XToken[]> {
    return this.supportedTokensPerChain;
  }

  public getSupportedMoneyMarketTokensByChainId(chainId: SpokeChainKey): readonly XToken[] {
    return this.sodax.moneyMarket.supportedTokens[chainId];
  }

  public getSupportedMoneyMarketTokens(): GetMoneyMarketTokensApiResponse {
    return this.sodax.moneyMarket.supportedTokens;
  }

  public getSupportedSwapTokensByChainId(chainId: SpokeChainKey): readonly XToken[] {
    return this.sodax.swaps.supportedTokens[chainId];
  }

  public getSupportedSwapTokens(): GetSwapTokensApiResponse {
    return this.sodax.swaps.supportedTokens;
  }

  public findSupportedTokenBySymbol(chainId: SpokeChainKey, symbol: string): XToken | undefined {
    const supportedTokens = Object.values(this.sodax.chains[chainId].supportedTokens);
    return supportedTokens.find(token => token.symbol.toLowerCase() === symbol.toLowerCase());
  }

  public isValidStakedATokenAddress(address: Address): boolean {
    return this.stakedATokenAddressesSet.has(address.toLowerCase() as Address);
  }

  public getOriginalAssetsFromVault(chainId: SpokeChainKey, vault: Address): OriginalAssetAddress[] {
    const chainConfig = this.sodax.chains[chainId];
    if (!chainConfig) {
      return [];
    }
    const vaultAddress = vault.toLowerCase();
    const result: OriginalAssetAddress[] = [];
    for (const token of Object.values(chainConfig.supportedTokens)) {
      if (token.vault.toLowerCase() === vaultAddress) {
        result.push(token.address);
      }
    }
    return result;
  }

  public getSodaTokenAddress(chainId: SpokeChainKey): string | undefined {
    return this.sodax.chains[chainId].supportedTokens.SODA?.address;
  }

  public getOriginalAssetAddressFromStakedATokenAddress = (
    chainId: SpokeChainKey,
    address: Address,
  ): OriginalAssetAddress => {
    if (address.toLowerCase() === this.getHubChainConfig().addresses.xSoda.toLowerCase()) {
      const sodaTokenAddress = this.getSodaTokenAddress(chainId);
      if (!sodaTokenAddress) {
        throw new Error(
          `[getOriginalAssetAddressFromStakedATokenAddress] Soda token address not found for chain ${chainId}`,
        );
      }
      return sodaTokenAddress;
    }

    const normalizedAddress = address.toLowerCase() as keyof typeof this.dex.statATokenAddresses;
    const sodaToken = this.dex.statATokenAddresses[normalizedAddress] ?? address;

    const originalAssetAddresses = this.getOriginalAssetsFromVault(chainId, sodaToken);

    if (!originalAssetAddresses.length) {
      throw new Error('[getOriginalAssetAddressFromStakedATokenAddress] Original asset address not found');
    }
    return originalAssetAddresses[0] as OriginalAssetAddress;
  };

  public findTokenByOriginalAddress(originalAddress: OriginalAssetAddress, chainId: SpokeChainKey): XToken | undefined {
    const tokens = this.supportedTokensPerChain.get(chainId);
    if (tokens && tokens.length > 0) {
      return tokens.find(token => token.address.toLowerCase() === originalAddress.toLowerCase());
    }
    return undefined;
  }

  public getDexPools(): PoolKey[] {
    return Object.values(this.dex.dexPools);
  }

  public getSodaToken(chainId: SpokeChainKey): XToken {
    const sodaToken = this.sodax.chains[chainId].supportedTokens.SODA;
    if (!sodaToken) {
      throw new Error(`[getSodaToken] Soda token not found for chain ${chainId}`);
    }
    return sodaToken;
  }

  public isMoneyMarketSupportedToken(chainId: SpokeChainKey, token: string): boolean {
    return this.sodax.moneyMarket.supportedTokens[chainId].some(t => t.address.toLowerCase() === token.toLowerCase());
  }

  /** Reserve members are hub vault addresses: query with `XToken.vault`, not `XToken.hubAsset`. */
  public isMoneyMarketReserveAsset(asset: Address): boolean {
    return this.moneyMarketReserveAssetsSet.has(asset.toLowerCase() as Address);
  }

  private loadSodaxConfigDataStructures(sodaxConfig: SodaxConfig): void {
    this.hubAssetToXTokenMap = new Map<`0x${string}`, XToken>(
      Object.values(sodaxConfig.chains)
        .flatMap(chainConfig => Object.values(chainConfig.supportedTokens))
        .filter(token => isAddress(token.hubAsset))
        .map(token => [token.hubAsset.toLowerCase() as Address, token]),
    );
    this.chainToSupportedTokenAddressMap = new Map(
      Object.entries(sodaxConfig.chains).map(([chainId, config]) => [
        chainId as SpokeChainKey,
        new Set(Object.values(config.supportedTokens).map(token => token.address.toLowerCase() as Address)),
      ]),
    );
    this.supportedSodaVaultAssetsSet = new Set(
      Object.values(sodaxConfig.chains).flatMap(config =>
        Object.values(config.supportedTokens).map(token => token.vault.toLowerCase() as Address),
      ),
    );
    this.loadSpokeChainDataStructures(sodaxConfig);
    this.intentRelayChainIdToSpokeChainKeyMap = new Map(
      Object.entries(sodaxConfig.relay.relayChainIdMap).map(([chainId, intentRelayChainId]) => [
        intentRelayChainId as IntentRelayChainId,
        chainId as SpokeChainKey,
      ]),
    );
    this.loadSpokeChainConfigDataStructures(sodaxConfig);
    this.moneyMarketReserveAssetsSet = new Set(
      sodaxConfig.moneyMarket.supportedReserveAssets.map(address => address.toLowerCase() as Address),
    );
    this.stakedATokenAddressesSet = new Set(
      Object.keys(sodaxConfig.dex.statATokenAddresses).map(address => address.toLowerCase() as Address),
    );
  }

  private loadSpokeChainDataStructures(sodaxConfig: SodaxConfig): void {
    this.spokeChainKeysSet = new Set(Object.keys(sodaxConfig.chains) as SpokeChainKey[]);
  }

  private loadSpokeChainConfigDataStructures(sodaxConfig: SodaxConfig): void {
    this.supportedTokensPerChain = new Map(
      Object.entries(sodaxConfig.chains).map(([chainId, config]) => [
        chainId as SpokeChainKey,
        Object.values(config.supportedTokens),
      ]),
    );
  }

  public isInitialized(): boolean {
    return this.sodax !== undefined && this.initialized;
  }

  get spokeChainConfig(): Record<SpokeChainKey, SpokeChainConfig> {
    return this.sodax.chains;
  }

  get relay(): RelayConfig {
    return this.sodax.relay;
  }

  get solver(): SolverConfig {
    return this.sodax.solver;
  }
  get swaps(): SwapsConfig {
    return this.sodax.swaps;
  }

  get bridge(): BridgeConfig {
    return this.sodax.bridge;
  }

  get moneyMarket(): MoneyMarketConfig {
    return this.sodax.moneyMarket;
  }

  get leverageYield(): LeverageYieldConfig {
    return this.sodax.leverageYield;
  }

  // Per-feature override, else the global `fee`; `??` (never a merge) keeps the PartnerFee variant intact.
  get swapPartnerFee(): PartnerFee | undefined {
    return this.swaps.partnerFee ?? this.fee;
  }

  get moneyMarketPartnerFee(): PartnerFee | undefined {
    return this.moneyMarket.partnerFee ?? this.fee;
  }

  get bridgePartnerFee(): PartnerFee | undefined {
    return this.bridge.partnerFee ?? this.fee;
  }

  get leverageYieldPartnerFee(): PartnerFee | undefined {
    return this.leverageYield.partnerFee ?? this.fee;
  }

  // Omitted flag resolves to ON here; the deprecated `swapsOptions` / `bridgeOptions` keys are honoured
  // as a fallback so an existing explicit opt-out keeps the client-side path.
  get swapUseBackendSubmitTx(): boolean {
    return this.swaps.useBackendSubmitTx ?? this.sodax.swapsOptions?.useBackendSubmitTx ?? true;
  }

  get bridgeUseBackendSubmitTx(): boolean {
    return this.bridge.useBackendSubmitTx ?? this.sodax.bridgeOptions?.useBackendSubmitTx ?? true;
  }

  // ON by default: a backend non-success falls back to the client-side relay. No deprecated fallback key.
  get leverageYieldUseBackendSubmitTx(): boolean {
    return this.leverageYield.useBackendSubmitTx ?? true;
  }

  get dex(): DexConfig {
    return this.sodax.dex;
  }

  public getChainConfig<K extends SpokeChainKey>(key: K): GetSpokeChainConfigType<K> {
    return this.sodax.chains[key] as GetSpokeChainConfigType<K>;
  }

  get sodaxConfig(): SodaxConfig {
    return this.sodax;
  }
}
