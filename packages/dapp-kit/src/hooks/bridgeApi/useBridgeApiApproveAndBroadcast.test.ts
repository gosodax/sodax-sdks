/**
 * The bridge API can return two approval transactions, and the second is only a valid state
 * transition once the first has been mined. That ordering is what this hook exists to own.
 *
 * Follows the package convention of testing hooks without a renderer: the React Query wrapper is
 * mocked so `mutationFn` can be captured and driven directly.
 */

import { ChainKeys } from '@sodax/sdk';
import type { ApprovalProgress } from '../../utils/approvalPlan.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const approve = vi.fn();
const invalidateQueries = vi.fn();

// biome-ignore lint/suspicious/noExplicitAny: the captured mutation options are driven directly.
let captured: any;

vi.mock('../shared/useSodaxContext.js', () => ({
  useSodaxContext: () => ({ sodax: { api: { bridge: { approve } } } }),
}));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries }) }));
vi.mock('../shared/useSafeMutation.js', () => ({
  // biome-ignore lint/suspicious/noExplicitAny: mirrors the real wrapper's opaque options bag.
  useSafeMutation: (options: any) => {
    captured = options;
    return {};
  },
}));

const { useBridgeApiApproveAndBroadcast } = await import('./useBridgeApiApproveAndBroadcast.js');

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

const onEvent = (sink: ApprovalProgress[]) => (progress: ApprovalProgress) => {
  sink.push(progress);
};

/** Compact rendering, so a sequence can be asserted as one readable list. */
const trace = (p: ApprovalProgress): string => `${p.step}:${p.phase}:${p.index}/${p.total}`;

