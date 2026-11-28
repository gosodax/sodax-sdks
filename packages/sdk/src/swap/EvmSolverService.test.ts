import { monadSupportedTokens } from '@sodax/types';
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
import { ChainKeys, FEE_PERCENTAGE_SCALE, type PartnerFee, type SolverConfig, type XToken } from '@sodax/types';
import { IntentsAbi } from '../shared/abis/intents.abi.js';
import type { ConfigService } from '../shared/config/ConfigService.js';
import { IntentDataType, type CreateIntentParams, type Intent } from '../shared/types/intent-types.js';
import { calculatePercentageFeeAmount, encodeAddress, encodeRecipient } from '../shared/utils/shared-utils.js';
import { EvmSolverService } from './EvmSolverService.js';
import { Sodax } from '../index.js';
import { tronSupportedTokens, xrpSupportedTokens } from '@sodax/types';
import { TRON_TEST_ADDRESS } from '../shared/services/spoke/tron-test-fixtures.js';

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

  it('resolves spoke-chain inputs to hub assets and embeds them in the intent struct (no fee, default solver)', () => {
    vi.mocked(mockConfig.getSpokeTokenFromOriginalAssetAddress)
      .mockReturnValueOnce(hubInputXToken)
      .mockReturnValueOnce(hubOutputXToken);

    const { solver: _omit, ...withoutSolver } = baseParams();
    const [, intent, feeAmount] = EvmSolverService.constructCreateIntentData(
      withoutSolver as CreateIntentParams,
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
    expect(intent.solver).toBe('0x0000000000000000000000000000000000000000');
    expect(intent.data).toBe('0x'); // no fee → empty data
    // EVM spoke addresses pass through as the hub-style hex.
    expect(intent.srcAddress).toBe(SRC_USER);
    expect(intent.dstAddress).toBe(DST_USER);
  });

  it('rejects an invalid MPC payout (partial fill to Tron) and an invalid MPC source (no deadline from Tron)', () => {
    vi.mocked(mockConfig.getSpokeTokenFromOriginalAssetAddress)
      .mockReturnValueOnce(hubInputXToken)
      .mockReturnValueOnce(tronSupportedTokens.USDT);
    expect(() =>
      EvmSolverService.constructCreateIntentData(
        {
          ...baseParams(),
          dstChainKey: ChainKeys.TRON_MAINNET,
          dstAddress: TRON_TEST_ADDRESS,
          outputToken: tronSupportedTokens.USDT.address,
          minOutputAmount: 3_000_001n,
          allowPartialFill: true,
        },
        HUB_WALLET,
        mockConfig,
        undefined,
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'VALIDATION_FAILED',
        context: expect.objectContaining({ field: 'allowPartialFill' }),
      }),
    );

    vi.mocked(mockConfig.getSpokeTokenFromOriginalAssetAddress)
      .mockReturnValueOnce(tronSupportedTokens.USDT)
      .mockReturnValueOnce(hubOutputXToken);
    expect(() =>
      EvmSolverService.constructCreateIntentData(
        {
          ...baseParams(),
          srcChainKey: ChainKeys.TRON_MAINNET,
          srcAddress: TRON_TEST_ADDRESS,
          inputToken: tronSupportedTokens.USDT.address,
          deadline: 0n,
        },
        HUB_WALLET,
        mockConfig,
        undefined,
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'VALIDATION_FAILED',
        context: expect.objectContaining({ field: 'deadline' }),
      }),
    );
  });

  it('encodes an MPC-relay dstAddress per family: the padded recipient word for XRP, the plain 20-byte address for Monad', () => {
    const xrp = xrpSupportedTokens.XRP;
    const xrpAddress = 'rBTwLga3i2gz3doX6Gva3MgEV8ZCD8jjah';
    const monadAddress = '0x6be3a4afbd5983604385bcba71aaa3645918e2e2';
    vi.mocked(mockConfig.getSpokeTokenFromOriginalAssetAddress)
      .mockReturnValueOnce(hubInputXToken)
      .mockReturnValueOnce(xrp)
      .mockReturnValueOnce(hubInputXToken)
      .mockReturnValueOnce(monadSupportedTokens.USDC);

    const [, toXrp] = EvmSolverService.constructCreateIntentData(
      {
        ...baseParams(),
        dstChainKey: xrp.chainKey,
        dstAddress: xrpAddress,
        outputToken: xrp.address,
        minOutputAmount: 1n,
      },
      HUB_WALLET,
      mockConfig,
      undefined,
    );
    const identity = encodeAddress(xrp.chainKey, xrpAddress);
    expect(toXrp.dstAddress).toBe(encodeRecipient(xrp.chainKey, xrpAddress));
    expect(toXrp.dstAddress).toBe(`0x${'00'.repeat(12)}${identity.slice(2)}`);
    expect(toXrp.srcAddress).toBe(SRC_USER);

    const [, toMonad] = EvmSolverService.constructCreateIntentData(
      {
        ...baseParams(),
        dstChainKey: ChainKeys.MONAD_MAINNET,
        dstAddress: monadAddress,
        outputToken: monadSupportedTokens.USDC.address,
      },
      HUB_WALLET,
      mockConfig,
      undefined,
    );
    // A padded word here was released to the zero address on Monad.
    expect(toMonad.dstAddress).toBe(monadAddress);
  });

  it('encodes a Tron srcAddress as the recipient word, since a cancel refunds to it', () => {
    vi.mocked(mockConfig.getSpokeTokenFromOriginalAssetAddress)
      .mockReturnValueOnce(hubInputXToken)
      .mockReturnValueOnce(hubOutputXToken);

    const [, intent] = EvmSolverService.constructCreateIntentData(
      { ...baseParams(), srcChainKey: ChainKeys.TRON_MAINNET, srcAddress: TRON_TEST_ADDRESS },
      HUB_WALLET,
      mockConfig,
      undefined,
    );

    expect(intent.srcAddress).toBe(encodeRecipient(ChainKeys.TRON_MAINNET, TRON_TEST_ADDRESS));
    expect(intent.srcAddress).not.toBe(encodeAddress(ChainKeys.TRON_MAINNET, TRON_TEST_ADDRESS));
  });

  it('skips the hub-asset lookup for whichever side is the hub chain', () => {
    // Only the spoke side is looked up; the hub side is the hub asset directly.
    vi.mocked(mockConfig.getSpokeTokenFromOriginalAssetAddress).mockReturnValueOnce(hubOutputXToken);
    const [, fromHub] = EvmSolverService.constructCreateIntentData(
      { ...baseParams(), srcChainKey: ChainKeys.SONIC_MAINNET, inputToken: HUB_INPUT_ASSET },
      HUB_WALLET,
      mockConfig,
      undefined,
    );
    expect(fromHub.inputToken).toBe(HUB_INPUT_ASSET);
    expect(fromHub.outputToken).toBe(HUB_OUTPUT_ASSET);
    expect(mockConfig.getSpokeTokenFromOriginalAssetAddress).toHaveBeenCalledTimes(1);

    vi.mocked(mockConfig.getSpokeTokenFromOriginalAssetAddress).mockReturnValueOnce(hubInputXToken);
    const [, toHub] = EvmSolverService.constructCreateIntentData(
      { ...baseParams(), dstChainKey: ChainKeys.SONIC_MAINNET, outputToken: HUB_OUTPUT_ASSET },
      HUB_WALLET,
      mockConfig,
      undefined,
    );
    expect(toHub.outputToken).toBe(HUB_OUTPUT_ASSET);
    expect(mockConfig.getSpokeTokenFromOriginalAssetAddress).toHaveBeenCalledTimes(2);
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
    expect(intent.solver).toBe(SOLVER_ADDRESS);
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

  it('throws when the input or output token cannot be resolved to a hub asset', () => {
    vi.mocked(mockConfig.getSpokeTokenFromOriginalAssetAddress).mockReturnValueOnce(undefined);
    expect(() => EvmSolverService.constructCreateIntentData(baseParams(), HUB_WALLET, mockConfig, undefined)).toThrow(
      /hub asset not found for spoke chain token \(intent\.inputToken\)/,
    );

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

    it('accepts the 0% and FEE_PERCENTAGE_SCALE (100%) percentage bounds', () => {
      const [zeroEncoded, zeroFee] = EvmSolverService.createIntentFeeData(
        { address: FEE_RECEIVER, percentage: 0 },
        1_000_000n,
      );
      expect(zeroFee).toBe(0n);
      // Even with feeAmount === 0n the envelope is still emitted (distinct from `undefined` fee).
      expect(zeroEncoded).not.toBe('0x');

      const [, fullFee] = EvmSolverService.createIntentFeeData(
        { address: FEE_RECEIVER, percentage: Number(FEE_PERCENTAGE_SCALE) },
        1_000_000n,
      );
      expect(fullFee).toBe(1_000_000n);
    });
  });

  it('throws on a zero inputAmount or a percentage outside [0, FEE_PERCENTAGE_SCALE]', () => {
    expect(() => EvmSolverService.createIntentFeeData(undefined, 0n)).toThrow('Input amount must be greater than 0');
    for (const percentage of [-1, Number(FEE_PERCENTAGE_SCALE) + 1]) {
      expect(() => EvmSolverService.createIntentFeeData({ address: FEE_RECEIVER, percentage }, 1_000_000n)).toThrow(
        /Fee percentage must be between/,
      );
    }
  });
});

