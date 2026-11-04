import { resolveHostOrigin } from './embedOrigin';

export type SwapEventStatus = 'started' | 'submitted' | 'completed' | 'failed';
export type EmbedEvent = { type: 'sodax:ready' } | { type: 'sodax:swap'; status: SwapEventStatus };

/**
 * The height an exported embed reserves, and the floor its resize handler keeps. The asset picker is
 * a dialog inside that frame, so a frame trimmed to the form leaves it too short for its grid; the
 * widget's ground fills whatever is left over. The builder's own preview sizes to its column instead.
 */
export const EMBED_MIN_HEIGHT = 760;

export function fromHost(
  event: { source: unknown; origin: string },
  parent: unknown,
  hostOrigin: string | undefined,
): boolean {
  return !!hostOrigin && event.source === parent && event.origin === hostOrigin;
}

export function readThemeMessage(data: unknown): 'light' | 'dark' | 'auto' | undefined {
  if (!data || typeof data !== 'object' || !('type' in data) || data.type !== 'sodax:theme' || !('theme' in data))
    return undefined;
  return data.theme === 'light' || data.theme === 'dark' || data.theme === 'auto' ? data.theme : undefined;
}

/** Lifecycle messages intentionally carry no amounts, wallet addresses, or transaction identifiers. */
export function postEmbedEvent(event: EmbedEvent): void {
  if (window.parent === window || new URLSearchParams(window.location.search).get('embed') !== '1') return;
  const origin = resolveHostOrigin(window.location.ancestorOrigins, document.referrer);
  if (origin) window.parent.postMessage(event, origin);
}
