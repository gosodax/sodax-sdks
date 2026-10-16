/**
 * Tests for EvmSolverService — the static helper that produces hub-chain calldata,
 * computes intent hashes, and reads `IntentCreated` / `IntentFilled` event payloads.
 *
 * Mirrors the EvmVaultTokenService.test.ts / IntentRelayApiService.test.ts pattern:
 *   1. `describe(method)` per public static; one `it` per branch the implementation
 *      forks on (hub vs. spoke chain key, fee mode, missing log, etc.). Branchy
 *      methods (`createIntentFeeData`, `getIntent`) get nested `happy paths` /
 *      `rejects on invalid inputs` / `error propagation` subgroups so a future
 *      reader can map the suite onto the source 1:1.
 *   2. Calldata is asserted via `encodeFunctionData` against the real `IntentsAbi`
 *      — a mutation that swaps the function name or arg order changes the encoded
 *      bytes and fails the assertion. The intent hash is also re-computed against
 *      the real ABI to lock down the keccak input shape.
 *   3. Event-reading methods (`getIntent`, `getFilledIntent`) build properly-encoded
 *      logs via `encodeEventTopics` + `encodeAbiParameters` so `parseEventLogs`
 *      decodes them through real viem — no mocking of viem internals.
 *   4. Collaborators reduce to a stubbed `publicClient` (`waitForTransactionReceipt`)
 *      and a partial `ConfigService` fake (`getSpokeTokenFromOriginalAssetAddress`,
 *      `solver.intentsContract`, `isValidIntentRelayChainId`). All other helpers
 *      (`getIntentRelayChainId`, `encodeAddress`, `encodeContractCalls`,
 *      `calculatePercentageFeeAmount`) run as real code so a regression in any of
 *      them surfaces here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type Address,
  type Hash,
  type Hex,
  type HttpTransport,
  type PublicClient,
  type TransactionReceipt,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  encodePacked,
  getAbiItem,
  getAddress,
  keccak256,
  toHex,
} from 'viem';
import {
  ChainKeys,
  FEE_PERCENTAGE_SCALE,
  HookKind,
  type PartnerFee,
  type SolverConfig,
  type XToken,
} from '@sodax/types';
import { IntentsAbi } from '../shared/abis/intents.abi.js';
import type { ConfigService } from '../shared/config/ConfigService.js';
import { IntentDataType, type CreateIntentParams, type Intent } from '../shared/types/intent-types.js';
import { calculatePercentageFeeAmount, encodeAddress, encodeRecipient } from '../shared/utils/shared-utils.js';
import { EvmSolverService } from './EvmSolverService.js';
import { HookService } from './HookService.js';
import { IntentDataService } from './IntentDataService.js';
import { Sodax } from '../index.js';

// --- fixtures -------------------------------------------------------------

// `address` ABI fields decode through `parseEventLogs` as EIP-55-checksummed; any all-lower
// fixture would mismatch on `toEqual` even though the underlying bytes are identical. So token
// / creator / solver / log-address constants are pre-checksummed via `getAddress`.
const INTENTS_CONTRACT: Address = getAddress('0x6382D6ccD780758C5e8A6123c33ee8F4472F96ef');
const HUB_WALLET: Address = getAddress('0x1111111111111111111111111111111111111111');
const SPOKE_INPUT_TOKEN: Address = getAddress('0x2170Ed0880ac9A755fd29B2688956BD959F933F8');
const SPOKE_OUTPUT_TOKEN: Address = getAddress('0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f');
const HUB_INPUT_ASSET: Address = getAddress('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
const HUB_OUTPUT_ASSET: Address = getAddress('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
const FEE_RECEIVER: Address = getAddress('0xfee0fee0fee0fee0fee0fee0fee0fee0fee0fee0');
const SOLVER_ADDRESS: Address = getAddress('0x5051515151515151515151515151515151515151');
// `srcAddress` / `dstAddress` are `bytes` in the IntentsAbi (not `address`), so viem
// returns them as the original lower-case hex — keep them un-checksummed here.
const SRC_USER: Hex = '0xc0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec0ff';
const DST_USER: Hex = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
const TX_HASH: Hash = '0xfeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedface';

const solverCfg: SolverConfig = {
  intentsContract: INTENTS_CONTRACT,
  solverApiEndpoint: 'https://api.example.com/v1/intent',
  protocolIntentsContract: '0xaFf2EDb3057ed6f9C1dA6c930b8ddDf2beE573A5',
};

// Two `XToken` objects whose `hubAsset` field is what `constructCreateIntentData` reads.
// Other XToken fields are irrelevant to the production code path so we cast in below.
const hubInputXToken = { address: SPOKE_INPUT_TOKEN, hubAsset: HUB_INPUT_ASSET } as unknown as XToken;
const hubOutputXToken = { address: SPOKE_OUTPUT_TOKEN, hubAsset: HUB_OUTPUT_ASSET } as unknown as XToken;

const mockPublicClient = {
  waitForTransactionReceipt: vi.fn(),
} as unknown as PublicClient<HttpTransport>;

// Partial ConfigService fake — only the three members EvmSolverService touches.
// `getSpokeTokenFromOriginalAssetAddress` and `isValidIntentRelayChainId` return
// per-test values configured via `mockReturnValueOnce`.
const mockConfig = {
  solver: solverCfg,
  getSpokeTokenFromOriginalAssetAddress: vi.fn(),
  isValidIntentRelayChainId: vi.fn(),
} as unknown as ConfigService;

beforeEach(() => {
  vi.clearAllMocks();
  // Default the chain-id validator to accept everything — getIntent tests opt out
  // when they want to exercise the rejection branch.
  vi.mocked(mockConfig.isValidIntentRelayChainId).mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- helpers --------------------------------------------------------------
//
// Build an `Intent` fixture with sensible defaults; tests override only the
// fields they care about. `srcChain` / `dstChain` are pre-resolved bigints so
// callers don't have to thread `getIntentRelayChainId` through every fixture.
const buildIntent = (overrides: Partial<Intent> = {}): Intent => ({
  intentId: 42n,
  creator: HUB_WALLET,
  inputToken: HUB_INPUT_ASSET,
  outputToken: HUB_OUTPUT_ASSET,
  inputAmount: 1_000_000n,
  minOutputAmount: 900_000n,
  deadline: 1_700_000_000n,
  allowPartialFill: false,
  srcChain: 4n,
  dstChain: 2n,
  srcAddress: SRC_USER,
  dstAddress: DST_USER,
  solver: '0x0000000000000000000000000000000000000000',
  data: '0x',
  ...overrides,
});

// `parseEventLogs` ultimately calls `decodeEventLog`, which expects fully-formed
// topics + data. For non-indexed-only events both fields below are: a single
// topic0 (the event selector) and an ABI-encoded data blob covering all fields.
const encodeIntentCreatedLog = (intentHash: Hex, intent: Intent, address: Address) => {
  const eventAbi = getAbiItem({ abi: IntentsAbi, name: 'IntentCreated' });
  const topics = encodeEventTopics({ abi: IntentsAbi, eventName: 'IntentCreated' });
  const data = encodeAbiParameters(eventAbi.inputs, [intentHash, intent]);
  return { address, topics, data } as const;
};

const encodeIntentFilledLog = (
  intentHash: Hex,
  intentState: { exists: boolean; remainingInput: bigint; receivedOutput: bigint; pendingPayment: boolean },
  address: Address,
) => {
  const eventAbi = getAbiItem({ abi: IntentsAbi, name: 'IntentFilled' });
  const topics = encodeEventTopics({ abi: IntentsAbi, eventName: 'IntentFilled' });
  const data = encodeAbiParameters(eventAbi.inputs, [intentHash, intentState]);
  return { address, topics, data } as const;
};

// Wrap a list of pseudo-logs in the minimal shape `waitForTransactionReceipt`
// returns — `parseEventLogs` only reads the `logs` array, so we don't bother
// populating the rest of the receipt.
const receiptWith = (logs: ReadonlyArray<unknown>): TransactionReceipt => ({ logs }) as unknown as TransactionReceipt;

// =========================================================================
// constructCreateIntentData — hub-asset resolution + multicall encoding
// =========================================================================

describe('EvmSolverService.constructCreateIntentData', () => {
  // Default spoke-chain params: a BSC → ETH swap (both EVM, both spoke chains).
  // Tests override the chain keys to exercise the `isHubChainKey` branches.
  const baseParams = (): CreateIntentParams => ({
    inputToken: SPOKE_INPUT_TOKEN,
    outputToken: SPOKE_OUTPUT_TOKEN,
    inputAmount: 1_000_000n,
    minOutputAmount: 900_000n,
    deadline: 1_700_000_000n,
    allowPartialFill: false,
    srcChainKey: ChainKeys.BSC_MAINNET,
    dstChainKey: ChainKeys.ETHEREUM_MAINNET,
    srcAddress: SRC_USER,
    dstAddress: DST_USER,
    solver: SOLVER_ADDRESS,
    data: '0x',
  });

  it('resolves spoke-chain inputs to hub assets and embeds them in the intent struct (no fee)', () => {
    vi.mocked(mockConfig.getSpokeTokenFromOriginalAssetAddress)
      .mockReturnValueOnce(hubInputXToken)
      .mockReturnValueOnce(hubOutputXToken);

    const [, intent, feeAmount] = EvmSolverService.constructCreateIntentData(
      baseParams(),
      HUB_WALLET,
      mockConfig,
      undefined,
    );

    expect(feeAmount).toBe(0n);
    expect(intent.inputToken).toBe(HUB_INPUT_ASSET);
    expect(intent.outputToken).toBe(HUB_OUTPUT_ASSET);
    expect(intent.creator).toBe(HUB_WALLET);
    expect(intent.inputAmount).toBe(1_000_000n); // no fee deducted
    expect(intent.srcChain).toBe(4n); // BSC_MAINNET → 4n
    expect(intent.dstChain).toBe(2n); // ETHEREUM_MAINNET → 2n
    expect(intent.solver).toBe(SOLVER_ADDRESS);
    expect(intent.data).toBe('0x'); // no fee → empty data
  });

  it('uses the spoke-chain srcAddress/dstAddress as the hub-style hex (EVM chains pass through)', () => {
    vi.mocked(mockConfig.getSpokeTokenFromOriginalAssetAddress)
      .mockReturnValueOnce(hubInputXToken)
      .mockReturnValueOnce(hubOutputXToken);

    const [, intent] = EvmSolverService.constructCreateIntentData(baseParams(), HUB_WALLET, mockConfig, undefined);

    expect(intent.srcAddress).toBe(SRC_USER);
    expect(intent.dstAddress).toBe(DST_USER);
  });

  it('encodes an MPC-relay (Tron) dstAddress as the 32-byte recipient word, not the 20-byte identity', () => {
    vi.mocked(mockConfig.getSpokeTokenFromOriginalAssetAddress)
      .mockReturnValueOnce(hubInputXToken)
      .mockReturnValueOnce(hubOutputXToken);
    const tronAddress = 'TGLeueT1EauJN1AupKBPmkSE76Brm1v4ow';

    const [, intent] = EvmSolverService.constructCreateIntentData(
      { ...baseParams(), dstChainKey: ChainKeys.TRON_MAINNET, dstAddress: tronAddress },
      HUB_WALLET,
      mockConfig,
      undefined,
    );

    const identity = encodeAddress(ChainKeys.TRON_MAINNET, tronAddress);
    expect(intent.dstAddress).toBe(encodeRecipient(ChainKeys.TRON_MAINNET, tronAddress));
    expect(intent.dstAddress).toBe(`0x${'00'.repeat(12)}${identity.slice(2)}`);
    expect(intent.srcAddress).toBe(SRC_USER);
  });

  it('treats the input token as already-on-hub when srcChainKey is the hub chain (skips lookup)', () => {
    // Only the *output* lookup runs; the input is the hub asset directly.
    vi.mocked(mockConfig.getSpokeTokenFromOriginalAssetAddress).mockReturnValueOnce(hubOutputXToken);

    const params: CreateIntentParams = {
      ...baseParams(),
      srcChainKey: ChainKeys.SONIC_MAINNET,
      inputToken: HUB_INPUT_ASSET,
    };
    const [, intent] = EvmSolverService.constructCreateIntentData(params, HUB_WALLET, mockConfig, undefined);

    expect(intent.inputToken).toBe(HUB_INPUT_ASSET);
    expect(intent.outputToken).toBe(HUB_OUTPUT_ASSET);
    expect(mockConfig.getSpokeTokenFromOriginalAssetAddress).toHaveBeenCalledTimes(1);
  });

  it('treats the output token as already-on-hub when dstChainKey is the hub chain (skips lookup)', () => {
    vi.mocked(mockConfig.getSpokeTokenFromOriginalAssetAddress).mockReturnValueOnce(hubInputXToken);

    const params: CreateIntentParams = {
      ...baseParams(),
      dstChainKey: ChainKeys.SONIC_MAINNET,
      outputToken: HUB_OUTPUT_ASSET,
    };
    const [, intent] = EvmSolverService.constructCreateIntentData(params, HUB_WALLET, mockConfig, undefined);

    expect(intent.outputToken).toBe(HUB_OUTPUT_ASSET);
    expect(mockConfig.getSpokeTokenFromOriginalAssetAddress).toHaveBeenCalledTimes(1);
  });

  it('defaults solver to the zero address when params.solver is omitted', () => {
    vi.mocked(mockConfig.getSpokeTokenFromOriginalAssetAddress)
      .mockReturnValueOnce(hubInputXToken)
      .mockReturnValueOnce(hubOutputXToken);

    const { solver: _omit, ...withoutSolver } = baseParams();
    const [, intent] = EvmSolverService.constructCreateIntentData(
      withoutSolver as CreateIntentParams,
      HUB_WALLET,
      mockConfig,
      undefined,
    );

    expect(intent.solver).toBe('0x0000000000000000000000000000000000000000');
  });

  it('deducts a percentage fee from the intent inputAmount and encodes fee data into intent.data', () => {
    vi.mocked(mockConfig.getSpokeTokenFromOriginalAssetAddress)
      .mockReturnValueOnce(hubInputXToken)
      .mockReturnValueOnce(hubOutputXToken);

    const fee: PartnerFee = { address: FEE_RECEIVER, percentage: 100 }; // 1%
    const [, intent, feeAmount] = EvmSolverService.constructCreateIntentData(baseParams(), HUB_WALLET, mockConfig, fee);

    const expectedFee = calculatePercentageFeeAmount(1_000_000n, 100);
    expect(feeAmount).toBe(expectedFee);
    expect(intent.inputAmount).toBe(1_000_000n - expectedFee);
    expect(intent.data).not.toBe('0x'); // fee data populated
  });

  it('emits a multicall payload [approve(intentsContract, grossAmount), createIntent(intent)] (gross before fee)', () => {
    vi.mocked(mockConfig.getSpokeTokenFromOriginalAssetAddress)
      .mockReturnValueOnce(hubInputXToken)
      .mockReturnValueOnce(hubOutputXToken);

    const fee: PartnerFee = { address: FEE_RECEIVER, amount: 1_000n };
    const [encoded, intent] = EvmSolverService.constructCreateIntentData(baseParams(), HUB_WALLET, mockConfig, fee);

    // The encoded payload must contain the createIntent calldata for the post-fee intent
    // AND the approve calldata for the pre-fee gross amount. We re-derive both from real
    // viem and assert they appear in the multicall blob.
    const createIntentCalldata = encodeFunctionData({
      abi: IntentsAbi,
      functionName: 'createIntent',
      args: [intent],
    });
    expect(encoded.includes(createIntentCalldata.slice(2))).toBe(true);
    // gross approval amount = pre-fee inputAmount, encoded as bytes32
    const grossEncoded = toHex(1_000_000n, { size: 32 }).slice(2);
    expect(encoded.toLowerCase().includes(grossEncoded.toLowerCase())).toBe(true);
  });

  it('throws when the input token cannot be resolved to a hub asset', () => {
    vi.mocked(mockConfig.getSpokeTokenFromOriginalAssetAddress).mockReturnValueOnce(undefined);

    expect(() => EvmSolverService.constructCreateIntentData(baseParams(), HUB_WALLET, mockConfig, undefined)).toThrow(
      /hub asset not found for spoke chain token \(intent\.inputToken\)/,
    );
  });

  it('throws when the output token cannot be resolved to a hub asset', () => {
    vi.mocked(mockConfig.getSpokeTokenFromOriginalAssetAddress)
      .mockReturnValueOnce(hubInputXToken)
      .mockReturnValueOnce(undefined);

    expect(() => EvmSolverService.constructCreateIntentData(baseParams(), HUB_WALLET, mockConfig, undefined)).toThrow(
      /hub asset not found for spoke chain token \(intent\.outputToken\)/,
    );
  });
});

// =========================================================================
// createIntentFeeData — fee-mode dispatch + ABI envelope
// =========================================================================

describe('EvmSolverService.createIntentFeeData', () => {
  describe('happy paths', () => {
    it('returns ["0x", 0n] when fee is undefined', () => {
      expect(EvmSolverService.createIntentFeeData(undefined, 1_000_000n)).toEqual(['0x', 0n]);
    });

    it('encodes a PartnerFeeAmount into the IntentDataType.FEE envelope', () => {
      const fee: PartnerFee = { address: FEE_RECEIVER, amount: 5_000n };
      const [encoded, feeAmount] = EvmSolverService.createIntentFeeData(fee, 1_000_000n);

      expect(feeAmount).toBe(5_000n);
      const expectedFeeData = encodeAbiParameters(
        [
          { name: 'fee', type: 'uint256' },
          { name: 'receiver', type: 'address' },
        ],
        [5_000n, FEE_RECEIVER],
      );
      const expectedEnvelope = encodePacked(['uint8', 'bytes'], [IntentDataType.FEE, expectedFeeData]);
      expect(encoded).toBe(expectedEnvelope);
    });

    it('encodes a PartnerFeePercentage as `inputAmount * percentage / FEE_PERCENTAGE_SCALE`', () => {
      const fee: PartnerFee = { address: FEE_RECEIVER, percentage: 250 }; // 2.5%
      const [, feeAmount] = EvmSolverService.createIntentFeeData(fee, 1_000_000n);

      // (1_000_000 * 250) / 10_000 = 25_000
      expect(feeAmount).toBe((1_000_000n * 250n) / FEE_PERCENTAGE_SCALE);
    });

    it('accepts the FEE_PERCENTAGE_SCALE upper bound (100% fee)', () => {
      const fee: PartnerFee = { address: FEE_RECEIVER, percentage: Number(FEE_PERCENTAGE_SCALE) };
      const [, feeAmount] = EvmSolverService.createIntentFeeData(fee, 1_000_000n);
      expect(feeAmount).toBe(1_000_000n);
    });

    it('accepts a 0% percentage fee (boundary, fee data still emitted)', () => {
      const fee: PartnerFee = { address: FEE_RECEIVER, percentage: 0 };
      const [encoded, feeAmount] = EvmSolverService.createIntentFeeData(fee, 1_000_000n);

      expect(feeAmount).toBe(0n);
      // Even with feeAmount === 0n the envelope is still emitted (distinct from `undefined` fee).
      expect(encoded).not.toBe('0x');
    });
  });

  describe('rejects on invalid inputs', () => {
    it('throws when inputAmount is 0n (invariant)', () => {
      expect(() => EvmSolverService.createIntentFeeData(undefined, 0n)).toThrow('Input amount must be greater than 0');
    });

    it('throws when fee.percentage is negative', () => {
      const fee: PartnerFee = { address: FEE_RECEIVER, percentage: -1 };
      expect(() => EvmSolverService.createIntentFeeData(fee, 1_000_000n)).toThrow(/Fee percentage must be between/);
    });

    it('throws when fee.percentage exceeds FEE_PERCENTAGE_SCALE', () => {
      const fee: PartnerFee = { address: FEE_RECEIVER, percentage: Number(FEE_PERCENTAGE_SCALE) + 1 };
      expect(() => EvmSolverService.createIntentFeeData(fee, 1_000_000n)).toThrow(/Fee percentage must be between/);
    });
  });
});

// =========================================================================
// decodeIntentFeeAmount — inverse of createIntentFeeData (fee recovery)
// =========================================================================

describe('EvmSolverService.decodeIntentFeeAmount', () => {
  it('returns 0n for empty data ("0x")', () => {
    expect(EvmSolverService.decodeIntentFeeAmount('0x')).toBe(0n);
  });

  it('round-trips a fixed-amount fee encoded by createIntentFeeData', () => {
    const [data, feeAmount] = EvmSolverService.createIntentFeeData(
      { address: FEE_RECEIVER, amount: 7_777n },
      1_000_000n,
    );
    expect(EvmSolverService.decodeIntentFeeAmount(data)).toBe(feeAmount);
  });

  it('round-trips a percentage fee encoded by createIntentFeeData', () => {
    const [data, feeAmount] = EvmSolverService.createIntentFeeData(
      { address: FEE_RECEIVER, percentage: 250 },
      1_000_000n,
    );
    expect(feeAmount).toBeGreaterThan(0n);
    expect(EvmSolverService.decodeIntentFeeAmount(data)).toBe(feeAmount);
  });

  it('gracefully returns 0n (logging the unknown type byte) for an unknown IntentData type byte', () => {
    const bogus = encodePacked(
      ['uint8', 'bytes'],
      [
        99,
        encodeAbiParameters(
          [
            { name: 'fee', type: 'uint256' },
            { name: 'receiver', type: 'address' },
          ],
          [1n, FEE_RECEIVER],
        ),
      ],
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(EvmSolverService.decodeIntentFeeAmount(bogus)).toBe(0n);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown IntentData type byte'));
  });

  it('recovers the fee from a TYPE_ARRAY envelope carrying fee + delivery', () => {
    const [feeEnvelope] = EvmSolverService.createIntentFeeData({ address: FEE_RECEIVER, amount: 1_234n }, 1_000_000n);
    const data = IntentDataService.composeIntentData(
      feeEnvelope,
      HookService.encodeDeliveryData({ kind: HookKind.HYPERCORE_DEPOSIT }, FEE_RECEIVER),
    );
    expect(EvmSolverService.decodeIntentFeeAmount(data)).toBe(1_234n);
  });

  it('returns 0n (no log) for a delivery-only envelope', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const data = IntentDataService.composeIntentData(
      '0x',
      HookService.encodeDeliveryData({ kind: HookKind.HYPERCORE_DEPOSIT }, FEE_RECEIVER),
    );
    expect(EvmSolverService.decodeIntentFeeAmount(data)).toBe(0n);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

// =========================================================================
// reconstructCreateIntentData — byte-identical relay payload from an Intent
// =========================================================================

describe('EvmSolverService.reconstructCreateIntentData', () => {
  // Spoke-source params (BSC → ETH); two hub-asset lookups happen per construct call.
  const spokeParams = (): CreateIntentParams => ({
    inputToken: SPOKE_INPUT_TOKEN,
    outputToken: SPOKE_OUTPUT_TOKEN,
    inputAmount: 1_000_000n,
    minOutputAmount: 900_000n,
    deadline: 1_700_000_000n,
    allowPartialFill: false,
    srcChainKey: ChainKeys.BSC_MAINNET,
    dstChainKey: ChainKeys.ETHEREUM_MAINNET,
    srcAddress: SRC_USER,
    dstAddress: DST_USER,
    solver: SOLVER_ADDRESS,
    data: '0x',
  });

  const mockHubLookups = () =>
    vi
      .mocked(mockConfig.getSpokeTokenFromOriginalAssetAddress)
      .mockReturnValueOnce(hubInputXToken)
      .mockReturnValueOnce(hubOutputXToken);

  // A real Solana → Sonic swap: the intent as read from the hub and the payload that was actually relayed for it.
  const SOLANA_RELAYED_INTENT = {
    intentId: BigInt('83488095412101173390950552028345512257870714538704893067132536316339680419144'),
    creator: '0x502a1ff98CaE3E596BBaa3586ffb9cD58826C140',
    inputToken: '0x0c09e69a4528945de6d16c7E469deA6996Fdf636',
    outputToken: '0x9Ee17486571917837210824b0d4CAdfe3B324D12',
    inputAmount: BigInt('2500000'),
    minOutputAmount: BigInt('2112617738149668914'),
    deadline: BigInt('1781199633'),
    allowPartialFill: false,
    srcChain: 1n,
    dstChain: 5n,
    srcAddress: '0xcea4dc7d8fd9f14b68c0611cc46c984838f78a506420c22ee40427377464f191',
    dstAddress: '0x0ab764ab3816cd036ea951be973098510d8105a6',
    solver: '0x0000000000000000000000000000000000000000',
    data: '0x',
  } satisfies Intent;
  const SOLANA_RELAYED_PAYLOAD =
    '0x00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000001200000000000000000000000000c09e69a4528945de6d16c7e469dea6996fdf636000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000044095ea7b30000000000000000000000006382d6ccd780758c5e8a6123c33ee8f4472f96ef00000000000000000000000000000000000000000000000000000000002625a0000000000000000000000000000000000000000000000000000000000000000000000000000000006382d6ccd780758c5e8a6123c33ee8f4472f96ef000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000284016f02e30000000000000000000000000000000000000000000000000000000000000020b89496621e10855e7ca566b16484c70234e14287966fe17cd7e57fc142539d48000000000000000000000000502a1ff98cae3e596bbaa3586ffb9cd58826c1400000000000000000000000000c09e69a4528945de6d16c7e469dea6996fdf6360000000000000000000000009ee17486571917837210824b0d4cadfe3b324d1200000000000000000000000000000000000000000000000000000000002625a00000000000000000000000000000000000000000000000001d5186a3c499a832000000000000000000000000000000000000000000000000000000006a2af31100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000500000000000000000000000000000000000000000000000000000000000001c00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002400000000000000000000000000000000000000000000000000000000000000020cea4dc7d8fd9f14b68c0611cc46c984838f78a506420c22ee40427377464f19100000000000000000000000000000000000000000000000000000000000000140Ab764AB3816cD036Ea951bE973098510D8105A6000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';

  it('reconstruct actual solana relay data', () => {
    const sodax = new Sodax();

    const reconstructResult = sodax.swaps.reconstructRelayData(SOLANA_RELAYED_INTENT);
    if (!reconstructResult.ok) {
      throw new Error('Failed to reconstruct relay data');
    }

    expect(reconstructResult.value.payload.toLowerCase()).toBe(SOLANA_RELAYED_PAYLOAD.toLowerCase());
  });

  it('getIntentSubmitTxExtraData rebuilds the same relayed multicall payload for a spoke-source intent', async () => {
    const sodax = new Sodax();

    const result = await sodax.swaps.getIntentSubmitTxExtraData({ intent: SOLANA_RELAYED_INTENT });
    if (!result.ok) {
      throw new Error('Failed to get intent submit tx extra data');
    }

    expect(result.value.address).toBe(SOLANA_RELAYED_INTENT.creator);
    expect(result.value.payload.toLowerCase()).toBe(SOLANA_RELAYED_PAYLOAD.toLowerCase());
  });

  // The canonical proof: the payload `constructCreateIntentData` produced for a spoke source must be
  // reproducible from the resulting `Intent` alone (same intents contract, isHubSource = false).
  it('reproduces the spoke multicall payload byte-for-byte (no fee)', () => {
    mockHubLookups();
    const [expected, intent] = EvmSolverService.constructCreateIntentData(
      spokeParams(),
      HUB_WALLET,
      mockConfig,
      undefined,
    );
    expect(EvmSolverService.reconstructCreateIntentData(intent, INTENTS_CONTRACT, false)).toBe(expected);
  });

  it('reproduces the spoke multicall payload byte-for-byte (percentage fee)', () => {
    mockHubLookups();
    const fee: PartnerFee = { address: FEE_RECEIVER, percentage: 100 }; // 1%
    const [expected, intent] = EvmSolverService.constructCreateIntentData(spokeParams(), HUB_WALLET, mockConfig, fee);
    expect(EvmSolverService.reconstructCreateIntentData(intent, INTENTS_CONTRACT, false)).toBe(expected);
  });

  it('reproduces the spoke multicall payload byte-for-byte (fixed-amount fee)', () => {
    mockHubLookups();
    const fee: PartnerFee = { address: FEE_RECEIVER, amount: 1_000n };
    const [expected, intent] = EvmSolverService.constructCreateIntentData(spokeParams(), HUB_WALLET, mockConfig, fee);
    expect(EvmSolverService.reconstructCreateIntentData(intent, INTENTS_CONTRACT, false)).toBe(expected);
  });

  it('reproduces the raw createIntent calldata for a hub (Sonic) source', () => {
    const intent = buildIntent();
    const expected = encodeFunctionData({ abi: IntentsAbi, functionName: 'createIntent', args: [intent] });
    expect(EvmSolverService.reconstructCreateIntentData(intent, INTENTS_CONTRACT, true)).toBe(expected);
  });
});

// =========================================================================
// getIntent — receipt → IntentCreated event → Intent struct
// =========================================================================

describe('EvmSolverService.getIntent', () => {
  describe('happy paths', () => {
    it('returns the Intent struct when a matching IntentCreated log is present', async () => {
      const intent = buildIntent();
      const intentHash = EvmSolverService.getIntentHash(intent);
      const log = encodeIntentCreatedLog(intentHash, intent, INTENTS_CONTRACT);
      vi.mocked(mockPublicClient.waitForTransactionReceipt).mockResolvedValueOnce(receiptWith([log]));

      const result = await EvmSolverService.getIntent(TX_HASH, mockConfig, mockPublicClient);

      expect(result).toEqual(intent);
      expect(mockPublicClient.waitForTransactionReceipt).toHaveBeenCalledWith({ hash: TX_HASH });
    });

    it('matches the intents contract case-insensitively (log address upper-cased)', async () => {
      const intent = buildIntent();
      const intentHash = EvmSolverService.getIntentHash(intent);
      // Upper-case the address — checksum casing varies in real receipts.
      const log = encodeIntentCreatedLog(intentHash, intent, INTENTS_CONTRACT.toUpperCase() as Address);
      vi.mocked(mockPublicClient.waitForTransactionReceipt).mockResolvedValueOnce(receiptWith([log]));

      await expect(EvmSolverService.getIntent(TX_HASH, mockConfig, mockPublicClient)).resolves.toEqual(intent);
    });

    it('skips logs from unrelated contracts and returns the matching one', async () => {
      const intent = buildIntent({ intentId: 99n });
      const intentHash = EvmSolverService.getIntentHash(intent);
      const otherContract: Address = '0x9999999999999999999999999999999999999999';
      const irrelevantIntent = buildIntent({ intentId: 1n });
      const irrelevantHash = EvmSolverService.getIntentHash(irrelevantIntent);

      const logs = [
        encodeIntentCreatedLog(irrelevantHash, irrelevantIntent, otherContract),
        encodeIntentCreatedLog(intentHash, intent, INTENTS_CONTRACT),
      ];
      vi.mocked(mockPublicClient.waitForTransactionReceipt).mockResolvedValueOnce(receiptWith(logs));

      await expect(EvmSolverService.getIntent(TX_HASH, mockConfig, mockPublicClient)).resolves.toEqual(intent);
    });
  });

  describe('rejects on invalid inputs', () => {
    it('throws when no IntentCreated log targets the intents contract', async () => {
      const intent = buildIntent();
      const intentHash = EvmSolverService.getIntentHash(intent);
      const otherContract: Address = '0x9999999999999999999999999999999999999999';
      const log = encodeIntentCreatedLog(intentHash, intent, otherContract);
      vi.mocked(mockPublicClient.waitForTransactionReceipt).mockResolvedValueOnce(receiptWith([log]));

      await expect(EvmSolverService.getIntent(TX_HASH, mockConfig, mockPublicClient)).rejects.toThrow(
        `No intent found for ${TX_HASH}`,
      );
    });

    it('throws when the receipt has no logs at all', async () => {
      vi.mocked(mockPublicClient.waitForTransactionReceipt).mockResolvedValueOnce(receiptWith([]));

      await expect(EvmSolverService.getIntent(TX_HASH, mockConfig, mockPublicClient)).rejects.toThrow(
        `No intent found for ${TX_HASH}`,
      );
    });

    it('throws when the intent references an unrecognized relay chain id', async () => {
      // Deliberate cast: 9999n is exactly the unrecognized relay chain id under test.
      const intent = buildIntent({ srcChain: 9999n as unknown as Intent['srcChain'] });
      const intentHash = EvmSolverService.getIntentHash(intent);
      const log = encodeIntentCreatedLog(intentHash, intent, INTENTS_CONTRACT);
      vi.mocked(mockPublicClient.waitForTransactionReceipt).mockResolvedValueOnce(receiptWith([log]));
      // First call (srcChain) returns false → the throw fires before dstChain is checked.
      vi.mocked(mockConfig.isValidIntentRelayChainId).mockReturnValueOnce(false);

      await expect(EvmSolverService.getIntent(TX_HASH, mockConfig, mockPublicClient)).rejects.toThrow(
        /Invalid intent relay chain id/,
      );
    });
  });

  describe('error propagation', () => {
    it('propagates errors from waitForTransactionReceipt', async () => {
      const rpcError = new Error('rpc unreachable');
      vi.mocked(mockPublicClient.waitForTransactionReceipt).mockRejectedValueOnce(rpcError);

      await expect(EvmSolverService.getIntent(TX_HASH, mockConfig, mockPublicClient)).rejects.toBe(rpcError);
    });
  });
});

// =========================================================================
// getFilledIntent — receipt → IntentFilled event → IntentState struct
// =========================================================================

describe('EvmSolverService.getFilledIntent', () => {
  const filledState = { exists: true, remainingInput: 0n, receivedOutput: 950_000n, pendingPayment: false };

  it('returns the IntentState when a matching IntentFilled log is present', async () => {
    const intentHash: Hex = keccak256('0xdeadbeef');
    const log = encodeIntentFilledLog(intentHash, filledState, INTENTS_CONTRACT);
    vi.mocked(mockPublicClient.waitForTransactionReceipt).mockResolvedValueOnce(receiptWith([log]));

    const result = await EvmSolverService.getFilledIntent(TX_HASH, solverCfg, mockPublicClient);

    expect(result).toEqual(filledState);
  });

  it('matches the intents contract case-insensitively', async () => {
    const intentHash: Hex = keccak256('0xdeadbeef');
    const log = encodeIntentFilledLog(intentHash, filledState, INTENTS_CONTRACT.toUpperCase() as Address);
    vi.mocked(mockPublicClient.waitForTransactionReceipt).mockResolvedValueOnce(receiptWith([log]));

    await expect(EvmSolverService.getFilledIntent(TX_HASH, solverCfg, mockPublicClient)).resolves.toEqual(filledState);
  });

  it('throws when no IntentFilled log targets the intents contract', async () => {
    const intentHash: Hex = keccak256('0xdeadbeef');
    const otherContract: Address = '0x9999999999999999999999999999999999999999';
    const log = encodeIntentFilledLog(intentHash, filledState, otherContract);
    vi.mocked(mockPublicClient.waitForTransactionReceipt).mockResolvedValueOnce(receiptWith([log]));

    await expect(EvmSolverService.getFilledIntent(TX_HASH, solverCfg, mockPublicClient)).rejects.toThrow(
      `No filled intent found for ${TX_HASH}`,
    );
  });

  it('propagates errors from waitForTransactionReceipt', async () => {
    const rpcError = new Error('rpc unreachable');
    vi.mocked(mockPublicClient.waitForTransactionReceipt).mockRejectedValueOnce(rpcError);

    await expect(EvmSolverService.getFilledIntent(TX_HASH, solverCfg, mockPublicClient)).rejects.toBe(rpcError);
  });
});

// =========================================================================
// getIntentHash (static, pure) — keccak256 of ABI-encoded createIntent inputs
// =========================================================================

describe('EvmSolverService.getIntentHash', () => {
  it('matches keccak256 of encodeAbiParameters over the createIntent input shape', () => {
    const intent = buildIntent();

    const expected = keccak256(
      encodeAbiParameters(getAbiItem({ abi: IntentsAbi, name: 'createIntent' }).inputs, [intent]),
    );

    expect(EvmSolverService.getIntentHash(intent)).toBe(expected);
  });

  it('produces different hashes for intents that differ in any field', () => {
    const a = buildIntent({ intentId: 1n });
    const b = buildIntent({ intentId: 2n });
    expect(EvmSolverService.getIntentHash(a)).not.toBe(EvmSolverService.getIntentHash(b));
  });
});

// =========================================================================
// encodeCreateIntent / encodeCancelIntent (static, pure) — calldata-only
// =========================================================================

describe('EvmSolverService.encodeCreateIntent', () => {
  it('returns { address: intentsContract, value: 0n, data: encoded createIntent(intent) }', () => {
    const intent = buildIntent();
    const result = EvmSolverService.encodeCreateIntent(intent, INTENTS_CONTRACT);

    expect(result).toEqual({
      address: INTENTS_CONTRACT,
      value: 0n,
      data: encodeFunctionData({ abi: IntentsAbi, functionName: 'createIntent', args: [intent] }),
    });
  });
});

describe('EvmSolverService.encodeCancelIntent', () => {
  it('returns { address: intentsContract, value: 0n, data: encoded cancelIntent(intent) }', () => {
    const intent = buildIntent();
    const result = EvmSolverService.encodeCancelIntent(intent, INTENTS_CONTRACT);

    expect(result).toEqual({
      address: INTENTS_CONTRACT,
      value: 0n,
      data: encodeFunctionData({ abi: IntentsAbi, functionName: 'cancelIntent', args: [intent] }),
    });
  });

  it('produces calldata distinct from encodeCreateIntent for the same intent (regression guard)', () => {
    const intent = buildIntent();
    const create = EvmSolverService.encodeCreateIntent(intent, INTENTS_CONTRACT);
    const cancel = EvmSolverService.encodeCancelIntent(intent, INTENTS_CONTRACT);
    expect(create.data).not.toEqual(cancel.data);
  });
});
