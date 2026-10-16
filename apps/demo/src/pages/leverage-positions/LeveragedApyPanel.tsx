/**
 * Leveraged APY panel.
 *
 * Leverage multiplies the collateral's yield and adds the cost of the debt that bought it. Equity is
 * unchanged by levering, so per unit of equity:
 *
 *   net = supply x L  -  borrow x (L - 1)
 *
 * which is the same identity the vaults use (`LeverageYieldService.getApr` writes it as
 * `supply + (L-1) x (supply - borrow)`) — checked against that method's own documented example: supply
 * 6%, borrow 2%, multiplier 4 gives 22%. At L = 1 it collapses to the plain supply rate. Where supply
 * EQUALS borrow leverage is neutral, not break-even: the `(L-1)(supply - borrow)` term vanishes and net
 * stays at the supply rate for every L.
 *
 * WHY THE RATES ARE EDITABLE, and this is the part worth reading: the seeded values are AAVE's own
 * `supplyAPY` / `variableBorrowAPY` for the two reserves, and for these positions that is usually NOT
 * where the yield comes from. A loop like sUSDS against USSD earns its return from sUSDS appreciating
 * against USSD, which AAVE never sees — sodaSUSDS's liquidity rate is ~0 — so the on-chain number
 * reports the money-market spread alone and can read negative on a position that is actually
 * profitable. The vault APR has the same blind spot and solves it by fetching the LSD rate off-chain.
 * Until a position does the same, typing the real collateral yield here is how you model it honestly.
 *
 * Nothing here is advice about the future: these are current rates, and both float with utilisation.
 */

import React, { useMemo, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  type BreakevenInput,
  apyPctFromReserve,
  formatDuration,
  leveragedNetApyPct,
  timeToBreakevenYears,
} from './leveragedApyMath';

export { apyPctFromReserve, leveragedNetApyPct, timeToBreakevenYears, formatDuration, type BreakevenInput };

