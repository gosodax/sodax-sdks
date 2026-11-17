/** Compile-time contract for `RadfiProvider.ts`: every Radfi/Bound Exchange call resolves to its exact response type. */
import { describe, expectTypeOf, it } from 'vitest';
import type {
  RadfiAuthResult,
  RadfiBuildTxResponse,
  RadfiDepositTxResponse,
  RadfiMaxSpentResponse,
  RadfiTradingWallet,
  RadfiUtxoListResponse,
  RadfiWalletBalance,
} from '../../../index.js';
import type { RadfiProvider } from './RadfiProvider.js';

type R<M extends keyof RadfiProvider> = RadfiProvider[M] extends (...args: never[]) => infer T ? T : never;

describe('RadfiProvider type contract', () => {
  it('authentication calls', () => {
    expectTypeOf<R<'authenticateWithWallet'>>().toEqualTypeOf<
      Promise<{ accessToken: string; refreshToken: string; tradingAddress: string; publicKey: string }>
    >();
    expectTypeOf<R<'ensureRadfiAccessToken'>>().toEqualTypeOf<Promise<void>>();
    expectTypeOf<R<'setRadfiAccessToken'>>().toEqualTypeOf<void>();
    expectTypeOf<R<'authenticate'>>().toEqualTypeOf<Promise<RadfiAuthResult>>();
    expectTypeOf<R<'refreshAccessToken'>>().toEqualTypeOf<Promise<{ accessToken: string; refreshToken: string }>>();
  });

  it('trading-wallet calls', () => {
    expectTypeOf<R<'createTradingWallet'>>().toEqualTypeOf<Promise<RadfiTradingWallet>>();
    expectTypeOf<R<'getTradingWallet'>>().toEqualTypeOf<Promise<RadfiTradingWallet>>();
    expectTypeOf<R<'getBalance'>>().toEqualTypeOf<Promise<RadfiWalletBalance>>();
    expectTypeOf<R<'checkIfTradingWalletExists'>>().toEqualTypeOf<Promise<boolean>>();
  });

  it('transaction calls', () => {
    expectTypeOf<R<'createWithdrawTransaction'>>().toEqualTypeOf<Promise<RadfiDepositTxResponse>>();
    expectTypeOf<R<'requestRadfiSignature'>>().toEqualTypeOf<Promise<string>>();
    expectTypeOf<R<'getExpiredUtxos'>>().toEqualTypeOf<Promise<RadfiUtxoListResponse>>();
    expectTypeOf<R<'buildRenewUtxoTransaction'>>().toEqualTypeOf<Promise<RadfiBuildTxResponse>>();
    expectTypeOf<R<'signAndBroadcastRenewUtxo'>>().toEqualTypeOf<Promise<string>>();
    expectTypeOf<R<'withdrawToUser'>>().toEqualTypeOf<Promise<RadfiBuildTxResponse>>();
    expectTypeOf<R<'signAndBroadcastWithdraw'>>().toEqualTypeOf<Promise<string>>();
    expectTypeOf<R<'getMaxWithdrawable'>>().toEqualTypeOf<Promise<RadfiMaxSpentResponse>>();
  });
});
