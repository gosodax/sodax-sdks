import { describe, it, expect } from 'vitest';
import { shallowMerge } from './merge.js';

describe('shallowMerge', () => {
  it('returns an empty object when there are no layers or all are undefined', () => {
    expect(shallowMerge<{ a?: number }>()).toEqual({});
    expect(shallowMerge<{ a?: number }>(undefined, undefined)).toEqual({});
  });

  it('treats undefined layers and explicitly undefined fields as no preference', () => {
    expect(shallowMerge({ a: 1 }, undefined, { b: 2 })).toEqual({ a: 1, b: 2 });
    expect(shallowMerge<{ a?: number }>({ a: 1 }, { a: undefined })).toEqual({ a: 1 });
  });

  it('lets later layers override earlier ones at the top level only, replacing nested objects wholesale', () => {
    expect(shallowMerge({ a: 1, b: 2 }, { b: 3, c: 4 })).toEqual({ a: 1, b: 3, c: 4 });
    expect(shallowMerge({ nested: { x: 1, y: 2 } }, { nested: { x: 99 } })).toEqual({ nested: { x: 99 } });
  });
});
