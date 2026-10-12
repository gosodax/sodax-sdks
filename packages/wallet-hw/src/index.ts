/**
 * `@sodax/wallet-hw` — optional hardware-wallet add-on for the Sodax wallet SDK.
 *
 * Opt-in: not a dependency of `@sodax/sdk` or `@sodax/wallet-sdk-core`. Install it
 * separately and wire the connectors into the EVM slot of `SodaxWalletProvider`:
 *
 * ```ts
 * import { ledgerEvmConnectors, trezorEvmConnectors } from '@sodax/wallet-hw';
 * const config = { EVM: { wagmiConnectors: [...ledgerEvmConnectors(), ...trezorEvmConnectors()] } };
 * ```
 */
export * from './ledger/index.js';
export * from './trezor/index.js';
