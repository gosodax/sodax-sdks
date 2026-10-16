// packages/sdk/src/partner/PartnerFeeClaimService.test.ts
import { decodeFunctionData, type Address, type Hex } from 'viem';
import { ChainKeys, type IEvmWalletProvider } from '@sodax/types';
import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '../shared/config/ConfigService.js';
import type { HubProvider } from '../shared/types/types.js';
import type { SpokeService } from '../shared/services/spoke/SpokeService.js';
import { ProtocolIntentsAbi } from '../shared/abis/protocolIntents.abi.js';
import { noopAnalytics } from '../shared/index.js';

// The fee-claim swap notifies the solver through a static import, so it is replaced at the module.
const mocks = vi.hoisted(() => ({ solverPostExecution: vi.fn() }));
vi.mock('../swap/SolverApiService.js', () => ({ SolverApiService: { postExecution: mocks.solverPostExecution } }));

import { PartnerFeeClaimService } from './PartnerFeeClaimService.js';

const PROTOCOL_INTENTS = '0xaFf2EDb3057ed6f9C1dA6c930b8ddDf2beE573A5' as Address;
const SRC = '0x6c5f91fd68dd7b3a1aedb0f09946659272f523a4' as Address;
const USDC = '0x29219dd400f2Bf60E5a23d13Be72B486D4038894' as Address;

const EVM_WALLET = { chainType: 'EVM', sendTransaction: vi.fn() } as unknown as IEvmWalletProvider;

function makeService(overrides: {
  readContract?: ReturnType<typeof vi.fn>;
  sendTransaction?: ReturnType<typeof vi.fn>;
  waitForTransactionReceipt?: ReturnType<typeof vi.fn>;
  isValidIntentRelayChainId?: (chainId: bigint) => boolean;
  apiKey?: string;
}): PartnerFeeClaimService {
  const config = {
    solver: { protocolIntentsContract: PROTOCOL_INTENTS },
    logger: { warn: vi.fn(), error: vi.fn() },
    analytics: noopAnalytics,
    isValidIntentRelayChainId: overrides.isValidIntentRelayChainId ?? (() => true),
    apiKey: overrides.apiKey,
  } as unknown as ConfigService;
  const hubProvider = {
    publicClient: {
      readContract: overrides.readContract ?? vi.fn(),
      waitForTransactionReceipt: overrides.waitForTransactionReceipt ?? vi.fn(),
    },
    chainConfig: { chain: { key: ChainKeys.SONIC_MAINNET } },
  } as unknown as HubProvider;
  const spoke = {} as unknown as SpokeService;
  return new PartnerFeeClaimService({ config, hubProvider, spoke });
}

