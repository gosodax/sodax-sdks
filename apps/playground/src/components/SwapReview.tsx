import type { ChainKey, XToken } from '@sodax/dapp-kit';
import { formatUnits } from 'viem';
import type { Execution } from '../hooks/useExecution';
import type { SwapFlow } from '../hooks/useSwapFlow';
import type { Activity } from '../lib/activity';
import { chainName, txExplorerUrl } from '../lib/chains';
import { formatTokenAmount } from '../lib/format';
import { STATUS_LABELS, failureMessage, progressLabel, refundAccounted } from '../lib/progress';
import { AssetLogo } from './AssetLogo';
import { CheckGlyph } from './CopyLabel';
import { Chevron } from './Dropdown';
import { Modal } from './Modal';
import { shortAddress } from './WalletControls';

function Spinner() {
  return (
    <svg className="spinner" viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="6" cy="6" r="4.25" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.3" />
      <path
        d="M6 1.75A4.25 4.25 0 1 1 1.75 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TimerGlyph() {
  return (
    <svg className="review-glyph" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 1.5h4M8 6.5V9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="9" r="5.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function DoneGlyph() {
  return (
    <svg className="review-glyph" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3 3.5L7.5 8L3 12.5M9 3.5L13.5 8L9 12.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** One side of the swap: the asset on its network, what it is worth, and whose wallet it moves in. */
function Leg({
  token,
  chain,
  amount,
  address,
  least = false,
  spent = false,
}: {
  token: XToken;
  chain: ChainKey;
  amount: string;
  address: string;
  /** The delivered amount is a floor, never a promise — the destination leg says so. */
  least?: boolean;
  spent?: boolean;
}) {
  return (
    <div className={spent ? 'review-leg review-leg-spent' : 'review-leg'}>
      <AssetLogo symbol={token.symbol} chain={chain} />
      <p className="review-leg-amount">
        {/* Reserved on both sides, empty or not, so the two amounts sit on one line. */}
        <span className="review-least muted">{least ? 'at least' : ''}</span>
        <span title={`${amount} ${token.symbol}`}>{formatTokenAmount(amount)}</span>{' '}
        <span className="muted">{token.symbol}</span>
      </p>
      <p className="review-leg-where">
        <span className="review-chip">{shortAddress(address)}</span>
        <span className="muted small">on {chainName(chain)}</span>
      </p>
    </div>
  );
}

/** One slot, one line: the failure first, then whatever makes tracking less than it looks. */
function reviewMessage(e: Execution): string | undefined {
  if (e.failed) return failureMessage(e.status);
  if (e.error) return e.error;
  if (!e.activity) return undefined;
  if (e.statusError) return 'Tracking is temporarily unavailable. Your transaction may still be processing.';
  if (!e.storageAvailable) return 'This browser blocked saving progress. Keep this page open until the swap settles.';
  return undefined;
}

/** `token`/`chain` are absent only in the degraded dialog, which always has a swap already sent. */
function ConfirmAction({ flow, token, chain }: { flow: SwapFlow; token?: XToken; chain?: ChainKey }) {
  const e = flow.execution;

  if (e.solved)
    return (
      <button type="button" className="btn btn-primary" onClick={e.closeReview}>
        Swap complete <CheckGlyph />
      </button>
    );

  // Clearing is explicit for a failure: closing keeps the record, because its hashes are what
  // support asks for and an Escape should not be the thing that discards them.
  if (e.failed)
    return (
      <button type="button" className="btn btn-primary" onClick={e.clearActivity}>
        Start a new swap
      </button>
    );

  // The deposit is broadcast and the relay has not taken it: resubmit that same transaction, never
  // sign a second one. Read from the record, so a reload cannot strand a swap only an error offered.
  if (e.activity && !e.phase && (e.error || !e.activity.relaySubmitted))
    return (
      <button type="button" className="btn btn-primary" onClick={e.retrySubmission}>
        Retry tracking
      </button>
    );

  const working = progressLabel(e.phase, e.status?.status) ?? (e.activity ? STATUS_LABELS.pending : undefined);
  if (working)
    return (
      <button type="button" className="btn btn-primary btn-working" disabled>
        {working} <Spinner />
      </button>
    );

  if (!token || !chain) return null;
  return (
    <button type="button" className="btn btn-primary" onClick={e.confirm}>
      Swap to {token.symbol} on {chainName(chain)}
    </button>
  );
}

/** The source deposit, and the fill once one exists: on a chain whether or not tracking works. */
function TransactionLinks({ e }: { e: Execution }) {
  if (!e.activity) return null;
  const fill = e.status?.result?.fillTxHash;
  return (
    <p className="review-links small">
      <a
        className="link"
        href={txExplorerUrl(e.activity.srcChainKey, e.activity.txHash)}
        target="_blank"
        rel="noreferrer"
      >
        Source transaction ↗
      </a>
      {fill && (
        <a className="link" href={txExplorerUrl(e.activity.dstChainKey, fill)} target="_blank" rel="noreferrer">
          Destination transaction ↗
        </a>
      )}
    </p>
  );
}

/**
 * The same dialog with the legs it cannot draw left out. A swap the live asset list cannot resolve —
 * because it has not loaded, or no longer carries the token — still has its summary, its status, its
 * resubmission and its hashes, and those are the parts a visitor needs when something has gone wrong.
 */
function RestoredSwap({ flow, activity }: { flow: SwapFlow; activity: Activity }) {
  const e = flow.execution;
  return (
    <div className="review">
      <p className="review-message" role="alert">
        {reviewMessage(e)}
      </p>
      <p className="review-restored">{activity.summary}</p>
      <p className="review-recipient small">
        <span className="muted">Receiving wallet</span>
        <span className="address-text">{activity.recipient}</span>
      </p>
      <ConfirmAction flow={flow} />
      <TransactionLinks e={e} />
      {e.failed && !refundAccounted(e.status) && (
        <a className="link review-support" href="https://support.sodax.com" target="_blank" rel="noreferrer">
          SODAX support ↗
        </a>
      )}
    </div>
  );
}

/**
 * The exchange's confirm dialog: both legs, the one action that carries the whole lifecycle, and the
 * numbers behind a disclosure. It stays open from confirmation to settlement — closing it early is
 * what once left a visitor watching a card behind the form.
 */
export function SwapReview({ flow }: { flow: SwapFlow }) {
  const e = flow.execution;
  const review = e.review;
  const problem = reviewMessage(e);
  // A sent swap the full snapshot cannot state is still shown, from the record's own summary: the
  // dialog is the only place a swap lives, so it degrading is the difference between that and none.
  const restored = !review && e.activity && !e.dismissed ? e.activity : undefined;

  return (
    <Modal title="Confirm swap" open={!!review || !!restored} onClose={e.closeReview} busy={!!e.phase} bare>
      {restored && <RestoredSwap flow={flow} activity={restored} />}
      {review && (
        <div className="review">
          {/* Always here, usually empty: a dialog mid-swap must not jump when a step reports back. */}
          <p className="review-message" role="alert">
            {problem}
          </p>
          <div className="review-legs">
            <Leg
              token={review.srcToken}
              chain={review.srcChain}
              amount={formatUnits(BigInt(review.intent.inputAmount), review.srcToken.decimals)}
              address={review.intent.srcAddress}
              spent={e.solved}
            />
            <div className="review-eta">
              {e.solved ? <DoneGlyph /> : <TimerGlyph />}
              <span className="muted small">
                {e.solved ? 'Done' : review.estimatedSeconds && `~${review.estimatedSeconds}s`}
              </span>
            </div>
            <Leg
              token={review.dstToken}
              chain={review.dstChain}
              amount={formatUnits(BigInt(review.intent.minOutputAmount), review.dstToken.decimals)}
              address={review.intent.dstAddress}
              least
            />
          </div>
          <p className="review-recipient small">
            <span className="muted">Receiving wallet</span>
            <span className="address-text">{review.intent.dstAddress}</span>
          </p>
          {/* The last screen before a signature, so it is the last place this can be said. Once the
              deposit is broadcast the warning is spent and the slot goes to the swap's own progress. */}
          {!e.activity && (
            <p className="muted small review-caution">
              This is a mainnet swap using real funds. Check the receiving wallet and minimum amount before confirming.
            </p>
          )}
          <ConfirmAction flow={flow} token={review.dstToken} chain={review.dstChain} />
          <TransactionLinks e={e} />
          {/* Offered only while the funds are unaccounted for: beside "your funds are back" it
              invents a problem, and a partner's frame sends their customer on as rarely as it can. */}
          {e.failed && !refundAccounted(e.status) && (
            <a className="link review-support" href="https://support.sodax.com" target="_blank" rel="noreferrer">
              SODAX support ↗
            </a>
          )}
          {!e.activity && (
            <details className="review-fees">
              <summary>
                {flow.partnerFee
                  ? `Total fees: ${formatTokenAmount(flow.partnerFeeAmount)} ${review.srcToken.symbol}`
                  : 'Swap details'}
                <Chevron up={false} className="review-chevron" />
              </summary>
              <div className="review-fees-rows">
                {flow.partnerFee && (
                  <div className="row-between">
                    <span className="muted">Swap fee ({flow.partnerFee.percentage / 100}%)</span>
                    <span>
                      {formatTokenAmount(flow.partnerFeeAmount)} {review.srcToken.symbol}
                    </span>
                  </div>
                )}
                <div className="row-between">
                  <span className="muted">Network fees</span>
                  <span>Confirmed in your wallet</span>
                </div>
                <div className="row-between">
                  <span className="muted">Via</span>
                  <span>SODAX API</span>
                </div>
              </div>
            </details>
          )}
        </div>
      )}
    </Modal>
  );
}