export function LeveragedApyPanel({
  supplyApyPct,
  borrowApyPct,
  leverage,
  collateralSymbol,
  borrowSymbol,
  /** Shown alongside the target, so a change is legible rather than just a new number. */
  currentLeverage,
  /**
   * Omit to hide the breakeven row. Only meaningful for a move that RAISES leverage: lowering it pays
   * the solver to reduce yield, so there is no payback period to report.
   */
  breakeven,
  /** Set when the caller already supplies a heading and a rule, so this does not repeat either. */
  embedded = false,
}: {
  supplyApyPct: number;
  borrowApyPct: number;
  leverage: number;
  collateralSymbol: string;
  borrowSymbol: string;
  currentLeverage?: number;
  breakeven?: BreakevenInput;
  embedded?: boolean;
}) {
  // Seeded from chain, overridable. Empty string means "follow the chain value" rather than zero, so
  // clearing the box returns to the real rate instead of silently modelling 0%.
  const [supplyOverride, setSupplyOverride] = useState('');
  const [borrowOverride, setBorrowOverride] = useState('');

  const supply = useMemo(() => {
    const n = Number(supplyOverride);
    return supplyOverride.trim() !== '' && Number.isFinite(n) ? n : supplyApyPct;
  }, [supplyOverride, supplyApyPct]);
  const borrow = useMemo(() => {
    const n = Number(borrowOverride);
    return borrowOverride.trim() !== '' && Number.isFinite(n) ? n : borrowApyPct;
  }, [borrowOverride, borrowApyPct]);

  const net = leveragedNetApyPct(supply, borrow, leverage);
  const netNow = currentLeverage === undefined ? undefined : leveragedNetApyPct(supply, borrow, currentLeverage);
  /**
   * Where leverage stops paying. Rearranging `net = supply + (L-1)(supply - borrow)` for net = 0 gives
   * `L = borrow / (borrow - supply)` — not `(borrow - supply) / borrow`, which is what this said first
   * and which put the crossing at 0.5x for supply 1% / borrow 2% instead of the correct 2x.
   *
   * Three regimes, and the middle one is easy to mislabel: above `borrow` the collateral out-earns the
   * debt so more leverage is always better; EQUAL means leverage is neutral, not harmful, because the
   * `(L-1)(supply - borrow)` term vanishes and net stays at the supply rate whatever L is; below it,
   * every extra turn costs and the crossing is finite.
   */
  const zeroCrossing =
    supply > borrow ? 'never' : supply === borrow ? 'neutral' : ((borrow / (borrow - supply)) as number | string);

  // Recomputed from the edited rates, not the seeded ones, so typing the real collateral yield moves
  // the payback period too — that is the whole point of the rates being editable.
  const breakevenYears = breakeven && timeToBreakevenYears(supply, borrow, leverage, breakeven);

  return (
    <div className={embedded ? 'space-y-2' : 'space-y-2 border-t pt-2'}>
      {!embedded && <div className="text-xs font-medium">Leveraged APY</div>}

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-[10px]">{collateralSymbol || 'Collateral'} APY %</Label>
          <Input
            value={supplyOverride}
            placeholder={supplyApyPct.toFixed(4)}
            onChange={e => setSupplyOverride(e.target.value)}
            spellCheck={false}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px]">{borrowSymbol || 'Debt'} borrow APY %</Label>
          <Input
            value={borrowOverride}
            placeholder={borrowApyPct.toFixed(4)}
            onChange={e => setBorrowOverride(e.target.value)}
            spellCheck={false}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <span className="text-muted-foreground">Supply return</span>
        <span className="text-right font-mono text-xs">{(supply * leverage).toFixed(3)}%</span>
        <span className="text-muted-foreground">Borrow cost</span>
        <span className="text-right font-mono text-xs">−{(borrow * Math.max(leverage - 1, 0)).toFixed(3)}%</span>
        {netNow !== undefined && (
          <>
            <span className="text-muted-foreground">Current net APY ({currentLeverage?.toFixed(2)}x)</span>
            <span className="text-right font-mono text-xs">{netNow.toFixed(3)}%</span>
          </>
        )}
        <span className="text-muted-foreground font-medium">
          Net APY {netNow !== undefined ? 'after' : 'at'} {leverage.toFixed(2)}x
        </span>
        <span className={`text-right font-mono text-xs font-medium ${net < 0 ? 'text-negative' : ''}`}>
          {net.toFixed(3)}%
        </span>
        <span className="text-muted-foreground">Negative above</span>
        <span className="text-right font-mono text-xs">
          {zeroCrossing === 'never'
            ? 'never — collateral out-earns the debt'
            : zeroCrossing === 'neutral'
              ? 'never — leverage is neutral here'
              : `above ${(zeroCrossing as number).toFixed(2)}x`}
        </span>
        {breakeven !== undefined && (
          <>
            <span className="text-muted-foreground">Opening spread</span>
            <span className="text-right font-mono text-xs">
              ${breakeven.costUsd.toFixed(4)}
              <span className="text-muted-foreground">
                {' '}
                ({((breakeven.costUsd / breakeven.equityUsd) * 100).toFixed(2)}% of equity)
              </span>
            </span>
            <span className="text-muted-foreground font-medium">Break-even time</span>
            <span className="text-right font-mono text-xs font-medium">
              {breakevenYears === undefined
                ? '—'
                : breakevenYears === 'immediate'
                  ? 'immediate — the quote beat parity'
                  : breakevenYears === 'never'
                    ? 'never at these rates'
                    : formatDuration(breakevenYears)}
            </span>
          </>
        )}
      </div>

      <div className="text-[10px] text-muted-foreground">
        Starts from current money-market APYs. Edit the collateral APY if the asset earns yield outside the pool, such
        as sUSDS against USSD.
        {breakeven !== undefined && (
          <> Break-even includes the opening spread; closing usually pays a similar spread again.</>
        )}
      </div>
    </div>
  );
}
