import type { ConfigService } from './../shared/config/ConfigService.js';
import { AssetService } from './AssetService.js';
import { ClService } from './ConcentratedLiquidityService.js';
import type { HubProvider } from '../shared/types/types.js';
import type { SpokeService } from '../shared/index.js';

export type DexServiceConstructorParams = {
  config: ConfigService;
  hubProvider: HubProvider;
  spoke: SpokeService;
};

/**
 * DEX facade: `assetService` (pool-token wrap/unwrap) and `clService` (concentrated liquidity); pools live on the hub.
 * @namespace SodaxFeatures
 */
export class DexService {
  public readonly assetService: AssetService;
  public readonly clService: ClService;

  constructor({ config, hubProvider, spoke }: DexServiceConstructorParams) {
    this.assetService = new AssetService({
      hubProvider: hubProvider,
      config: config,
      spoke: spoke,
    });
    this.clService = new ClService({
      hubProvider: hubProvider,
      config: config,
      spoke: spoke,
    });
  }
}
