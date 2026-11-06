// Partner example the Leverage Yield API skill links to: approve and deposit in one signature, public exports only.
// The batch rules themselves (strategy, refusal, unconfirmed) are tested in `shared/utils/approvalBatch.test.ts`.
import { AtomicityNotSupportedError, isAddress, isHex } from 'viem';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ATOMIC_BATCH_UNCONFIRMED,
  ChainKeys,
  DEFAULT_API_BASE_URL,
  DEFAULT_RELAY_TX_TIMEOUT,
  Sodax,
  confirmApprovalBatch,
  getEvmViemChain,
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
  type RawTxReturnType,
  type Result,
  type SpokeChainKey,
} from '../index.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const sodax = new Sodax();
const BASE = DEFAULT_API_BASE_URL;
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
  // Only `status` is read.
  waitForTransactionReceipt: vi
    .fn<IEvmWalletProvider['waitForTransactionReceipt']>()
    .mockResolvedValue({ status: 'success' } as never),
  getAtomicBatchSupport: vi.fn(async (_chainId: number) => support),
  sendAtomicBatch: vi.fn(
    async (_txs: readonly EvmRawTransaction[], _options: { expectedChainId: number }) => 'batch-1',
  ),
  waitForBatch: vi.fn(async (_batchId: string, _options?: { timeout?: number }) => confirmed),
});

