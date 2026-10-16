import { describe, expect, it } from 'vitest';
import { resolveHostOrigin } from './embedOrigin';

describe('resolveHostOrigin', () => {
  it('prefers the direct ancestor origin', () => {
    expect(resolveHostOrigin(['https://partner.example'], 'https://other.example/page')).toBe(
      'https://partner.example',
    );
  });

  it('falls back to the referrer origin when ancestorOrigins is unavailable', () => {
    expect(resolveHostOrigin(undefined, 'https://partner.example/embed?x=1')).toBe('https://partner.example');
    expect(resolveHostOrigin([], 'http://localhost:5173/')).toBe('http://localhost:5173');
  });

  it('returns undefined without a usable http(s) origin', () => {
    expect(resolveHostOrigin(undefined, '')).toBeUndefined();
    expect(resolveHostOrigin(undefined, 'not a url')).toBeUndefined();
    expect(resolveHostOrigin(['null'], '')).toBeUndefined();
    expect(resolveHostOrigin(['file://'], 'about:blank')).toBeUndefined();
  });
});
