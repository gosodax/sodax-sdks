import type { ChainKey } from '@sodax/dapp-kit';
import { type ReactNode, useState } from 'react';
import { chainName } from '../lib/chains';
import { formatTokenAmount } from '../lib/format';
import { AssetLogo } from './AssetLogo';

export type AssetPanelProps = {
  /** Undefined while the chain carries no token for this flow — the picker still opens. */
  symbol: string | undefined;
  chain: ChainKey;
  emptyLabel: string;
  pickerLabel: string;
  /** Rendered with `open`/`onClose`, so the panel owns the trigger and the picker owns the choosing. */
  picker: (state: { open: boolean; onClose: () => void }) => ReactNode;
  amount: string;
  amountLabel: string;
  /** Omitted on a receive leg, which shows a derived amount rather than taking one. */
  onAmountChange?: (value: string) => void;
  note?: ReactNode;
  locked?: boolean;
  /** Joins the network on the line under the symbol — what this side knows: a balance, a MAX action. */
  meta?: ReactNode;
};

/**
 * One side of a two-leg form, shaped like the `sodax.com/exchange/swap` currency panel: the asset
 * and its network on the left, the amount on the right, and the whole panel a picker trigger.
 */
export function AssetPanel({
  symbol,
  chain,
  emptyLabel,
  pickerLabel,
  picker,
  amount,
  amountLabel,
  onAmountChange,
  note,
  locked,
  meta,
}: AssetPanelProps) {
  const [isOpen, setOpen] = useState(false);

  return (
    <div className="asset-panel">
      <div className="asset-row">
        {/* The logo sits outside the trigger so the meta line can hold a MAX button, which cannot
            nest in one, and so the logo still centres across both lines. */}
        <div className="asset-identity">
          <AssetLogo symbol={symbol ?? '?'} chain={chain} />
          <div className="asset-id-text">
            <button
              type="button"
              className="asset-id"
              onClick={() => setOpen(true)}
              disabled={locked}
              aria-haspopup={locked ? undefined : 'dialog'}
              aria-label={pickerLabel}
            >
              <span className="asset-symbol">
                {symbol ?? emptyLabel}
                {!locked && (
                  <svg className="asset-chevron" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                )}
              </span>
            </button>
            <p className="asset-meta">
              <span className="asset-chain">{chainName(chain)}</span>
              {meta && (
                <>
                  <span aria-hidden="true">·</span>
                  {meta}
                </>
              )}
            </p>
          </div>
        </div>

        <span className="asset-amount">
          {onAmountChange ? (
            <input
              className="input amount"
              aria-label={amountLabel}
              inputMode="decimal"
              placeholder="0"
              value={amount}
              onChange={event => onAmountChange(event.target.value)}
            />
          ) : (
            <input
              className="input amount"
              aria-label={amountLabel}
              value={formatTokenAmount(amount)}
              title={amount}
              placeholder="0"
              readOnly
            />
          )}
          <span className="asset-note">{note}</span>
        </span>
      </div>

      {!locked && picker({ open: isOpen, onClose: () => setOpen(false) })}
    </div>
  );
}

export function FlipButton({ onClick, disabled = false }: { onClick: () => void; disabled?: boolean }) {
  return (
    <div className="flip">
      <button
        type="button"
        className="btn btn-icon flip-btn"
        onClick={onClick}
        disabled={disabled}
        aria-label="Reverse direction"
        title="Reverse direction"
      >
        {/* The exchange's switch mark: two short staggered arrows, not mirrored full-height twins. */}
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path
            d="M1.5 8.5L3.5 10.5L5.5 8.5M3.5 10.5V4.5M6.5 3.5L8.5 1.5L10.5 3.5M8.5 1.5V7.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
