import {
  ATOMIC_BATCH_UNCONFIRMED,
  ChainKeys,
  IndeterminateOutcomeError,
  intentCreationFailed,
  SodaxError,
  type CreateIntentParams,
} from '@sodax/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const strategyHook = vi.fn();
const swapHook = vi.fn();
const statusHook = vi.fn();
const stellarHook = vi.fn();
const nearHook = vi.fn();
const xrpHook = vi.fn();
const hederaHook = vi.fn();
const fetchingChecks = vi.fn(() => 0);

// The resolver is covered in utils/swapLifecycle.test.ts, so sub-hooks are stubbed and the hook runs as a plain function.
vi.mock('./useSwapApprovalStrategy.js', () => ({ useSwapApprovalStrategy: (args: unknown) => strategyHook(args) }));
vi.mock('./useSwapWithApproval.js', () => ({ useSwapWithApproval: (args: unknown) => swapHook(args) }));
vi.mock('./useDetailedStatus.js', () => ({ useDetailedStatus: (args: unknown) => statusHook(args) }));
vi.mock('../shared/useStellarGate.js', () => ({ useStellarGate: (args: unknown) => stellarHook(args) }));
vi.mock('../shared/useNearStorageGate.js', () => ({ useNearStorageGate: (args: unknown) => nearHook(args) }));
vi.mock('../shared/useXrpGate.js', () => ({ useXrpGate: (args: unknown) => xrpHook(args) }));
vi.mock('../shared/useHederaGate.js', () => ({ useHederaGate: (args: unknown) => hederaHook(args) }));
// Its own state is one ref; a fresh one per run() is a fresh mount.
vi.mock('react', () => ({ useRef: (initial: unknown) => ({ current: initial }) }));
vi.mock('@tanstack/react-query', () => ({ useIsFetching: () => fetchingChecks() }));

const { useSwapLifecycle } = await import('./useSwapLifecycle.js');

const PARAMS: CreateIntentParams = {
  inputToken: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
  outputToken: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
  inputAmount: 1_000_000n,
  minOutputAmount: 900_000n,
  deadline: 0n,
  allowPartialFill: false,
  srcChainKey: ChainKeys.BSC_MAINNET,
  dstChainKey: ChainKeys.ARBITRUM_MAINNET,
  srcAddress: '0x1111111111111111111111111111111111111111',
  dstAddress: '0x2222222222222222222222222222222222222222',
  solver: '0x0000000000000000000000000000000000000000',
  data: '0x',
};
const WALLET = { chainType: 'EVM' } as never;

const mutateAsyncSafe = vi.fn();
const resetSwap = vi.fn();
const refetchStrategy = vi.fn();
const openGate = {
  isStellar: false,
  needsActivation: false,
  needsFunding: false,
  needsTrustline: false,
  checkFailed: false,
  blocksAction: false,
  isNear: false,
  needsRegistration: false,
  isXrpIssuedToken: false,
  isHederaHtsToken: false,
  needsAssociation: false,
  blockedReason: undefined,
  activate: vi.fn(),
  requestTrustline: vi.fn(),
  retry: vi.fn(),
  registerStorage: vi.fn(),
  requestAssociation: vi.fn(),
};

const stub = ({
  swap = {},
  strategy = 'atomic-batch',
  status,
  stellar = {},
  near = {},
  xrp = {},
  hedera = {},
}: {
  swap?: Record<string, unknown>;
  strategy?: string;
  status?: unknown;
  stellar?: Record<string, unknown>;
  near?: Record<string, unknown>;
  xrp?: Record<string, unknown>;
  hedera?: Record<string, unknown>;
} = {}) => {
  strategyHook.mockReturnValue({ data: strategy, error: null, refetch: refetchStrategy });
  swapHook.mockReturnValue({
    status: 'idle',
    data: undefined,
    error: null,
    variables: undefined,
    mutateAsyncSafe,
    reset: resetSwap,
    ...swap,
  });
  statusHook.mockReturnValue({ data: status });
  stellarHook.mockReturnValue({ ...openGate, ...stellar });
  nearHook.mockReturnValue({ ...openGate, ...near });
  xrpHook.mockReturnValue({ ...openGate, ...xrp });
  hederaHook.mockReturnValue({ ...openGate, ...hedera });
};

