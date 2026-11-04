/**
 * `SodaxProvider` wire test for the consumer-supplied API key: `config.apiKey` handed to the
 * provider must reach the backend as `x-api-key` on requests made through the provided instance.
 *
 * Covers the one key-supply surface the hook manifests' hand-built `Sodax` does not: the provider's
 * own `new Sodax(config)`. No renderer — `useMemo` is patched to evaluate its factory so the
 * component can be called as a plain function and the provided `sodax` read off the element's
 * context value.
 */

import type { Sodax } from '@sodax/sdk';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react', async importOriginal => ({
  ...(await importOriginal<typeof import('react')>()),
  useMemo: <T>(factory: () => T): T => factory(),
}));

const { SodaxProvider } = await import('./SodaxProvider.js');

const fetchMock = vi.fn<typeof globalThis.fetch>(
  async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
);
vi.stubGlobal('fetch', fetchMock);

describe('SodaxProvider — config.apiKey on the wire', () => {
  it('provides a Sodax whose backend requests carry x-api-key from the provider config', async () => {
    const element = SodaxProvider({ config: { apiKey: 'provider-key', logger: 'silent' }, children: null });

    const { sodax } = (element as ReactElement<{ value: { sodax: Sodax } }>).props.value;
    const result = await sodax.api.getAllConfig();

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(new URL(String(url)).pathname).toBe('/v1/be/config/all');
    expect(init?.method).toBe('GET');
    expect(new Headers(init?.headers).get('x-api-key')).toBe('provider-key');
  });
});
