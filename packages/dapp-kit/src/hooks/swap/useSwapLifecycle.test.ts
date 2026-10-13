import { ATOMIC_BATCH_UNCONFIRMED, ChainKeys, SodaxError, type CreateIntentParams } from '@sodax/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const strategyHook = vi.fn();
const swapHook = vi.fn();
const statusHook = vi.fn();
const stellarHook = vi.fn();
const nearHook = vi.fn();
const fetchingChecks = vi.fn(() => 0);

// The lifecycle is composition plus a pure resolver (covered in utils/swapLifecycle.test.ts), so the
// sub-hooks are stubbed and the hook runs as a plain function.
vi.mock('./useSwapApprovalStrategy.js', () => ({ useSwapApprovalStrategy: (args: unknown) => strategyHook(args) }));
vi.mock('./useSwapWithApproval.js', () => ({ useSwapWithApproval: (args: unknown) => swapHook(args) }));
vi.mock('./useDetailedStatus.js', () => ({ useDetailedStatus: (args: unknown) => statusHook(args) }));
vi.mock('../shared/useStellarGate.js', () => ({ useStellarGate: (args: unknown) => stellarHook(args) }));
vi.mock('../shared/useNearStorageGate.js', () => ({ useNearStorageGate: (args: unknown) => nearHook(args) }));
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
  activate: vi.fn(),
  requestTrustline: vi.fn(),
  retry: vi.fn(),
  registerStorage: vi.fn(),
};

const stub = ({
  swap = {},
  strategy = 'atomic-batch',
  status,
  stellar = {},
  near = {},
}: {
  swap?: Record<string, unknown>;
  strategy?: string;
  status?: unknown;
  stellar?: Record<string, unknown>;
  near?: Record<string, unknown>;
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

  it('never retries an unconfirmed batch from next(), and exposes its error', async () => {
    const error = new SodaxError('TX_VERIFICATION_FAILED', 'batch not confirmed', {
      feature: 'swap',
      context: { reason: ATOMIC_BATCH_UNCONFIRMED, batchId: 'batch-1' },
    });
    stub({ swap: { status: 'error', error, variables: { params: PARAMS } } });
    const lifecycle = run();

    expect(lifecycle.state).toEqual({ kind: 'unconfirmed', batchId: 'batch-1', error });
    expect(lifecycle.error).toBe(error);
    await expect(lifecycle.next()).resolves.toBeUndefined();
    expect(resetSwap).not.toHaveBeenCalled();
    expect(mutateAsyncSafe).not.toHaveBeenCalled();
  });

  it('keeps an unconfirmed batch after the params change, so the swap cannot be sent again', async () => {
    const error = new SodaxError('TX_VERIFICATION_FAILED', 'batch not confirmed', {
      feature: 'swap',
      context: { reason: ATOMIC_BATCH_UNCONFIRMED, batchId: 'batch-1' },
    });
    stub({ swap: { status: 'error', error, variables: { params: PARAMS } } });
    const lifecycle = run({ intentParams: { ...PARAMS, minOutputAmount: 899_000n } });

    expect(lifecycle.state).toEqual({ kind: 'unconfirmed', batchId: 'batch-1', error });
    await lifecycle.next();
    expect(mutateAsyncSafe).not.toHaveBeenCalled();
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
