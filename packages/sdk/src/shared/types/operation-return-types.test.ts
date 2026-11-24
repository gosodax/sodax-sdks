/**
 * A raw `tx` follows the spoke operation behind an action. On Tron a deposit is a transfer and a message to
 * the hub (borrow, withdraw) is a withdraw-auth, so each action names the one it returns rather than the union.
 * Every other chain keeps its single raw transaction type.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type { ChainKeys, EvmRawTransaction, SpokeChainKey, TronRawTransaction, TronRawWithdraw } from '@sodax/types';
import type { Sodax } from '../entities/Sodax.js';

type Tron = typeof ChainKeys.TRON_MAINNET;
type Arbitrum = typeof ChainKeys.ARBITRUM_MAINNET;
type Value<F extends (...args: never[]) => Promise<unknown>> = Extract<Awaited<ReturnType<F>>, { ok: true }>['value'];

// Type queries only: nothing reads it at runtime.
declare const sodax: Sodax;

describe('raw return types follow the operation', () => {
  it('types a Tron deposit as a transfer and a Tron message as a withdraw-auth, through every seam', () => {
    expectTypeOf<Value<typeof sodax.spoke.deposit<Tron, true>>>().toEqualTypeOf<TronRawTransaction>();
    expectTypeOf<Value<typeof sodax.spoke.sendMessage<Tron, true>>>().toEqualTypeOf<TronRawWithdraw>();

    expectTypeOf<Value<typeof sodax.swaps.createIntent<Tron, true>>['tx']>().toEqualTypeOf<TronRawTransaction>();
    expectTypeOf<Value<typeof sodax.bridge.createBridgeIntent<Tron, true>>['tx']>().toEqualTypeOf<TronRawTransaction>();
    expectTypeOf<
      Value<typeof sodax.moneyMarket.createSupplyIntent<Tron, true>>['tx']
    >().toEqualTypeOf<TronRawTransaction>();
    expectTypeOf<
      Value<typeof sodax.moneyMarket.createRepayIntent<Tron, true>>['tx']
    >().toEqualTypeOf<TronRawTransaction>();
    expectTypeOf<
      Value<typeof sodax.moneyMarket.createBorrowIntent<Tron, true>>['tx']
    >().toEqualTypeOf<TronRawWithdraw>();
    expectTypeOf<
      Value<typeof sodax.moneyMarket.createWithdrawIntent<Tron, true>>['tx']
    >().toEqualTypeOf<TronRawWithdraw>();
    expectTypeOf<
      Value<typeof sodax.dex.assetService.executeDeposit<Tron, true>>['tx']
    >().toEqualTypeOf<TronRawTransaction>();
    expectTypeOf<
      Value<typeof sodax.dex.assetService.executeWithdraw<Tron, true>>['tx']
    >().toEqualTypeOf<TronRawWithdraw>();
    expectTypeOf<Value<typeof sodax.recovery.withdrawHubAsset<Tron, true>>>().toEqualTypeOf<TronRawWithdraw>();
  });

  it('keeps one raw type on every other chain, and both Tron shapes for a chain key not known statically', () => {
    expectTypeOf<Value<typeof sodax.spoke.deposit<Arbitrum, true>>>().toEqualTypeOf<EvmRawTransaction>();
    expectTypeOf<
      Value<typeof sodax.moneyMarket.createBorrowIntent<Arbitrum, true>>['tx']
    >().toEqualTypeOf<EvmRawTransaction>();
    expectTypeOf<TronRawWithdraw>().toExtend<Value<typeof sodax.spoke.sendMessage<SpokeChainKey, true>>>();
    expectTypeOf<TronRawTransaction>().toExtend<Value<typeof sodax.spoke.sendMessage<SpokeChainKey, true>>>();
  });

  it('keeps a signed Tron result a string: the tx id of a deposit, the trackingId of a message', () => {
    expectTypeOf<Value<typeof sodax.spoke.deposit<Tron, false>>>().toEqualTypeOf<string>();
    expectTypeOf<Value<typeof sodax.spoke.sendMessage<Tron, false>>>().toEqualTypeOf<string>();
  });
});
