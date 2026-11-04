/**
 * The leverage-yield API can return two approval transactions, and the second is only a valid state
 * transition once the first has been mined. That ordering is what this hook exists to own.
 *
 * `runApprovalPlan` itself — every chain family, every progress phase — is covered by the swaps and
 * bridge suites; this one pins what is leverage-yield-specific: the client method it asks for the
 * plan, that the ordering survives, that errors name THIS hook, and its own invalidation key.
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
  useSodaxContext: () => ({ sodax: { api: { leverageYield: { approve } } } }),
}));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries }) }));
vi.mock('../shared/useSafeMutation.js', () => ({
  // biome-ignore lint/suspicious/noExplicitAny: mirrors the real wrapper's opaque options bag.
  useSafeMutation: (options: any) => {
    captured = options;
    return {};
  },
}));

const { useLeverageYieldApiApproveAndBroadcast } = await import('./useLeverageYieldApiApproveAndBroadcast.js');

const RESET_TX = { from: '0x1', to: '0x2', value: 0n, data: '0xreset' };
const APPROVE_TX = { from: '0x1', to: '0x2', value: 0n, data: '0xapprove' };
const RESET_HASH = '0xreset-hash';
const APPROVE_HASH = '0xapprove-hash';

const VAULT = '0x6666666666666666666666666666666666666666';

const body = (srcChainKey: string) => ({
  vault: VAULT,
  srcChainKey,
  srcAddress: '0x1111111111111111111111111111111111111111',
  inputToken: '0xtoken',
  inputAmount: '1',
  minOutputAmount: '1',
});

/** Records the interleaving of sends and waits so ordering can be asserted, not assumed. */
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
  useLeverageYieldApiApproveAndBroadcast();
  return captured.mutationFn(vars);
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useLeverageYieldApiApproveAndBroadcast', () => {
  it('asks the leverage-yield client for the plan, passing the per-call apiConfig', async () => {
    approve.mockResolvedValue({ ok: true, value: { tx: APPROVE_TX } });
    const apiConfig = { baseURL: 'https://canary-api.example/v1' };

    await run({ body: body(ChainKeys.ARBITRUM_MAINNET), walletProvider: evmProvider([]), apiConfig });

    expect(approve).toHaveBeenCalledWith(body(ChainKeys.ARBITRUM_MAINNET), apiConfig);
  });

  it('broadcasts the reset, waits for it, then approves — and reports both hashes', async () => {
    approve.mockResolvedValue({ ok: true, value: { tx: APPROVE_TX, resetTx: RESET_TX } });
    const calls: string[] = [];

    const result = await run({ body: body(ChainKeys.ARBITRUM_MAINNET), walletProvider: evmProvider(calls) });

    expect(result).toEqual({ resetTxHash: RESET_HASH, approveTxHash: APPROVE_HASH });
    // The wait has to sit between the two sends; approving over an unconfirmed reset reverts. This is
    // the transaction `useLeverageYieldApiApprove` callers were dropping.
    expect(calls).toEqual(['send:0xreset', `wait:${RESET_HASH}`, 'send:0xapprove', `wait:${APPROVE_HASH}`]);
  });

  it('sends one transaction and omits resetTxHash for an ordinary token', async () => {
    approve.mockResolvedValue({ ok: true, value: { tx: APPROVE_TX } });
    const calls: string[] = [];

    const result = await run({ body: body(ChainKeys.ARBITRUM_MAINNET), walletProvider: evmProvider(calls) });

    expect(result).toEqual({ approveTxHash: APPROVE_HASH });
    expect(calls).toEqual(['send:0xapprove', `wait:${APPROVE_HASH}`]);
  });

  it('works on the hub chain, where a Sonic-sourced deposit signs its approval', async () => {
    approve.mockResolvedValue({ ok: true, value: { tx: APPROVE_TX } });

    const result = await run({ body: body(ChainKeys.SONIC_MAINNET), walletProvider: evmProvider([]) });

    expect(result).toEqual({ approveTxHash: APPROVE_HASH });
  });

  it('names this hook, not a sibling, in an error from the shared plan runner', async () => {
    // The runner is shared with the swaps and bridge hooks; a hard-coded prefix there would point a
    // leverage-yield integrator at the wrong hook.
    approve.mockResolvedValue({ ok: true, value: { tx: APPROVE_TX } });

    await expect(run({ body: body(ChainKeys.SOLANA_MAINNET), walletProvider: {} })).rejects.toThrow(
      /\[useLeverageYieldApiApproveAndBroadcast\].*cannot be approved/,
    );
  });

  it('reports each transaction as it is prompted for, numbered against the total', async () => {
    approve.mockResolvedValue({ ok: true, value: { tx: APPROVE_TX, resetTx: RESET_TX } });
    const events: ApprovalProgress[] = [];

    await run({
      body: body(ChainKeys.ARBITRUM_MAINNET),
      walletProvider: evmProvider([]),
      onProgress: (progress: ApprovalProgress) => events.push(progress),
    });

    expect(events.map(p => `${p.step}:${p.phase}:${p.index}/${p.total}`)).toEqual([
      'allowance-reset:signing:1/2',
      'allowance-reset:broadcast:1/2',
      'allowance-reset:confirmed:1/2',
      'approve:signing:2/2',
      'approve:broadcast:2/2',
      'approve:confirmed:2/2',
    ]);
  });

  it('invalidates the leverage-yield allowance query once the approval has confirmed', async () => {
    useLeverageYieldApiApproveAndBroadcast();

    await captured.onSuccess({ approveTxHash: APPROVE_HASH }, {}, undefined);

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['leverageYieldApi', 'allowance'] });
  });

  it('awaits the allowance refetch before resolving — a stale cache must not re-enable Approve', async () => {
    useLeverageYieldApiApproveAndBroadcast();
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
});
