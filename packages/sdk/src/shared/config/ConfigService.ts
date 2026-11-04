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
  /**
   * The raw user-provided config override (the `SodaxOptions` passed to `new Sodax(...)`),
   * NOT the merged result. Re-applied on top of dynamic config in {@link ConfigService.initialize} so
   * that a remote config fetch never clobbers explicit user overrides.
   */
  userConfig?: SodaxOptions;
  /**
   * Pre-resolved SDK log sink. Held outside the swappable `SodaxConfig` so a dynamic config fetch
   * in {@link ConfigService.initialize} never replaces it. Defaults to the console logger when omitted.
   */
  logger?: SodaxLogger;
  /**
   * Pre-resolved analytics emitter. Like {@link logger}, held outside the swappable `SodaxConfig` so a
   * dynamic config fetch never replaces it. Defaults to the no-op (disabled) emitter when omitted.
   */
  analytics?: ResolvedAnalytics;
  /**
   * Global partner fee (the `fee` option passed to `new Sodax(...)`). Held outside the swappable
   * `SodaxConfig` — like {@link logger} — so a dynamic config fetch never replaces it. The backend
   * never supplies it; it is purely a client-side option.
   */
  fee?: PartnerFee;
  /**
   * Global backend API key (the `apiKey` option passed to `new Sodax(...)`). Held outside the
   * swappable `SodaxConfig` — like {@link fee} — so a dynamic config fetch never replaces it. Sent as
   * the `x-api-key` header on every backend API request; read here by the swap, leverage-yield, and
   * partner solver flows, whose transport does not go through `BackendApiService`.
   */
  apiKey?: string;
  /**
   * RadFi/Bound request signer (the `radfi.signRequest` option passed to `new Sodax(...)`). Held
   * outside the swappable `SodaxConfig` — like {@link logger} — so a dynamic config fetch never
   * replaces it. Read by {@link BitcoinSpokeService} to inject Bound `x-api-signature` headers.
   */
  radfiSigner?: RadfiSigner;
};

/**
 * ConfigApiService - Service for fetching configuration data from the backend API or fallbacking to default values
 */
export class ConfigService {
  private sodax: SodaxConfig;
  // TODO(config-v2): restore `api` / `userConfig` when initialize() dynamic fetch is re-enabled.
  // private readonly api: BackendApiService;
  // private readonly userConfig?: SodaxOptions;

  /**
   * SDK log sink. Resolved once at construction and kept independent of {@link sodax} so that
   * {@link initialize}'s dynamic-config swap never clobbers it. Read by services via `config.logger`.
   */
  public readonly logger: SodaxLogger;

  /**
   * Analytics emitter. Resolved once at construction and kept independent of {@link sodax} so that
   * {@link initialize}'s dynamic-config swap never clobbers it. Read by services via `config.analytics`;
   * disabled (no-op) unless the consumer passed an `analytics` config to `new Sodax(...)`.
   */
  public readonly analytics: ResolvedAnalytics;

  /**
   * Global partner fee. Resolved once at construction and kept independent of {@link sodax} so that
   * {@link initialize}'s dynamic-config swap never clobbers it. The backend never supplies it — it is
   * a client-side option set via `new Sodax({ fee })`. Per-feature overrides live on the feature config.
   */
  public readonly fee: PartnerFee | undefined;

  /**
   * Global backend API key. Resolved once at construction and kept independent of {@link sodax} so
   * that {@link initialize}'s dynamic-config swap never clobbers it. The backend never supplies it —
   * it is a client-side option set via `new Sodax({ apiKey })`. Never logged; read here by the swap,
   * leverage-yield, and partner solver flows, whose transport does not go through `BackendApiService`.
   */
  public readonly apiKey: string | undefined;

  /**
   * RadFi/Bound request signer. Resolved once at construction and kept independent of {@link sodax}
   * so that {@link initialize}'s dynamic-config swap never clobbers it. Read by `BitcoinSpokeService`
   * via `config.radfiSigner`; `undefined` unless the consumer passed `radfi.signRequest` to
   * `new Sodax(...)`. Holds the function reference only — never a credential.
   */
  public readonly radfiSigner: RadfiSigner | undefined;