// =========================================================================
// decodeIntentFeeAmount — inverse of createIntentFeeData (fee recovery). Envelope parsing (unknown type
// bytes, delivery-only data) is IntentDataService.extractFeePayload's and tested there.
// =========================================================================

describe('EvmSolverService.decodeIntentFeeAmount', () => {
  it('returns 0n for empty data and round-trips fixed-amount and percentage fees from createIntentFeeData', () => {
    expect(EvmSolverService.decodeIntentFeeAmount('0x')).toBe(0n);
    for (const fee of [
      { address: FEE_RECEIVER, amount: 7_777n },
      { address: FEE_RECEIVER, percentage: 250 },
    ] satisfies PartnerFee[]) {
      const [data, feeAmount] = EvmSolverService.createIntentFeeData(fee, 1_000_000n);
      expect(feeAmount).toBeGreaterThan(0n);
      expect(EvmSolverService.decodeIntentFeeAmount(data)).toBe(feeAmount);
    }
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

  it('reconstructs the actual relayed Solana payload, through reconstructRelayData and getIntentSubmitTxExtraData', async () => {
    const sodax = new Sodax();

    const reconstructResult = sodax.swaps.reconstructRelayData(SOLANA_RELAYED_INTENT);
    if (!reconstructResult.ok) {
      throw new Error('Failed to reconstruct relay data');
    }
    expect(reconstructResult.value.payload.toLowerCase()).toBe(SOLANA_RELAYED_PAYLOAD.toLowerCase());

    const result = await sodax.swaps.getIntentSubmitTxExtraData({ intent: SOLANA_RELAYED_INTENT });
    if (!result.ok) {
      throw new Error('Failed to get intent submit tx extra data');
    }
    expect(result.value.address).toBe(SOLANA_RELAYED_INTENT.creator);
    expect(result.value.payload.toLowerCase()).toBe(SOLANA_RELAYED_PAYLOAD.toLowerCase());
  });

  // The canonical proof: the payload `constructCreateIntentData` produced for a spoke source must be
  // reproducible from the resulting `Intent` alone (same intents contract, isHubSource = false).
  it('reproduces the spoke multicall payload byte-for-byte with no fee, a percentage fee or a fixed-amount fee', () => {
    for (const fee of [
      undefined,
      { address: FEE_RECEIVER, percentage: 100 },
      { address: FEE_RECEIVER, amount: 1_000n },
    ] satisfies (PartnerFee | undefined)[]) {
      vi.mocked(mockConfig.getSpokeTokenFromOriginalAssetAddress)
        .mockReturnValueOnce(hubInputXToken)
        .mockReturnValueOnce(hubOutputXToken);
      const [expected, intent] = EvmSolverService.constructCreateIntentData(spokeParams(), HUB_WALLET, mockConfig, fee);
      expect(EvmSolverService.reconstructCreateIntentData(intent, INTENTS_CONTRACT, false)).toBe(expected);
    }
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
  it('returns the Intent from the log the intents contract emitted, matched case-insensitively, skipping unrelated contracts', async () => {
    const intent = buildIntent({ intentId: 99n });
    const intentHash = EvmSolverService.getIntentHash(intent);
    const otherContract: Address = '0x9999999999999999999999999999999999999999';
    const irrelevantIntent = buildIntent({ intentId: 1n });
    const irrelevantHash = EvmSolverService.getIntentHash(irrelevantIntent);

    // Upper-case the address — checksum casing varies in real receipts.
    const logs = [
      encodeIntentCreatedLog(irrelevantHash, irrelevantIntent, otherContract),
      encodeIntentCreatedLog(intentHash, intent, INTENTS_CONTRACT.toUpperCase() as Address),
    ];
    vi.mocked(mockPublicClient.waitForTransactionReceipt).mockResolvedValueOnce(receiptWith(logs));

    await expect(EvmSolverService.getIntent(TX_HASH, mockConfig, mockPublicClient)).resolves.toEqual(intent);
    expect(mockPublicClient.waitForTransactionReceipt).toHaveBeenCalledWith({ hash: TX_HASH });
  });

  it('throws when no IntentCreated log targets the intents contract, or the receipt has no logs at all', async () => {
    const intent = buildIntent();
    const intentHash = EvmSolverService.getIntentHash(intent);
    const otherContract: Address = '0x9999999999999999999999999999999999999999';
    vi.mocked(mockPublicClient.waitForTransactionReceipt)
      .mockResolvedValueOnce(receiptWith([encodeIntentCreatedLog(intentHash, intent, otherContract)]))
      .mockResolvedValueOnce(receiptWith([]));

    for (let i = 0; i < 2; i++) {
      await expect(EvmSolverService.getIntent(TX_HASH, mockConfig, mockPublicClient)).rejects.toThrow(
        `No intent found for ${TX_HASH}`,
      );
    }
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

// =========================================================================
// getFilledIntent — receipt → IntentFilled event → IntentState struct
// =========================================================================

describe('EvmSolverService.getFilledIntent', () => {
  const filledState = { exists: true, remainingInput: 0n, receivedOutput: 950_000n, pendingPayment: false };

  it('returns the IntentState from the IntentFilled log of the intents contract, matched case-insensitively', async () => {
    const intentHash: Hex = keccak256('0xdeadbeef');
    const log = encodeIntentFilledLog(intentHash, filledState, INTENTS_CONTRACT.toUpperCase() as Address);
    vi.mocked(mockPublicClient.waitForTransactionReceipt).mockResolvedValueOnce(receiptWith([log]));

    await expect(EvmSolverService.getFilledIntent(TX_HASH, solverCfg, mockPublicClient)).resolves.toEqual(filledState);
  });

  it('throws when no IntentFilled log targets the intents contract, and propagates receipt errors', async () => {
    const intentHash: Hex = keccak256('0xdeadbeef');
    const otherContract: Address = '0x9999999999999999999999999999999999999999';
    const rpcError = new Error('rpc unreachable');
    vi.mocked(mockPublicClient.waitForTransactionReceipt)
      .mockResolvedValueOnce(receiptWith([encodeIntentFilledLog(intentHash, filledState, otherContract)]))
      .mockRejectedValueOnce(rpcError);

    await expect(EvmSolverService.getFilledIntent(TX_HASH, solverCfg, mockPublicClient)).rejects.toThrow(
      `No filled intent found for ${TX_HASH}`,
    );
    await expect(EvmSolverService.getFilledIntent(TX_HASH, solverCfg, mockPublicClient)).rejects.toBe(rpcError);
  });
});

// =========================================================================
// Pure calldata helpers — encodeCreateIntent, encodeCancelIntent
// =========================================================================

describe('EvmSolverService.encodeCreateIntent / encodeCancelIntent', () => {
  it('returns { address: intentsContract, value: 0n, data } with the createIntent and cancelIntent calldata', () => {
    const intent = buildIntent();

    expect(EvmSolverService.encodeCreateIntent(intent, INTENTS_CONTRACT)).toEqual({
      address: INTENTS_CONTRACT,
      value: 0n,
      data: encodeFunctionData({ abi: IntentsAbi, functionName: 'createIntent', args: [intent] }),
    });
    expect(EvmSolverService.encodeCancelIntent(intent, INTENTS_CONTRACT)).toEqual({
      address: INTENTS_CONTRACT,
      value: 0n,
      data: encodeFunctionData({ abi: IntentsAbi, functionName: 'cancelIntent', args: [intent] }),
    });
  });
});
