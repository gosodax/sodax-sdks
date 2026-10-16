import { afterEach, describe, expect, it, vi } from 'vitest';
import { fromHost, postEmbedEvent, readThemeMessage } from './embedMessages';

afterEach(() => vi.unstubAllGlobals());

describe('embed message boundary', () => {
  it('requires the direct parent and its exact origin', () => {
    const parent = {};
    expect(fromHost({ source: parent, origin: 'https://partner.test' }, parent, 'https://partner.test')).toBe(true);
    expect(fromHost({ source: {}, origin: 'https://partner.test' }, parent, 'https://partner.test')).toBe(false);
    expect(fromHost({ source: parent, origin: 'https://other.test' }, parent, 'https://partner.test')).toBe(false);
    expect(fromHost({ source: parent, origin: 'null' }, parent, undefined)).toBe(false);
  });
  it.each(['light', 'dark', 'auto'] as const)('accepts only supported theme messages: %s', theme => {
    expect(readThemeMessage({ type: 'sodax:theme', theme })).toBe(theme);
  });
  it.each([
    null,
    {},
    { type: 'sodax:theme', theme: 'toString' },
    { type: 'sodax:sign', theme: 'dark' },
    { type: 'sodax:theme', theme: { dark: true } },
  ])('rejects malformed messages', value => {
    expect(readThemeMessage(value)).toBeUndefined();
  });
  it('sends status only to the resolved host origin', () => {
    const postMessage = vi.fn();
    vi.stubGlobal('window', {
      parent: { postMessage },
      location: { search: '?embed=1', ancestorOrigins: ['https://partner.test'] },
    });
    vi.stubGlobal('document', { referrer: '' });
    postEmbedEvent({ type: 'sodax:swap', status: 'submitted' });
    expect(postMessage).toHaveBeenCalledWith({ type: 'sodax:swap', status: 'submitted' }, 'https://partner.test');
  });
  it('does not broadcast without a host origin or in the builder', () => {
    const postMessage = vi.fn();
    vi.stubGlobal('window', { parent: { postMessage }, location: { search: '?embed=1' } });
    vi.stubGlobal('document', { referrer: '' });
    postEmbedEvent({ type: 'sodax:ready' });
    expect(postMessage).not.toHaveBeenCalled();
    vi.stubGlobal('window', {
      parent: { postMessage },
      location: { search: '?embed=0', ancestorOrigins: ['https://partner.test'] },
    });
    postEmbedEvent({ type: 'sodax:ready' });
    expect(postMessage).not.toHaveBeenCalled();
  });
});
