/**
 * Partner flow: approve and deposit into a leverage-yield vault with one wallet signature through
 * `sodax.api.leverageYield`.
 *
 * `approveAndDeposit` is the example the Leverage Yield API skill links to. It uses only public exports
 * (`../index.js`) and a stubbed backend, so the flow is compiled and run, not described.
 * The batch rules themselves (strategy, refusal, unconfirmed) live in `shared/utils/approvalBatch.test.ts`.
 */
import { AtomicityNotSupportedError } from 'viem';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChainKeys,
  DEFAULT_API_BASE_URL,
  type CreateDepositIntentParamsV2,
  type EvmAtomicBatchSupport,
  type EvmBatchResult,
  type EvmRawTransaction,
  type IEvmWalletProvider,
  type IntentRequestV2,
  type IntentResponseV2,
} from '@sodax/types';
import {
  ATOMIC_BATCH_UNCONFIRMED,
  Sodax,
  confirmApprovalBatch,
  isAtomicBatchRefusal,
  resolveApprovalStrategy,
  sendApprovalBatch,
} from '../index.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const sodax = new Sodax();
const BASE = DEFAULT_API_BASE_URL;
const BASE_CHAIN_ID = 8453;
const ACCOUNT = '0x0000000000000000000000000000000000000001';
const TOKEN = '0x00000000000000000000000000000000000000aa';
const SPENDER = '0x00000000000000000000000000000000000000bb';
const VAULT = '0x00000000000000000000000000000000000000cc';
const DEPOSIT_HASH = '0xdeposit';
const RELAY_DATA = { address: '0x00000000000000000000000000000000000000dd', payload: '0xpayload' };

const DEPOSIT_PARAMS: CreateDepositIntentParamsV2 = {
  vault: VAULT,
  srcChainKey: ChainKeys.BASE_MAINNET,
  srcAddress: ACCOUNT,
  inputToken: TOKEN,
  inputAmount: '1000000',
  minOutputAmount: '900000',
};

const wireTx = (to: string, data: string) => ({ from: ACCOUNT, to, value: '0', data });
const APPROVE_WIRE = wireTx(TOKEN, '0x095ea7b3');
const RESET_WIRE = wireTx(TOKEN, '0x095ea7b300');
const DEPOSIT_WIRE = wireTx(SPENDER, '0xdeadbeef');

const wireIntent = (deadline: string): IntentResponseV2 => ({
  intentId: '1',
  creator: ACCOUNT,
  inputToken: TOKEN,
  outputToken: VAULT,
  inputAmount: '1000000',
  minOutputAmount: '900000',
  deadline,
  allowPartialFill: false,
  srcChain: '4',
  dstChain: '146',
  srcAddress: ACCOUNT,
  dstAddress: ACCOUNT,
  solver: '0x0000000000000000000000000000000000000000',
  data: '0x',
});

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

const stubBackend = ({ withReset }: { withReset: boolean }) => {
  let intentsCreated = 0;
  mockFetch.mockImplementation(async (url: string) => {
    const body = (() => {
      if (url === `${BASE}/leverage-yield/allowance/check`) return { valid: false };
      if (url === `${BASE}/leverage-yield/approve`)
        return withReset ? { tx: APPROVE_WIRE, resetTx: RESET_WIRE } : { tx: APPROVE_WIRE };
      if (url === `${BASE}/leverage-yield/intents/deposit`) {
        intentsCreated += 1;
        return { tx: DEPOSIT_WIRE, intent: wireIntent(String(1_000 * intentsCreated)), relayData: RELAY_DATA };
      }
      if (url === `${BASE}/leverage-yield/submit-tx`)
        return { success: true, data: { status: 'inserted', message: 'ok' } };
      throw new Error(`unexpected request ${url}`);
    })();
    return { ok: true, status: 200, json: vi.fn().mockResolvedValue(body) };
  });
};

const requested = (path: string) => mockFetch.mock.calls.filter(([url]) => url === `${BASE}${path}`);
const submitted = () => JSON.parse(requested('/leverage-yield/submit-tx')[0]?.[1]?.body as string);

/** The wire intent comes back with decimal strings; `submitTx` takes the bigint variant. */
const toIntentRequest = (intent: IntentResponseV2): IntentRequestV2 => ({
  ...intent,
  intentId: BigInt(intent.intentId),
  inputAmount: BigInt(intent.inputAmount),
  minOutputAmount: BigInt(intent.minOutputAmount),
  deadline: BigInt(intent.deadline),
  srcChain: BigInt(intent.srcChain),
  dstChain: BigInt(intent.dstChain),
});

const unwrap = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
  if (!result.ok) throw result.error;
  return result.value;
};

