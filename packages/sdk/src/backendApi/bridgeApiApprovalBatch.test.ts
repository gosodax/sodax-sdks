/**
 * Partner flow: approve and bridge with one wallet signature through `sodax.api.bridge`.
 *
 * `approveAndBridge` is the example the Bridge API skill links to. It uses only public exports
 * (`../index.js`) and a stubbed backend, so the flow is compiled and run, not described.
 * The batch rules themselves (strategy, refusal, unconfirmed) live in `shared/utils/approvalBatch.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ATOMIC_BATCH_UNCONFIRMED,
  ChainKeys,
  DEFAULT_API_BASE_URL,
  Sodax,
  baseChainInfo,
  confirmApprovalBatch,
  isAtomicBatchRefusal,
  isEvmChainKeyType,
  isEvmSpokeOnlyChainKeyType,
  isEvmWalletProviderType,
  resolveApprovalStrategy,
  sendApprovalBatch,
  type CreateBridgeIntentParamsV2,
  type EvmAtomicBatchSupport,
  type EvmBatchResult,
  type EvmRawTransaction,
  type IEvmWalletProvider,
  type IWalletProvider,
  type SpokeChainKey,
} from '../index.js';
import { AtomicityNotSupportedError } from 'viem';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const sodax = new Sodax();
const BASE = DEFAULT_API_BASE_URL;
const ACCOUNT = '0x0000000000000000000000000000000000000001';
const TOKEN = '0x00000000000000000000000000000000000000aa';
const SPENDER = '0x00000000000000000000000000000000000000bb';
const DEPOSIT_HASH = '0xdeposit';
const relayDataFor = (call: number) => ({
  address: '0x00000000000000000000000000000000000000cc',
  payload: `0xpayload${call}`,
});

const BRIDGE_PARAMS: CreateBridgeIntentParamsV2 & { srcChainKey: SpokeChainKey } = {
  srcChainKey: ChainKeys.BASE_MAINNET,
  dstChainKey: ChainKeys.ARBITRUM_MAINNET,
  inputToken: TOKEN,
  outputToken: '0x00000000000000000000000000000000000000dd',
  inputAmount: '1000000',
  srcAddress: ACCOUNT,
  dstAddress: ACCOUNT,
};

const wireTx = (to: string, data: string) => ({ from: ACCOUNT, to, value: '0', data });
const APPROVE_WIRE = wireTx(TOKEN, '0x095ea7b3');
const RESET_WIRE = wireTx(TOKEN, '0x095ea7b300');
const DEPOSIT_WIRE = wireTx(SPENDER, '0xdeadbeef');

const confirmed: EvmBatchResult = {
  status: 'success',
  statusCode: 200,
  atomic: true,
  receipts: [{ transactionHash: DEPOSIT_HASH, status: 'success' }],
};

const batchWallet = (support: EvmAtomicBatchSupport = 'supported') => ({
  chainType: 'EVM' as const,
  getWalletAddress: vi.fn<IEvmWalletProvider['getWalletAddress']>(),
  sendTransaction: vi.fn<IEvmWalletProvider['sendTransaction']>(),
  waitForTransactionReceipt: vi.fn<IEvmWalletProvider['waitForTransactionReceipt']>(),
  getAtomicBatchSupport: vi.fn(async (_chainId: number) => support),
  sendAtomicBatch: vi.fn(
    async (_txs: readonly EvmRawTransaction[], _options: { expectedChainId: number }) => 'batch-1',
  ),
  waitForBatch: vi.fn(async (_batchId: string, _options?: { timeout?: number }) => confirmed),
});

type BackendOptions = { withReset: boolean };

const stubBackend = ({ withReset }: BackendOptions) => {
  let intentsCreated = 0;
  mockFetch.mockImplementation(async (url: string) => {
    const body = (() => {
      if (url === `${BASE}/bridge/allowance/check`) return { valid: false };
      if (url === `${BASE}/bridge/approve`)
        return withReset ? { tx: APPROVE_WIRE, resetTx: RESET_WIRE } : { tx: APPROVE_WIRE };
      if (url === `${BASE}/bridge/intents`) {
        intentsCreated += 1;
        return { tx: DEPOSIT_WIRE, relayData: relayDataFor(intentsCreated) };
      }
      if (url === `${BASE}/bridge/submit-tx`) return { success: true, data: { status: 'inserted', message: 'ok' } };
      throw new Error(`unexpected request ${url}`);
    })();
    return { ok: true, status: 200, json: vi.fn().mockResolvedValue(body) };
  });
};

const requested = (path: string) => mockFetch.mock.calls.filter(([url]) => url === `${BASE}${path}`);

/** Approves and bridges; one signature when the source is an EVM spoke and the wallet can batch. */
async function approveAndBridge(
  walletProvider: IWalletProvider,
  params: CreateBridgeIntentParamsV2 & { srcChainKey: SpokeChainKey },
  onBatchSent?: (id: string) => void,
) {
  const { srcChainKey } = params;
  if (!isEvmWalletProviderType(walletProvider) || !isEvmChainKeyType(srcChainKey)) {
    throw new Error('Only EVM sources are handled here; approve and sign other chains separately.');
  }
  const unwrap = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
    if (!result.ok) throw result.error;
    return result.value;
  };
  const allowance = unwrap(await sodax.api.bridge.checkAllowance(params));
  const approval = allowance.valid ? undefined : unwrap(await sodax.api.bridge.approve(params));
  let bridge = unwrap(await sodax.api.bridge.createBridgeIntent(params));

  // The API types its txs as `RawTxReturnType`; an EVM source returns EVM transactions.
  const approvalTxs = approval ? ([approval.resetTx, approval.tx].filter(Boolean) as EvmRawTransaction[]) : [];
  const strategy = approval ? await resolveApprovalStrategy({ srcChainKey, walletProvider }) : 'not-required';

  let txHash: string | undefined;
  if (strategy === 'atomic-batch' && isEvmSpokeOnlyChainKeyType(srcChainKey)) {
    const sent = await sendApprovalBatch({
      walletProvider,
      srcChainKey,
      txs: [...approvalTxs, bridge.tx as EvmRawTransaction],
      timeoutMs: 60_000,
      feature: 'bridge',
      onBatchSent,
    });
    if (sent.ok) txHash = sent.value.txHash;
    else if (!isAtomicBatchRefusal(sent.error)) throw sent.error;
  }
  if (txHash === undefined) {
    const { chainId } = baseChainInfo[srcChainKey];
    for (const tx of approvalTxs) {
      const receipt = await walletProvider.waitForTransactionReceipt(
        await walletProvider.sendTransaction(tx, { expectedChainId: chainId }),
      );
      // The deposit is only valid once the allowance is on-chain, so a reverted reset or approve ends the flow.
      if (receipt.status === 'reverted' || receipt.status === '0x0')
        throw new Error('The approval transaction reverted');
    }
    // Once the approval is mined, build the deposit again, as the SDK's `bridgeWithApproval` does.
    if (approval) bridge = unwrap(await sodax.api.bridge.createBridgeIntent(params));
    txHash = await walletProvider.sendTransaction(bridge.tx as EvmRawTransaction, { expectedChainId: chainId });
  }

  unwrap(
    await sodax.api.bridge.submitTx({
      txHash,
      srcChainKey,
      walletAddress: params.srcAddress,
      relayData: bridge.relayData,
    }),
  );
  return { txHash, strategy };
}