/** One render, then the captured `mutationFn` invoked with `vars`. */
// biome-ignore lint/suspicious/noExplicitAny: vars mirror the hook's generic mutation variables.
const run = (vars: any) => {
  useBridgeApiApproveAndBroadcast();
  return captured.mutationFn(vars);
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useBridgeApiApproveAndBroadcast', () => {
  it('broadcasts the reset, waits for it, then approves — and reports both hashes', async () => {
    approve.mockResolvedValue({ ok: true, value: { tx: APPROVE_TX, resetTx: RESET_TX } });
    const calls: string[] = [];
    const walletProvider = evmProvider(calls);

    const result = await run({ body: body(ChainKeys.ARBITRUM_MAINNET), walletProvider });

    expect(result).toEqual({ resetTxHash: RESET_HASH, approveTxHash: APPROVE_HASH });
    // The wait has to sit between the two sends; approving over an unconfirmed reset reverts.
    expect(calls).toEqual(['send:0xreset', `wait:${RESET_HASH}`, 'send:0xapprove', `wait:${APPROVE_HASH}`]);
  });

  it('never sends the approve when the reset is mined but reverts', async () => {
    approve.mockResolvedValue({ ok: true, value: { tx: APPROVE_TX, resetTx: RESET_TX } });
    const calls: string[] = [];
    const walletProvider = evmProvider(calls, hash => (hash === RESET_HASH ? 'reverted' : 'success'));

    await expect(run({ body: body(ChainKeys.ARBITRUM_MAINNET), walletProvider })).rejects.toThrow(
      /allowance reset transaction .* reverted on chain/,
    );

    // Mined is not succeeded: the allowance never moved, so the approve would revert too.
    expect(walletProvider.sendTransaction).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['send:0xreset', `wait:${RESET_HASH}`]);
  });

  it('sends one transaction and omits resetTxHash for an ordinary token', async () => {
    approve.mockResolvedValue({ ok: true, value: { tx: APPROVE_TX } });
    const calls: string[] = [];
    const walletProvider = evmProvider(calls);

    const result = await run({ body: body(ChainKeys.ARBITRUM_MAINNET), walletProvider });

    expect(result).toEqual({ approveTxHash: APPROVE_HASH });
    expect(calls).toEqual(['send:0xapprove', `wait:${APPROVE_HASH}`]);
  });

  it('works on the hub chain, not just EVM spokes', async () => {
    // Bridge approves the caller's own hub wallet router on Sonic — a different spender to swaps,
    // but the same EVM broadcast path, so the hub must not fall through to the unsupported branch.
    approve.mockResolvedValue({ ok: true, value: { tx: APPROVE_TX } });
    const calls: string[] = [];

    const result = await run({ body: body(ChainKeys.SONIC_MAINNET), walletProvider: evmProvider(calls) });

    expect(result).toEqual({ approveTxHash: APPROVE_HASH });
  });

  it('signs a Stellar trustline through signAndSendTransaction', async () => {
    approve.mockResolvedValue({ ok: true, value: { tx: APPROVE_TX } });
    const walletProvider = {
      signAndSendTransaction: vi.fn(async () => APPROVE_HASH),
      waitForTransactionReceipt: vi.fn(async () => ({ successful: true })),
    };

    const result = await run({ body: body(ChainKeys.STELLAR_MAINNET), walletProvider });

    expect(result).toEqual({ approveTxHash: APPROVE_HASH });
    expect(walletProvider.signAndSendTransaction).toHaveBeenCalledOnce();
  });

  it('reports a Stellar trustline that Horizon records as unsuccessful', async () => {
    approve.mockResolvedValue({ ok: true, value: { tx: APPROVE_TX } });
    const walletProvider = {
      signAndSendTransaction: vi.fn(async () => APPROVE_HASH),
      waitForTransactionReceipt: vi.fn(async () => ({ successful: false })),
    };

    await expect(run({ body: body(ChainKeys.STELLAR_MAINNET), walletProvider })).rejects.toThrow(
      /approve transaction .* failed on chain/,
    );
  });

  it('rejects a chain the bridge API cannot approve on', async () => {
    approve.mockResolvedValue({ ok: true, value: { tx: APPROVE_TX } });

    await expect(run({ body: body(ChainKeys.SOLANA_MAINNET), walletProvider: {} })).rejects.toThrow(
      /cannot be approved/,
    );
  });

  it('names this hook, not the swaps one, in an error from the shared plan runner', async () => {
    // The runner is shared with useSwapsApiApproveAndBroadcast; a hard-coded prefix there would
    // point a bridge integrator at the wrong hook.
    approve.mockResolvedValue({ ok: true, value: { tx: APPROVE_TX } });

    await expect(run({ body: body(ChainKeys.SOLANA_MAINNET), walletProvider: {} })).rejects.toThrow(
      /\[useBridgeApiApproveAndBroadcast\]/,
    );
  });

  it('invalidates the bridge allowance query once the approval has confirmed', async () => {
    useBridgeApiApproveAndBroadcast();

    await captured.onSuccess({ approveTxHash: APPROVE_HASH }, {}, undefined);

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['bridgeApi', 'allowance'] });
  });

  it('awaits the allowance refetch before resolving — a stale cache must not re-enable Approve', async () => {
    useBridgeApiApproveAndBroadcast();
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

    expect(order).toEqual(['invalidate:done', 'onSuccess:resolved']);
  });

  describe('onProgress', () => {
    it('walks each transaction through its phases, numbered against the total', async () => {
      approve.mockResolvedValue({ ok: true, value: { tx: APPROVE_TX, resetTx: RESET_TX } });
      const events: ApprovalProgress[] = [];

      await run({
        body: body(ChainKeys.ARBITRUM_MAINNET),
        walletProvider: evmProvider([]),
        onProgress: onEvent(events),
      });

      expect(events.map(trace)).toEqual([
        'allowance-reset:signing:1/2',
        'allowance-reset:broadcast:1/2',
        'allowance-reset:confirmed:1/2',
        'approve:signing:2/2',
        'approve:broadcast:2/2',
        'approve:confirmed:2/2',
      ]);
      // The first report lands before the first wallet prompt, so "1/2" is on screen when it opens.
      expect(events[0]?.phase).toBe('signing');
    });

    it('carries the hash from broadcast onwards', async () => {
      approve.mockResolvedValue({ ok: true, value: { tx: APPROVE_TX } });
      const events: ApprovalProgress[] = [];

      await run({
        body: body(ChainKeys.ARBITRUM_MAINNET),
        walletProvider: evmProvider([]),
        onProgress: onEvent(events),
      });

      expect(events.map(trace)).toEqual(['approve:signing:1/1', 'approve:broadcast:1/1', 'approve:confirmed:1/1']);
      expect(events.map(e => e.hash)).toEqual([undefined, APPROVE_HASH, APPROVE_HASH]);
    });

    it('ends the failing step as failed, with its error, and reports nothing after it', async () => {
      approve.mockResolvedValue({ ok: true, value: { tx: APPROVE_TX, resetTx: RESET_TX } });
      const events: ApprovalProgress[] = [];
      const walletProvider = evmProvider([], hash => (hash === RESET_HASH ? 'reverted' : 'success'));

      await expect(
        run({ body: body(ChainKeys.ARBITRUM_MAINNET), walletProvider, onProgress: onEvent(events) }),
      ).rejects.toThrow(/reverted on chain/);

      expect(events.map(trace)).toEqual([
        'allowance-reset:signing:1/2',
        'allowance-reset:broadcast:1/2',
        'allowance-reset:failed:1/2',
      ]);
      const failed = events.at(-1) as ApprovalProgress;
      expect(failed.error).toBeInstanceOf(Error);
      // Broadcast before it failed, so the hash is the one thing a user can still look up.
      expect(failed.hash).toBe(RESET_HASH);
    });

    it('survives a listener that throws — reporting must never cost the user a transaction', async () => {
      approve.mockResolvedValue({ ok: true, value: { tx: APPROVE_TX, resetTx: RESET_TX } });

      const result = await run({
        body: body(ChainKeys.ARBITRUM_MAINNET),
        walletProvider: evmProvider([]),
        onProgress: () => {
          throw new Error('UI bug');
        },
      });

      expect(result).toEqual({ resetTxHash: RESET_HASH, approveTxHash: APPROVE_HASH });
    });
  });
});