const stubBackend = ({
  withReset,
  allowanceValid = false,
  failSubmitOnce = false,
}: {
  withReset: boolean;
  allowanceValid?: boolean;
  failSubmitOnce?: boolean;
}) => {
  let intentsCreated = 0;
  let submitFailures = failSubmitOnce ? 1 : 0;
  mockFetch.mockImplementation(async (url: string) => {
    if (url === `${BASE}/leverage-yield/submit-tx` && submitFailures > 0) {
      submitFailures -= 1;
      return { ok: false, status: 500, text: vi.fn().mockResolvedValue('unavailable') };
    }
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
const submitted = () => requested('/leverage-yield/submit-tx').map(([, init]) => JSON.parse(init.body));

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

const unwrap = <T>(result: Result<T>): T => {
  if (!result.ok) throw result.error;
  return result.value;
};

const isEvmTx = (tx: RawTxReturnType): tx is EvmRawTransaction =>
  'to' in tx &&
  typeof tx.to === 'string' &&
  isAddress(tx.to) &&
  'data' in tx &&
  typeof tx.data === 'string' &&
  isHex(tx.data);

/** The API types its txs for every chain type; an EVM source must get EVM ones before anything is signed. */
const evmTx = (tx: RawTxReturnType): EvmRawTransaction => {
  if (!isEvmTx(tx)) throw new Error('The API returned a non-EVM transaction for an EVM source');
  return tx;
};

/**
 * The `submitTx` body with the wire `intent` (decimal strings), so it survives `JSON.stringify`, unlike the
 * bigint `IntentRequestV2` that `submitTx` takes; `submitDeposit` converts it.
 */
type DepositSubmit = Omit<LeverageYieldSubmitTxRequestV2, 'intent'> & { intent: IntentResponseV2 };

const submitDeposit = (submit: DepositSubmit) =>
  sodax.api.leverageYield.submitTx({ ...submit, intent: toIntentRequest(submit.intent) });

/**
 * Persist this with the batch id before waiting on the batch: a resume after a reload needs `callCount`
 * for `confirmApprovalBatch` and the rest of the `submitTx` body.
 */
type PendingDeposit = { callCount: number; submit: Omit<DepositSubmit, 'txHash'> };

/**
 * Approves and sends the deposit; one signature when the source is an EVM spoke and the wallet can batch.
 * Returns the `submitTx` body unsent: the deposit is already out, so persist it, then submit it, and retry
 * only `submitTx` if that fails.
 */
async function approveAndDeposit(
  walletProvider: IWalletProvider,
  params: CreateDepositIntentParamsV2 & { srcChainKey: SpokeChainKey },
  {
    onBatchSent,
    allowAccountUpgrade,
  }: { onBatchSent?: (batchId: string, pending: PendingDeposit) => void; allowAccountUpgrade?: boolean } = {},
): Promise<{ strategy: ApprovalStrategy; submit: DepositSubmit }> {
  const { srcChainKey } = params;
  if (!isEvmWalletProviderType(walletProvider) || !isEvmChainKeyType(srcChainKey)) {
    throw new Error('Only EVM sources are handled here; approve and sign other chains separately.');
  }
  const allowance = unwrap(await sodax.api.leverageYield.checkAllowance(params));
  const [approval, created, resolved] = await Promise.all([
    allowance.valid ? undefined : sodax.api.leverageYield.approve(params).then(unwrap),
    sodax.api.leverageYield.createDepositIntent(params).then(unwrap),
    allowance.valid
      ? ('not-required' as const)
      : resolveApprovalStrategy({ srcChainKey, walletProvider, allowAccountUpgrade }),
  ]);
  const approvalTxs = approval ? (approval.resetTx ? [approval.resetTx, approval.tx] : [approval.tx]).map(evmTx) : [];
  let deposit = created;
  let strategy: ApprovalStrategy = resolved;
  const submitBody = () => ({
    srcChainKey,
    walletAddress: params.srcAddress,
    intent: deposit.intent,
    relayData: deposit.relayData.payload,
    operation: 'deposit' as const,
  });

  let txHash: string | undefined;
  if (strategy === 'atomic-batch' && isEvmSpokeOnlyChainKeyType(srcChainKey)) {
    const txs = [...approvalTxs, evmTx(deposit.tx)];
    const sent = await sendApprovalBatch({
      walletProvider,
      srcChainKey,
      txs,
      timeoutMs: DEFAULT_RELAY_TX_TIMEOUT,
      feature: 'leverageYield',
      onBatchSent: onBatchSent && (batchId => onBatchSent(batchId, { callCount: txs.length, submit: submitBody() })),
    });
    if (sent.ok) txHash = sent.value.txHash;
    else if (isAtomicBatchRefusal(sent.error)) strategy = 'sequential';
    else throw sent.error;
  }
  if (txHash === undefined) {
    const expectedChainId = getEvmViemChain(srcChainKey).id;
    for (const tx of approvalTxs) {
      const receipt = await walletProvider.waitForTransactionReceipt(
        await walletProvider.sendTransaction(tx, { expectedChainId }),
      );
      // The deposit is only valid once the allowance is on-chain, so a reverted reset or approve ends the flow.
      if (receipt.status === 'reverted' || receipt.status === '0x0')
        throw new Error('The approval transaction reverted');
    }
    // The first intent's `deadline` also covered the wait for the approval, so build the deposit again.
    if (approval) deposit = unwrap(await sodax.api.leverageYield.createDepositIntent(params));
    txHash = await walletProvider.sendTransaction(evmTx(deposit.tx), { expectedChainId });
  }
  return { strategy, submit: { ...submitBody(), txHash } };
}

/** Leaves the batch unconfirmed and returns what `onBatchSent` persisted, read back as after a reload. */
async function leaveUnconfirmed(walletProvider: ReturnType<typeof batchWallet>) {
  const onBatchSent = vi.fn<(batchId: string, pending: PendingDeposit) => void>();
  await expect(approveAndDeposit(walletProvider, DEPOSIT_PARAMS, { onBatchSent })).rejects.toMatchObject({
    code: 'TX_VERIFICATION_FAILED',
    context: { reason: ATOMIC_BATCH_UNCONFIRMED, batchId: 'batch-1' },
  });
  const [batchId, pending] = onBatchSent.mock.calls[0] ?? [];
  if (batchId === undefined || pending === undefined) throw new Error('onBatchSent was not called');
  const saved: PendingDeposit = JSON.parse(JSON.stringify(pending));
  expect(saved).toEqual(pending);
  return { batchId, saved };
}

const resume = (walletProvider: IEvmWalletProvider, batchId: string, callCount: number) =>
  confirmApprovalBatch({
    walletProvider,
    batchId,
    callCount,
    timeoutMs: DEFAULT_RELAY_TX_TIMEOUT,
    feature: 'leverageYield',
  });

beforeEach(() => {
  mockFetch.mockReset();
});

describe('approve and deposit in one signature (Leverage Yield API)', () => {
  it('sends [resetTx, approve, deposit] as one batch, deposit last, and returns the submit body with the intent and relay payload', async () => {
    stubBackend({ withReset: true });
    const walletProvider = batchWallet();

    const result = await approveAndDeposit(walletProvider, DEPOSIT_PARAMS);

    expect(result).toEqual({
      strategy: 'atomic-batch',
      submit: {
        txHash: DEPOSIT_HASH,
        srcChainKey: ChainKeys.BASE_MAINNET,
        walletAddress: ACCOUNT,
        intent: wireIntent('1000'),
        relayData: RELAY_DATA.payload,
        operation: 'deposit',
      },
    });
    expect(walletProvider.sendAtomicBatch).toHaveBeenCalledTimes(1);
    const [txs, options] = walletProvider.sendAtomicBatch.mock.calls[0] ?? [];
    expect(txs?.map(tx => tx.data)).toEqual([RESET_WIRE.data, APPROVE_WIRE.data, DEPOSIT_WIRE.data]);
    expect(options).toEqual({ expectedChainId: getEvmViemChain(ChainKeys.BASE_MAINNET).id });
    expect(walletProvider.sendTransaction).not.toHaveBeenCalled();
    expect(requested('/leverage-yield/intents/deposit')).toHaveLength(1);
    expect(submitted()).toEqual([]);

    unwrap(await submitDeposit(result.submit));
    expect(submitted()).toMatchObject([result.submit]);
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

    const result = await approveAndDeposit(walletProvider, DEPOSIT_PARAMS);

    expect(result).toMatchObject({
      strategy: 'sequential',
      submit: { txHash: '0xseparate-deposit', intent: wireIntent('2000') },
    });
    expect(walletProvider.sendAtomicBatch).toHaveBeenCalledTimes(1);
    expect(walletProvider.sendTransaction.mock.calls.map(([tx]) => tx.data)).toEqual([
      APPROVE_WIRE.data,
      DEPOSIT_WIRE.data,
    ]);
    expect(requested('/leverage-yield/intents/deposit')).toHaveLength(2);
  });

  it('stops when the separate approval reverts: no deposit is sent', async () => {
    stubBackend({ withReset: false });
    const walletProvider = batchWallet();
    walletProvider.sendAtomicBatch.mockRejectedValueOnce(new AtomicityNotSupportedError(new Error('no atomicity')));
    walletProvider.sendTransaction.mockResolvedValueOnce('0xapprove');
    walletProvider.waitForTransactionReceipt.mockResolvedValue({ status: 'reverted' } as never); // only `status` is read

    await expect(approveAndDeposit(walletProvider, DEPOSIT_PARAMS)).rejects.toThrow(
      'The approval transaction reverted',
    );

    expect(walletProvider.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it('sends only the deposit when the allowance is already valid', async () => {
    stubBackend({ withReset: false, allowanceValid: true });
    const walletProvider = batchWallet();
    walletProvider.sendTransaction.mockResolvedValueOnce('0xdirect-deposit');

    const result = await approveAndDeposit(walletProvider, DEPOSIT_PARAMS);

    expect(result).toMatchObject({ strategy: 'not-required', submit: { txHash: '0xdirect-deposit' } });
    expect(walletProvider.sendAtomicBatch).not.toHaveBeenCalled();
    expect(walletProvider.sendTransaction.mock.calls.map(([tx]) => tx.data)).toEqual([DEPOSIT_WIRE.data]);
    expect(requested('/leverage-yield/approve')).toHaveLength(0);
  });

  it('approves separately for a wallet that must upgrade its account when allowAccountUpgrade is false', async () => {
    stubBackend({ withReset: false });
    const walletProvider = batchWallet('ready');
    walletProvider.sendTransaction.mockResolvedValueOnce('0xapprove').mockResolvedValueOnce('0xno-upgrade-deposit');

    const result = await approveAndDeposit(walletProvider, DEPOSIT_PARAMS, { allowAccountUpgrade: false });

    expect(result).toMatchObject({ strategy: 'sequential', submit: { txHash: '0xno-upgrade-deposit' } });
    expect(walletProvider.sendAtomicBatch).not.toHaveBeenCalled();
  });

  it('keeps a Sonic hub source sequential: no batch, the approval and the deposit go out separately', async () => {
    stubBackend({ withReset: false });
    const walletProvider = batchWallet();
    walletProvider.sendTransaction.mockResolvedValueOnce('0xapprove').mockResolvedValueOnce('0xhub-deposit');

    const result = await approveAndDeposit(walletProvider, { ...DEPOSIT_PARAMS, srcChainKey: ChainKeys.SONIC_MAINNET });

    expect(result).toMatchObject({ strategy: 'sequential', submit: { txHash: '0xhub-deposit' } });
    expect(walletProvider.sendAtomicBatch).not.toHaveBeenCalled();
    expect(walletProvider.sendTransaction.mock.calls.map(([tx]) => tx.data)).toEqual([
      APPROVE_WIRE.data,
      DEPOSIT_WIRE.data,
    ]);
  });

  it('retries only submitTx when it fails after the deposit: the same body goes again, no second deposit', async () => {
    stubBackend({ withReset: false, failSubmitOnce: true });
    const walletProvider = batchWallet();

    const { submit } = await approveAndDeposit(walletProvider, DEPOSIT_PARAMS);
    const first = await submitDeposit(submit);
    const retried = await submitDeposit(submit);

    expect(first.ok).toBe(false);
    expect(retried.ok).toBe(true);
    expect(submitted()).toMatchObject([submit, submit]);
    expect(walletProvider.sendAtomicBatch).toHaveBeenCalledTimes(1);
    expect(requested('/leverage-yield/intents/deposit')).toHaveLength(1);
  });

  it('never resends an unconfirmed batch; the persisted state alone resumes and submits it', async () => {
    stubBackend({ withReset: true });
    const walletProvider = batchWallet();
    walletProvider.waitForBatch.mockRejectedValueOnce(new Error('timed out')).mockResolvedValueOnce(oneReceiptPerCall);

    const { batchId, saved } = await leaveUnconfirmed(walletProvider);

    expect(saved.callCount).toBe(3);
    expect(walletProvider.sendTransaction).not.toHaveBeenCalled();
    const { txHash } = unwrap(await resume(walletProvider, batchId, saved.callCount));
    unwrap(await submitDeposit({ ...saved.submit, txHash }));
    expect(walletProvider.sendAtomicBatch).toHaveBeenCalledTimes(1);
    expect(submitted()).toMatchObject([
      {
        txHash: DEPOSIT_HASH,
        srcChainKey: ChainKeys.BASE_MAINNET,
        walletAddress: ACCOUNT,
        intent: wireIntent('1000'),
        relayData: RELAY_DATA.payload,
        operation: 'deposit',
      },
    ]);
  });

  it('runs the flow again when the resume reports the batch failed, since nothing landed', async () => {
    stubBackend({ withReset: false });
    const walletProvider = batchWallet();
    walletProvider.waitForBatch
      .mockRejectedValueOnce(new Error('timed out'))
      .mockResolvedValueOnce({ status: 'failure', statusCode: 400, atomic: true, receipts: [] });

    const { batchId, saved } = await leaveUnconfirmed(walletProvider);
    const resumed = await resume(walletProvider, batchId, saved.callCount);
    expect(!resumed.ok && resumed.error.context?.reason).toBe('atomic-batch-failed');

    const rerun = await approveAndDeposit(walletProvider, DEPOSIT_PARAMS);
    expect(rerun).toMatchObject({
      strategy: 'atomic-batch',
      submit: { txHash: DEPOSIT_HASH, intent: wireIntent('2000') },
    });
    expect(walletProvider.sendAtomicBatch).toHaveBeenCalledTimes(2);
  });
});
