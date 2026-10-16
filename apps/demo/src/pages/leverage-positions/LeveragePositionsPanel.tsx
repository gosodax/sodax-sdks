/**
 * Leverage Positions panel.
 *
 * The unpooled counterpart to the vault flow on this page. A vault is one shared ERC-4626
 * position at a single target LTV; a leverage position is one AAVE account per user, so an
 * owner can hold several at different eMode categories and leverage tiers at once.
 *
 * Each row is a full lifecycle: health, adjust leverage in either direction, and close. Writes go
 * through the wallet router so they execute as the hub wallet that owns the position — see
 * `useHubWalletRoute`.
 *
 * Controls are gated on the position's own pending flag rather than local state, because a position
 * permits one intent at a time and that state changes without the user acting (a solver fills, or the
 * intent expires).
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  useReservesUsdFormat,
  useLeveragePositionAccount,
  useLeveragePositionInfo,
  useLeveragePositionPending,
  type SpokeChainKey,
} from '@sodax/dapp-kit';
import { AdjustLeverageControl } from './AdjustLeverageControl';
import { ClosePositionControl } from './ClosePositionControl';
import { PendingOperationControl } from './PendingOperationControl';
import { HandCoins, Layers, ListTree, ShieldCheck, TrendingUp } from 'lucide-react';
import { fmtBps, fmtHealthFactor } from '@/lib/utils';
import { DetailGrid, DetailRow, Disclosure, SummaryTile, SummaryTiles, healthTone } from './PositionSummary';
import { formatUnits, type Address } from 'viem';
import { DUST_BASE } from './constants';

/**
 * Pool oracle base currency is 8 decimals on the Sodax fork.
 * Source of truth if that ever changes: `priceOracle.BASE_CURRENCY_UNIT()`, 1e8 today.
 */
const BASE_CURRENCY_DECIMALS = 8;

/**
 * Base-currency amounts read as bare numbers before — `0.1` next to `0` says nothing about what
 * either one is. The pool's base currency is USD on this fork, and the create card already prices in
 * it, so the two halves of the page now agree.
 */
