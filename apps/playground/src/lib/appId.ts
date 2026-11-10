import { DEFAULT_API_BASE_URL } from '@sodax/dapp-kit';

/** Matches the IDs the SODAX partner portal issues; the swaps API rejects widget requests without one. */
export const APP_ID_PATTERN = /^wgt_[0-9a-f]{24}$/;

export const APP_ID_HEADER = 'x-widget-app-id';

export const PARTNER_PORTAL_URL = 'https://portal.sodax.com/portal';

export type WidgetFeeConfig = { appId: string; feeBps: number; feeReceiver: string };

export function isAppId(value: string): boolean {
  return APP_ID_PATTERN.test(value);
}

export async function fetchWidgetFeeConfig(appId: string, signal?: AbortSignal): Promise<WidgetFeeConfig | null> {
  const res = await fetch(`${DEFAULT_API_BASE_URL}/swaps/widget/config/${encodeURIComponent(appId)}`, { signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Could not load the fee for this app ID (${res.status}).`);
  return (await res.json()) as WidgetFeeConfig;
}
