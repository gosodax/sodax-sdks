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

/**
 * Sodax class is used to interact with the Sodax.
 *
 * @see https://docs.sodax.com
 */
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
    // Resolve the client-side options (`logger`, `analytics`, `fee`) once, up front, and hand them to the
    // services so they survive the dynamic-config swap in `config.initialize()`. All live on `SodaxOptions`,
    // not on the `DeepPartial<SodaxDefaultConfig>` data contract, so they keep their exact types and need no
    // cast. `mergeSodaxConfig` / `userConfig` ignore these extra keys (they are never read off the data
    // config; services read them via `config.logger` / `config.analytics` / `config.fee`).
    const logger = resolveLogger(options?.logger);
    // Analytics is opt-in: `resolveAnalytics` returns a no-op emitter unless `options.analytics` is set,
    // so feature services can call `config.analytics.emit(...)` unconditionally with zero cost when off.
    const analytics = resolveAnalytics(options?.analytics);
    const fee = options?.fee;
    // Client-side runtime option like `fee`, sent as `x-api-key` on every backend API request. Held out
    // of the merge below so the credential never lands on the publicly readable `instanceConfig`.
    const apiKey = options?.apiKey || undefined;
    // RadFi/Bound request signer: another client-side runtime hook (like `logger`/`analytics`/`fee`),
    // held off the data config so the dynamic-config swap never touches it. See `RadfiOptions` / gh-831.
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
   * Initializes the Sodax instance with dynamic configuration.
   * You should use this option if you do not want to update package versions when new chains and tokens are added.
   * NOTE: Default configuration will be used if initialization fails.
   * @param sodax - The Sodax instance to initialize.
   */
  public async initialize(): Promise<Result<void>> {
    return this.config.initialize();
  }
}
