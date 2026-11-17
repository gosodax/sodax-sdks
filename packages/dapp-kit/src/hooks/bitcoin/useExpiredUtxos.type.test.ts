/**
 * Compile-time contract: `useExpiredUtxos` reads expired UTXOs of the trading wallet from Bound Exchange.
 */
import type { IBitcoinWalletProvider, RadfiUtxo } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadHookParams } from '../shared/types.js';
import type { useExpiredUtxos, UseExpiredUtxosParams } from './useExpiredUtxos.js';

type Params = ReadHookParams<
  RadfiUtxo[],
  { walletProvider: IBitcoinWalletProvider | undefined; tradingAddress: string | undefined }
>;

describe('useExpiredUtxos', () => {
  it('accepts optional read-hook params', () => {
    expectTypeOf<UseExpiredUtxosParams>().toEqualTypeOf<Params>();
    expectTypeOf<Parameters<typeof useExpiredUtxos>>().toEqualTypeOf<[params?: Params]>();
  });

  it('returns the exact query', () => {
    expectTypeOf<ReturnType<typeof useExpiredUtxos>>().toEqualTypeOf<UseQueryResult<RadfiUtxo[], Error>>();
    expectTypeOf<ReturnType<typeof useExpiredUtxos>['data']>().toEqualTypeOf<RadfiUtxo[] | undefined>();
  });
});
