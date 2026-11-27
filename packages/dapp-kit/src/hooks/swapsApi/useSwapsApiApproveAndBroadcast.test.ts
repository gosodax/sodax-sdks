/**
 * The swaps API can return two approval transactions, and the second is only a valid state
 * transition once the first has been mined. That ordering is what this hook exists to own — before
 * it, every integration re-implemented it and could drop the wait or the abort, which costs the user
 * gas on a transaction certain to revert.
 *
 * This suite also holds the shared `runApprovalPlan` chain and ordering matrix; the bridge and
 * leverage-yield suites pin only their own wiring on top of it.
 *
 * Follows the package convention of testing hooks without a renderer: the React Query wrapper is
 * mocked so `mutationFn` can be captured and driven directly.
 */

import { ChainKeys, getEvmViemChain } from '@sodax/sdk';
import type { ApprovalProgress } from '../../utils/approvalPlan.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const approve = vi.fn();
const checkAllowance = vi.fn();
const invalidateQueries = vi.fn();

// biome-ignore lint/suspicious/noExplicitAny: the captured mutation options are driven directly.
let captured: any;

vi.mock('../shared/useSodaxContext.js', () => ({
  useSodaxContext: () => ({ sodax: { api: { swaps: { approve, checkAllowance } } } }),
}));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries }) }));
vi.mock('../shared/useSafeMutation.js', () => ({
  // biome-ignore lint/suspicious/noExplicitAny: mirrors the real wrapper's opaque options bag.
  useSafeMutation: (options: any) => {
    captured = options;
    return {};
  },
}));

const { useSwapsApiApproveAndBroadcast } = await import('./useSwapsApiApproveAndBroadcast.js');

const RESET_TX = { from: '0x1', to: '0x2', value: 0n, data: '0xreset' };
const APPROVE_TX = { from: '0x1', to: '0x2', value: 0n, data: '0xapprove' };
const RESET_HASH = '0xreset-hash';
const APPROVE_HASH = '0xapprove-hash';

const body = (srcChainKey: string) => ({ srcChainKey, inputToken: '0xtoken', inputAmount: '1' });

/**
 * Records the interleaving of sends and waits so ordering can be asserted, not assumed.
 * `onWait` either throws (the receipt never arrives) or returns the mined status.
 */
function evmProvider(calls: string[], onWait?: (hash: string) => string | void) {
  return {
    sendTransaction: vi.fn(async (tx: { data: string }) => {
      calls.push(`send:${tx.data}`);
      return tx.data === '0xreset' ? RESET_HASH : APPROVE_HASH;
    }),
    waitForTransactionReceipt: vi.fn(async (hash: string) => {
      calls.push(`wait:${hash}`);
      return { status: onWait?.(hash) ?? 'success' };
    }),
  };
}

/** One render, then the captured `mutationFn` invoked with `vars`. */
// biome-ignore lint/suspicious/noExplicitAny: vars mirror the hook's generic mutation variables.
const run = (vars: any) => {
  useSwapsApiApproveAndBroadcast();
  return captured.mutationFn(vars);
};

beforeEach(() => {
  vi.clearAllMocks();
  checkAllowance.mockResolvedValue({ ok: true, value: { valid: true } });
});

