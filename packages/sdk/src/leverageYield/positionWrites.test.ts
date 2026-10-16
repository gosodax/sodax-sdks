/**
 * The three high-level position writes, and the one thing that distinguishes them.
 *
 * `notifySolver` is what these exist to get right: skipping it on a leverage change loses the
 * operation silently, and calling it on a withdraw is noise. Nothing else enforces that, so it is
 * asserted here rather than left to the names.
 */

import { describe, expect, it, vi } from 'vitest';
import { ChainKeys, Sodax, SodaxError, type Result, type SpokeExecActionParams } from '../index.js';
import type {
  OpenPositionFromDebtTokenParams,
  OpenPositionParams,
  PositionFundingParams,
  PositionOperationParams,
} from './LeverageYieldService.js';
import type { TxHashPair } from '../shared/types/types.js';

const SODA_ETH = '0x4effb5813271699683c25c734f4dabc45b363709' as const;
const SODA_S = '0x62ecc3Eeb80a162c57624B3fF80313FE69f5203e' as const;

const HASHES: TxHashPair = {
  srcChainTxHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
  dstChainTxHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
};

const OPERATION = {
  params: {
    srcChainKey: ChainKeys.SONIC_MAINNET,
    srcAddress: '0x1468d3529032106291433B7e9e3026dF1Ff78F31',
    calls: [],
  },
  // Cast because every SDK call below is stubbed, so nothing ever reaches the provider.
  walletProvider: {} as never,
} satisfies Omit<
  SpokeExecActionParams<typeof ChainKeys.SONIC_MAINNET, false, PositionOperationParams<typeof ChainKeys.SONIC_MAINNET>>,
  'raw'
>;

const SONIC = ChainKeys.SONIC_MAINNET;
const FUNDING_BASE = {
  srcChainKey: SONIC,
  srcAddress: OPERATION.params.srcAddress,
  token: '0x0000000000000000000000000000000000000000',
  amount: 1n,
  eModeCategory: 0,
  minCollateralOut: 1n,
} satisfies PositionFundingParams<typeof SONIC>;

const OPEN_COLLATERAL = {
  params: { ...FUNDING_BASE, borrowToken: SODA_ETH, borrowAmount: 1n },
  walletProvider: OPERATION.walletProvider,
} satisfies Omit<SpokeExecActionParams<typeof SONIC, false, OpenPositionParams<typeof SONIC>>, 'raw'>;

const OPEN_DEBT = {
  params: { ...FUNDING_BASE, collateral: SODA_S, totalInput: 1n },
  walletProvider: OPERATION.walletProvider,
} satisfies Omit<
  Omit<SpokeExecActionParams<typeof SONIC, false, OpenPositionFromDebtTokenParams<typeof SONIC>>, 'raw'>,
  never
>;

const failure = (message: string) => new SodaxError('EXECUTION_FAILED', message, { feature: 'leverageYield' });

function stub(ok = true) {
  const sodax = new Sodax();
  const routed: Result<TxHashPair, SodaxError> = ok
    ? { ok: true, value: HASHES }
    : { ok: false, error: failure('routing failed') };
  const open = vi.spyOn(sodax.leverageYield, 'openPosition').mockResolvedValue(routed as never);
  const openDebt = vi.spyOn(sodax.leverageYield, 'openPositionFromDebtToken').mockResolvedValue(routed as never);
  const operate = vi.spyOn(sodax.leverageYield, 'operatePosition').mockResolvedValue(routed as never);
  const notify = vi
    .spyOn(sodax.leverageYield, 'notifySolver')
    .mockResolvedValue({ ok: true, value: { answer: 'OK', intent_hash: HASHES.dstChainTxHash } } as never);
  return { sodax, open, openDebt, operate, notify };
}

