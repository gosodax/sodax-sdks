import { DEFAULT_API_BASE_URL } from '@sodax/dapp-kit';

/** Matches the IDs the SODAX partner portal issues; the swaps API rejects widget requests without one. */
export const APP_ID_PATTERN = /^wgt_[0-9a-f]{24}$/;

export const APP_ID_HEADER = 'x-widget-app-id';

/** The portal's `/portal` redirects a signed-out visitor to `/login` without the query, so link to `/login`. */
const PARTNER_PORTAL_SIGNUP_URL = 'https://portal.sodax.com/login';

export type AppIdLinkPlacement = 'builder' | 'embed';

/** The portal records these `utm_*` on the org it creates, which is how widget signups are counted. */
export function appIdSignupUrl(placement: AppIdLinkPlacement): string {
  const params = new URLSearchParams({
    utm_source: 'sodax_widget',
    utm_medium: placement === 'builder' ? 'widget_builder' : 'widget_embed',
    utm_campaign: 'widget_app_id',
  });
  return `${PARTNER_PORTAL_SIGNUP_URL}?${params}`;
}

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
