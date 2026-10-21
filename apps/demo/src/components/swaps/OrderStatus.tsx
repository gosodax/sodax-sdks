import React, { useEffect, useMemo, useState } from 'react';
import {
  isAuthFailure,
  useDetailedStatus,
  useLeverageYieldDetailedStatus,
  useSodaxContext,
  useSwapsApiSubmitTxStatus,
  type SpokeChainKey,
  type UseDetailedStatusResult,
  type UseLeverageYieldDetailedStatusResult,
} from '@sodax/dapp-kit';
import { formatUnits } from 'viem';
import { ArrowRight, Check, Copy, ExternalLink, X } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn, getChainExplorerTxUrl, statusCodeToMessage } from '@/lib/utils';
import { getChainIcon, getChainName } from '@/constants';
import { sodaxScanSearchUrl } from '@/lib/sodaxScan';
import { useSolverStatus } from '@/hooks/useSolverStatus';
import { useAppStore } from '@/zustand/useAppStore';

/** One side of a swap, for the "AMOUNT TOKEN (NETWORK)" summary. `chain` is a chain key. */
export type OrderLeg = { amount: string; symbol: string; chain: string };
export type OrderSummary = { from: OrderLeg; to: OrderLeg };
export type LinkRef = { label: string; href: string };
export type DetailRowData = { label: string; value: string; links?: LinkRef[] };

/** Cached terminal snapshot — once set, the card renders statically with no polling/fetch. */
export type FinalStatus = { label: string; error?: string; extraRows?: DetailRowData[] };

// Orders carry only JSON-safe scalars so the whole history can be persisted to localStorage
// (no bigint, no SDK objects). While pending, status is fetched in-component from the stored
// hash; on settle it is snapshotted into `final` so a reload renders it with zero requests.
export type SolverOrder = {
  mode: 'solver';
  intentHash: string;
  orderId: string;
  dstTxHash: string;
  srcTxHash?: string;
  srcChainKey?: string;
  /** Solver API endpoint of the env this order was created on — status is polled against it. */
  statusEndpoint?: string;
  createdAt?: number;
  summary: OrderSummary;
  final?: FinalStatus;
};

export type SubmitTxOrder = {
  mode: 'submit-tx';
  txHash: string;
  srcChainKey: string;
  createdAt?: number;
  summary: OrderSummary;
  final?: FinalStatus;
};

export type Order = SolverOrder | SubmitTxOrder;

/** Stable identity for an order — used for list keys, dismissal, and settle updates. */
export function orderId(order: Order): string {
  return order.mode === 'solver' ? order.intentHash : order.txHash;
}

/** Limit to 6 fractional digits and drop trailing zeros for a compact display amount. */
function formatAmount(raw: string): string {
  const [int, frac] = raw.split('.');
  if (!frac) {
    return int;
  }
  const trimmed = frac.slice(0, 6).replace(/0+$/, '');
  return trimmed ? `${int}.${trimmed}` : int;
}

/** Build the "AMOUNT TOKEN (NETWORK)" summary for an order at creation time. */
export function buildOrderSummary(
  src: { chain: string; token?: { symbol: string } },
  dst: { chain: string; token?: { symbol: string; decimals: number } },
  inputAmount: string,
  quotedAmount?: bigint,
): OrderSummary {
  return {
    from: { amount: formatAmount(inputAmount), symbol: src.token?.symbol ?? '', chain: src.chain },
    to: {
      amount: quotedAmount !== undefined ? formatAmount(formatUnits(quotedAmount, dst.token?.decimals ?? 0)) : '',
      symbol: dst.token?.symbol ?? '',
      chain: dst.chain,
    },
  };
}

type StatusTone = 'green' | 'amber' | 'red' | 'gray';

const TONE: Record<StatusTone, { pill: string; accent: string; dot: string }> = {
  green: { pill: 'bg-emerald-100 text-emerald-700', accent: 'border-l-emerald-400', dot: 'bg-emerald-500' },
  amber: { pill: 'bg-amber-100 text-amber-700', accent: 'border-l-amber-400', dot: 'bg-amber-500 animate-pulse' },
  red: { pill: 'bg-red-100 text-red-700', accent: 'border-l-red-400', dot: 'bg-red-500' },
  gray: { pill: 'bg-gray-100 text-gray-600', accent: 'border-l-gray-300', dot: 'bg-gray-400' },
};

