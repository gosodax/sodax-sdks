import { SwapService } from '../../swap/SwapService.js';
import { MigrationService } from '../../migration/MigrationService.js';
import { BackendApiService } from '../../backendApi/BackendApiService.js';
import { BridgeService } from '../../bridge/BridgeService.js';
import { StakingService } from '../../staking/StakingService.js';
import { DexService } from '../../dex/DexService.js';
import { SpokeService } from '../services/spoke/SpokeService.js';
import { EvmHubProvider } from './EvmHubProvider.js';
import { MoneyMarketService } from '../../moneyMarket/MoneyMarketService.js';
import { sodaxConfig, type Result, type SodaxConfig, type SodaxOptions } from '@sodax/types';
import type { HubProvider } from '../types/types.js';
import { ConfigService } from '../config/index.js';
import { mergeSodaxConfig } from '../config/mergeSodaxConfig.js';
import { resolveLogger } from '../logger.js';
import { resolveAnalytics } from '../analytics.js';
import { PartnerService } from '../../partner/PartnerService.js';
import { RecoveryService } from '../../recovery/RecoveryService.js';
import { LeverageYieldService } from '../../leverageYield/LeverageYieldService.js';
import { SponsoringService } from '../../sponsoring/SponsoringService.js';

export class Sodax {
  public readonly instanceConfig: SodaxConfig;

  public readonly swaps: SwapService; // Solver service enabling intent based swaps
  public readonly moneyMarket: MoneyMarketService; // Money Market service enabling cross-chain lending and borrowing
  public readonly migration: MigrationService; // ICX migration service enabling ICX migration to SODA
  public readonly backendApi: BackendApiService; // backend API service enabling backend API endpoints
  public readonly api: BackendApiService; // syntactic sugar for backend API service
  public readonly bridge: BridgeService; // Bridge service enabling cross-chain transfers
  public readonly staking: StakingService; // Staking service enabling SODA staking operations
  public readonly partners: PartnerService; // Partner service enabling partner fee claim and other partner operations
  public readonly recovery: RecoveryService; // Recovery service for withdrawing stuck hub-wallet assets back to a spoke chain
  public readonly dex: DexService; // Dex service enabling DEX operations
  public readonly sponsoring: SponsoringService;
  public readonly leverageYield: LeverageYieldService; // Leverage-yield service: cross-chain deposits / withdrawals into ERC-4626 leverage vaults on Sonic
  public readonly config: ConfigService; // Config service enabling configuration data fetching from the backend API or fallbacking to default values

  public readonly hubProvider: HubProvider; // hub provider for the hub chain (e.g. Sonic mainnet)
  public readonly spoke: SpokeService; // spoke service enabling spoke chain operations

  constructor(options?: SodaxOptions) {
    // Client-side options are resolved once and handed to services so they survive the dynamic-config swap
    // in `config.initialize()`; `mergeSodaxConfig` ignores these keys.
    const logger = resolveLogger(options?.logger);
    // No-op emitter unless `options.analytics` is set, so services can emit unconditionally.
    const analytics = resolveAnalytics(options?.analytics);
    const fee = options?.fee;
    // Kept out of the merge below so the credential never lands on the publicly readable `instanceConfig`.
    const apiKey = options?.apiKey || undefined;
    const radfiSigner = options?.radfi?.signRequest;
    // Also the `userConfig` a future dynamic-config re-merge would use, so the strip survives it.
    const mergeOptions = options ? { ...options, apiKey: undefined } : undefined;
    this.instanceConfig = mergeOptions ? mergeSodaxConfig(sodaxConfig, mergeOptions) : sodaxConfig;
    this.backendApi = new BackendApiService(this.instanceConfig.api, logger, { apiKey });
    this.api = this.backendApi;
    this.config = new ConfigService({
      api: this.backendApi,
      config: this.instanceConfig,
      userConfig: mergeOptions,
      logger,
      analytics,
      fee,
      apiKey,
      radfiSigner,
    });

    this.hubProvider = new EvmHubProvider({ config: this.config }); // default to Sonic mainnet
    this.spoke = new SpokeService({ config: this.config, hubProvider: this.hubProvider });
    this.swaps = new SwapService({
      config: this.config,
      hubProvider: this.hubProvider,
      spoke: this.spoke,
      backendApi: this.backendApi,
    });

    this.moneyMarket = new MoneyMarketService({
      config: this.config,
      hubProvider: this.hubProvider,
      spoke: this.spoke,
    });

    this.dex = new DexService({
      config: this.config,
      hubProvider: this.hubProvider,
      spoke: this.spoke,
    });

    this.migration = new MigrationService({
      hubProvider: this.hubProvider,
      config: this.config,
      spoke: this.spoke,
    });
    this.bridge = new BridgeService({
      hubProvider: this.hubProvider,
      config: this.config,
      spoke: this.spoke,
      backendApi: this.backendApi,
    });
    this.staking = new StakingService({ hubProvider: this.hubProvider, config: this.config, spoke: this.spoke });
    this.partners = new PartnerService({
      hubProvider: this.hubProvider,
      config: this.config,
      spoke: this.spoke,
    });
    this.recovery = new RecoveryService({
      hubProvider: this.hubProvider,
      config: this.config,
      spoke: this.spoke,
    });
    this.leverageYield = new LeverageYieldService({
      hubProvider: this.hubProvider,
      config: this.config,
      spoke: this.spoke,
      backendApi: this.backendApi,
    });
    // Sponsored activation never touches the hub.
    this.sponsoring = new SponsoringService({
      config: this.config,
      spoke: this.spoke,
      api: this.backendApi,
    });
  }

  /**
   * Currently returns success without fetching backend config: chains and tokens stay those packaged with
   * this release, plus constructor overrides. For tokens listed later, use the `sodax.api.*` clients or upgrade.
   */
  public async initialize(): Promise<Result<void>> {
    return this.config.initialize();
  }
}