const run = (overrides: Partial<Parameters<typeof useSwapLifecycle>[0]> = {}) =>
  useSwapLifecycle({
    intentParams: PARAMS,
    srcWalletProvider: WALLET,
    dstWalletProvider: undefined,
    ...overrides,
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useSwapLifecycle', () => {
  it('feeds the sub-hooks from the intent params', () => {
    stub();
    run();

    expect(strategyHook).toHaveBeenCalledWith({ params: { payload: PARAMS, walletProvider: WALLET } });
    expect(stellarHook).toHaveBeenCalledWith(
      expect.objectContaining({ dstChainKey: ChainKeys.ARBITRUM_MAINNET, amount: PARAMS.minOutputAmount }),
    );
    expect(nearHook).toHaveBeenCalledWith(expect.objectContaining({ dstChainKey: ChainKeys.ARBITRUM_MAINNET }));
    // No attempt yet, so the status read stays disabled.
    expect(statusHook).toHaveBeenCalledWith({ params: { srcChainKey: undefined, srcTxHash: undefined } });
  });

  it('checks the Stellar trustline for one unit when the minimum is 0n, so the check still runs', () => {
    stub();
    run({ intentParams: { ...PARAMS, minOutputAmount: 0n } });
    expect(stellarHook).toHaveBeenLastCalledWith(expect.objectContaining({ amount: 1n }));

    run({ intentParams: undefined });
    expect(stellarHook).toHaveBeenLastCalledWith(expect.objectContaining({ amount: undefined }));
  });

  it('swaps from the ready state with the configured extras and timeout', async () => {
    stub();
    mutateAsyncSafe.mockResolvedValueOnce({ ok: true, value: {} });
    const lifecycle = run({ extras: { apiKey: 'k' }, timeout: 30_000 });

    expect(lifecycle.state).toEqual({ kind: 'ready', approvalStrategy: 'atomic-batch' });
    await lifecycle.next();

    expect(mutateAsyncSafe).toHaveBeenCalledWith({
      params: PARAMS,
      walletProvider: WALLET,
      extras: { apiKey: 'k' },
      timeout: 30_000,
    });
  });

  it('passes allowAccountUpgrade to the strategy read and the swap', async () => {
    stub({ strategy: 'sequential' });
    mutateAsyncSafe.mockResolvedValueOnce({ ok: true, value: {} });
    const lifecycle = run({ allowAccountUpgrade: false });

    expect(strategyHook).toHaveBeenCalledWith({
      params: { payload: PARAMS, walletProvider: WALLET, allowAccountUpgrade: false },
    });
    await lifecycle.next();
    expect(mutateAsyncSafe).toHaveBeenCalledWith(expect.objectContaining({ allowAccountUpgrade: false }));
  });

  it('reads status from the source tx of the current swap and settles on solved', () => {
    stub({
      swap: {
        status: 'success',
        data: { intentDeliveryInfo: { srcChainKey: ChainKeys.BSC_MAINNET, srcTxHash: '0xsrc' } },
        variables: { params: PARAMS },
      },
      status: {
        ok: true,
        value: { source: 'solver', dstTxHash: '0xhub', data: { status: 3, fill_tx_hash: '0xf111' } },
      },
    });
    const lifecycle = run();

    expect(statusHook).toHaveBeenCalledWith({ params: { srcChainKey: ChainKeys.BSC_MAINNET, srcTxHash: '0xsrc' } });
    expect(lifecycle.state).toEqual({
      kind: 'settled',
      srcChainKey: ChainKeys.BSC_MAINNET,
      srcTxHash: '0xsrc',
      fillTxHash: '0xf111',
    });
  });

  it('switches chain when the source wallet is on the wrong network', async () => {
    stub();
    const switchChain = vi.fn();
    const lifecycle = run({ chainSwitch: { isWrongChain: true, switchChain } });

    expect(lifecycle.state).toEqual({ kind: 'needsChainSwitch' });
    await lifecycle.next();
    expect(switchChain).toHaveBeenCalledOnce();
    expect(mutateAsyncSafe).not.toHaveBeenCalled();
  });

  it.each([
    [{ stellar: { isStellar: true, needsActivation: true, blocksAction: true } }, 'activate'],
    [{ stellar: { isStellar: true, needsTrustline: true, blocksAction: true } }, 'requestTrustline'],
    [{ stellar: { isStellar: true, checkFailed: true, blocksAction: true } }, 'retry'],
    [{ near: { isNear: true, needsRegistration: true, blocksAction: true } }, 'registerStorage'],
    [{ xrp: { isXrpIssuedToken: true, needsTrustline: true, blocksAction: true } }, 'requestTrustline'],
    [{ xrp: { isXrpIssuedToken: true, checkFailed: true, blocksAction: true } }, 'retry'],
    [{ hedera: { isHederaHtsToken: true, needsAssociation: true, blocksAction: true } }, 'requestAssociation'],
    [{ hedera: { isHederaHtsToken: true, checkFailed: true, blocksAction: true } }, 'retry'],
  ] as const)('runs the matching setup action', async (gates, action) => {
    stub(gates);
    const lifecycle = run();

    expect(lifecycle.state.kind).toBe('needsSetup');
    await lifecycle.next();
    expect(openGate[action]).toHaveBeenCalledOnce();
    expect(mutateAsyncSafe).not.toHaveBeenCalled();
  });

  // The gates must check the account the swap pays, not whichever destination account the app tracks.
  it('checks the Stellar and NEAR gates on the intent recipient', () => {
    stub();
    run();

    expect(stellarHook).toHaveBeenCalledWith(expect.objectContaining({ address: PARAMS.dstAddress }));
    expect(nearHook).toHaveBeenCalledWith(expect.objectContaining({ accountId: PARAMS.dstAddress }));
  });

  it('sizes the XRPL trustline check as the SDK sizes its check before signing', () => {
    stub();
    run({ intentParams: { ...PARAMS, dstChainKey: ChainKeys.XRP_MAINNET } });

    expect(xrpHook).toHaveBeenCalledWith(
      expect.objectContaining({
        dstChainKey: ChainKeys.XRP_MAINNET,
        address: PARAMS.dstAddress,
        token: PARAMS.outputToken,
        amount: PARAMS.minOutputAmount,
        maxAmount: PARAMS.minOutputAmount * 2n,
      }),
    );
  });

  it.each([
    ['xrpBlocked', { blockedReason: 'issuer_frozen' }],
    ['xrpFunding', { needsFunding: true }],
  ] as const)('leaves %s to the app and sends nothing', async (reason, gate) => {
    stub({ xrp: { isXrpIssuedToken: true, blocksAction: true, ...gate } });
    const lifecycle = run();

    expect(lifecycle.state).toEqual({ kind: 'needsSetup', reason });
    expect(await lifecycle.next()).toBeUndefined();
    expect(openGate.requestTrustline).not.toHaveBeenCalled();
    expect(mutateAsyncSafe).not.toHaveBeenCalled();
  });

  it('holds the XRPL trustline step while its TrustSet is in flight', async () => {
    stub({ xrp: { isXrpIssuedToken: true, needsTrustline: true, blocksAction: true, isRequestingTrustline: true } });
    const lifecycle = run();

    expect(lifecycle.state).toEqual({ kind: 'checking' });
    await lifecycle.next();
    expect(openGate.requestTrustline).not.toHaveBeenCalled();
  });

  it('checks the Hedera gate on the intent recipient, for the swap output token only', () => {
    stub();
    const dstWalletProvider = { chainType: 'EVM' } as never;
    run({ intentParams: { ...PARAMS, dstChainKey: ChainKeys.HEDERA_MAINNET }, dstWalletProvider });

    expect(hederaHook).toHaveBeenCalledWith({
      dstChainKey: ChainKeys.HEDERA_MAINNET,
      token: PARAMS.outputToken,
      address: PARAMS.dstAddress,
      walletProvider: dstWalletProvider,
    });
  });

  it('switches to Hedera before association and back to the source before swapping', async () => {
    const requestAssociation = vi.fn().mockResolvedValue({ ok: true, value: '0xhash' });
    const dstChainSwitch = { isWrongChain: true, switchChain: vi.fn() };
    const chainSwitch = { isWrongChain: true, switchChain: vi.fn() };
    const intentParams = { ...PARAMS, dstChainKey: ChainKeys.HEDERA_MAINNET };
    stub({ hedera: { isHederaHtsToken: true, needsAssociation: true, blocksAction: true, requestAssociation } });
    const before = run({ intentParams, chainSwitch, dstChainSwitch });

    expect(before.state).toEqual({ kind: 'needsChainSwitch' });
    await before.next();
    expect(dstChainSwitch.switchChain).toHaveBeenCalledOnce();
    expect(requestAssociation).not.toHaveBeenCalled();
    expect(chainSwitch.switchChain).not.toHaveBeenCalled();

    dstChainSwitch.isWrongChain = false;
    const onHedera = run({ intentParams, chainSwitch, dstChainSwitch });
    expect(onHedera.state).toEqual({ kind: 'needsSetup', reason: 'hederaAssociation' });
    await onHedera.next();
    expect(requestAssociation).toHaveBeenCalledOnce();

    stub({ hedera: { isHederaHtsToken: true } });
    const associated = run({ intentParams, chainSwitch, dstChainSwitch });
    expect(associated.state).toEqual({ kind: 'needsChainSwitch' });
    await associated.next();
    expect(chainSwitch.switchChain).toHaveBeenCalledOnce();
    expect(dstChainSwitch.switchChain).toHaveBeenCalledOnce();
    expect(mutateAsyncSafe).not.toHaveBeenCalled();
  });

  it('returns the failed association Result to the next caller', async () => {
    const failure = { ok: false, error: new Error('User rejected association') };
    const requestAssociation = vi.fn().mockResolvedValue(failure);
    stub({ hedera: { isHederaHtsToken: true, needsAssociation: true, blocksAction: true, requestAssociation } });

    await expect(run().next()).resolves.toBe(failure);
    expect(requestAssociation).toHaveBeenCalledOnce();
    expect(mutateAsyncSafe).not.toHaveBeenCalled();
  });

  it('shows the association step, runs it, then swaps once the token is associated', async () => {
    const requestAssociation = vi.fn().mockResolvedValue({ ok: true, value: '0xhash' });
    stub({ hedera: { isHederaHtsToken: true, needsAssociation: true, blocksAction: true, requestAssociation } });
    const before = run();

    expect(before.state).toEqual({ kind: 'needsSetup', reason: 'hederaAssociation' });
    await expect(before.next()).resolves.toEqual({ ok: true, value: '0xhash' });
    expect(requestAssociation).toHaveBeenCalledOnce();
    expect(mutateAsyncSafe).not.toHaveBeenCalled();

    // The association landed and its check refreshed: the gate opens and the same form can swap.
    stub({ hedera: { isHederaHtsToken: true } });
    const after = run();
    expect(after.state).toEqual({ kind: 'ready', approvalStrategy: 'atomic-batch' });
    await after.next();
    expect(mutateAsyncSafe).toHaveBeenCalledOnce();
    expect(requestAssociation).toHaveBeenCalledOnce();
  });

  it.each([
    'account_missing',
    'frozen',
    'kyc_not_granted',
  ] as const)('leaves a %s Hedera destination to the app and sends nothing', async blockedReason => {
    stub({ hedera: { isHederaHtsToken: true, blocksAction: true, blockedReason } });
    const lifecycle = run();

    expect(lifecycle.state).toEqual({ kind: 'needsSetup', reason: 'hederaBlocked' });
    expect(lifecycle.hedera.blockedReason).toBe(blockedReason);
    expect(await lifecycle.next()).toBeUndefined();
    expect(openGate.requestAssociation).not.toHaveBeenCalled();
    expect(mutateAsyncSafe).not.toHaveBeenCalled();
  });

  it('holds the Hedera association step while the association is in flight', async () => {
    stub({
      hedera: { isHederaHtsToken: true, needsAssociation: true, blocksAction: true, isRequestingAssociation: true },
    });
    const lifecycle = run();

    expect(lifecycle.state).toEqual({ kind: 'checking' });
    await lifecycle.next();
    expect(openGate.requestAssociation).not.toHaveBeenCalled();
  });

  it('holds the Hedera association step while its refreshed check is still fetching', async () => {
    fetchingChecks.mockReturnValueOnce(1);
    stub({ hedera: { isHederaHtsToken: true, needsAssociation: true, blocksAction: true } });
    const lifecycle = run();

    expect(lifecycle.state).toEqual({ kind: 'checking' });
    await lifecycle.next();
    expect(openGate.requestAssociation).not.toHaveBeenCalled();
  });

  it('retries a failed NEAR storage check instead of swapping', async () => {
    const nearRetry = vi.fn();
    stub({ near: { isNear: true, checkFailed: true, retry: nearRetry } });
    const lifecycle = run();

    expect(lifecycle.state).toEqual({ kind: 'needsSetup', reason: 'nearStorageCheckFailed' });
    await lifecycle.next();
    expect(nearRetry).toHaveBeenCalledOnce();
    expect(mutateAsyncSafe).not.toHaveBeenCalled();
  });

  it.each([
    ['a trustline tx in flight', { stellar: { needsTrustline: true, isRequestingTrustline: true } }, 0],
    ['a storage tx in flight', { near: { needsRegistration: true, isRegistering: true } }, 0],
    ['the storage check refreshing after the tx', { near: { needsRegistration: true } }, 1],
  ] as const)('holds the setup step while %s, so a second click sends nothing', async (_label, gates, fetching) => {
    stub({
      stellar: { isStellar: true, blocksAction: true, ...('stellar' in gates ? gates.stellar : {}) },
      near: { isNear: true, blocksAction: true, ...('near' in gates ? gates.near : {}) },
    });
    fetchingChecks.mockReturnValueOnce(fetching);
    const lifecycle = run();

    expect(lifecycle.state).toEqual({ kind: 'checking' });
    await lifecycle.next();
    expect(openGate.requestTrustline).not.toHaveBeenCalled();
    expect(openGate.registerStorage).not.toHaveBeenCalled();
  });

  it('leaves app-owned prerequisites to the app', async () => {
    stub();
    const lifecycle = run({ externalBlocked: true });

    expect(lifecycle.state).toEqual({ kind: 'needsSetup', reason: 'external' });
    await expect(lifecycle.next()).resolves.toBeUndefined();
    expect(mutateAsyncSafe).not.toHaveBeenCalled();
  });

  it('resumes an unconfirmed batch from next() instead of sending it again, and exposes its error', async () => {
    const error = new SodaxError('TX_VERIFICATION_FAILED', 'batch not confirmed', {
      feature: 'swap',
      context: { reason: ATOMIC_BATCH_UNCONFIRMED, batchId: 'batch-1', callCount: 2 },
    });
    const sent = { params: PARAMS, walletProvider: WALLET, extras: { apiKey: 'k' }, timeout: 30_000 };
    stub({ swap: { status: 'error', error, variables: sent } });
    mutateAsyncSafe.mockResolvedValueOnce({ ok: true, value: {} });
    const lifecycle = run();

    expect(lifecycle.state).toEqual({ kind: 'unconfirmed', batchId: 'batch-1', callCount: 2, error });
    expect(lifecycle.error).toBe(error);
    await lifecycle.next();
    expect(resetSwap).not.toHaveBeenCalled();
    expect(mutateAsyncSafe).toHaveBeenCalledWith({ ...sent, resumeBatchId: 'batch-1', resumeBatchCallCount: 2 });
  });

  it('keeps an unconfirmed batch after the params change, and resumes it with the params that sent it', async () => {
    const error = new SodaxError('TX_VERIFICATION_FAILED', 'batch not confirmed', {
      feature: 'swap',
      context: { reason: ATOMIC_BATCH_UNCONFIRMED, batchId: 'batch-1' },
    });
    stub({ swap: { status: 'error', error, variables: { params: PARAMS, walletProvider: WALLET } } });
    mutateAsyncSafe.mockResolvedValueOnce({ ok: true, value: {} });
    const lifecycle = run({ intentParams: { ...PARAMS, minOutputAmount: 899_000n } });

    expect(lifecycle.state).toEqual({ kind: 'unconfirmed', batchId: 'batch-1', error });
    await lifecycle.next();
    expect(mutateAsyncSafe).toHaveBeenCalledWith({ params: PARAMS, walletProvider: WALLET, resumeBatchId: 'batch-1' });
  });

  it('runs one next() at a time, so a double click swaps once', async () => {
    stub();
    let finish: (value: unknown) => void = () => {};
    mutateAsyncSafe.mockReturnValueOnce(
      new Promise(resolve => {
        finish = resolve;
      }),
    );
    const lifecycle = run();

    const first = lifecycle.next();
    await expect(lifecycle.next()).resolves.toBeUndefined();
    expect(mutateAsyncSafe).toHaveBeenCalledOnce();

    finish({ ok: true, value: {} });
    await first;
    mutateAsyncSafe.mockResolvedValueOnce({ ok: true, value: {} });
    await lifecycle.next();
    expect(mutateAsyncSafe).toHaveBeenCalledTimes(2);
  });

  it('exposes the error of a swap that failed after broadcast while it stays pending', () => {
    const error = new SodaxError('RELAY_TIMEOUT', 'relay timed out', {
      feature: 'swap',
      context: { srcChainKey: ChainKeys.BSC_MAINNET, srcTxHash: '0xsrc' },
    });
    stub({ swap: { status: 'error', error, variables: { params: PARAMS } } });
    const lifecycle = run();

    expect(lifecycle.state).toMatchObject({ kind: 'pending', srcTxHash: '0xsrc' });
    expect(lifecycle.error).toBe(error);
  });

  it('keeps a recovery-only attempt pending across an input edit without sending again', async () => {
    const recovery = { validUntil: 42 };
    const failure = intentCreationFailed(
      'swap',
      new IndeterminateOutcomeError('submit reply lost', {
        cause: new Error('timeout'),
        recovery,
      }),
    );
    stub({ swap: { status: 'error', error: failure, variables: { params: PARAMS } } });
    const lifecycle = run({ intentParams: { ...PARAMS, minOutputAmount: 899_000n } });

    expect(lifecycle.state).toEqual({ kind: 'pending', srcChainKey: PARAMS.srcChainKey, recovery, error: failure });
    expect(statusHook).toHaveBeenCalledWith({ params: { srcChainKey: undefined, srcTxHash: undefined } });
    await expect(lifecycle.next()).resolves.toBeUndefined();
    expect(mutateAsyncSafe).not.toHaveBeenCalled();
    expect(resetSwap).not.toHaveBeenCalled();
  });

  it('ignores reset() while the swap call is in flight', () => {
    stub({ swap: { status: 'pending', isPending: true, variables: { params: PARAMS } } });
    const lifecycle = run();

    expect(lifecycle.state).toEqual({ kind: 'submitting' });
    lifecycle.reset();
    expect(resetSwap).not.toHaveBeenCalled();
  });

  it('surfaces a failed swap on error and resets it from next()', async () => {
    const error = new Error('User rejected the request');
    stub({ swap: { status: 'error', error, variables: { params: PARAMS } } });
    const lifecycle = run();

    expect(lifecycle.state).toEqual({ kind: 'failed', error });
    expect(lifecycle.error).toBe(error);
    await lifecycle.next();
    expect(resetSwap).toHaveBeenCalledOnce();
    expect(refetchStrategy).toHaveBeenCalledOnce();
  });
});