function fmtBase(value: bigint): string {
  const amount = Number(formatUnits(value, BASE_CURRENCY_DECIMALS));
  if (amount > 0 && amount < 0.01) return '<$0.01';
  return `$${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function PositionRow({
  chain,
  position,
  owner,
  hidden,
  onEmptyChange,
}: {
  chain: SpokeChainKey;
  position: Address;
  owner: Address | undefined;
  /** Collapse this row when it is empty. The parent owns the toggle; the row owns the verdict. */
  hidden: boolean;
  onEmptyChange: (position: Address, isEmpty: boolean) => void;
}) {
  const { data: account, isLoading, error } = useLeveragePositionAccount({ params: { position } });
  const { data: info } = useLeveragePositionInfo({ params: { position } });
  const { data: slot } = useLeveragePositionPending({ params: { position } });
  const { data: reserves } = useReservesUsdFormat();

  /**
   * The pair is what tells two positions apart, and the row used to lead with the position address
   * instead — an identifier that distinguishes nothing a reader can act on.
   */
  const pair = useMemo(() => {
    const symbolFor = (token: Address | undefined) =>
      token && reserves?.find(r => r.underlyingAsset.toLowerCase() === token.toLowerCase())?.symbol;
    const collateral = symbolFor(info?.collateral);
    const borrow = symbolFor(info?.borrowToken);
    return collateral && borrow ? `${collateral} → ${borrow}` : undefined;
  }, [reserves, info?.collateral, info?.borrowToken]);

  /**
   * Empty means "nothing here and nothing owed and nothing in flight" — a closed position, which stays
   * in `positionsOf` forever because the registry is append-only.
   *
   * THE PENDING CHECK IS NOT OPTIONAL. A debt-side open before its fill has zero collateral AND zero
   * debt while the position is holding the user's contribution as a plain balance — collapsing that
   * would hide real money behind a toggle. Any occupied slot, live or awaiting settle, keeps the row
   * visible. A settled position has already had its idle balance swept, so by then empty is really empty.
   */
  const isEmpty =
    !!account &&
    Number(formatUnits(account.totalCollateralBase, BASE_CURRENCY_DECIMALS)) < DUST_BASE &&
    Number(formatUnits(account.totalDebtBase, BASE_CURRENCY_DECIMALS)) < DUST_BASE &&
    !slot?.isLive &&
    !slot?.needsSettle;

  React.useEffect(() => {
    onEmptyChange(position, isEmpty);
  }, [position, isEmpty, onEmptyChange]);

  if (isEmpty && hidden) return null;
  // healthTone takes a plain number; the value is only compared against thresholds, so precision
  // loss on the no-debt sentinel is immaterial.
  const health = account ? healthTone(Number(formatUnits(account.healthFactor, 18))) : undefined;
  // Leverage is collateral over equity, which is the one number that says what this position IS.
  const collateralBase = account ? Number(formatUnits(account.totalCollateralBase, BASE_CURRENCY_DECIMALS)) : 0;
  const debtBase = account ? Number(formatUnits(account.totalDebtBase, BASE_CURRENCY_DECIMALS)) : 0;
  const equityBase = collateralBase - debtBase;
  const currentLeverage = equityBase > 0 ? collateralBase / equityBase : undefined;

  return (
    <div className="rounded-md border p-2 sm:p-3 space-y-2">
      {/* Pair and leverage lead, because together they are what the position IS. The address is an
          identifier, so it is demoted to the smallest muted thing on the row. */}
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-sm font-semibold">{pair ?? 'Position'}</span>
          <span
            className={`shrink-0 rounded-full border px-1.5 py-px font-mono text-[10px] font-semibold ${
              isEmpty ? 'text-muted-foreground' : ''
            }`}
          >
            {isEmpty ? 'closed' : currentLeverage !== undefined ? `${currentLeverage.toFixed(2)}x` : '—'}
          </span>
        </div>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground" title={position}>
          {position.slice(0, 6)}…{position.slice(-4)}
        </span>
      </div>
      {isLoading && <div className="text-xs text-muted-foreground">Loading position…</div>}
      {error && <div className="text-xs text-negative break-all">{error.message}</div>}
      {account && (
        <SummaryTiles>
          <SummaryTile
            icon={Layers}
            label="Collateral"
            value={fmtBase(account.totalCollateralBase)}
            hint="value held"
            emphasis
            info="Everything the position holds, priced by the pool oracle."
          />
          <SummaryTile
            icon={HandCoins}
            label="Debt"
            value={fmtBase(account.totalDebtBase)}
            hint="borrowed"
            info="What it owes the pool. Value minus debt is yours."
          />
          <SummaryTile
            icon={ShieldCheck}
            label="Health"
            value={fmtHealthFactor(account.healthFactor)}
            hint={health?.label}
            className={health?.className}
            tone={health?.tone}
            info="Liquidation happens below 1.00."
          />
        </SummaryTiles>
      )}
      {/* Shown whenever the slot is occupied, not only while the intent is live — a
          resolved-but-unswept position is precisely the state that needs settling, and it would
          otherwise be invisible. */}
      {(slot?.isLive || slot?.needsSettle) && (
        <PendingOperationControl
          chain={chain}
          position={position}
          owner={owner}
          slot={slot}
          collateralToken={info?.collateral}
          borrowToken={info?.borrowToken}
        />
      )}
      {account && info && (
        <>
          {/* Folded: adjusting is the rarer of the two actions, and its slider plus projection table
              was the bulk of a row's height even for someone only here to check on a position. */}
          <Disclosure
            icon={TrendingUp}
            title="Adjust leverage"
            summary={currentLeverage !== undefined ? `now ${currentLeverage.toFixed(2)}x` : undefined}
          >
            <AdjustLeverageControl
              chain={chain}
              position={position}
              account={account}
              collateralToken={info.collateral}
              borrowToken={info.borrowToken}
              owner={owner}
              pending={!!slot?.isLive}
            />
          </Disclosure>
          <ClosePositionControl
            chain={chain}
            position={position}
            account={account}
            collateralToken={info.collateral}
            borrowToken={info.borrowToken}
            owner={owner}
            pending={!!slot?.isLive}
          />
          <Disclosure icon={ListTree} title="Details">
            <DetailGrid>
              <DetailRow
                label="LTV"
                value={`${fmtBps(account.ltv)} of ${fmtBps(account.currentLiquidationThreshold)}`}
                info="Debt over collateral, against the threshold this position is liquidated at."
              />
              <DetailRow label="Collateral token" value={`${info.collateral.slice(0, 10)}…`} />
              <DetailRow label="Debt token" value={`${info.borrowToken.slice(0, 10)}…`} />
              <DetailRow label="Position address" value={<span className="break-all">{position}</span>} />
            </DetailGrid>
          </Disclosure>
        </>
      )}
    </div>
  );
}

export function LeveragePositionsPanel({
  chain,
  positions,
  error,
  owner,
}: {
  chain: SpokeChainKey;
  /** Discovered by the page, which needs the count to decide whether this column exists at all. */
  positions: readonly Address[] | undefined;
  error: Error | null;
  owner: Address | undefined;
}) {
  // Closed positions are never removed from the factory's registry, so without this the list only ever
  // grows. Hidden by default, with a count, and revealable — a filter you cannot switch off is a way to
  // lose track of something.
  const [showEmpty, setShowEmpty] = useState(false);
  const [empties, setEmpties] = useState<Record<string, boolean>>({});
  const onEmptyChange = useCallback((position: Address, isEmpty: boolean) => {
    setEmpties(prev => (prev[position] === isEmpty ? prev : { ...prev, [position]: isEmpty }));
  }, []);
  const emptyCount = (positions ?? []).filter(p => empties[p]).length;
  const activeCount = (positions ?? []).length - emptyCount;

  return (
    <Card className="w-full max-w-xl mx-auto">
      <CardHeader className="px-4 sm:px-6">
        <CardTitle className="text-lg font-bold">Your positions</CardTitle>
        <CardDescription>Review health, adjust leverage, or close an open position.</CardDescription>
      </CardHeader>
      <CardContent className="px-4 sm:px-6 space-y-3">
        {/* The empty and loading states are the page's business now: with nothing to show there is no
            column, and it centres on the form instead. An error still has to surface somewhere. */}
        {error && (
          <div className="space-y-1">
            <div className="text-sm text-negative break-all">{error.message}</div>
            <div className="text-xs text-muted-foreground">
              Missing <code>leverageYield.positionFactory</code> in Sodax config.
            </div>
          </div>
        )}
        {positions && positions.length > 0 && (activeCount === 0 || emptyCount > 0) && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              {activeCount} open{emptyCount > 0 && `, ${emptyCount} closed`}
            </span>
            {emptyCount > 0 && (
              <Button size="sm" variant="outline" onClick={() => setShowEmpty(v => !v)}>
                <span className="text-[10px]">{showEmpty ? 'Hide closed' : `Show closed (${emptyCount})`}</span>
              </Button>
            )}
          </div>
        )}
        {positions?.map(p => (
          <PositionRow
            key={p}
            chain={chain}
            position={p}
            owner={owner}
            hidden={!showEmpty}
            onEmptyChange={onEmptyChange}
          />
        ))}
      </CardContent>
    </Card>
  );
}
