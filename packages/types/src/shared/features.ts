/** Feature tag shared by `SodaxError.feature` and analytics; defined here so every package uses one source of truth. */
export type SodaxFeature =
  | 'swap'
  | 'moneyMarket'
  | 'bridge'
  | 'staking'
  | 'migration'
  | 'dex'
  | 'partner'
  | 'recovery'
  | 'backend' // backend-API HTTP client layer (BackendApiService / SwapsApiService), not a domain feature
  | 'sponsoring'
  | 'leverageYield';
