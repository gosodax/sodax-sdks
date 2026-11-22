import { DEFAULT_API_BASE_URL } from '@sodax/dapp-kit';

/** Matches the IDs the SODAX dev portal issues; the swaps API rejects widget requests without one. */
export const APP_ID_PATTERN = /^wgt_[0-9a-f]{24}$/;

export const APP_ID_HEADER = 'x-widget-app-id';

/** The portal's `/widget` link keeps the `utm_*` query through sign-in and sign-up and opens the Swap widget tab. */
const PARTNER_PORTAL_SIGNUP_URL = 'https://portal.sodax.com/widget';

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

/** The partner's own ID, or undefined. SODAX's preview ID never counts, so it cannot reach an export. */
export function partnerAppId(value: string, previewId: string | undefined): string | undefined {
  const id = value.trim();
  return isAppId(id) && id !== previewId ? id : undefined;
}

/** The ID sent to the swaps API: the partner's, else the preview ID inside the builder's own preview only. */
export function requestAppId(
  partnerId: string | undefined,
  previewId: string | undefined,
  inBuilderPreview: boolean,
): string | undefined {
  if (partnerId) return partnerId;
  return inBuilderPreview && previewId && isAppId(previewId) ? previewId : undefined;
}

export async function fetchWidgetFeeConfig(appId: string, signal?: AbortSignal): Promise<WidgetFeeConfig | null> {
  const res = await fetch(`${DEFAULT_API_BASE_URL}/swaps/widget/config/${encodeURIComponent(appId)}`, { signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Could not load the fee for this app ID (${res.status}).`);
  return (await res.json()) as WidgetFeeConfig;
}
