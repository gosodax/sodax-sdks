import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKoiosClient } from './cardano-koios.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const stubFetch = () => {
  const fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify([{ abs_slot: 123 }])));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

describe('createKoiosClient base URL', () => {
  it.each([
    ['https://koios.example/api/v1', 'https://koios.example/api/v1/tip'],
    ['https://koios.example/api/v1/', 'https://koios.example/api/v1/tip'],
    ['https://koios.example/api/v1///', 'https://koios.example/api/v1/tip'],
  ])('reads %s as %s', async (baseUrl, expected) => {
    const fetchMock = stubFetch();

    expect(await createKoiosClient(baseUrl).getTipSlot()).toBe(123n);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(expected);
  });

  it('trims a very long run of trailing slashes in linear time', () => {
    // The input a backtracking `/\/+$/` is polynomial on: a long run of slashes that does not end the string.
    const hostile = `https://koios.example/api/v1${'/'.repeat(200_000)}x`;
    const started = performance.now();

    createKoiosClient(hostile);

    expect(performance.now() - started).toBeLessThan(200);
  });

  it('refuses an empty URL, naming the setting to fix', () => {
    expect(() => createKoiosClient('')).toThrow(/rpcUrl is empty/);
    expect(() => createKoiosClient('///')).toThrow(/rpcUrl is empty/);
  });
});
