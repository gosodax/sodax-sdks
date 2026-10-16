/**
 * Events to the GTM dataLayer under GA4 naming, as on sodax.com. The pair parameters reuse the
 * frontend's names, so the dimensions registered for `swap_completed` read these events too.
 */

declare global {
  interface Window {
    dataLayer?: Record<string, unknown>[];
  }
}

const GTM_ORIGIN = 'https://www.googletagmanager.com/gtm.js';

/** Set on sodax.com by visiting with `?internal=1`, scoped to `.sodax.com`. */
const INTERNAL_TRAFFIC_COOKIE = 'sodax_internal=1';

export type EventName =
  | 'widget_viewed'
  | 'quote_received'
  | 'quote_failed'
  | 'exchange_handoff_clicked'
  | 'embed_snippet_copied'
  | 'partner_fee_set'
  | 'swap_submitted'
  | 'swap_completed'
  | 'swap_failed';

/**
 * Why a swap stopped: the phase it broke in, or how settlement ended. A closed set, so the GA4
 * dimension stays groupable — never a raw error message, which would leak internals into a report.
 */
export type SwapFailureReason =
  | 'rejected'
  | 'checking'
  | 'approving'
  | 'building'
  | 'signing'
  | 'submitting'
  | 'settlement_failed'
  | 'abandoned';

export type PairDimensions = {
  source_chain: string;
  destination_chain: string;
  input_token_symbol: string;
  output_token_symbol: string;
  input_amount: string;
  has_partner_fee: boolean;
};

export type EventParams = Record<string, string | number | boolean>;

export type TagConfig = { gtmId: string | undefined; embedded: boolean; allowInEmbed: boolean };

/** Inside an `<iframe>` the site owner, not us, owns the consent decision — so it is opt-in. */
export function tagPolicy({ gtmId, embedded, allowInEmbed }: TagConfig): 'load' | 'no-container' | 'embed-opt-out' {
  if (!gtmId) return 'no-container';
  if (embedded && !allowInEmbed) return 'embed-opt-out';
  return 'load';
}

/** One event per pair the visitor settles on, not one per 3s refetch. */
export function quoteEventKey(pair: PairDimensions): string {
  return [
    pair.source_chain,
    pair.input_token_symbol,
    pair.destination_chain,
    pair.output_token_symbol,
    pair.input_amount,
    pair.has_partner_fee,
  ].join('|');
}

export function buildEvent(
  name: EventName,
  params: EventParams,
  context: { embedded: boolean; internal: boolean },
): Record<string, unknown> {
  return {
    event: name,
    ...params,
    is_embedded: context.embedded,
    ...(context.internal ? { traffic_type: 'internal' } : {}),
  };
}

let embedded = false;

function isInternalTraffic(): boolean {
  // A sandboxed embed, or one with site data blocked, throws here.
  try {
    return document.cookie.split('; ').includes(INTERNAL_TRAFFIC_COOKIE);
  } catch {
    return false;
  }
}

function track(name: EventName, params: EventParams = {}): void {
  const event = buildEvent(name, params, { embedded, internal: isInternalTraffic() });

  if (import.meta.env.DEV) console.log('[Analytics]', event);
  window.dataLayer?.push(event);
}

function loadContainer(gtmId: string): void {
  window.dataLayer = window.dataLayer ?? [];
  window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });

  const script = document.createElement('script');
  script.async = true;
  script.src = `${GTM_ORIGIN}?id=${encodeURIComponent(gtmId)}`;
  document.head.append(script);
}

export function initAnalytics(config: TagConfig): void {
  embedded = config.embedded;

  if (tagPolicy(config) !== 'load' || !config.gtmId) return;

  loadContainer(config.gtmId);
  track('widget_viewed');
}

export function trackQuoteReceived(pair: PairDimensions): void {
  track('quote_received', { ...pair });
}

export function trackQuoteFailed(pair: PairDimensions, reason: string): void {
  track('quote_failed', { ...pair, reason });
}

export function trackExchangeHandoff(pair: PairDimensions): void {
  track('exchange_handoff_clicked', { ...pair });
}

export function trackSnippetCopied(snippetId: string): void {
  track('embed_snippet_copied', { snippet_id: snippetId });
}

/** Basis points only — the recipient address is the partner's. */
export function trackPartnerFeeSet(feeBps: number): void {
  track('partner_fee_set', { fee_bps: feeBps });
}

/**
 * The execution funnel, under the frontend's `swap_completed` name so widget swaps land in the
 * same GA4 report as sodax.com's. Two of the frontend's parameters are deliberately absent:
 * `transaction_hash`, because a framed widget must not emit hashes, and `input_amount_usd`,
 * because nothing here prices the input — `input_amount` carries token units instead.
 */
export function trackSwapSubmitted(pair: PairDimensions): void {
  track('swap_submitted', { ...pair });
}

export function trackSwapCompleted(pair: PairDimensions): void {
  track('swap_completed', { ...pair });
}

export function trackSwapFailed(pair: PairDimensions, reason: SwapFailureReason): void {
  track('swap_failed', { ...pair, reason });
}