// Only states that never change again. NOT_FOUND / error / *_NOT_FINISHED are transient (the solver
// returns NOT_FOUND for a few seconds before it indexes a fresh intent), so they must keep polling —
// caching them would freeze the card on a stale status.
const TERMINAL_LABELS = new Set(['SOLVED', 'FAILED', 'solved', 'failed']);

function toneFromLabel(label: string): StatusTone {
  if (label === 'SOLVED' || label === 'solved') {
    return 'green';
  }
  if (label === 'FAILED' || label === 'NOT_FOUND' || label === 'failed' || label === 'error') {
    return 'red';
  }
  if (label === 'pending' || label === 'NOT_STARTED_YET' || label === 'STARTED_NOT_FINISHED') {
    return 'amber';
  }
  return 'gray';
}

/** Absolute timestamp as "DD/MM HH:mm". */
function formatDateTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Middle-ellipsis for long hashes and big numeric ids; leaves chain keys / short values intact. */
function shorten(value: string): string {
  const isHash = /^0x[0-9a-fA-F]{12,}$/.test(value);
  const isLongNumber = /^\d{12,}$/.test(value);
  if (isHash || isLongNumber) {
    return `${value.slice(0, 6)}…${value.slice(-4)}`;
  }
  return value;
}

// Both links are built directly from the hash — no fetch. SodaxScan's /messages/search page
// resolves the hash client-side, so we never call its CORS-locked API.
function txLinks(chainKey: string | undefined, txHash: string, scan = false): LinkRef[] {
  const links: LinkRef[] = [];
  const explorer = chainKey ? getChainExplorerTxUrl(chainKey, txHash) : undefined;
  if (explorer) {
    links.push({ label: getChainName(chainKey ?? '') ?? 'Explorer', href: explorer });
  }
  if (scan) {
    links.push({ label: 'SodaxScan', href: sodaxScanSearchUrl(txHash) });
  }
  return links;
}

/** The always-present detail rows, rebuilt from the order's own scalars. */
function baseRows(order: Order): DetailRowData[] {
  if (order.mode === 'solver') {
    // `intentHash` (solver's `intent_hash`) is the same value as `dstTxHash` — the solver echoes the
    // intent tx hash back — so only the Intent Tx row is shown (with Sonic-hub + SodaxScan links).
    const rows: DetailRowData[] = [{ label: 'Order ID', value: order.orderId }];
    if (order.srcTxHash) {
      // Src Tx → its own source-chain explorer; SodaxScan (per message) lives on the Intent Tx row.
      rows.push({ label: 'Src Tx', value: order.srcTxHash, links: txLinks(order.srcChainKey, order.srcTxHash) });
    }
    // Intent settles on the Sonic hub; link only to SodaxScan (drop the chain explorer).
    rows.push({
      label: 'Intent Tx',
      value: order.dstTxHash,
      links: [{ label: 'SodaxScan', href: sodaxScanSearchUrl(order.dstTxHash) }],
    });
    return rows;
  }
  return [{ label: 'Tx Hash', value: order.txHash, links: txLinks(order.srcChainKey, order.txHash, true) }];
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard unavailable (insecure context) — no-op
    }
  };
  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={copied ? 'Copied' : 'Copy to clipboard'}
      className="shrink-0 text-cherry-grey/60 transition-colors hover:text-cherry-soda"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function ChainAsset({ leg, approx }: { leg: OrderLeg; approx?: boolean }) {
  const name = getChainName(leg.chain) ?? leg.chain;
  const icon = getChainIcon(leg.chain);
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span className="font-semibold text-cherry-dark">
        {approx && leg.amount ? '≈ ' : ''}
        {leg.amount || '—'} {leg.symbol}
      </span>
      {icon ? (
        <img src={icon} alt={name} title={name} className="h-4 w-4 rounded-full" />
      ) : (
        <span className="text-[11px] text-muted-foreground">({name})</span>
      )}
    </span>
  );
}

