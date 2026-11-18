/** Compile-time contract for `HookService`: the delivery-hook encoders' exact result types. */
import { describe, expectTypeOf, it } from 'vitest';
import type { Address, Hex } from '../index.js';
import type { HookService } from './HookService.js';

type S = typeof HookService;

describe('HookService', () => {
  it('encodeDeliveryData returns the encoded payload', () => {
    expectTypeOf<ReturnType<S['encodeDeliveryData']>>().toEqualTypeOf<Hex>();
  });

  it('resolveDeliveryHook returns the deployed hook address and its payload', () => {
    expectTypeOf<ReturnType<S['resolveDeliveryHook']>>().toEqualTypeOf<{ dstAddress: Address; deliveryData: Hex }>();
  });

  it('resolveDelivery keeps the caller address type, and the payload is optional without a hook', () => {
    expectTypeOf<ReturnType<S['resolveDelivery']>>().toEqualTypeOf<{
      dstAddress: string;
      deliveryData: Hex | undefined;
    }>();
  });
});
