/**
 * Close-position control.
 *
 * Closing means clearing the debt, and clearing the debt means selling collateral through a solver —
 * so it is never one transaction, and the UI is shaped around that rather than hiding it. What the
 * user gets to choose is which asset they leave with:
 *
 *   EXIT INTO COLLATERAL — sell only as much collateral as the debt is worth, then withdraw the rest.
 *     Two steps, and the withdrawal can pay out to any address, so it goes to the signer's own wallet.
 *
 *   EXIT INTO THE DEBT TOKEN — sell the whole collateral balance in one go. The solver delivers more
 *     debt token than is owed, the hook repays the debt and leaves the surplus in the position, and
 *     `settle` sweeps it to the position's owner. That is the natural exit for someone who arrived
 *     from the debt side and wants the same asset back rather than the collateral.
 *
 * Both are the same `decreaseLeverage` call; the difference is only how much collateral it sells.
 *
 * Phases are driven by the position's own state rather than local flags, so a reload or a fill that
 * lands while the page is closed picks up where it left off:
 *
 *   1. debt > 0      → sell collateral to repay it
 *   2. debt == 0     → withdraw whatever collateral is left (nothing to do after a full exit)
 *
 * WHY A FULL EXIT CANNOT HALF-HAPPEN: the hook repays the debt and then withdraws all the collateral
 * to pay the solver. If the delivered amount fell short of the debt, that withdrawal would leave debt
 * standing against no collateral, and the pool's health-factor check rejects it — the whole fill
 * reverts and the position is untouched. So a full exit either clears the debt or does nothing, which
 * is also why this blocks rather than posts when the quote would not cover the debt.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, DoorOpen, Info } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  useLeveragePositionInfo,
  useSodaxContext,
  useReservesUsdFormat,
  useLeveragePositionCollateral,
  type LeveragePositionAccount,
  type SpokeChainKey,
} from '@sodax/dapp-kit';
import { formatUnits, parseUnits, type Address } from 'viem';
import { getReadableTxError } from '@/lib/utils';
import {
  useLeveragePositionPayoutAddress,
  useRunPositionOperation,
  useSubmitPositionIntent,
} from './useHubWalletRoute';
import { useLegQuote } from './useLegQuote';
import { Notice } from './PositionSummary';
import { DUST_BASE } from './constants';

/**
 * Sell slightly more collateral than the debt is worth. Debt accrues interest between quoting and
 * filling, and the swap itself can come in under quote — repaying a hair too much just leaves the
 * remainder as collateral to withdraw in phase 2, whereas repaying too little leaves dust debt that
 * blocks the withdrawal entirely. Doubles as the margin the full exit's coverage check must clear.
 */
const REPAY_OVERSHOOT = 1.01;
/**
 * Health factor to leave the position at when debt outlives the repay leg. The pool only demands
 * 1.0, but that is the liquidation line itself, and what is being kept back is worth fractions of a
 * cent — there is nothing to win by cutting it fine.
 */
const WITHDRAW_TARGET_HF = 2;
/** "The whole aToken balance", which also sidesteps naming an exact amount against a rebasing one. */
const MAX_UINT256 = 2n ** 256n - 1n;

type ExitAsset = 'collateral' | 'debt';

/**
 * `getUserAccountData` reports base-currency amounts with 8 decimals on the Sodax fork.
 * Source of truth if that ever changes: `priceOracle.BASE_CURRENCY_UNIT()`, 1e8 today.
 */
const BASE_DP = 8;

function toNumber(base: bigint): number {
  return Number(base) / 10 ** BASE_DP;
}

