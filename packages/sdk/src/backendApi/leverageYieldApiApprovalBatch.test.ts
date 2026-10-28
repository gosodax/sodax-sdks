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
  ATOMIC_BATCH_UNCONFIRMED,
  ChainKeys,
  DEFAULT_API_BASE_URL,
  DEFAULT_RELAY_TX_TIMEOUT,
  Sodax,
  baseChainInfo,
  confirmApprovalBatch,
  isAtomicBatchRefusal,
  isEvmChainKeyType,
  isEvmSpokeOnlyChainKeyType,
  isEvmWalletProviderType,
  resolveApprovalStrategy,
  sendApprovalBatch,
  type ApprovalStrategy,
  type CreateDepositIntentParamsV2,
  type EvmAtomicBatchSupport,
  type EvmBatchResult,
  type EvmRawTransaction,
  type IEvmWalletProvider,
  type IWalletProvider,
  type IntentRequestV2,
  type IntentResponseV2,
  type LeverageYieldSubmitTxRequestV2,
  type SpokeChainKey,
} from '../index.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const sodax = new Sodax();
const BASE = DEFAULT_API_BASE_URL;
const BASE_CHAIN_ID = baseChainInfo[ChainKeys.BASE_MAINNET].chainId;
const ACCOUNT = '0x0000000000000000000000000000000000000001';
const TOKEN = '0x00000000000000000000000000000000000000aa';
const SPENDER = '0x00000000000000000000000000000000000000bb';
const VAULT = '0x00000000000000000000000000000000000000cc';
const DEPOSIT_HASH = '0xdeposit';
const RELAY_DATA = { address: '0x00000000000000000000000000000000000000dd', payload: '0xpayload' };