/** Approves and deposits from an EVM spoke; one signature when the wallet can batch. */
async function approveAndDeposit(walletProvider: ReturnType<typeof batchWallet>, onBatchSent?: (id: string) => void) {
  const srcChainKey = ChainKeys.BASE_MAINNET;
  const allowance = unwrap(await sodax.api.leverageYield.checkAllowance(DEPOSIT_PARAMS));
  const approval = allowance.valid ? undefined : unwrap(await sodax.api.leverageYield.approve(DEPOSIT_PARAMS));
  let deposit = unwrap(await sodax.api.leverageYield.createDepositIntent(DEPOSIT_PARAMS));

  // The API types its txs as `RawTxReturnType`; an EVM source returns EVM transactions.
  const approvalTxs = approval ? ([approval.resetTx, approval.tx].filter(Boolean) as EvmRawTransaction[]) : [];
  const strategy = await resolveApprovalStrategy({ srcChainKey, walletProvider });

  let txHash: string | undefined;
  if (strategy === 'atomic-batch') {
    const sent = await sendApprovalBatch({
      walletProvider,
      srcChainKey,
      txs: [...approvalTxs, deposit.tx as EvmRawTransaction],
      timeoutMs: 60_000,
      feature: 'leverageYield',
      onBatchSent,
    });
    if (sent.ok) txHash = sent.value.txHash;
    else if (!isAtomicBatchRefusal(sent.error)) throw sent.error;
  }
  if (txHash === undefined) {
    for (const tx of approvalTxs) {
      await walletProvider.waitForTransactionReceipt(
        await walletProvider.sendTransaction(tx, { expectedChainId: BASE_CHAIN_ID }),
      );
    }
    // The first intent's `deadline` also covered the wait for the approval, so build the deposit again.
    deposit = unwrap(await sodax.api.leverageYield.createDepositIntent(DEPOSIT_PARAMS));
    txHash = await walletProvider.sendTransaction(deposit.tx as EvmRawTransaction, { expectedChainId: BASE_CHAIN_ID });
  }

  unwrap(
    await sodax.api.leverageYield.submitTx({
      txHash,
      srcChainKey,
      walletAddress: ACCOUNT,
      intent: toIntentRequest(deposit.intent),
      relayData: deposit.relayData.payload,
      operation: 'deposit',
    }),
  );
  return { txHash, strategy };
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('approve and deposit in one signature (Leverage Yield API)', () => {
  it('sends [resetTx, approve, deposit] as one batch, deposit last, and submits the batch tx with the intent and relay payload', async () => {
    stubBackend({ withReset: true });
    const walletProvider = batchWallet();

    const result = await approveAndDeposit(walletProvider);

    expect(result).toEqual({ txHash: DEPOSIT_HASH, strategy: 'atomic-batch' });
    expect(walletProvider.sendAtomicBatch).toHaveBeenCalledTimes(1);
    const [txs, options] = walletProvider.sendAtomicBatch.mock.calls[0] ?? [];
    expect(txs?.map(tx => tx.data)).toEqual([RESET_WIRE.data, APPROVE_WIRE.data, DEPOSIT_WIRE.data]);
    expect(options).toEqual({ expectedChainId: BASE_CHAIN_ID });
    expect(walletProvider.sendTransaction).not.toHaveBeenCalled();
    expect(requested('/leverage-yield/intents/deposit')).toHaveLength(1);
    expect(submitted()).toMatchObject({
      txHash: DEPOSIT_HASH,
      srcChainKey: ChainKeys.BASE_MAINNET,
      relayData: RELAY_DATA.payload,
      operation: 'deposit',
      intent: wireIntent('1000'),
    });
  });

  it('sends [approve, deposit] when the token needs no reset', async () => {
    stubBackend({ withReset: false });
    const walletProvider = batchWallet();

    await approveAndDeposit(walletProvider);

    const [txs] = walletProvider.sendAtomicBatch.mock.calls[0] ?? [];
    expect(txs?.map(tx => tx.data)).toEqual([APPROVE_WIRE.data, DEPOSIT_WIRE.data]);
  });

  it('approves separately and creates the deposit intent again when the wallet refuses the batch', async () => {
    stubBackend({ withReset: false });
    const walletProvider = batchWallet();
    walletProvider.sendAtomicBatch.mockRejectedValueOnce(new AtomicityNotSupportedError(new Error('no atomicity')));
    walletProvider.sendTransaction.mockResolvedValueOnce('0xapprove').mockResolvedValueOnce('0xseparate-deposit');
    walletProvider.waitForTransactionReceipt.mockResolvedValue({ status: 'success' } as never); // receipt shape is not read here

    const result = await approveAndDeposit(walletProvider);

    expect(result.txHash).toBe('0xseparate-deposit');
    expect(walletProvider.sendAtomicBatch).toHaveBeenCalledTimes(1);
    expect(walletProvider.sendTransaction.mock.calls.map(([tx]) => tx.data)).toEqual([
      APPROVE_WIRE.data,
      DEPOSIT_WIRE.data,
    ]);
    expect(requested('/leverage-yield/intents/deposit')).toHaveLength(2);
    expect(submitted()).toMatchObject({ txHash: '0xseparate-deposit', intent: wireIntent('2000') });
  });

  it('never resends an unconfirmed batch; confirmApprovalBatch resumes it by id and call count', async () => {
    stubBackend({ withReset: true });
    const walletProvider = batchWallet();
    walletProvider.waitForBatch.mockRejectedValueOnce(new Error('timed out'));
    const onBatchSent = vi.fn();

    await expect(approveAndDeposit(walletProvider, onBatchSent)).rejects.toMatchObject({
      code: 'TX_VERIFICATION_FAILED',
      context: { reason: ATOMIC_BATCH_UNCONFIRMED, batchId: 'batch-1', callCount: 3 },
    });
    expect(onBatchSent).toHaveBeenCalledWith('batch-1');
    expect(walletProvider.sendAtomicBatch).toHaveBeenCalledTimes(1);
    expect(walletProvider.sendTransaction).not.toHaveBeenCalled();
    expect(requested('/leverage-yield/submit-tx')).toHaveLength(0);

    const resumed = await confirmApprovalBatch({
      walletProvider,
      batchId: 'batch-1',
      callCount: 3,
      timeoutMs: 60_000,
      feature: 'leverageYield',
    });
    expect(resumed).toEqual({ ok: true, value: { txHash: DEPOSIT_HASH, batchId: 'batch-1' } });
  });
});
