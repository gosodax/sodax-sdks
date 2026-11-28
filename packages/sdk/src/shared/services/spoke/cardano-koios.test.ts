import { describe, expect, it } from 'vitest';
import { stubFetch } from '../../../test-utils/fetch.js';
import { createKoiosClient } from './cardano-koios.js';

describe('createKoiosClient base URL', () => {
  it('drops trailing slashes from the base URL', async () => {
    const fetchMock = stubFetch().mockImplementation(async () => new Response(JSON.stringify([{ abs_slot: 123 }])));

    expect(await createKoiosClient('https://koios.example/api/v1///').getTipSlot()).toBe(123n);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://koios.example/api/v1/tip');
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
