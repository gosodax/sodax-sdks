/**
 * Executable API-key wire manifest for the swapsApi + bridgeApi + leverageYieldApi hook families.
 *
 * Every hook that accepts a per-request `apiConfig` must land it on the outgoing HTTP request as
 * `x-api-key`. Each row renders its hook without a renderer (the package convention: the React
 * Query wrapper is mocked so `queryFn`/`mutationFn` can be captured and driven directly) against a
 * REAL `Sodax` instance whose config carries a DIFFERENT key — so a hook that silently drops its
 * `apiConfig` still makes a request, still sends a key, and fails its row. The stubbed fetch serves
 * a minimal 200 body; post-request validation rejections are expected and tolerated, because the
 * request that already went out is the whole subject. For the approveAndBroadcast hooks that
 * rejection also means the wallet machinery is never touched.
 *
 * To add a new swapsApi/bridgeApi/leverageYieldApi hook, add its row here. The friction is
 * intentional — it forces key-on-wire coverage from day one.
 */

import { ChainKeys, Sodax, type RequestOverrideConfig } from '@sodax/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// biome-ignore lint/suspicious/noExplicitAny: the captured query/mutation options are driven directly.
let captured: any;

const sodax = new Sodax({ apiKey: 'instance-key', logger: 'silent' });