const DEPOSIT_PARAMS: CreateDepositIntentParamsV2 & { srcChainKey: SpokeChainKey } = {
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

/** A wallet may answer with one receipt per call instead of one for the batch; the deposit is the last one. */
const oneReceiptPerCall: EvmBatchResult = {
  ...confirmed,
  receipts: [
    { transactionHash: '0xreset', status: 'success' },
    { transactionHash: '0xapprove', status: 'success' },
    { transactionHash: DEPOSIT_HASH, status: 'success' },
  ],
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

const stubBackend = ({ withReset, allowanceValid = false }: { withReset: boolean; allowanceValid?: boolean }) => {
  let intentsCreated = 0;
  mockFetch.mockImplementation(async (url: string) => {
    const body = (() => {
      if (url === `${BASE}/leverage-yield/allowance/check`) return { valid: allowanceValid };
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
const submitted = () => JSON.parse(requested('/leverage-yield/submit-tx')[0]?.[1]?.body);

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

/**
 * Persist this with the batch id before waiting on the batch: a resume after a reload needs `callCount`
 * for `confirmApprovalBatch` and the `submitTx` inputs. Keep the wire `intent` (decimal strings): it
 * survives `JSON.stringify`, unlike the bigint `IntentRequestV2` that `submitTx` takes; convert at submit time.
 */
type PendingDeposit = {
  intent: IntentResponseV2;
  relayData: LeverageYieldSubmitTxRequestV2['relayData'];
  callCount: number;
};

/** Approves and deposits; one signature when the source is an EVM spoke and the wallet can batch. */
async function approveAndDeposit(
  walletProvider: IWalletProvider,
  params: CreateDepositIntentParamsV2 & { srcChainKey: SpokeChainKey },
  {
    onBatchSent,
    allowAccountUpgrade,
  }: { onBatchSent?: (batchId: string, pending: PendingDeposit) => void; allowAccountUpgrade?: boolean } = {},
) {
  const { srcChainKey } = params;
  if (!isEvmWalletProviderType(walletProvider) || !isEvmChainKeyType(srcChainKey)) {
    throw new Error('Only EVM sources are handled here; approve and sign other chains separately.');
  }
  const allowance = unwrap(await sodax.api.leverageYield.checkAllowance(params));
  const approval = allowance.valid ? undefined : unwrap(await sodax.api.leverageYield.approve(params));
  let deposit = unwrap(await sodax.api.leverageYield.createDepositIntent(params));

  // The API types its txs as `RawTxReturnType`; an EVM source returns EVM transactions.
  const approvalTxs = approval ? ([approval.resetTx, approval.tx].filter(Boolean) as EvmRawTransaction[]) : [];
  let strategy: ApprovalStrategy = approval
    ? await resolveApprovalStrategy({ srcChainKey, walletProvider, allowAccountUpgrade })
    : 'not-required';

  let txHash: string | undefined;
  if (strategy === 'atomic-batch' && isEvmSpokeOnlyChainKeyType(srcChainKey)) {
    const txs = [...approvalTxs, deposit.tx as EvmRawTransaction];
    const sent = await sendApprovalBatch({
      walletProvider,
      srcChainKey,
      txs,
      timeoutMs: DEFAULT_RELAY_TX_TIMEOUT,
      feature: 'leverageYield',
      onBatchSent:
        onBatchSent &&
        (batchId =>
          onBatchSent(batchId, {
            intent: deposit.intent,
            relayData: deposit.relayData.payload,
            callCount: txs.length,
          })),
    });
    if (sent.ok) txHash = sent.value.txHash;
    else if (isAtomicBatchRefusal(sent.error)) strategy = 'sequential';
    else throw sent.error;
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
    // The first intent's `deadline` also covered the wait for the approval, so build the deposit again.
    if (approval) deposit = unwrap(await sodax.api.leverageYield.createDepositIntent(params));
    txHash = await walletProvider.sendTransaction(deposit.tx as EvmRawTransaction, { expectedChainId: chainId });
  }

  unwrap(
    await sodax.api.leverageYield.submitTx({
      txHash,
      srcChainKey,
      walletAddress: params.srcAddress,
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

    const result = await approveAndDeposit(walletProvider, DEPOSIT_PARAMS);

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

    await approveAndDeposit(walletProvider, DEPOSIT_PARAMS);

    const [txs] = walletProvider.sendAtomicBatch.mock.calls[0] ?? [];
    expect(txs?.map(tx => tx.data)).toEqual([APPROVE_WIRE.data, DEPOSIT_WIRE.data]);
  });

  it('approves separately and creates the deposit intent again when the wallet refuses the batch', async () => {
    stubBackend({ withReset: false });
    const walletProvider = batchWallet();
    walletProvider.sendAtomicBatch.mockRejectedValueOnce(new AtomicityNotSupportedError(new Error('no atomicity')));
    walletProvider.sendTransaction.mockResolvedValueOnce('0xapprove').mockResolvedValueOnce('0xseparate-deposit');
    walletProvider.waitForTransactionReceipt.mockResolvedValue({ status: 'success' } as never); // only `status` is read

    const result = await approveAndDeposit(walletProvider, DEPOSIT_PARAMS);

    expect(result).toEqual({ txHash: '0xseparate-deposit', strategy: 'sequential' });
    expect(walletProvider.sendAtomicBatch).toHaveBeenCalledTimes(1);
    expect(walletProvider.sendTransaction.mock.calls.map(([tx]) => tx.data)).toEqual([
      APPROVE_WIRE.data,
      DEPOSIT_WIRE.data,
    ]);
    expect(requested('/leverage-yield/intents/deposit')).toHaveLength(2);
    expect(submitted()).toMatchObject({ txHash: '0xseparate-deposit', intent: wireIntent('2000') });
  });

  it('stops when the separate approval reverts: no deposit is sent and nothing is submitted', async () => {
    stubBackend({ withReset: false });
    const walletProvider = batchWallet();
    walletProvider.sendAtomicBatch.mockRejectedValueOnce(new AtomicityNotSupportedError(new Error('no atomicity')));
    walletProvider.sendTransaction.mockResolvedValueOnce('0xapprove');
    walletProvider.waitForTransactionReceipt.mockResolvedValue({ status: 'reverted' } as never); // only `status` is read

    await expect(approveAndDeposit(walletProvider, DEPOSIT_PARAMS)).rejects.toThrow(
      'The approval transaction reverted',
    );

    expect(walletProvider.sendTransaction).toHaveBeenCalledTimes(1);
    expect(requested('/leverage-yield/submit-tx')).toHaveLength(0);
  });

  it('sends only the deposit when the allowance is already valid', async () => {
    stubBackend({ withReset: false, allowanceValid: true });
    const walletProvider = batchWallet();
    walletProvider.sendTransaction.mockResolvedValueOnce('0xdirect-deposit');

    const result = await approveAndDeposit(walletProvider, DEPOSIT_PARAMS);

    expect(result).toEqual({ txHash: '0xdirect-deposit', strategy: 'not-required' });
    expect(walletProvider.sendAtomicBatch).not.toHaveBeenCalled();
    expect(walletProvider.sendTransaction.mock.calls.map(([tx]) => tx.data)).toEqual([DEPOSIT_WIRE.data]);
    expect(requested('/leverage-yield/approve')).toHaveLength(0);
  });

  it('approves separately for a wallet that must upgrade its account when allowAccountUpgrade is false', async () => {
    stubBackend({ withReset: false });
    const walletProvider = batchWallet('ready');
    walletProvider.sendTransaction.mockResolvedValueOnce('0xapprove').mockResolvedValueOnce('0xno-upgrade-deposit');
    walletProvider.waitForTransactionReceipt.mockResolvedValue({ status: 'success' } as never); // only `status` is read

    const result = await approveAndDeposit(walletProvider, DEPOSIT_PARAMS, { allowAccountUpgrade: false });

    expect(result).toEqual({ txHash: '0xno-upgrade-deposit', strategy: 'sequential' });
    expect(walletProvider.sendAtomicBatch).not.toHaveBeenCalled();
  });

  it('keeps a Sonic hub source sequential: no batch, the approval and the deposit go out separately', async () => {
    stubBackend({ withReset: false });
    const walletProvider = batchWallet();
    walletProvider.sendTransaction.mockResolvedValueOnce('0xapprove').mockResolvedValueOnce('0xhub-deposit');
    walletProvider.waitForTransactionReceipt.mockResolvedValue({ status: 'success' } as never); // only `status` is read

    const result = await approveAndDeposit(walletProvider, { ...DEPOSIT_PARAMS, srcChainKey: ChainKeys.SONIC_MAINNET });

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
    walletProvider.waitForBatch.mockRejectedValueOnce(new Error('timed out')).mockResolvedValueOnce(oneReceiptPerCall);
    const onBatchSent = vi.fn<(batchId: string, pending: PendingDeposit) => void>();

    await expect(approveAndDeposit(walletProvider, DEPOSIT_PARAMS, { onBatchSent })).rejects.toMatchObject({
      code: 'TX_VERIFICATION_FAILED',
      context: { reason: ATOMIC_BATCH_UNCONFIRMED, batchId: 'batch-1', callCount: 3 },
    });
    expect(onBatchSent).toHaveBeenCalledWith('batch-1', expect.anything());
    expect(walletProvider.sendAtomicBatch).toHaveBeenCalledTimes(1);
    expect(walletProvider.sendTransaction).not.toHaveBeenCalled();
    expect(requested('/leverage-yield/submit-tx')).toHaveLength(0);

    // What was persisted survives a JSON round trip and is all a resume needs: the call count, then the submit inputs.
    const pending = onBatchSent.mock.calls[0]?.[1];
    if (!pending) throw new Error('onBatchSent was not called');
    expect(JSON.parse(JSON.stringify(pending))).toEqual(pending);
    expect(pending.callCount).toBe(3);

    const resumed = await confirmApprovalBatch({
      walletProvider,
      batchId: 'batch-1',
      callCount: pending.callCount,
      timeoutMs: DEFAULT_RELAY_TX_TIMEOUT,
      feature: 'leverageYield',
    });
    expect(resumed).toEqual({ ok: true, value: { txHash: DEPOSIT_HASH, batchId: 'batch-1' } });
    if (!resumed.ok) throw resumed.error;

    const finished = await sodax.api.leverageYield.submitTx({
      txHash: resumed.value.txHash,
      srcChainKey: DEPOSIT_PARAMS.srcChainKey,
      walletAddress: DEPOSIT_PARAMS.srcAddress,
      intent: toIntentRequest(pending.intent),
      relayData: pending.relayData,
      operation: 'deposit',
    });
    expect(finished.ok).toBe(true);
    expect(submitted()).toMatchObject({
      txHash: DEPOSIT_HASH,
      relayData: RELAY_DATA.payload,
      intent: wireIntent('1000'),
      operation: 'deposit',
    });
  });
});
