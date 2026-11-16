// Central SodaxScan base URL and API: resolve source tx hash to message ID and message URL.
// Single place to change if SodaxScan URL or API changes.

/** Base URL for SodaxScan; change here if the domain or path changes. */
export const SODAX_SCAN_BASE_URL = 'https://sodaxscan.com';

/**
 * Direct SodaxScan message URL that resolves a tx hash client-side — no API call from our app.
 * The /messages/search page looks the hash up itself (src/dest/intent tx), so the link works
 * without us hitting /api/search (which is CORS-locked) or knowing the numeric message id.
 */
export function sodaxScanSearchUrl(value: string): string {
  return `${SODAX_SCAN_BASE_URL}/messages/search?value=${encodeURIComponent(value)}`;
}

/** SodaxScan search API path (used to resolve hash to message id). */
const SODAX_SCAN_SEARCH_PATH = '/api/search';

/** Per-request cap, so a hung search cannot stretch the caller's retries into minutes. */
const SODAX_SCAN_SEARCH_TIMEOUT_MS = 5_000;

/** Response shape from SodaxScan /api/search (array of message objects with id). */
interface SodaxScanSearchResponse {
  data?: Array<{ id?: string | number }>;
}

/**
 * Resolves a source transaction hash to a SodaxScan message ID via the search API.
 * Returns the first matching message id, or null if not found or on error.
 * The API searches by src_tx_hash, dest_tx_hash, response_tx_hash, rollback_tx_hash, or intent_tx_hash.
 */
export async function getMessageIdBySrcHash(srcHash: string): Promise<string | null> {
  const url = `${SODAX_SCAN_BASE_URL}${SODAX_SCAN_SEARCH_PATH}?value=${encodeURIComponent(srcHash)}`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(SODAX_SCAN_SEARCH_TIMEOUT_MS) });
    if (!response.ok) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[SodaxScan] API error: ${response.status} ${response.statusText}`, url);
      }
      return null;
    }
    const json = (await response.json()) as SodaxScanSearchResponse;
    const id = json.data?.[0]?.id;
    // Handle both string and number IDs (backend returns number)
    if (id === undefined || id === null) {
      if (process.env.NODE_ENV === 'development') {
        // Purpose: Warns in development if no message found for the given hash.
        // Effect: Prints a warning with the queried hash and full JSON response.
        console.warn('[SodaxScan] No message found for hash:', srcHash, json);
      }
      return null;
    }
    return String(id);
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('[SodaxScan] Fetch error:', error);
    }
    return null;
  }
}

/**
 * Returns the SodaxScan message URL for a given source tx hash, or null if the message cannot be resolved.
 */
export async function getSodaxScanMessageUrl(srcHash: string): Promise<string | null> {
  const id = await getMessageIdBySrcHash(srcHash);
  if (!id) return null;
  return `${SODAX_SCAN_BASE_URL}/messages/${id}`;
}