vi.mock('./shared/useSodaxContext.js', () => ({ useSodaxContext: () => ({ sodax }) }));
vi.mock('@tanstack/react-query', () => ({
  // biome-ignore lint/suspicious/noExplicitAny: mirrors the real wrapper's opaque options bag.
  useQuery: (options: any) => {
    captured = options;
    return {};
  },
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('./shared/useSafeMutation.js', () => ({
  // biome-ignore lint/suspicious/noExplicitAny: mirrors the real wrapper's opaque options bag.
  useSafeMutation: (options: any) => {
    captured = options;
    return {};
  },
}));

const swapsApi = await import('./swapsApi/index.js');
const bridgeApi = await import('./bridgeApi/index.js');
const leverageYieldApi = await import('./leverageYieldApi/index.js');

const fetchMock = vi.fn<typeof globalThis.fetch>(
  async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
);
vi.stubGlobal('fetch', fetchMock);

// --- wire-DTO fixtures (string amounts; the six intent bigint fields are serialized client-side) ---

const INTENT = {
  intentId: 1n,
  creator: '0x3333333333333333333333333333333333333333',
  inputToken: '0x4444444444444444444444444444444444444444',
  outputToken: '0x5555555555555555555555555555555555555555',
  inputAmount: 1_000_000n,
  minOutputAmount: 900_000n,
  deadline: 0n,
  allowPartialFill: false,
  srcChain: 4n,
  dstChain: 44n,
  srcAddress: '0x1111111111111111111111111111111111111111',
  dstAddress: '0x2222222222222222222222222222222222222222',
  solver: '0x0000000000000000000000000000000000000000',
  data: '0x',
} as const;

const CREATE_INTENT_BODY = {
  srcChainKey: ChainKeys.SONIC_MAINNET,
  dstChainKey: ChainKeys.ARBITRUM_MAINNET,
  inputToken: '0x4444444444444444444444444444444444444444',
  outputToken: '0x5555555555555555555555555555555555555555',
  inputAmount: '1000000',
  minOutputAmount: '1',
  deadline: '0',
  allowPartialFill: false,
  srcAddress: '0x1111111111111111111111111111111111111111',
  dstAddress: '0x2222222222222222222222222222222222222222',
};

const QUOTE_BODY = {
  tokenSrc: '0x4444444444444444444444444444444444444444',
  tokenSrcChainKey: ChainKeys.SONIC_MAINNET,
  tokenDst: '0x5555555555555555555555555555555555555555',
  tokenDstChainKey: ChainKeys.ARBITRUM_MAINNET,
  amount: '1000000',
  quoteType: 'exact_input' as const,
};

const SUBMIT_TX_REQUEST = {
  txHash: '0xabc',
  srcChainKey: ChainKeys.SONIC_MAINNET,
  walletAddress: '0x1111111111111111111111111111111111111111',
  intent: INTENT,
  relayData: '0x',
};

const BRIDGE_INTENT_BODY = {
  srcChainKey: ChainKeys.BSC_MAINNET,
  dstChainKey: ChainKeys.ARBITRUM_MAINNET,
  inputToken: '0x4444444444444444444444444444444444444444',
  outputToken: '0x5555555555555555555555555555555555555555',
  inputAmount: '1000000',
  srcAddress: '0x1111111111111111111111111111111111111111',
  dstAddress: '0x2222222222222222222222222222222222222222',
};

const BRIDGE_QUOTE_BODY = {
  srcChainKey: ChainKeys.BSC_MAINNET,
  dstChainKey: ChainKeys.ARBITRUM_MAINNET,
  inputToken: '0x4444444444444444444444444444444444444444',
  outputToken: '0x5555555555555555555555555555555555555555',
};

const BRIDGE_SUBMIT_REQUEST = {
  txHash: '0xabc',
  srcChainKey: ChainKeys.BSC_MAINNET,
  walletAddress: '0x1111111111111111111111111111111111111111',
  relayData: { address: '0x1111111111111111111111111111111111111111', payload: '0x' },
};

const VAULT = '0x6666666666666666666666666666666666666666';

const LEVERAGE_DEPOSIT_BODY = {
  vault: VAULT,
  srcChainKey: ChainKeys.SONIC_MAINNET,
  srcAddress: '0x1111111111111111111111111111111111111111',
  inputToken: '0x4444444444444444444444444444444444444444',
  inputAmount: '1000000',
  minOutputAmount: '1',
};

const LEVERAGE_WITHDRAW_BODY = {
  vault: VAULT,
  srcChainKey: ChainKeys.SONIC_MAINNET,
  srcAddress: '0x1111111111111111111111111111111111111111',
  dstChainKey: ChainKeys.ARBITRUM_MAINNET,
  outputToken: '0x5555555555555555555555555555555555555555',
  inputAmount: '1000000000000000000',
  minOutputAmount: '1',
};

const LEVERAGE_DEPOSIT_QUOTE_BODY = {
  vault: VAULT,
  tokenSrc: '0x4444444444444444444444444444444444444444',
  tokenSrcChainKey: ChainKeys.SONIC_MAINNET,
  amount: '1000000',
  quoteType: 'exact_input' as const,
};

const LEVERAGE_WITHDRAW_QUOTE_BODY = {
  vault: VAULT,
  srcChainKey: ChainKeys.SONIC_MAINNET,
  tokenDst: '0x5555555555555555555555555555555555555555',
  tokenDstChainKey: ChainKeys.ARBITRUM_MAINNET,
  amount: '1000000000000000000',
  quoteType: 'exact_input' as const,
};

/** The leverage-yield submit-tx body carries the required `operation` discriminator. */
const LEVERAGE_SUBMIT_TX_REQUEST = { ...SUBMIT_TX_REQUEST, operation: 'deposit' as const };

// --- manifest ---------------------------------------------------------------

type Row = {
  hook: string;
  /** Exact pathname (below the `/v1` gateway root) the row's single request must hit. */
  path: string;
  /** Exact HTTP method of that request — with `path`, pins the row to one endpoint. */
  method: 'GET' | 'POST';
  /** Renders the hook with `apiConfig` threaded in, then drives the captured queryFn/mutationFn. */
  run: (apiConfig: RequestOverrideConfig) => Promise<unknown>;
};

const ROWS: Row[] = [
  // swapsApi read hooks
  {
    hook: 'useSwapsApiTokens',
    path: '/swaps/tokens',
    method: 'GET',
    run: apiConfig => {
      swapsApi.useSwapsApiTokens({ params: { apiConfig } });
      return captured.queryFn();
    },
  },
  {
    hook: 'useSwapsApiTokensByChain',
    path: '/swaps/tokens/sonic',
    method: 'GET',
    run: apiConfig => {
      swapsApi.useSwapsApiTokensByChain({ params: { chainKey: ChainKeys.SONIC_MAINNET, apiConfig } });
      return captured.queryFn();
    },
  },
  {
    hook: 'useSwapsApiQuote',
    path: '/swaps/quote',
    method: 'POST',
    run: apiConfig => {
      swapsApi.useSwapsApiQuote({ params: { body: QUOTE_BODY, apiConfig } });
      return captured.queryFn();
    },
  },
  {
    hook: 'useSwapsApiDeadline',
    path: '/swaps/deadline',
    method: 'GET',
    run: apiConfig => {
      swapsApi.useSwapsApiDeadline({ params: { apiConfig } });
      return captured.queryFn();
    },
  },
  {
    hook: 'useSwapsApiAllowance',
    path: '/swaps/allowance/check',
    method: 'POST',
    run: apiConfig => {
      swapsApi.useSwapsApiAllowance({ params: { body: CREATE_INTENT_BODY, apiConfig } });
      return captured.queryFn();
    },
  },
  {
    hook: 'useSwapsApiStatus',
    path: '/swaps/intents/status',
    method: 'POST',
    run: apiConfig => {
      swapsApi.useSwapsApiStatus({ params: { intentTxHash: '0xabc', apiConfig } });
      return captured.queryFn();
    },
  },
  {
    hook: 'useSwapsApiSubmitTxStatus',
    path: '/swaps/submit-tx/status',
    method: 'GET',
    run: apiConfig => {
      swapsApi.useSwapsApiSubmitTxStatus({
        params: { txHash: '0xabc', srcChainKey: ChainKeys.SONIC_MAINNET, apiConfig },
      });
      return captured.queryFn();
    },
  },
  {
    hook: 'useSwapsApiFilledIntent',
    path: '/swaps/intents/0xabc/fill',
    method: 'GET',
    run: apiConfig => {
      swapsApi.useSwapsApiFilledIntent({ params: { txHash: '0xabc', apiConfig } });
      return captured.queryFn();
    },
  },
  {
    hook: 'useSwapsApiIntent',
    path: '/swaps/intents/0xabc',
    method: 'GET',
    run: apiConfig => {
      swapsApi.useSwapsApiIntent({ params: { txHash: '0xabc', apiConfig } });
      return captured.queryFn();
    },
  },
  {
    hook: 'useSwapsApiPartnerFee',
    path: '/swaps/fees/partner',
    method: 'GET',
    run: apiConfig => {
      swapsApi.useSwapsApiPartnerFee({ params: { amount: '1000', apiConfig } });
      return captured.queryFn();
    },
  },
  {
    hook: 'useSwapsApiSolverFee',
    path: '/swaps/fees/solver',
    method: 'GET',
    run: apiConfig => {
      swapsApi.useSwapsApiSolverFee({ params: { amount: '1000', apiConfig } });
      return captured.queryFn();
    },
  },
  {
    hook: 'useSwapsApiEstimateGas',
    path: '/swaps/gas/estimate',
    method: 'POST',
    run: apiConfig => {
      swapsApi.useSwapsApiEstimateGas({
        params: { body: { chainKey: ChainKeys.SONIC_MAINNET, tx: { from: '0xf', to: '0xt', data: '0x' } }, apiConfig },
      });
      return captured.queryFn();
    },
  },
  {
    hook: 'useSwapsApiIntentExtraData',
    path: '/swaps/intents/extra-data',
    method: 'POST',
    run: apiConfig => {
      swapsApi.useSwapsApiIntentExtraData({ params: { body: { txHash: '0xabc' }, apiConfig } });
      return captured.queryFn();
    },
  },
  {
    hook: 'useSwapsApiIntentHash',
    path: '/swaps/intents/hash',
    method: 'POST',
    run: apiConfig => {
      swapsApi.useSwapsApiIntentHash({ params: { intent: INTENT, apiConfig } });
      return captured.queryFn();
    },
  },
  {
    hook: 'useSwapsApiIntentPacket',
    path: '/swaps/intents/packet',
    method: 'POST',
    run: apiConfig => {
      swapsApi.useSwapsApiIntentPacket({ params: { body: { chainId: '146', fillTxHash: '0xf' }, apiConfig } });
      return captured.queryFn();
    },
  },
  // swapsApi mutation hooks
  {
    hook: 'useSwapsApiApprove',
    path: '/swaps/approve',
    method: 'POST',
    run: apiConfig => {
      swapsApi.useSwapsApiApprove();
      return captured.mutationFn({ body: CREATE_INTENT_BODY, apiConfig });
    },
  },
  {
    hook: 'useSwapsApiCancelIntent',
    path: '/swaps/intents/cancel',
    method: 'POST',
    run: apiConfig => {
      swapsApi.useSwapsApiCancelIntent();
      return captured.mutationFn({ body: { srcChainKey: ChainKeys.SONIC_MAINNET, intent: INTENT }, apiConfig });
    },
  },
  {
    hook: 'useSwapsApiCreateIntent',
    path: '/swaps/intents',
    method: 'POST',
    run: apiConfig => {
      swapsApi.useSwapsApiCreateIntent();
      return captured.mutationFn({ body: CREATE_INTENT_BODY, apiConfig });
    },
  },
  {
    hook: 'useSwapsApiCreateLimitOrder',
    path: '/swaps/limit-orders',
    method: 'POST',
    run: apiConfig => {
      swapsApi.useSwapsApiCreateLimitOrder();
      return captured.mutationFn({ body: CREATE_INTENT_BODY, apiConfig });
    },
  },
  {
    hook: 'useSwapsApiSubmitIntent',
    path: '/swaps/intents/submit',
    method: 'POST',
    run: apiConfig => {
      swapsApi.useSwapsApiSubmitIntent();
      return captured.mutationFn({ body: { chainId: '146', txHash: '0xabc' }, apiConfig });
    },
  },
  {
    hook: 'useSwapsApiSubmitTx',
    path: '/swaps/submit-tx',
    method: 'POST',
    run: apiConfig => {
      swapsApi.useSwapsApiSubmitTx();
      return captured.mutationFn({ request: SUBMIT_TX_REQUEST, apiConfig });
    },
  },
  {
    // The `{}` 200 fails the approve schema, so the mutation rejects BEFORE any wallet work — the
    // backend request this row asserts is the hook's first step.
    hook: 'useSwapsApiApproveAndBroadcast',
    path: '/swaps/approve',
    method: 'POST',
    run: apiConfig => {
      swapsApi.useSwapsApiApproveAndBroadcast();
      return captured.mutationFn({ body: CREATE_INTENT_BODY, walletProvider: {}, apiConfig });
    },
  },
  // bridgeApi read hooks
  {
    hook: 'useBridgeApiTokens',
    path: '/bridge/tokens',
    method: 'GET',
    run: apiConfig => {
      bridgeApi.useBridgeApiTokens({ params: { apiConfig } });
      return captured.queryFn();
    },
  },
  {
    hook: 'useBridgeApiTokensByChain',
    path: '/bridge/tokens/0x38.bsc',
    method: 'GET',
    run: apiConfig => {
      bridgeApi.useBridgeApiTokensByChain({ params: { chainKey: ChainKeys.BSC_MAINNET, apiConfig } });
      return captured.queryFn();
    },
  },
  {
    hook: 'useBridgeApiAllowance',
    path: '/bridge/allowance/check',
    method: 'POST',
    run: apiConfig => {
      bridgeApi.useBridgeApiAllowance({ params: { body: BRIDGE_INTENT_BODY, apiConfig } });
      return captured.queryFn();
    },
  },
  {
    hook: 'useBridgeApiBridgeableAmount',
    path: '/bridge/bridgeable-amount',
    method: 'POST',
    run: apiConfig => {
      bridgeApi.useBridgeApiBridgeableAmount({ params: { body: BRIDGE_QUOTE_BODY, apiConfig } });
      return captured.queryFn();
    },
  },
  {
    hook: 'useBridgeApiFee',
    path: '/bridge/fee',
    method: 'POST',
    run: apiConfig => {
      bridgeApi.useBridgeApiFee({ params: { body: { inputAmount: '1000000' }, apiConfig } });
      return captured.queryFn();
    },
  },
  {
    hook: 'useBridgeApiIsBridgeable',
    path: '/bridge/bridgeable/check',
    method: 'POST',
    run: apiConfig => {
      bridgeApi.useBridgeApiIsBridgeable({ params: { body: BRIDGE_QUOTE_BODY, apiConfig } });
      return captured.queryFn();
    },
  },
  {
    hook: 'useBridgeApiSubmitTxStatus',
    path: '/bridge/submit-tx/status',
    method: 'GET',
    run: apiConfig => {
      bridgeApi.useBridgeApiSubmitTxStatus({
        params: { txHash: '0xabc', srcChainKey: ChainKeys.BSC_MAINNET, apiConfig },
      });
      return captured.queryFn();
    },
  },
  // bridgeApi mutation hooks
  {
    hook: 'useBridgeApiApprove',
    path: '/bridge/approve',
    method: 'POST',
    run: apiConfig => {
      bridgeApi.useBridgeApiApprove();
      return captured.mutationFn({ body: BRIDGE_INTENT_BODY, apiConfig });
    },
  },
  {
    hook: 'useBridgeApiCreateBridgeIntent',
    path: '/bridge/intents',
    method: 'POST',
    run: apiConfig => {
      bridgeApi.useBridgeApiCreateBridgeIntent();
      return captured.mutationFn({ body: BRIDGE_INTENT_BODY, apiConfig });
    },
  },
  {
    hook: 'useBridgeApiSubmitTx',
    path: '/bridge/submit-tx',
    method: 'POST',
    run: apiConfig => {
      bridgeApi.useBridgeApiSubmitTx();
      return captured.mutationFn({ request: BRIDGE_SUBMIT_REQUEST, apiConfig });
    },
  },
  {
    // Same shape as the swaps row: the failed approve unwrap rejects before any wallet work.
    hook: 'useBridgeApiApproveAndBroadcast',
    path: '/bridge/approve',
    method: 'POST',
    run: apiConfig => {
      bridgeApi.useBridgeApiApproveAndBroadcast();
      return captured.mutationFn({ body: BRIDGE_INTENT_BODY, walletProvider: {}, apiConfig });
    },
  },
  // leverageYieldApi read hooks
  {
    hook: 'useLeverageYieldApiVaults',
    path: '/leverage-yield/vaults',
    method: 'GET',
    run: apiConfig => {
      leverageYieldApi.useLeverageYieldApiVaults({ params: { apiConfig } });
      return captured.queryFn();
    },
  },
  {
    hook: 'useLeverageYieldApiVault',
    path: '/leverage-yield/vaults/lsodaWEETH',
    method: 'GET',
    run: apiConfig => {
      leverageYieldApi.useLeverageYieldApiVault({ params: { name: 'lsodaWEETH', apiConfig } });
      return captured.queryFn();
    },
  },
  {
    hook: 'useLeverageYieldApiAsset',
    path: '/leverage-yield/asset',
    method: 'GET',
    run: apiConfig => {
      leverageYieldApi.useLeverageYieldApiAsset({ params: { vault: VAULT, apiConfig } });
      return captured.queryFn();
    },
  },
  {
    hook: 'useLeverageYieldApiPosition',
    path: '/leverage-yield/position',
    method: 'GET',
    run: apiConfig => {
      leverageYieldApi.useLeverageYieldApiPosition({ params: { vault: VAULT, apiConfig } });
      return captured.queryFn();
    },
  },
  {
    hook: 'useLeverageYieldApiApr',
    path: '/leverage-yield/apr',
    method: 'GET',
    run: apiConfig => {
      leverageYieldApi.useLeverageYieldApiApr({ params: { vault: VAULT, apiConfig } });
      return captured.queryFn();
    },
  },
  {
    hook: 'useLeverageYieldApiEffectiveApr',
    path: '/leverage-yield/apr/effective',
    method: 'GET',
    run: apiConfig => {
      leverageYieldApi.useLeverageYieldApiEffectiveApr({ params: { vault: VAULT, apiConfig } });
      return captured.queryFn();
    },
  },
  {
    hook: 'useLeverageYieldApiLsdApr',
    path: '/leverage-yield/apr/lsd',
    method: 'GET',
    run: apiConfig => {
      leverageYieldApi.useLeverageYieldApiLsdApr({ params: { vault: VAULT, apiConfig } });
      return captured.queryFn();
    },
  },
  {
    hook: 'useLeverageYieldApiTotalAssets',
    path: '/leverage-yield/total-assets',
    method: 'GET',
    run: apiConfig => {
      leverageYieldApi.useLeverageYieldApiTotalAssets({ params: { vault: VAULT, apiConfig } });
      return captured.queryFn();
    },
  },
  {
    hook: 'useLeverageYieldApiPreviewDeposit',
    path: '/leverage-yield/preview/deposit',
    method: 'GET',
    run: apiConfig => {
      leverageYieldApi.useLeverageYieldApiPreviewDeposit({ params: { vault: VAULT, assets: '1000000', apiConfig } });
      return captured.queryFn();
    },
  },
  {
    hook: 'useLeverageYieldApiPreviewWithdraw',
    path: '/leverage-yield/preview/withdraw',
    method: 'GET',
    run: apiConfig => {
      leverageYieldApi.useLeverageYieldApiPreviewWithdraw({ params: { vault: VAULT, assets: '1000000', apiConfig } });
      return captured.queryFn();
    },
  },
  {
    hook: 'useLeverageYieldApiPreviewRedeem',
    path: '/leverage-yield/preview/redeem',
    method: 'GET',
    run: apiConfig => {
      leverageYieldApi.useLeverageYieldApiPreviewRedeem({ params: { vault: VAULT, shares: '1000000', apiConfig } });
      return captured.queryFn();
    },
  },
  {
    hook: 'useLeverageYieldApiShareBalance',
    path: '/leverage-yield/share-balance',
    method: 'GET',
    run: apiConfig => {
      leverageYieldApi.useLeverageYieldApiShareBalance({
        params: { vault: VAULT, owner: '0x1111111111111111111111111111111111111111', apiConfig },
      });
      return captured.queryFn();
    },
  },
  {
    hook: 'useLeverageYieldApiMaxWithdraw',
    path: '/leverage-yield/max-withdraw',
    method: 'GET',
    run: apiConfig => {
      leverageYieldApi.useLeverageYieldApiMaxWithdraw({
        params: { vault: VAULT, owner: '0x1111111111111111111111111111111111111111', apiConfig },
      });
      return captured.queryFn();
    },
  },
  {
    hook: 'useLeverageYieldApiDepositQuote',
    path: '/leverage-yield/quote/deposit',
    method: 'POST',
    run: apiConfig => {
      leverageYieldApi.useLeverageYieldApiDepositQuote({ params: { body: LEVERAGE_DEPOSIT_QUOTE_BODY, apiConfig } });
      return captured.queryFn();
    },
  },
  {
    hook: 'useLeverageYieldApiWithdrawQuote',
    path: '/leverage-yield/quote/withdraw',
    method: 'POST',
    run: apiConfig => {
      leverageYieldApi.useLeverageYieldApiWithdrawQuote({ params: { body: LEVERAGE_WITHDRAW_QUOTE_BODY, apiConfig } });
      return captured.queryFn();
    },
  },
  {
    hook: 'useLeverageYieldApiDeadline',
    path: '/leverage-yield/deadline',
    method: 'GET',
    run: apiConfig => {
      leverageYieldApi.useLeverageYieldApiDeadline({ params: { apiConfig } });
      return captured.queryFn();
    },
  },
  {
    hook: 'useLeverageYieldApiAllowance',
    path: '/leverage-yield/allowance/check',
    method: 'POST',
    run: apiConfig => {
      leverageYieldApi.useLeverageYieldApiAllowance({ params: { body: LEVERAGE_DEPOSIT_BODY, apiConfig } });
      return captured.queryFn();
    },
  },
  {
    hook: 'useLeverageYieldApiStatus',
    path: '/leverage-yield/intents/status',
    method: 'POST',
    run: apiConfig => {
      leverageYieldApi.useLeverageYieldApiStatus({ params: { intentTxHash: '0xabc', apiConfig } });
      return captured.queryFn();
    },
  },
  {
    hook: 'useLeverageYieldApiIntentHash',
    path: '/leverage-yield/intents/hash',
    method: 'POST',
    run: apiConfig => {
      leverageYieldApi.useLeverageYieldApiIntentHash({ params: { intent: INTENT, apiConfig } });
      return captured.queryFn();
    },
  },
  {
    hook: 'useLeverageYieldApiIntentPacket',
    path: '/leverage-yield/intents/packet',
    method: 'POST',
    run: apiConfig => {
      leverageYieldApi.useLeverageYieldApiIntentPacket({
        params: { body: { chainId: '146', fillTxHash: '0xf' }, apiConfig },
      });
      return captured.queryFn();
    },
  },
  {
    hook: 'useLeverageYieldApiIntentExtraData',
    path: '/leverage-yield/intents/extra-data',
    method: 'POST',
    run: apiConfig => {
      leverageYieldApi.useLeverageYieldApiIntentExtraData({ params: { body: { txHash: '0xabc' }, apiConfig } });
      return captured.queryFn();
    },
  },
  {
    hook: 'useLeverageYieldApiFilledIntent',
    path: '/leverage-yield/intents/0xabc/fill',
    method: 'GET',
    run: apiConfig => {
      leverageYieldApi.useLeverageYieldApiFilledIntent({ params: { txHash: '0xabc', apiConfig } });
      return captured.queryFn();
    },
  },
  {
    hook: 'useLeverageYieldApiIntent',
    path: '/leverage-yield/intents/0xabc',
    method: 'GET',
    run: apiConfig => {
      leverageYieldApi.useLeverageYieldApiIntent({ params: { txHash: '0xabc', apiConfig } });
      return captured.queryFn();
    },
  },
  {
    hook: 'useLeverageYieldApiEstimateGas',
    path: '/leverage-yield/gas/estimate',
    method: 'POST',
    run: apiConfig => {
      leverageYieldApi.useLeverageYieldApiEstimateGas({
        params: { body: { chainKey: ChainKeys.SONIC_MAINNET, tx: { from: '0xf', to: '0xt', data: '0x' } }, apiConfig },
      });
      return captured.queryFn();
    },
  },
  {
    hook: 'useLeverageYieldApiPartnerFee',
    path: '/leverage-yield/fees/partner',
    method: 'GET',
    run: apiConfig => {
      leverageYieldApi.useLeverageYieldApiPartnerFee({ params: { amount: '1000', apiConfig } });
      return captured.queryFn();
    },
  },
  {
    hook: 'useLeverageYieldApiSolverFee',
    path: '/leverage-yield/fees/solver',
    method: 'GET',
    run: apiConfig => {
      leverageYieldApi.useLeverageYieldApiSolverFee({ params: { amount: '1000', apiConfig } });
      return captured.queryFn();
    },
  },
  {
    hook: 'useLeverageYieldApiSubmitTxStatus',
    path: '/leverage-yield/submit-tx/status',
    method: 'GET',
    run: apiConfig => {
      leverageYieldApi.useLeverageYieldApiSubmitTxStatus({
        params: { txHash: '0xabc', srcChainKey: ChainKeys.SONIC_MAINNET, apiConfig },
      });
      return captured.queryFn();
    },
  },
  // leverageYieldApi mutation hooks
  {
    hook: 'useLeverageYieldApiApprove',
    path: '/leverage-yield/approve',
    method: 'POST',
    run: apiConfig => {
      leverageYieldApi.useLeverageYieldApiApprove();
      return captured.mutationFn({ body: LEVERAGE_DEPOSIT_BODY, apiConfig });
    },
  },
  {
    // Same shape as the swaps/bridge rows: the failed approve unwrap rejects before any wallet work.
    hook: 'useLeverageYieldApiApproveAndBroadcast',
    path: '/leverage-yield/approve',
    method: 'POST',
    run: apiConfig => {
      leverageYieldApi.useLeverageYieldApiApproveAndBroadcast();
      return captured.mutationFn({ body: LEVERAGE_DEPOSIT_BODY, walletProvider: {}, apiConfig });
    },
  },
  {
    hook: 'useLeverageYieldApiCreateDepositIntent',
    path: '/leverage-yield/intents/deposit',
    method: 'POST',
    run: apiConfig => {
      leverageYieldApi.useLeverageYieldApiCreateDepositIntent();
      return captured.mutationFn({ body: LEVERAGE_DEPOSIT_BODY, apiConfig });
    },
  },
  {
    hook: 'useLeverageYieldApiCreateWithdrawIntent',
    path: '/leverage-yield/intents/withdraw',
    method: 'POST',
    run: apiConfig => {
      leverageYieldApi.useLeverageYieldApiCreateWithdrawIntent();
      return captured.mutationFn({ body: LEVERAGE_WITHDRAW_BODY, apiConfig });
    },
  },
  {
    hook: 'useLeverageYieldApiCancelIntent',
    path: '/leverage-yield/intents/cancel',
    method: 'POST',
    run: apiConfig => {
      leverageYieldApi.useLeverageYieldApiCancelIntent();
      return captured.mutationFn({ body: { srcChainKey: ChainKeys.SONIC_MAINNET, intent: INTENT }, apiConfig });
    },
  },
  {
    hook: 'useLeverageYieldApiSubmitIntent',
    path: '/leverage-yield/intents/submit',
    method: 'POST',
    run: apiConfig => {
      leverageYieldApi.useLeverageYieldApiSubmitIntent();
      return captured.mutationFn({ body: { chainId: '146', txHash: '0xabc' }, apiConfig });
    },
  },
  {
    hook: 'useLeverageYieldApiSubmitTx',
    path: '/leverage-yield/submit-tx',
    method: 'POST',
    run: apiConfig => {
      leverageYieldApi.useLeverageYieldApiSubmitTx();
      return captured.mutationFn({ request: LEVERAGE_SUBMIT_TX_REQUEST, apiConfig });
    },
  },
];

/** Fails loudly when a named row is missing, so a hook rename cannot silently drop coverage. */
const rowFor = (hook: string): Row => {
  const row = ROWS.find(r => r.hook === hook);
  if (!row) throw new Error(`_apiKeyWire manifest has no row named ${hook}`);
  return row;
};

beforeEach(() => {
  fetchMock.mockClear();
  captured = undefined;
});

describe('apiConfig.apiKey reaches the wire (hook-level key beats the instance key)', () => {
  it.each(ROWS)('$hook → $method $path carries x-api-key: hook-key', async ({ path, method, run }) => {
    await run({ apiKey: 'hook-key' }).catch(() => {}); // response may fail validation; the request is the subject
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(new URL(String(url)).pathname).toBe(`/v1${path}`);
    expect(init?.method).toBe(method);
    expect(new Headers(init?.headers).get('x-api-key')).toBe('hook-key');
  });
});

describe('a raw x-api-key header override wins in any casing, without duplicating the header', () => {
  const REPRESENTATIVES = [
    rowFor('useSwapsApiTokens'),
    rowFor('useBridgeApiTokens'),
    rowFor('useLeverageYieldApiVaults'),
  ];

  it.each(REPRESENTATIVES)('$hook → $method $path carries exactly one x-api-key: raw-key', async ({
    path,
    method,
    run,
  }) => {
    await run({ headers: { 'X-Api-Key': 'raw-key' } }).catch(() => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(new URL(String(url)).pathname).toBe(`/v1${path}`);
    expect(init?.method).toBe(method);
    const headers = init?.headers as Record<string, string>;
    expect(Object.keys(headers).filter(name => name.toLowerCase() === 'x-api-key')).toHaveLength(1);
    expect(new Headers(headers).get('x-api-key')).toBe('raw-key');
  });
});