function DetailRow({ label, value, links }: DetailRowData) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      <div className="flex min-w-0 items-center gap-1.5">
        <span title={value} className="truncate font-mono text-xs text-cherry-dark">
          {shorten(value)}
        </span>
        <CopyButton value={value} />
        {links?.map(link => (
          <a
            key={link.label}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-0.5 text-[10px] font-medium text-cherry-soda hover:underline"
          >
            {link.label}
            <ExternalLink className="h-3 w-3" />
          </a>
        ))}
      </div>
    </div>
  );
}

/** Pure presentational card (no hooks); per-row links are built by the caller. */
function OrderCard({
  title,
  label,
  summary,
  rows,
  error,
  createdAt,
  onDismiss,
}: {
  title: string;
  label: string;
  summary: OrderSummary;
  rows: DetailRowData[];
  error?: string;
  createdAt?: number;
  onDismiss?: () => void;
}) {
  const tone = TONE[toneFromLabel(label)];
  return (
    <Card className={cn('w-full shrink-0 overflow-hidden border-l-4', tone.accent)}>
      <div className="flex items-center justify-between gap-2 border-b border-cherry-grey/10 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className={cn('h-2 w-2 rounded-full', tone.dot)} />
          <span className="text-sm font-semibold text-cherry-dark">{title}</span>
          {createdAt && (
            <span className="text-[10px] text-muted-foreground" title={new Date(createdAt).toLocaleString()}>
              {formatDateTime(createdAt)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold', tone.pill)}
          >
            {label}
          </span>
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Dismiss order"
              className="text-cherry-grey/60 transition-colors hover:text-cherry-dark"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      <div className="space-y-2.5 px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
          <ChainAsset leg={summary.from} />
          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-cherry-grey/60" />
          <ChainAsset leg={summary.to} approx />
        </div>
        <div className="space-y-1.5 border-t border-cherry-grey/10 pt-2">
          {rows.map(row => (
            <DetailRow key={row.label} {...row} />
          ))}
        </div>
        {error && <div className="break-words text-xs text-red-500">{error}</div>}
      </div>
    </Card>
  );
}

type SettleFn = (id: string, final: FinalStatus) => void;

/** A terminal, cached order renders statically — the guard also narrows `final` to non-optional. */
function isSettled(order: Order): order is Order & { final: FinalStatus } {
  return !!order.final && TERMINAL_LABELS.has(order.final.label);
}

/** Renders a settled order from its cached snapshot — no status polling, no network. */
function StaticOrderCard({
  order,
  title,
  onDismiss,
}: {
  order: Order & { final: FinalStatus };
  title: string;
  onDismiss?: () => void;
}) {
  const final = order.final;
  return (
    <OrderCard
      title={title}
      label={final.label}
      summary={order.summary}
      rows={[...baseRows(order), ...(final.extraRows ?? [])]}
      error={final.error}
      createdAt={order.createdAt}
      onDismiss={onDismiss}
    />
  );
}

function SolverLiveCard({
  order,
  title,
  onDismiss,
  onSettle,
}: {
  order: SolverOrder;
  title: string;
  onDismiss?: () => void;
  onSettle: SettleFn;
}) {
  const { sodax } = useSodaxContext();
  const endpoint = order.statusEndpoint ?? sodax.config.solver.solverApiEndpoint;
  const { data: status } = useSolverStatus(order.dstTxHash, endpoint);

  const label = status ? statusCodeToMessage(status.status) : 'pending';

  const isTerminal = TERMINAL_LABELS.has(label);
  useEffect(() => {
    if (isTerminal) {
      onSettle(order.intentHash, { label });
    }
  }, [isTerminal, label, order.intentHash, onSettle]);

  return (
    <OrderCard
      title={title}
      label={label}
      summary={order.summary}
      rows={baseRows(order)}
      createdAt={order.createdAt}
      onDismiss={onDismiss}
    />
  );
}

type SubmitTxData = NonNullable<ReturnType<typeof useSwapsApiSubmitTxStatus>['data']>;
/** The record, not the response envelope — the detailed-status backend arm carries this same shape. */
type SubmitTxRecord = SubmitTxData['data'];

/** Derives label / error / terminal-only rows from a BES submit-tx status record. */
function deriveSubmitTx(record: SubmitTxRecord | undefined): {
  label: string;
  error?: string;
  extraRows: DetailRowData[];
} {
  const extraRows: DetailRowData[] = [];
  if (!record) {
    return { label: 'pending', extraRows };
  }
  const { status, result, failedAtStep, failureReason, userMessage } = record;
  if (status === 'solved' && result?.dstIntentTxHash) {
    extraRows.push({ label: 'Dst Intent Tx', value: result.dstIntentTxHash });
  }
  if (status === 'solved' && result?.intent_hash) {
    extraRows.push({ label: 'Intent Hash', value: result.intent_hash });
  }
  const error =
    status === 'failed'
      ? [failedAtStep && `Failed at: ${failedAtStep}`, failureReason && `Reason: ${failureReason}`, userMessage]
          .filter(Boolean)
          .join(' · ') || undefined
      : undefined;
  return { label: status, error, extraRows };
}

function SubmitTxLiveCard({
  order,
  title,
  onDismiss,
  onSettle,
}: {
  order: SubmitTxOrder;
  title: string;
  onDismiss?: () => void;
  onSettle: SettleFn;
}) {
  const { data: statusResponse } = useSwapsApiSubmitTxStatus({
    params: { txHash: order.txHash, srcChainKey: order.srcChainKey },
  });

  // Derive once (memoized on the React-Query data ref) and reuse in both render and the settle effect.
  const derived = useMemo(() => deriveSubmitTx(statusResponse?.data), [statusResponse]);
  const { label, error, extraRows } = derived;
  useEffect(() => {
    if (TERMINAL_LABELS.has(derived.label)) {
      onSettle(order.txHash, { label: derived.label, error: derived.error, extraRows: derived.extraRows });
    }
  }, [derived, order.txHash, onSettle]);

  return (
    <OrderCard
      title={title}
      label={label}
      summary={order.summary}
      rows={[...baseRows(order), ...extraRows]}
      error={error}
      createdAt={order.createdAt}
      onDismiss={onDismiss}
    />
  );
}

/**
 * Derives the card fields from a `getDetailedStatus` read. The two arms speak different vocabularies
 * — the backend record's string statuses and the solver's numeric codes — and both are terminal
 * labels this panel already knows. A failed read stays `pending`: the hook keeps polling it, and the
 * ones that never resolve are stopped by its own NOT_FOUND budget, not by this card. A rejected API
 * key also stops the hook, so it carries an error — otherwise the card would sit on `pending` silently.
 */
function deriveDetailed(read: UseDetailedStatusResult | UseLeverageYieldDetailedStatusResult): {
  label: string;
  error?: string;
  extraRows: DetailRowData[];
} {
  if (!read?.ok) {
    return read && isAuthFailure(read.error)
      ? { label: 'pending', error: 'Status read rejected the API key — fix it in Settings and reload.', extraRows: [] }
      : { label: 'pending', extraRows: [] };
  }
  if (read.value.source === 'backend') {
    return deriveSubmitTx(read.value.data);
  }
  const { status, fill_tx_hash } = read.value.data;
  return {
    label: statusCodeToMessage(status),
    extraRows: fill_tx_hash ? [{ label: 'Fill Tx', value: fill_tx_hash }] : [],
  };
}

/**
 * The vault-swap card. `useLeverageYieldDetailedStatus` keys on the SOURCE tx and routes to whichever
 * source can answer — the backend submit-tx record while it is in play, the solver once it is not —
 * so one card covers both transports, including a vault swap the client-side fallback completed.
 * `SolverLiveCard` cannot: it polls one hub tx hash and knows nothing about a backend record.
 */
function LeverageYieldLiveCard({
  order,
  title,
  onDismiss,
  onSettle,
}: {
  order: SolverOrder & { srcChainKey: string; srcTxHash: string };
  title: string;
  onDismiss?: () => void;
  onSettle: SettleFn;
}) {
  // The same per-action key the vault swap submitted with; never persisted on the order itself.
  const apiKey = useAppStore(state => state.sodaxSettings.leverageYieldApiKey);
  const { data: read } = useLeverageYieldDetailedStatus({
    params: {
      // Orders persist as JSON scalars, so the chain key is widened to `string` on the way in.
      srcChainKey: order.srcChainKey as SpokeChainKey,
      srcTxHash: order.srcTxHash,
      ...(apiKey ? { apiConfig: { apiKey } } : {}),
    },
  });

  const derived = useMemo(() => deriveDetailed(read), [read]);
  const { label, error, extraRows } = derived;
  useEffect(() => {
    if (TERMINAL_LABELS.has(derived.label)) {
      onSettle(order.intentHash, { label: derived.label, error: derived.error, extraRows: derived.extraRows });
    }
  }, [derived, order.intentHash, onSettle]);

  return (
    <OrderCard
      title={title}
      label={label}
      summary={order.summary}
      rows={[...baseRows(order), ...extraRows]}
      error={error}
      createdAt={order.createdAt}
      onDismiss={onDismiss}
    />
  );
}

/**
 * The SDK swap card. `useDetailedStatus` keys on the SOURCE tx and routes like the vault-swap card
 * above, so it answers whichever path completed the swap: backend submit-tx or the client-side relay.
 */
function SwapLiveCard({
  order,
  title,
  onDismiss,
  onSettle,
}: {
  order: SolverOrder & { srcChainKey: string; srcTxHash: string };
  title: string;
  onDismiss?: () => void;
  onSettle: SettleFn;
}) {
  const { data: read } = useDetailedStatus({
    // Orders persist as JSON scalars, so the chain key is widened to `string` on the way in.
    params: { srcChainKey: order.srcChainKey as SpokeChainKey, srcTxHash: order.srcTxHash },
  });

  const derived = useMemo(() => deriveDetailed(read), [read]);
  const { label, error, extraRows } = derived;
  useEffect(() => {
    if (TERMINAL_LABELS.has(derived.label)) {
      onSettle(order.intentHash, { label: derived.label, error: derived.error, extraRows: derived.extraRows });
    }
  }, [derived, order.intentHash, onSettle]);

  return (
    <OrderCard
      title={title}
      label={label}
      summary={order.summary}
      rows={[...baseRows(order), ...extraRows]}
      error={error}
      createdAt={order.createdAt}
      onDismiss={onDismiss}
    />
  );
}

export default function OrderStatus({
  order,
  onDismiss,
  onSettle,
  feature = 'swap',
}: {
  order: Order;
  onDismiss?: () => void;
  onSettle?: SettleFn;
  /** Whose history this card belongs to: a vault swap reads the leverage-yield status router. */
  feature?: 'swap' | 'leverage-yield';
}) {
  const { sodax } = useSodaxContext();
  const title = feature === 'leverage-yield' ? 'Vault Swap' : order.mode === 'solver' ? 'Swap' : 'Submit Tx';

  // Only short-circuit to the static card for a genuinely terminal cache; a non-terminal `final`
  // (e.g. a stale NOT_FOUND from an older build) falls through to the live card and re-polls.
  if (isSettled(order)) {
    return <StaticOrderCard order={order} title={title} onDismiss={onDismiss} />;
  }
  const settle: SettleFn = onSettle ?? (() => {});
  if (order.mode === 'solver') {
    // `statusEndpoint` pins an order to the env it was created on; the router only knows the current
    // one. So an order from another env — or one saved before the source tx was — stays on the poll.
    const pinnedElsewhere = !!order.statusEndpoint && order.statusEndpoint !== sodax.config.solver.solverApiEndpoint;
    if (order.srcChainKey && order.srcTxHash && !pinnedElsewhere) {
      const sourced = { ...order, srcChainKey: order.srcChainKey, srcTxHash: order.srcTxHash };
      return feature === 'leverage-yield' ? (
        <LeverageYieldLiveCard order={sourced} title={title} onDismiss={onDismiss} onSettle={settle} />
      ) : (
        <SwapLiveCard order={sourced} title={title} onDismiss={onDismiss} onSettle={settle} />
      );
    }
    return <SolverLiveCard order={order} title={title} onDismiss={onDismiss} onSettle={settle} />;
  }
  return <SubmitTxLiveCard order={order} title={title} onDismiss={onDismiss} onSettle={settle} />;
}