const submitted = () => JSON.parse(requested('/bridge/submit-tx')[0]?.[1]?.body as string);

beforeEach(() => {
  mockFetch.mockReset();
});

describe('approve and bridge in one signature (Bridge API)', () => {
  it('sends [resetTx, approve, deposit] as one batch, deposit last, and submits the batch tx with the full relayData', async () => {
    stubBackend({ withReset: true });
    const walletProvider = batchWallet();

    const result = await approveAndBridge(walletProvider, BRIDGE_PARAMS);

    expect(result).toEqual({ txHash: DEPOSIT_HASH, strategy: 'atomic-batch' });
    expect(walletProvider.sendAtomicBatch).toHaveBeenCalledTimes(1);
    const [txs, options] = walletProvider.sendAtomicBatch.mock.calls[0] ?? [];
    expect(txs?.map(tx => tx.data)).toEqual([RESET_WIRE.data, APPROVE_WIRE.data, DEPOSIT_WIRE.data]);
    expect(options).toEqual({ expectedChainId: baseChainInfo[ChainKeys.BASE_MAINNET].chainId });
    expect(walletProvider.sendTransaction).not.toHaveBeenCalled();
    expect(submitted()).toMatchObject({
      txHash: DEPOSIT_HASH,
      srcChainKey: ChainKeys.BASE_MAINNET,
      relayData: relayDataFor(1),
    });
  });

  it('sends [approve, deposit] when the token needs no reset', async () => {
    stubBackend({ withReset: false });
    const walletProvider = batchWallet();

    await approveAndBridge(walletProvider, BRIDGE_PARAMS);

    const [txs] = walletProvider.sendAtomicBatch.mock.calls[0] ?? [];
    expect(txs?.map(tx => tx.data)).toEqual([APPROVE_WIRE.data, DEPOSIT_WIRE.data]);
  });

  it('approves separately and creates the bridge intent again when the wallet refuses the batch; no second batch', async () => {
    stubBackend({ withReset: false });
    const walletProvider = batchWallet();
    walletProvider.sendAtomicBatch.mockRejectedValueOnce(new AtomicityNotSupportedError(new Error('no atomicity')));
    walletProvider.sendTransaction.mockResolvedValueOnce('0xapprove').mockResolvedValueOnce('0xseparate-deposit');
    walletProvider.waitForTransactionReceipt.mockResolvedValue({ status: 'success' } as never); // only `status` is read

    const result = await approveAndBridge(walletProvider, BRIDGE_PARAMS);

    expect(result.txHash).toBe('0xseparate-deposit');
    expect(walletProvider.sendAtomicBatch).toHaveBeenCalledTimes(1);
    expect(walletProvider.sendTransaction.mock.calls.map(([tx]) => tx.data)).toEqual([
      APPROVE_WIRE.data,
      DEPOSIT_WIRE.data,
    ]);
    expect(requested('/bridge/intents')).toHaveLength(2);
    expect(submitted()).toMatchObject({ txHash: '0xseparate-deposit', relayData: relayDataFor(2) });
  });

  it('stops when the separate approval reverts: no deposit is sent and nothing is submitted', async () => {
    stubBackend({ withReset: false });
    const walletProvider = batchWallet();
    walletProvider.sendAtomicBatch.mockRejectedValueOnce(new AtomicityNotSupportedError(new Error('no atomicity')));
    walletProvider.sendTransaction.mockResolvedValueOnce('0xapprove');
    walletProvider.waitForTransactionReceipt.mockResolvedValue({ status: 'reverted' } as never); // only `status` is read

    await expect(approveAndBridge(walletProvider, BRIDGE_PARAMS)).rejects.toThrow('The approval transaction reverted');

    expect(walletProvider.sendTransaction).toHaveBeenCalledTimes(1);
    expect(requested('/bridge/submit-tx')).toHaveLength(0);
  });

  it('keeps a Sonic hub source sequential: no batch, the approval and the deposit go out separately', async () => {
    stubBackend({ withReset: false });
    const walletProvider = batchWallet();
    walletProvider.sendTransaction.mockResolvedValueOnce('0xapprove').mockResolvedValueOnce('0xhub-deposit');
    walletProvider.waitForTransactionReceipt.mockResolvedValue({ status: 'success' } as never); // only `status` is read

    const result = await approveAndBridge(walletProvider, { ...BRIDGE_PARAMS, srcChainKey: ChainKeys.SONIC_MAINNET });

    expect(result).toEqual({ txHash: '0xhub-deposit', strategy: 'sequential' });
    expect(walletProvider.sendAtomicBatch).not.toHaveBeenCalled();
    expect(walletProvider.sendTransaction.mock.calls.map(([tx]) => tx.data)).toEqual([
      APPROVE_WIRE.data,
      DEPOSIT_WIRE.data,
    ]);
  });

  it('never resends an unconfirmed batch; confirmApprovalBatch resumes it by id and call count', async () => {
    stubBackend({ withReset: true });
    const walletProvider = batchWallet();
    walletProvider.waitForBatch.mockRejectedValueOnce(new Error('timed out'));
    const onBatchSent = vi.fn();

    await expect(approveAndBridge(walletProvider, BRIDGE_PARAMS, onBatchSent)).rejects.toMatchObject({
      code: 'TX_VERIFICATION_FAILED',
      context: { reason: ATOMIC_BATCH_UNCONFIRMED, batchId: 'batch-1', callCount: 3 },
    });
    expect(onBatchSent).toHaveBeenCalledWith('batch-1');
    expect(walletProvider.sendAtomicBatch).toHaveBeenCalledTimes(1);
    expect(walletProvider.sendTransaction).not.toHaveBeenCalled();
    expect(requested('/bridge/submit-tx')).toHaveLength(0);

    const resumed = await confirmApprovalBatch({
      walletProvider,
      batchId: 'batch-1',
      callCount: 3,
      timeoutMs: 60_000,
      feature: 'bridge',
    });
    expect(resumed).toEqual({ ok: true, value: { txHash: DEPOSIT_HASH, batchId: 'batch-1' } });
  });
});
