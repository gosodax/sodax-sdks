/**
 * Wire test for PartnerFeeClaimService.swap's solver notice: the configured backend API key must
 * ride the actual outgoing `/execute` fetch with `Content-Type` intact. Deliberately a separate
 * file from PartnerFeeClaimService.test.ts, which hoists a `vi.mock('../swap/SolverApiService.js')`
 * that would replace the very transport under test — here the real solver client runs against a
 * stubbed global fetch.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChainKeys, type Address, type Hex, type IEvmWalletProvider } from '@sodax/types';
import type { ConfigService } from '../shared/config/ConfigService.js';
import type { HubProvider } from '../shared/types/types.js';
import type { SpokeService } from '../shared/services/spoke/SpokeService.js';
import { noopAnalytics } from '../shared/index.js';
import { PartnerFeeClaimService } from './PartnerFeeClaimService.js';

const PROTOCOL_INTENTS = '0xaFf2EDb3057ed6f9C1dA6c930b8ddDf2beE573A5' as Address;
const SRC = '0x6c5f91fd68dd7b3a1aedb0f09946659272f523a4' as Address;
const USDC = '0x29219dd400f2Bf60E5a23d13Be72B486D4038894' as Address;
const INTENT_TX_HASH = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as Hex;

// Stub provider: createIntentAutoSwap — its only consumer here — is mocked in the test body.
const EVM_WALLET = { chainType: 'EVM', sendTransaction: vi.fn() } as unknown as IEvmWalletProvider;

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// The minimal dependency set PartnerFeeClaimService.test.ts's makeService uses, plus the solver
// endpoint config the un-mocked transport reads and the configured API key under test.
function makeService(): PartnerFeeClaimService {
  const config = {
    solver: {
      protocolIntentsContract: PROTOCOL_INTENTS,
      solverApiEndpoint: 'https://api.sodax.com/v1/intent',
    },
    logger: { warn: vi.fn(), error: vi.fn() },
    analytics: noopAnalytics,
    isValidIntentRelayChainId: () => true,
    apiKey: 'instance-key',
  } as unknown as ConfigService; // deliberate partial: see comment above makeService
  const hubProvider = {
    publicClient: {
      readContract: vi.fn(),
      waitForTransactionReceipt: vi.fn(async () => ({ transactionHash: INTENT_TX_HASH })),
    },
    chainConfig: { chain: { key: ChainKeys.SONIC_MAINNET } },
  } as unknown as HubProvider; // deliberate partial: see comment above makeService
  const spoke = {} as unknown as SpokeService; // unused on this path: createIntentAutoSwap is mocked
  return new PartnerFeeClaimService({ config, hubProvider, spoke });
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('PartnerFeeClaimService.swap — API key on the solver wire', () => {
  it('sends x-api-key with Content-Type intact on the real POST /execute', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ answer: 'OK', intent_hash: INTENT_TX_HASH }),
    });
    const service = makeService();
    vi.spyOn(service, 'createIntentAutoSwap').mockResolvedValueOnce({ ok: true, value: INTENT_TX_HASH });

    const result = await service.swap({
      raw: false,
      params: { srcChainKey: ChainKeys.SONIC_MAINNET, srcAddress: SRC, fromToken: USDC, amount: 1_000_000n },
      walletProvider: EVM_WALLET,
    });

    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] ?? [];
    expect(new URL(String(url)).pathname).toBe('/v1/intent/execute');
    expect(init?.method).toBe('POST');
    const headers = new Headers(init?.headers);
    expect(headers.get('x-api-key')).toBe('instance-key');
    expect(headers.get('content-type')).toBe('application/json');
  });
});