describe('openLeveragePosition', () => {
  it('routes the collateral side by default and reports the intent', async () => {
    const { sodax, open, openDebt, notify } = stub();
    const result = await sodax.leverageYield.openLeveragePosition(OPEN_COLLATERAL);
    expect(open).toHaveBeenCalledOnce();
    expect(openDebt).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith({ intent_tx_hash: HASHES.dstChainTxHash });
    expect(result.ok && result.value).toEqual({ txHashes: HASHES, notified: true });
  });

  it("takes the debt-side path on side: 'debt'", async () => {
    const { sodax, open, openDebt } = stub();
    await sodax.leverageYield.openLeveragePosition({ ...OPEN_DEBT, side: 'debt' });
    expect(openDebt).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
  });

  it('does NOT notify when the open itself failed — there is no intent to report', async () => {
    const { sodax, notify } = stub(false);
    const result = await sodax.leverageYield.openLeveragePosition(OPEN_COLLATERAL);
    expect(result.ok).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });

  it('still succeeds when the notification fails, because the money already moved', async () => {
    const { sodax, notify } = stub();
    notify.mockResolvedValue({ ok: false, error: failure('solver down') } as never);
    const result = await sodax.leverageYield.openLeveragePosition(OPEN_COLLATERAL);
    expect(result.ok).toBe(true);
    expect(result.ok && result.value).toMatchObject({ notified: false, notifyError: 'solver down' });
  });
});

describe('submitLeveragePositionIntent', () => {
  it('routes the calls and reports the HUB hash', async () => {
    const { sodax, operate, notify } = stub();
    const result = await sodax.leverageYield.submitLeveragePositionIntent(OPERATION);
    expect(operate).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith({ intent_tx_hash: HASHES.dstChainTxHash });
    expect(result.ok && result.value.notified).toBe(true);
  });

  it('does NOT notify when the routing failed', async () => {
    const { sodax, notify } = stub(false);
    expect((await sodax.leverageYield.submitLeveragePositionIntent(OPERATION)).ok).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('runLeveragePositionOperation', () => {
  it('NEVER notifies — this is the whole reason it is a separate method', async () => {
    // withdraw / settle / cancel are synchronous on the hub. A notification here is harmless noise,
    // but the method existing at all is what keeps a leverage change from taking this path.
    const { sodax, operate, notify } = stub();
    const result = await sodax.leverageYield.runLeveragePositionOperation(OPERATION);
    expect(operate).toHaveBeenCalledOnce();
    expect(notify).not.toHaveBeenCalled();
    expect(result.ok && result.value).toEqual(HASHES);
  });

  it('returns the hashes directly, not an intent result', async () => {
    const { sodax } = stub();
    const result = await sodax.leverageYield.runLeveragePositionOperation(OPERATION);
    expect(result.ok && 'notified' in result.value).toBe(false);
  });
});

describe('the intent / direct split is enforced by the compiler', () => {
  it('refuses a leverage change on the route-only path', () => {
    const sodax = new Sodax();
    const from = OPERATION.params.srcAddress as `0x${string}`;
    const add = sodax.leverageYield.buildAddLeverage({
      from,
      position: SODA_S,
      borrowAmount: 1n,
      minCollateralOut: 1n,
    });

    // The damaging mistake: routed here the intent is never reported and expires unfilled. If the
    // brand ever stops working this directive goes unused, which is itself a type error — so the
    // guard cannot rot into a comment.
    void sodax.leverageYield.runLeveragePositionOperation({
      params: {
        srcChainKey: SONIC,
        srcAddress: from,
        // @ts-expect-error PositionIntentCall is not a PositionDirectCall
        calls: [add],
      },
      walletProvider: OPERATION.walletProvider,
    });

    // The harmless direction still compiles, and it is not hypothetical: a settle riding along in an
    // intent batch is the settle-then-act sequence `PositionOperationParams.calls` exists for.
    const settle = sodax.leverageYield.buildSettlePosition({ from, position: SODA_S });
    void sodax.leverageYield.submitLeveragePositionIntent({
      params: { srcChainKey: SONIC, srcAddress: from, calls: [settle, add] },
      walletProvider: OPERATION.walletProvider,
    });
    expect(settle.to).toBe(SODA_S);
  });
});
