import * as v from 'valibot';
import { IntentEventTypeSchema } from './backendApiSchemas.js';
import type { IntentResponse } from './BackendApiService.js';
import { isFillEvent } from './guards.js';

/** How an intent ended, as far as the backend's durable intent journal proves it. */
export type IntentJournalOutcome = { kind: 'solved'; fillTxHash: string } | { kind: 'cancelled' };

/**
 * The terminal outcome the intent journal proves, or `undefined` while it proves none.
 *
 * `solved` needs the fill that consumed the remainder: an intent created with `allowPartialFill` emits
 * a fill event per fill while input remains. `cancelled` needs an explicit cancel on a closed intent
 * that never filled at all — a cancel after a partial fill is neither, so it proves nothing here, and
 * any `intent-filled` entry rules it out, even one too malformed for `isFillEvent`.
 *
 * The journal, not the hub's `intentStates`: the hub deletes that entry on a full fill as well as on
 * a cancel, so it cannot tell the two apart.
 */
export function readIntentJournalOutcome(intent: IntentResponse): IntentJournalOutcome | undefined {
  const settled = intent.events.filter(isFillEvent).find(fill => fill.intentState.remainingInput === '0');
  if (settled) return { kind: 'solved', fillTxHash: settled.txHash };

  const eventTypes = intent.events.flatMap(event => (v.is(IntentEventTypeSchema, event) ? [event.eventType] : []));
  if (!intent.open && eventTypes.includes('intent-cancelled') && !eventTypes.includes('intent-filled')) {
    return { kind: 'cancelled' };
  }
  return undefined;
}