describe('useSwapsApiApproveAndBroadcast', () => {
  it('broadcasts the reset, waits for it, then approves — and reports both hashes and progress', async () => {
    approve.mockResolvedValue({ ok: true, value: { tx: APPROVE_TX, resetTx: RESET_TX } });
    const calls: string[] = [];
    const walletProvider = evmProvider(calls);
    const events: ApprovalProgress[] = [];

    const result = await run({
      body: body(ChainKeys.ARBITRUM_MAINNET),
      walletProvider,
      onProgress: (progress: ApprovalProgress) => events.push(progress),
    });

    expect(result).toEqual({ resetTxHash: RESET_HASH, approveTxHash: APPROVE_HASH });
    // The wait has to sit between the two sends; approving over an unconfirmed reset reverts.
    expect(calls).toEqual(['send:0xreset', `wait:${RESET_HASH}`, 'send:0xapprove', `wait:${APPROVE_HASH}`]);
    expect(events).toHaveLength(6);
    expect(events.at(-1)).toMatchObject({ step: 'approve', phase: 'confirmed', index: 2, total: 2 });
  });

  it('never sends the approve when the reset fails to confirm', async () => {
    approve.mockResolvedValue({ ok: true, value: { tx: APPROVE_TX, resetTx: RESET_TX } });
    const calls: string[] = [];
    const walletProvider = evmProvider(calls, hash => {
      if (hash === RESET_HASH) throw new Error('reset reverted');
    });

    await expect(run({ body: body(ChainKeys.ARBITRUM_MAINNET), walletProvider })).rejects.toThrow('reset reverted');

    // A retry is cheap — the allowance is untouched, so the next plan is a single transaction.
    expect(walletProvider.sendTransaction).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['send:0xreset', `wait:${RESET_HASH}`]);
  });

  it('never sends the approve when the reset is mined but reverts', async () => {
    approve.mockResolvedValue({ ok: true, value: { tx: APPROVE_TX, resetTx: RESET_TX } });
    const calls: string[] = [];
    // A paused or blacklisted token mines the reset and reverts it; the allowance never moved, so
    // the approve that follows is certain to revert too and would be paid for.
    const walletProvider = evmProvider(calls, hash => (hash === RESET_HASH ? 'reverted' : 'success'));

    await expect(run({ body: body(ChainKeys.ARBITRUM_MAINNET), walletProvider })).rejects.toThrow(
      /allowance reset transaction .* reverted/,
    );

    expect(walletProvider.sendTransaction).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['send:0xreset', `wait:${RESET_HASH}`]);
  });

  it('reports a reverted approve, whichever spelling of the status the provider returns', async () => {
    approve.mockResolvedValue({ ok: true, value: { tx: APPROVE_TX } });
    // `EvmWalletProvider` forwards viem's `'reverted'`; a provider reading the JSON-RPC receipt
    // directly returns `'0x0'`. Both mean the same thing.
    const walletProvider = evmProvider([], () => '0x0');

    await expect(run({ body: body(ChainKeys.ARBITRUM_MAINNET), walletProvider })).rejects.toThrow(
      /approve transaction .* reverted/,
    );
  });

  it('sends one transaction for an ordinary token, then re-checks the allowance through the same API', async () => {
    approve.mockResolvedValue({ ok: true, value: { tx: APPROVE_TX } });
    const calls: string[] = [];
    checkAllowance.mockImplementation(async () => {
      calls.push('check');
      return { ok: true, value: { valid: true } };
    });
    const walletProvider = evmProvider(calls);
    const apiConfig = { baseURL: 'https://api.example' };

    const result = await run({ body: body(ChainKeys.ARBITRUM_MAINNET), walletProvider, apiConfig });

    expect(result).toEqual({ approveTxHash: APPROVE_HASH });
    expect(calls).toEqual(['send:0xapprove', `wait:${APPROVE_HASH}`, 'check']);
    expect(checkAllowance).toHaveBeenCalledWith(body(ChainKeys.ARBITRUM_MAINNET), {
      ...apiConfig,
      timeout: expect.any(Number),
    });
    // Backend-built approvals are chain-bound: the runner must pass the source chain's id.
    expect(walletProvider.sendTransaction).toHaveBeenCalledWith(expect.anything(), {
      expectedChainId: getEvmViemChain(ChainKeys.ARBITRUM_MAINNET).id,
    });
  });

  it('works on the hub chain, not just EVM spokes', async () => {
    approve.mockResolvedValue({ ok: true, value: { tx: APPROVE_TX } });
    const walletProvider = evmProvider([]);

    const result = await run({ body: body(ChainKeys.SONIC_MAINNET), walletProvider });

    expect(result).toEqual({ approveTxHash: APPROVE_HASH });
  });

  it('signs a Stellar trustline through signAndSendTransaction', async () => {
    const trustlineTx = { unsignedTx: 'AAAA' };
    approve.mockResolvedValue({ ok: true, value: { tx: trustlineTx } });
    const walletProvider = {
      signAndSendTransaction: vi.fn().mockResolvedValue('stellar-hash'),
      waitForTransactionReceipt: vi.fn().mockResolvedValue({ successful: true }),
    };

    const result = await run({ body: body(ChainKeys.STELLAR_MAINNET), walletProvider });

    expect(result).toEqual({ approveTxHash: 'stellar-hash' });
    expect(walletProvider.signAndSendTransaction).toHaveBeenCalledWith(trustlineTx);
  });

  it('reports a Stellar trustline that Horizon records as unsuccessful', async () => {
    approve.mockResolvedValue({ ok: true, value: { tx: { unsignedTx: 'AAAA' } } });
    const walletProvider = {
      signAndSendTransaction: vi.fn().mockResolvedValue('stellar-hash'),
      waitForTransactionReceipt: vi.fn().mockResolvedValue({ successful: false }),
    };

    await expect(run({ body: body(ChainKeys.STELLAR_MAINNET), walletProvider })).rejects.toThrow(
      /approve transaction .* failed on chain/,
    );
  });

  it('names the missing capability when a Stellar wallet cannot sign', async () => {
    approve.mockResolvedValue({ ok: true, value: { tx: { unsignedTx: 'AAAA' } } });

    await expect(
      run({ body: body(ChainKeys.STELLAR_MAINNET), walletProvider: { waitForTransactionReceipt: vi.fn() } }),
    ).rejects.toThrow(/signAndSendTransaction/);
  });

  it('rejects a chain the swaps API cannot approve on', async () => {
    approve.mockResolvedValue({ ok: true, value: { tx: APPROVE_TX } });

    await expect(run({ body: body(ChainKeys.SOLANA_MAINNET), walletProvider: {} })).rejects.toThrow(
      /the hub \(Sonic\), EVM spokes, and Stellar/,
    );
  });

  it('awaits the allowance invalidation before resolving — a stale cache must not re-enable Approve', async () => {
    useSwapsApiApproveAndBroadcast();
    const order: string[] = [];
    // A macrotask, not a microtask: any resolution that happens without awaiting invalidateQueries
    // would land before this fires, so a regression here proves the mutation returned too early.
    invalidateQueries.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          setTimeout(() => {
            order.push('invalidate:done');
            resolve();
          }, 0);
        }),
    );

    await captured.onSuccess({ approveTxHash: APPROVE_HASH }, {}, undefined);
    order.push('onSuccess:resolved');

    // The hook owns confirmation now, so unlike useSwapsApiApprove it can refresh this itself.
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['swapsApi', 'allowance'] });
    expect(order).toEqual(['invalidate:done', 'onSuccess:resolved']);
  });
});
