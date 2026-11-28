import type { TxPollingConfig } from '../shared/shared.js';
import type { SodaxLoggerOption } from '../shared/logger.js';
import type { AnalyticsOption } from '../shared/analytics.js';
import type { DeepPartial } from '../utils/deep-partial.js';
import {
  apiConfig,
  solverConfig,
  relayConfig,
  type ApiConfig,
  type SolverConfig,
  type RelayConfig,
} from '../common/constants.js';
import type { MoneyMarketDefaultConfig, MoneyMarketOptions, PartnerFee, Prettify } from '../common/common.js';
import { moneyMarketConfig } from '../moneyMarket/moneyMarket.js';
import { dexConfig, type DexDefaultConfig } from '../dex/dex.js';
import { swapsConfig, type SwapsDefaultConfig, type SwapsOptions } from '../swap/swap.js';
import {
  leverageYieldConfig,
  type LeverageYieldDefaultConfig,
  type LeverageYieldOptions,
} from '../leverageYield/leverageYield.js';
import {
  spokeChainConfig,
  type HubConfig,
  hubConfig,
  type SpokeChainConfig,
  type SpokeChainKey,
} from '../chains/chains.js';

export type EvmSharedChainConfig = TxPollingConfig & {
  rpcUrl: string;
};

export type StellarSharedChainConfig = TxPollingConfig & {
  horizonRpcUrl: string;
  sorobanRpcUrl: string;
};

export type RadfiConfig = {
  apiUrl: string;
  /** `/auth/*` + `/wallets/*`. Unset resolves via `BOUND_COMPANION_HOSTS[apiUrl]`, then `apiUrl`. */
  authUrl?: string;
  /** `/transactions/*`. Unset resolves via `BOUND_COMPANION_HOSTS[apiUrl]`, then `apiUrl`. */
  transactionsUrl?: string;
  apiKey: string;
  umsUrl: string;
  accessToken: string;
  refreshToken: string;
};

export type BitcoinSharedChainConfig = TxPollingConfig & {
  rpcUrl: string;
  network: string;
  radfi: RadfiConfig;
  walletMode?: 'USER' | 'TRADING';
};

export type BridgeConfig = Prettify<BridgeDefaultConfig & BridgeOptions>;

export type BridgeOptions = {
  partnerFee?: PartnerFee; // overrides the global partner fee
  /** Route `bridge()` via backend submit-tx (default `true`; `false` = client-side relay). Client-side only.
   * Omitted means the default, not off: read the effective value via `sodax.config.bridgeUseBackendSubmitTx`. */
  useBackendSubmitTx?: boolean;
};

export type BridgeDefaultConfig = {}; // kept for future extension

export const bridgeConfig = {} satisfies BridgeDefaultConfig;

/** Input to {@link RadfiSigner}, a client-side hook kept out of {@link RadfiConfig} so no credential lives on SDK config;
 * called per outbound RadFi request, its headers merged in (e.g. Bound's `x-api-signature` HMAC, swaps-api gh-831). */
export type RadfiSignContext = {
  method: string;
  path: string; // e.g. `/sodax/transaction`
  /** Resolved base URL this request goes to. Bound serves several hosts — scope credentials on it. */
  baseUrl: string;
};
export type RadfiSigner = (ctx: RadfiSignContext) => Record<string, string> | Promise<Record<string, string>>;
export type RadfiOptions = {
  signRequest?: RadfiSigner; // extra headers (e.g. `x-api-signature`) merged onto each routed RadFi request
};

/** @deprecated Use `swaps: { partnerFee, useBackendSubmitTx }` ({@link SwapsOptions}); removed in v3.
 * Still honoured only when `swaps.useBackendSubmitTx` is omitted; the default is now `true`. */
export type SwapsClientOptions = {
  useBackendSubmitTx?: boolean;
};

/** @deprecated Use `bridge: { partnerFee, useBackendSubmitTx }` ({@link BridgeOptions}); removed in v3.
 * Still honoured only when `bridge.useBackendSubmitTx` is omitted; the default is now `true`. */
export type BridgeClientOptions = {
  useBackendSubmitTx?: boolean;
};

export type SodaxOptionalConfig = {
  logger?: SodaxLoggerOption;
  analytics?: AnalyticsOption; // off by default; client-side only, never from backend config
  fee?: PartnerFee;
  /** Sent as `x-api-key`; client-side only. Overridable per request via `sodax.api.*` and swap()/bridge() submit-tx legs;
   * legacy solver requests use this key only. Browser-bundled keys are public. */
  apiKey?: string;
  radfi?: RadfiOptions; // client-side only, never part of the backend data contract
  swaps?: SwapsOptions;
  moneyMarket?: MoneyMarketOptions;
  bridge?: BridgeOptions;
  leverageYield?: LeverageYieldOptions;
  /** @deprecated Use `swaps` instead; removed in v3. Still honoured, but only when `swaps.useBackendSubmitTx` is absent. */
  swapsOptions?: SwapsClientOptions;
  /** @deprecated Use `bridge` instead; removed in v3. Still honoured, but only when `bridge.useBackendSubmitTx` is absent. */
  bridgeOptions?: BridgeClientOptions;
};

/** `new Sodax(...)` options: a deep-partial override of {@link SodaxDefaultConfig} plus client-side runtime options. */
export type SodaxOptions = DeepPartial<SodaxDefaultConfig> & SodaxOptionalConfig;
export type SodaxConfig = Prettify<SodaxDefaultConfig & SodaxOptionalConfig>;

/** Also the shape of backend API config responses. */
export type SodaxDefaultConfig = {
  chains: Record<SpokeChainKey, SpokeChainConfig>;
  swaps: SwapsDefaultConfig;
  moneyMarket: MoneyMarketDefaultConfig;
  bridge: BridgeDefaultConfig;
  dex: DexDefaultConfig;
  leverageYield: LeverageYieldDefaultConfig; // deployed ERC-4626 vaults on Sonic
  hub: HubConfig;
  api: ApiConfig;
  solver: SolverConfig;
  relay: RelayConfig;
};

export const sodaxConfig = {
  chains: spokeChainConfig,
  swaps: swapsConfig,
  moneyMarket: moneyMarketConfig,
  bridge: bridgeConfig,
  dex: dexConfig,
  leverageYield: leverageYieldConfig,
  hub: hubConfig,
  api: apiConfig,
  solver: solverConfig,
  relay: relayConfig,
} satisfies SodaxDefaultConfig;
