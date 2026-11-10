import { afterEach, describe, expect, it, vi } from 'vitest';
import { appIdSignupUrl, fetchWidgetFeeConfig, isAppId } from './appId';

describe('isAppId', () => {
  it.each(['wgt_0123456789abcdef01234567'])('accepts %s', value => {
    expect(isAppId(value)).toBe(true);
  });

  it.each([
    '',
    'wgt_',
    'wgt_0123456789ABCDEF01234567',
    'app_0123456789abcdef01234567',
    ' wgt_0123456789abcdef01234567',
  ])('rejects %j', value => {
    expect(isAppId(value)).toBe(false);
  });
});

describe('fetchWidgetFeeConfig', () => {
  afterEach(() => vi.unstubAllGlobals());

  const respond = (status: number, body?: unknown) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status })),
    );

  it('returns the config', async () => {
    const config = {
      appId: 'wgt_0123456789abcdef01234567',
      feeBps: 25,
      feeReceiver: '0x52908400098527886E0F7030069857D2E4169EE7',
    };
    respond(200, config);
    await expect(fetchWidgetFeeConfig(config.appId)).resolves.toEqual(config);
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(
      'https://api.sodax.com/v1/swaps/widget/config/wgt_0123456789abcdef01234567',
    );
  });

  it('returns null for an unknown app ID and throws on other failures', async () => {
    respond(404);
    await expect(fetchWidgetFeeConfig('wgt_0123456789abcdef01234567')).resolves.toBeNull();
    respond(503);
    await expect(fetchWidgetFeeConfig('wgt_0123456789abcdef01234567')).rejects.toThrow('503');
  });
});

describe('appIdSignupUrl', () => {
  it('links to the portal login with the widget UTMs for each placement', () => {
    const builder = new URL(appIdSignupUrl('builder'));
    expect(`${builder.origin}${builder.pathname}`).toBe('https://portal.sodax.com/login');
    expect(Object.fromEntries(builder.searchParams)).toEqual({
      utm_source: 'sodax_widget',
      utm_medium: 'widget_builder',
      utm_campaign: 'widget_app_id',
    });
    expect(new URL(appIdSignupUrl('embed')).searchParams.get('utm_medium')).toBe('widget_embed');
  });
});