  private initialized = false;

  // data structures for quick lookup
  private supportedHubAssetsSet!: Set<Address>;
  private supportedSodaVaultAssetsSet!: Set<Address>;
  private intentRelayChainIdToSpokeChainKeyMap!: Map<IntentRelayChainId, SpokeChainKey>;
  private supportedTokensPerChain!: Map<SpokeChainKey, readonly XToken[]>;
  private moneyMarketReserveAssetsSet!: Set<Address>;
  private spokeChainKeysSet!: Set<SpokeChainKey>;
  private stakedATokenAddressesSet!: Set<Address>;
  private chainToSupportedTokenAddressMap!: Map<SpokeChainKey, Set<string>>;
  private hubAssetToXTokenMap!: Map<Address, XToken>;

  // `api` / `userConfig` are accepted but unused while initialize()'s dynamic fetch is disabled
  // (see TODO(config-v2) below); restore their assignments when re-enabling.
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

  /**
   * Resolves the {@link XToken} descriptor (hub asset, vault, decimals) for a hub-asset address.
   *
   * Useful when a caller holds a hub asset directly on Sonic that has no spoke-token entry under
   * the hub chain — e.g. a partner BTC fee held as the BTC hub asset, which only exists as a spoke
   * token on Bitcoin. Returns `undefined` when the address is not a known hub asset.
   */
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

  /**
   * Checks whether a hub-chain address is one of the soda-vault hub assets
   * (sodaUSDC, sodaUSDT, bnUSD, etc.). The input MUST be a hub-chain address;
   * passing a spoke token address will silently produce wrong answers when a
   * spoke address collides with a hub vault address (e.g. SODA on Base).
   */
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

  /**
   * Is `asset` one of the money-market reserve assets?
   *
   * The reserve set is built from `moneyMarketHubVaults`, so its members are hub **vault**
   * addresses. Query it with an `XToken.vault`; an `XToken.hubAsset` only matches for the Sonic
   * vault shares themselves, where `hubAsset === vault`.
   */
  public isMoneyMarketReserveAsset(asset: Address): boolean {
    return this.moneyMarketReserveAssetsSet.has(asset.toLowerCase() as Address);
  }

  private loadSodaxConfigDataStructures(sodaxConfig: SodaxConfig): void {
    // Maps each hub asset address to its original XToken with the matching hubAsset property
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

  // Effective partner fee per feature: the feature-specific override if set, otherwise the global
  // `fee` client option ({@link fee}). The global fee is the default, overridable per-feature. `??`
  // (never a merge) keeps the chosen PartnerFee variant intact — no discriminated-union hybrid.
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

  // Effective backend submit-tx toggle per feature. Read live off the same `swaps` / `bridge` slots as
  // `partnerFee` so an omitted flag resolves to the ON default here, in one place, instead of leaving
  // `config.swaps.useBackendSubmitTx === undefined` while the backend path is actually active.
  // The deprecated `swapsOptions` / `bridgeOptions` keys are still honoured as a second-precedence
  // fallback, so a pre-existing explicit opt-out keeps the client-side path instead of silently flipping.
  get swapUseBackendSubmitTx(): boolean {
    return this.swaps.useBackendSubmitTx ?? this.sodax.swapsOptions?.useBackendSubmitTx ?? true;
  }

  get bridgeUseBackendSubmitTx(): boolean {
    return this.bridge.useBackendSubmitTx ?? this.sodax.bridgeOptions?.useBackendSubmitTx ?? true;
  }

  // Same ON default as the two above, and for the same reason: any backend non-success falls back
  // to the client-side relay, so the default costs a rejected attempt at worst. No deprecated
  // second-precedence key here — leverage yield arrived after `swapsOptions` / `bridgeOptions` were
  // already deprecated, so it never had one.
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
