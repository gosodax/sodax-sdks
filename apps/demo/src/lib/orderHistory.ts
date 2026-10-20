import type { Order } from '@/components/swaps/OrderStatus';
import { readJson, writeJson } from '@/lib/storage';

// Persists recent swap history so in-flight swaps survive a refresh: each card re-loads its own
// status from the stored hash (and caches the terminal result), so a swap that settles while the
// app is closed still shows complete. Orders are JSON-safe scalars.
//
// Keyed per feature so the solver and swaps-api pages keep separate histories.
/** Value intentionally still says `solver`: renaming it would orphan already-saved demo orders. */
export const SWAPS_SDK_ORDERS_KEY = 'sodax-demo:solver:orders';
export const SWAPS_API_ORDERS_KEY = 'sodax-demo:swaps-api:orders';

/** Keep at most the newest N swaps; a 16th evicts the oldest. */
export const MAX_ORDERS = 15;

function isOrder(value: unknown): value is Order {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const o = value as Record<string, unknown>;
  // Validate the summary legs too — a malformed from/to would otherwise crash ChainAsset.
  const summary = o.summary as { from?: unknown; to?: unknown } | undefined;
  if (!summary || typeof summary !== 'object' || typeof summary.from !== 'object' || !summary.from) {
    return false;
  }
  if (typeof summary.to !== 'object' || !summary.to) {
    return false;
  }
  if (o.mode === 'solver') {
    return typeof o.intentHash === 'string' && typeof o.dstTxHash === 'string' && typeof o.orderId === 'string';
  }
  if (o.mode === 'submit-tx') {
    return typeof o.txHash === 'string' && typeof o.srcChainKey === 'string';
  }
  return false;
}

export function loadOrders(storageKey: string): Order[] {
  const parsed = readJson<unknown[]>(storageKey);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter(isOrder).slice(-MAX_ORDERS);
}

export function saveOrders(storageKey: string, orders: Order[]): void {
  writeJson(storageKey, orders.slice(-MAX_ORDERS));
}

/**
 * Append an order, keeping only the newest MAX_ORDERS (FIFO eviction). Typing the param as `Order`
 * also lets callers pass an inline object literal whose `mode` narrows without an `as const`.
 */
export function appendOrder(prev: Order[], order: Order): Order[] {
  return [...prev, order].slice(-MAX_ORDERS);
}
