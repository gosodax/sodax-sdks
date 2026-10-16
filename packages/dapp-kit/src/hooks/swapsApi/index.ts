/**
 * Swaps API hooks — typed React Query wrappers over `sodax.api.swaps.*` (the SwapsApiService
 * HTTP client). One hook per endpoint of the backend Swaps API.
 *
 * Distinct from the on-chain `swap/` hooks (`useQuote`/`useStatus`/`useSwap`/…), which drive the
 * `SwapService` path (wallet → hub chain). These hooks call the backend HTTP API instead.
 */

// Tokens
export * from './useSwapsApiTokens.js';
export * from './useSwapsApiTokensByChain.js';

// Quote · deadline
export * from './useSwapsApiQuote.js';
export * from './useSwapsApiDeadline.js';

// Allowance · approve · create intent
export * from './useSwapsApiAllowance.js';
export * from './useSwapsApiApprove.js';
export * from './useSwapsApiApproveAndBroadcast.js';
export * from './useSwapsApiCreateIntent.js';

// Intent lifecycle: submit · status · cancel · hash · packet · extra-data · lookup
export * from './useSwapsApiSubmitIntent.js';
export * from './useSwapsApiStatus.js';
export * from './isTerminalSwapIntentStatus.js'; // terminal-status predicate (drives the status hook's polling)
export * from './useSwapsApiCancelIntent.js';
export * from './useSwapsApiIntentHash.js';
export * from './useSwapsApiIntentPacket.js';
export * from './useSwapsApiIntentExtraData.js';
export * from './useSwapsApiFilledIntent.js';
export * from './useSwapsApiIntent.js';

// Limit orders · gas · fees
export * from './useSwapsApiCreateLimitOrder.js';
export * from './useSwapsApiEstimateGas.js';
export * from './useSwapsApiPartnerFee.js';
export * from './useSwapsApiSolverFee.js';

// Submit-tx state machine
export * from './useSwapsApiSubmitTx.js';
export * from './useSwapsApiSubmitTxStatus.js';