describe('PartnerFeeClaimService.cancelIntent', () => {
  it('encodes a ProtocolIntents.cancelIntent(fromToken, toToken) call to the protocol intents contract (raw)', async () => {
    const service = makeService({});

    const result = await service.cancelIntent({
      raw: true,
      params: { srcChainKey: ChainKeys.SONIC_MAINNET, srcAddress: SRC, fromToken: USDC, toToken: USDC },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rawTx = result.value as { from: Address; to: Address; value: bigint; data: Hex };
    expect(rawTx.to).toBe(PROTOCOL_INTENTS);
    expect(rawTx.from).toBe(SRC);
    expect(rawTx.value).toBe(0n);

    const decoded = decodeFunctionData({ abi: ProtocolIntentsAbi, data: rawTx.data });
    expect(decoded.functionName).toBe('cancelIntent');
    expect(decoded.args).toEqual([USDC, USDC]);
  });

  it('signs and broadcasts via the wallet provider when not raw', async () => {
    const sendTransaction = vi.fn(async () => '0xcancelhash' as Hex);
    const service = makeService({});

    const result = await service.cancelIntent({
      raw: false,
      params: { srcChainKey: ChainKeys.SONIC_MAINNET, srcAddress: SRC, fromToken: USDC, toToken: USDC },
      walletProvider: { chainType: 'EVM', sendTransaction } as unknown as IEvmWalletProvider,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe('0xcancelhash');
    expect(sendTransaction).toHaveBeenCalledOnce();
  });
});

describe('PartnerFeeClaimService.swap same-token guard', () => {
  it('rejects a claim when the configured output token equals the fee token', async () => {
    // getAutoSwapPreferences reads the on-chain preference; return outputToken === fromToken.
    const readContract = vi.fn(async () => ({ outputToken: USDC, dstChain: 0n, dstAddress: '0x' as Hex }));
    const service = makeService({ readContract });

    const result = await service.swap({
      raw: false,
      params: { srcChainKey: ChainKeys.SONIC_MAINNET, srcAddress: SRC, fromToken: USDC, amount: 1_000_000n },
      walletProvider: EVM_WALLET,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect((result.error as { code?: string }).code).toBe('VALIDATION_FAILED');
    // The guard must short-circuit before any swap transaction is built/sent.
    expect(readContract).toHaveBeenCalled();
  });

  it('forwards the configured backend API key to the solver /execute notice', async () => {
    const intentTxHash = '0xintentTx' as Hex;
    const service = makeService({
      apiKey: 'instance-key',
      waitForTransactionReceipt: vi.fn(async () => ({ transactionHash: intentTxHash })),
    });
    vi.spyOn(service, 'createIntentAutoSwap').mockResolvedValueOnce({ ok: true, value: intentTxHash });
    mocks.solverPostExecution.mockResolvedValueOnce({ ok: true, value: { answer: 'OK' } });

    const result = await service.swap({
      raw: false,
      params: { srcChainKey: ChainKeys.SONIC_MAINNET, srcAddress: SRC, fromToken: USDC, amount: 1_000_000n },
      walletProvider: EVM_WALLET,
    });

    expect(result.ok).toBe(true);
    expect(mocks.solverPostExecution.mock.calls[0]?.[3]).toBe('instance-key');
  });
});

describe('PartnerFeeClaimService.getUserIntent', () => {
  it('returns the stored intent hash for the token pair', async () => {
    const intentHash = '0x5f0317381efc3db8cc34186e3a4c09ebb934209d079d833425beb26d3d9932fb' as Hex;
    const readContract = vi.fn(async () => intentHash);
    const service = makeService({ readContract });

    const result = await service.getUserIntent({ user: SRC, fromToken: USDC, toToken: USDC });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(intentHash);
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: 'getUserIntent', args: [SRC, USDC, USDC] }),
    );
  });
});

describe('PartnerFeeClaimService.getIntentDetails', () => {
  const INTENT_HASH = '0x5f0317381efc3db8cc34186e3a4c09ebb934209d079d833425beb26d3d9932fb' as Hex;
  // Raw struct as viem returns it from readContract: srcChain/dstChain are plain bigint chain ids.
  const onChainIntent = {
    intentId: 7n,
    creator: PROTOCOL_INTENTS,
    inputToken: USDC,
    outputToken: USDC,
    inputAmount: 1_000_000n,
    minOutputAmount: 0n,
    deadline: 0n,
    allowPartialFill: false,
    srcChain: 146n,
    dstChain: 146n,
    srcAddress: SRC as Hex,
    dstAddress: SRC as Hex,
    solver: PROTOCOL_INTENTS,
    data: '0x' as Hex,
  };

  it('maps the on-chain intent struct when the relay chain ids are valid', async () => {
    const readContract = vi.fn(async () => onChainIntent);
    const service = makeService({ readContract, isValidIntentRelayChainId: () => true });

    const result = await service.getIntentDetails(INTENT_HASH);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(onChainIntent);
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: 'getIntentDetails', args: [INTENT_HASH] }),
    );
  });

  it('fails with LOOKUP_FAILED when a relay chain id is not recognized', async () => {
    const readContract = vi.fn(async () => ({ ...onChainIntent, srcChain: 999_999n }));
    const service = makeService({ readContract, isValidIntentRelayChainId: id => id !== 999_999n });

    const result = await service.getIntentDetails(INTENT_HASH);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect((result.error as { code?: string }).code).toBe('LOOKUP_FAILED');
  });
});
