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

// -- Per-chain shared config types (user-overridable runtime config) --

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
  partnerFee?: PartnerFee; // enables override of global partner fee
  /**
   * Route `bridge()` through the backend submit-tx flow. Default `true`.
   * Set `false` for the fully client-side relay. Client-side only — not part of backend SodaxDefaultConfig.
   * Omitted here means the default, not off: read the effective value via `sodax.config.bridgeUseBackendSubmitTx`.
   */
  useBackendSubmitTx?: boolean;
};

export type BridgeDefaultConfig = {}; // kept for future extension

export const bridgeConfig = {} satisfies BridgeDefaultConfig;

/**
 * RadFi/Bound request signer — a client-side RUNTIME hook (like {@link SodaxOptionalConfig.logger}),
 * deliberately kept OUT of the serializable {@link RadfiConfig} data contract so it is never fetched
 * from or overwritten by the backend config, and so no credential ever lives on the SDK config object.
 *
 * The SDK invokes it once per outbound RadFi request on any routed host — `baseUrl` says which — and
 * merges the returned headers
 * request. The consumer (e.g. a backend) owns the credential and computes the signature; the SDK holds
 * only the function reference. Used to add Bound's `x-api-signature` HMAC header for server-to-server
 * callers (see swaps-api gh-831), keeping the per-user `accessToken` and the backend credential separate.
 */
export type RadfiSignContext = {
  method: string; // HTTP method of the outbound RadFi request
  path: string; // request endpoint, e.g. `/sodax/transaction`
  /** Resolved base URL this request goes to. Bound serves several hosts — scope credentials on it. */
  baseUrl: string;
};
export type RadfiSigner = (ctx: RadfiSignContext) => Record<string, string> | Promise<Record<string, string>>;
export type RadfiOptions = {
  signRequest?: RadfiSigner; // extra headers (e.g. `x-api-signature`) merged onto each routed RadFi request
};

/**
 * @deprecated Use `swaps: { partnerFee, useBackendSubmitTx }` ({@link SwapsOptions}) instead; removed in v3. Kept for backward
 * compatibility: still honoured, but only when `swaps.useBackendSubmitTx` is omitted; the default is now `true`.
 */
export type SwapsClientOptions = {
  useBackendSubmitTx?: boolean;
};

/**
 * @deprecated Use `bridge: { partnerFee, useBackendSubmitTx }` ({@link BridgeOptions}) instead; removed in v3. Kept for backward
 * compatibility: still honoured, but only when `bridge.useBackendSubmitTx` is omitted; the default is now `true`.
 */
export type BridgeClientOptions = {
  useBackendSubmitTx?: boolean;
};

export type SodaxOptionalConfig = {
  logger?: SodaxLoggerOption;
  analytics?: AnalyticsOption; // Opt-in user-action analytics: an AnalyticsConfig or false (default, disabled). Resolved client-side; never fetched from or overwritten by the backend config.
  fee?: PartnerFee;
  /**
   * Global backend API key, sent as the `x-api-key` header. A client-side runtime option like
   * {@link fee}: held on `ConfigService` and never part of the backend data contract. Sent to
   * configured SODAX backend transports. Per-request overrides via `sodax.api.*` and the
   * `swap()`/`bridge()` submit-tx legs; legacy solver requests use the configured key only.
   * Browser-bundled keys are public.
   */
  apiKey?: string;
  radfi?: RadfiOptions; // Client-side RadFi/Bound runtime hook (request signer). Like `logger`/`analytics`: never part of the backend data contract.
  swaps?: SwapsOptions;
  moneyMarket?: MoneyMarketOptions;
  bridge?: BridgeOptions;
  leverageYield?: LeverageYieldOptions;
  /** @deprecated Use `swaps` instead; removed in v3. Still honoured, but only when `swaps.useBackendSubmitTx` is absent. */
  swapsOptions?: SwapsClientOptions;
  /** @deprecated Use `bridge` instead; removed in v3. Still honoured, but only when `bridge.useBackendSubmitTx` is absent. */
  bridgeOptions?: BridgeClientOptions;
};

/**
 * Options (always optional) accepted by `new Sodax(...)`. A deep-partial override of the {@link SodaxDefaultConfig} data
 * contract, plus client-side runtime options and feature-specific option types that are deliberately
 * kept OUT of `SodaxStaticConfig` itself.
 */
export type SodaxOptions = DeepPartial<SodaxDefaultConfig> & SodaxOptionalConfig;
/**
 * Consolidated config type that combines the default static config and the client provided options in Core SDK.
 * Used in new Sodax constructor where clients can override static config and provide options for the services.
 */
export type SodaxConfig = Prettify<SodaxDefaultConfig & SodaxOptionalConfig>;

/**
 * Default static config data shape used as default config in Core SDK and also used in backend API config responses.
 */
export type SodaxDefaultConfig = {
  chains: Record<SpokeChainKey, SpokeChainConfig>;
  swaps: SwapsDefaultConfig; // swaps config for supported swap tokens per chain
  moneyMarket: MoneyMarketDefaultConfig; // Optional Money Market service enabling cross-chain lending and borrowing
  bridge: BridgeDefaultConfig; // Optional Bridge config for partner fee
  dex: DexDefaultConfig; // Optional Dex service enabling DEX operations
  leverageYield: LeverageYieldDefaultConfig; // Registry of deployed leverage-yield ERC-4626 vaults on Sonic
  hub: HubConfig; // Hub provider for the hub chain (e.g. Sonic mainnet)
  api: ApiConfig; // API config used to interact with the Backend API
  solver: SolverConfig;
  relay: RelayConfig; // Relayer config to relay intents/user actions to the hub and vice versa
};

// default sodax config object which can always be overriden through Sodax instance (i.e. new Sodax(...config))
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
