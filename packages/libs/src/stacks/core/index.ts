/**
 * Bundled re-exports of @stacks/transactions and @stacks/network.
 *
 * TODO(#1070): These packages are bundled here via tsup `noExternal` to work
 * around a Turbopack scope-hoisting cycle that crashes Next.js 16 builds.
 * Consumers (sdk, wallet-sdk-core, wallet-sdk-react) import from
 * `@sodax/libs/stacks` so the code is bundled only once across the chain.
 *
 * Remove this package and revert consumers to `@stacks/*` imports when the
 * upstream cycle is fixed.
 *
 * Re-exports only the subset of `@stacks/transactions` + `@stacks/network`
 * that `@sodax/*` consumers actually use. When a consumer needs an
 * additional Stacks symbol, add it here first — do not import from
 * `@stacks/transactions` directly elsewhere, otherwise the bundling
 * isolation breaks (caught at CI by `verify-no-duplicate-bundling.mjs`).
 */

// @stacks/transactions — values
export {
  Cl,
  Pc,
  serializeCV,
  cvToString,
  deserializeCV,
  someCV,
  uintCV,
  noneCV,
  parseContractId,
  broadcastTransaction,
  fetchCallReadOnlyFunction,
  getAddressFromPrivateKey,
  getAddressFromPublicKey,
  makeContractCall,
  makeSTXTokenTransfer,
  PostConditionMode,
  makeUnsignedContractCall,
  fetchFeeEstimateTransaction,
  validateStacksAddress,
  serializePayloadBytes,
  deserializePayload,
  addressToString,
  PayloadType,
  privateKeyToPublic,
  publicKeyToHex,
} from '@stacks/transactions';

// @stacks/transactions — types
export type {
  ClarityValue,
  ContractIdString,
  ContractPrincipalCV,
  UIntCV,
  ResponseOkCV,
  PostConditionModeName,
  PostCondition,
} from '@stacks/transactions';

// @stacks/network — values
export { createNetwork, networkFrom } from '@stacks/network';

// @stacks/network — types
export type { StacksNetwork } from '@stacks/network';