export function ClosePositionControl({
  chain,
  position,
  account,
  collateralToken,
  borrowToken,
  owner,
  pending,
}: {
  chain: SpokeChainKey;
  position: Address;
  account: LeveragePositionAccount;
  collateralToken: Address;
  borrowToken: Address;
  owner: Address | undefined;
  pending: boolean;
}) {
  const { sodax } = useSodaxContext();
  // Deduped with the panel's own call by React Query; what it is here for is `feeBps`.
  const { data: info } = useLeveragePositionInfo({ params: { position } });
  const queryClient = useQueryClient();
  const { route, signer } = useRunPositionOperation(chain);
  const submitIntent = useSubmitPositionIntent(chain);
  // Not the signer: off the hub, the signer's address is not one the hub could pay out to.
  const payoutAddress = useLeveragePositionPayoutAddress({
    params: { chainKey: chain, signerAddress: signer as Address | undefined, owner },
  });
  /**
   * Which of the user's two addresses the payout lands at. `withdraw` takes a destination, so on the
   * hub it can be their own; anywhere else it has to be the hub wallet, and those are not the same
   * address. Saying "your address" when it is the other one is how a withdrawal looks lost.
   */
  const payoutIsSigner = !!payoutAddress && !!signer && payoutAddress.toLowerCase() === signer.toLowerCase();
  const { data: reserves } = useReservesUsdFormat();
  // The exact aToken balance, which is the only thing that can size "sell everything" — the account
  // snapshot's base-currency collateral divided by a price lands near the balance, not on it, and
  // asking for more than the position holds expires as an unfillable intent.
  const { data: held } = useLeveragePositionCollateral({ params: { position, collateral: collateralToken } });

  const [exit, setExit] = useState<ExitAsset>('collateral');
  const [slippagePct, setSlippagePct] = useState(1);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();

  const reserveFor = useCallback(
    (token: Address) => reserves?.find(r => r.underlyingAsset.toLowerCase() === token.toLowerCase()),
    [reserves],
  );
  const collateralReserve = useMemo(() => reserveFor(collateralToken), [reserveFor, collateralToken]);
  const borrowReserve = useMemo(() => reserveFor(borrowToken), [reserveFor, borrowToken]);

  /**
   * The token a full exit is delivered in — the debt reserve's own underlying, so exiting "to USSD"
   * hands over USSD rather than sodaUSSD. The hook unwraps and sends it to the owner's own address on
   * their origin chain, the same route a refund takes.
   *
   * `undefined` when the reserve IS the underlying (nothing to unwrap) or when the pair is not in the
   * registry; the surplus then stays in the position for `settle` to sweep, which is the old behaviour
   * and never worse than it.
   */
  const exitDelivery = useMemo(() => {
    // Resolved against the user's OWN chain, not from the hub asset alone. Delivery off-hub goes through
    // the AssetManager, which only moves assets registered for the destination — and one hub reserve can
    // back different registered assets per chain, so a chain-agnostic lookup can name one the
    // destination has never heard of. Matching on the reserve within this chain's own token list keeps
    // the asset and the destination in step.
    const onThisChain = sodax.moneyMarket
      .getSupportedTokensByChainId(chain)
      .find(t => t.vault?.toLowerCase() === borrowToken.toLowerCase());
    const asset = onThisChain?.hubAsset as Address | undefined;
    if (!asset || asset.toLowerCase() === borrowToken.toLowerCase()) return undefined;
    // The symbol travels with the address on purpose. The solver is quoted and pays in the RESERVE
    // (sodaUSSD); the hook unwraps that into this asset before it reaches you. Labelling the exit with
    // the reserve's symbol described the intermediate step rather than what lands in your wallet.
    return { asset, symbol: onThisChain?.symbol ?? 'the debt token' };
  }, [sodax, chain, borrowToken]);
  const exitAsset = exitDelivery?.asset;
  /** What a full exit actually delivers: the native asset when it is unwrapped, else the reserve. */
  const exitSymbol = exitDelivery?.symbol ?? borrowReserve?.symbol ?? 'the debt token';

  const collateral = toNumber(account.totalCollateralBase);
  const debt = toNumber(account.totalDebtBase);
  const phase = debt > DUST_BASE ? 'repay' : collateral > DUST_BASE ? 'withdraw' : 'closed';
  const fullExit = exit === 'debt';
  /**
   * `DUST_BASE` decides the phase; the pool does not round. A position owing a fraction of a cent
   * reaches the withdraw phase still owing it, and that is a different withdrawal.
   */
  const hasResidualDebt = account.totalDebtBase > 0n;

  /**
   * How much can actually leave. `MAX_UINT256` empties the aToken balance, and the pool rejects that
   * outright while ANY debt is outstanding: the health check runs on what is left behind, and debt
   * with no collateral behind it is a health factor of zero.
   *
   * Not hypothetical — this is the revert. `DUST_BASE` routes a position owing well under a cent
   * into this phase, where "Withdraw everything" failed with nothing to show for it but "External
   * call failed". With debt outstanding, keep enough collateral to hold `WITHDRAW_TARGET_HF` and
   * send the rest; only a genuinely debt-free position withdraws whole.
   */
  const withdrawAmount = useMemo((): bigint | undefined => {
    if (!hasResidualDebt) return MAX_UINT256;
    if (!collateralReserve || held?.balance === undefined) return undefined;
    const price = Number(collateralReserve.priceInUSD);
    const liquidationThreshold = Number(account.currentLiquidationThreshold) / 10_000;
    if (!(price > 0) || !(liquidationThreshold > 0)) return undefined;
    const keepBase = (debt * WITHDRAW_TARGET_HF) / liquidationThreshold;
    const outBase = collateral - keepBase;
    if (!(outBase > 0)) return 0n;
    const tokens = parseUnits((outBase / price).toFixed(collateralReserve.decimals), collateralReserve.decimals);
    return tokens > held.balance ? held.balance : tokens;
  }, [hasResidualDebt, collateralReserve, held?.balance, account.currentLiquidationThreshold, debt, collateral]);
  /** What stays behind, for the copy. Zero unless debt survived the repay leg. */
  const keptBackBase = useMemo(() => {
    if (!hasResidualDebt) return 0;
    const liquidationThreshold = Number(account.currentLiquidationThreshold) / 10_000;
    if (!(liquidationThreshold > 0)) return collateral;
    return Math.min((debt * WITHDRAW_TARGET_HF) / liquidationThreshold, collateral);
  }, [hasResidualDebt, account.currentLiquidationThreshold, debt, collateral]);

  /**
   * THIS position's fee, which on an exit is collateral given up ON TOP of what the solver is paid.
   * So the position must hold `input x (1 + fee)`, and sizing the input at the whole balance leaves
   * nothing for the fee — the operation cannot settle. Read from the position, not from config: it is
   * fixed at creation, so what a new position would carry is not what this one does.
   */
  const feeBps = BigInt(info?.feeBps ?? 0);

  /** Collateral to sell, in collateral-token units: the whole balance for a full exit, else the debt's worth. */
  const repayInput = useMemo(() => {
    if (phase !== 'repay') return undefined;
    // Leave room for the fee: what is handed over is the input, what leaves is input + fee.
    if (fullExit) return held?.balance === undefined ? undefined : (held.balance * 10_000n) / (10_000n + feeBps);
    if (!collateralReserve) return undefined;
    const price = Number(collateralReserve.priceInUSD);
    if (!(price > 0)) return undefined;
    const feeMultiple = 1 + Number(feeBps) / 10_000;
    const needed = Math.min((debt * REPAY_OVERSHOOT) / price, collateral / (price * feeMultiple));
    return parseUnits(needed.toFixed(collateralReserve.decimals), collateralReserve.decimals);
  }, [phase, fullExit, held, collateralReserve, debt, collateral, feeBps]);

  // The repay leg sells collateral for the borrow token, so quote it for real: the floor has to be
  // what the solver will pay, and a pair it does not support must fail here rather than as a silent
  // expiry that leaves the position stuck mid-close.
  const legQuote = useLegQuote({
    inputHubToken: phase === 'repay' ? collateralToken : undefined,
    outputHubToken: phase === 'repay' ? borrowToken : undefined,
    amount: repayInput,
  });

  /** Slippage floor, off the quoted output — the two legs are different tokens. */
  const minOut = useMemo(() => {
    if (!legQuote.data) return undefined;
    const floor = (legQuote.data.outputAmount * BigInt(Math.round((100 - slippagePct) * 100))) / 10_000n;
    return floor > 0n ? floor : 1n;
  }, [legQuote.data, slippagePct]);

  /**
   * Debt in borrow-token units, with the interest margin — what a full exit's fill has to deliver for
   * the pool to let the hook take the collateral. Oracle math, so approximate; it gates the button
   * rather than setting the floor, and the pool is the real enforcement either way.
   */
  const debtToCover = useMemo(() => {
    if (!fullExit || !borrowReserve) return undefined;
    const price = Number(borrowReserve.priceInUSD);
    if (!(price > 0)) return undefined;
    return parseUnits(((debt * REPAY_OVERSHOOT) / price).toFixed(borrowReserve.decimals), borrowReserve.decimals);
  }, [fullExit, borrowReserve, debt]);

  /** A full exit that would not clear the debt cannot fill at all — see the header note. */
  const shortOfDebt = fullExit && !!minOut && !!debtToCover && minOut < debtToCover;

  const onRepay = useCallback(async () => {
    if (!owner || !repayInput || !legQuote.data || !minOut) return;
    setBusy(true);
    setError(undefined);
    setStatus(undefined);
    try {
      const tx = sodax.leverageYield.buildDecreaseLeverage({
        from: owner,
        position,
        collateralIn: repayInput,
        minDebtOut: minOut,
        // Only a full exit produces a surplus, so only that case asks for delivery. A partial repay has
        // nothing left over and the argument is ignored on-chain either way.
        ...(fullExit && exitAsset ? { exitAsset } : {}),
      });
      const result = await submitIntent({ calls: [tx] });
      const posted = fullExit
        ? exitAsset
          ? `Posted. After fill, debt is repaid and the remainder arrives as ${exitSymbol}.`
          : `Posted. After fill, debt is repaid; settle to sweep the remaining ${legQuote.data.outputSymbol}.`
        : 'Posted. After the fill, withdraw the remaining collateral.';
      setStatus(
        result.notified
          ? posted
          : `Posted, but the solver rejected the notification: ${result.error}. It will expire and can then be cancelled.`,
      );
      await queryClient.invalidateQueries({ queryKey: ['leverageYield'] });
    } catch (e) {
      setError(getReadableTxError(e));
    } finally {
      setBusy(false);
    }
  }, [
    owner,
    repayInput,
    legQuote.data,
    minOut,
    fullExit,
    exitAsset,
    exitSymbol,
    sodax,
    position,
    submitIntent,
    queryClient,
  ]);

  const onWithdraw = useCallback(async () => {
    if (!owner || !payoutAddress) return;
    setBusy(true);
    setError(undefined);
    setStatus(undefined);
    try {
      if (withdrawAmount === undefined || withdrawAmount === 0n) throw new Error('Nothing can be withdrawn yet');
      const tx = sodax.leverageYield.buildPositionWithdraw({
        from: owner,
        position,
        amount: withdrawAmount,
        to: payoutAddress,
      });
      const { dstChainTxHash } = await route([tx]);
      setStatus(
        `Withdrawn as ${collateralReserve?.symbol ?? 'the reserve token'} to ${payoutAddress} (${dstChainTxHash.slice(0, 10)}…)`,
      );
      await queryClient.invalidateQueries({ queryKey: ['leverageYield'] });
    } catch (e) {
      setError(getReadableTxError(e));
    } finally {
      setBusy(false);
    }
  }, [owner, payoutAddress, sodax, position, route, queryClient, withdrawAmount, collateralReserve?.symbol]);

  if (phase === 'closed') {
    return <div className="text-xs text-muted-foreground">Position is empty.</div>;
  }

  return (
    <div className="space-y-2 border-t pt-2">
      <div className="flex items-center gap-1 text-xs font-semibold">
        <DoorOpen className="h-3 w-3 text-muted-foreground" />
        Close
      </div>

      {phase === 'repay' && (
        <>
          <div className="flex gap-1">
            {(
              [
                ['collateral', `Keep ${collateralReserve?.symbol ?? 'collateral'}`],
                ['debt', `Exit to ${exitSymbol}`],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                // Selection marked by border and weight rather than by fill, so it reads as a choice
                // rather than competing with the solid submit button below it.
                className={`flex-1 ${
                  exit === value ? 'border-primary bg-secondary font-semibold' : 'text-muted-foreground'
                }`}
                size="sm"
                variant="outline"
                onClick={() => setExit(value)}
              >
                <span className="text-[10px]">{label}</span>
              </Button>
            ))}
          </div>

          <div className="text-[10px] text-muted-foreground">
            {fullExit ? (
              <>
                Sells all collateral to repay {debt.toFixed(2)} of debt. Any excess returns as {exitSymbol} —
                {exitAsset ? ' sent to your address on the funding chain.' : ' left in the position until you settle.'}{' '}
                Funds move after the solver fills.
              </>
            ) : (
              <>
                Step 1 of 2: sell enough collateral to repay {debt.toFixed(2)} of debt. Withdraw the rest after the
                fill.
              </>
            )}
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <span className="text-muted-foreground">Selling</span>
            <span className="text-right font-mono text-xs">
              {repayInput !== undefined
                ? `${Number(formatUnits(repayInput, collateralReserve?.decimals ?? 18)).toLocaleString(undefined, {
                    maximumFractionDigits: 6,
                  })} ${collateralReserve?.symbol ?? ''}`
                : fullExit
                  ? 'Reading balance…'
                  : '—'}
            </span>
            <span className="text-muted-foreground">Solver quote</span>
            <span className="text-right font-mono text-xs">
              {legQuote.isLoading
                ? 'quoting…'
                : legQuote.data
                  ? `${Number(formatUnits(legQuote.data.outputAmount, legQuote.data.outputDecimals)).toLocaleString(
                      undefined,
                      { maximumFractionDigits: 6 },
                    )} ${legQuote.data.outputSymbol}`
                  : '—'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs whitespace-nowrap">Max slippage</span>
            <input
              type="range"
              className="min-w-0 flex-1"
              min={0.1}
              max={5}
              step={0.1}
              value={slippagePct}
              onChange={e => setSlippagePct(Number(e.target.value))}
            />
            <span className="font-mono text-xs w-8 text-right">{slippagePct.toFixed(1)}</span>
          </div>
          {legQuote.error && (
            <div className="text-xs text-negative break-all">
              No solver quote for this pair: {legQuote.error.message}.
            </div>
          )}
          {shortOfDebt && (
            <div className="text-xs text-negative">
              This quote does not cover the debt. Tighten slippage, or keep collateral and withdraw what remains.
            </div>
          )}
          <Button
            className="h-auto min-h-9 w-full whitespace-normal text-center"
            size="sm"
            disabled={!repayInput || !legQuote.data || legQuote.isLoading || busy || !owner || pending || shortOfDebt}
            onClick={onRepay}
          >
            {busy
              ? 'Posting intent…'
              : pending
                ? 'An operation is already in flight'
                : legQuote.isLoading
                  ? 'Quoting…'
                  : fullExit
                    ? `Exit to ${exitSymbol}`
                    : 'Step 1: repay all debt'}
          </Button>
        </>
      )}

      {phase === 'withdraw' && (
        <>
          {hasResidualDebt ? (
            <Notice tone="warn" icon={AlertTriangle}>
              A little debt survived the repay leg, and the pool will not let collateral drop below it. This withdraws
              what it can and leaves about ${keptBackBase.toFixed(4)} behind to keep the position solvent.
            </Notice>
          ) : (
            <div className="text-[10px] text-muted-foreground">
              Debt is repaid. Withdraw the remaining {collateral.toFixed(2)} of collateral.
            </div>
          )}
          {/* Two things a withdrawal does not do on its own, and both were left to be discovered:
              it pays out the RESERVE token rather than the underlying, and on a spoke it pays the
              hub wallet rather than the address you signed with. */}
          <Notice icon={Info}>
            Arrives as {collateralReserve?.symbol ?? 'the reserve token'} — an ERC-20 your wallet will not list until
            you add it — at {payoutIsSigner ? 'your own address' : 'your hub wallet'}{' '}
            <span className="font-mono">
              {payoutAddress ? `${payoutAddress.slice(0, 6)}…${payoutAddress.slice(-4)}` : '—'}
            </span>
            . Unwrapping it back to the underlying is a separate step.
          </Notice>
          <Button
            className="h-auto min-h-9 w-full whitespace-normal text-center"
            size="sm"
            disabled={
              busy || !owner || !payoutAddress || pending || withdrawAmount === undefined || withdrawAmount === 0n
            }
            onClick={onWithdraw}
          >
            {busy
              ? 'Withdrawing…'
              : pending
                ? 'An operation is already in flight'
                : withdrawAmount === 0n
                  ? 'The debt leaves nothing to withdraw'
                  : hasResidualDebt
                    ? 'Withdraw what the debt allows'
                    : 'Withdraw everything'}
          </Button>
        </>
      )}

      {status && <div className="text-xs text-cherry-soda break-all">{status}</div>}
      {error && <div className="text-xs text-negative break-all">{error}</div>}
    </div>
  );
}
