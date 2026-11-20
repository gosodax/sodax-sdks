/**
 * Compile-time contract for `EvmAssetManagerService`: asset lookups and calldata encoders pin one
 * exact result type each.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type { Address, AssetInfo, EvmContractCall, Hex } from '../../../index.js';
import type { EvmAssetManagerService } from './EvmAssetManagerService.js';

describe('EvmAssetManagerService', () => {
  it('lookups and encoders pin one result type', () => {
    expectTypeOf<ReturnType<typeof EvmAssetManagerService.getAssetInfo>>().toEqualTypeOf<Promise<AssetInfo>>();
    expectTypeOf<ReturnType<typeof EvmAssetManagerService.encodeTransfer>>().toEqualTypeOf<EvmContractCall>();
    expectTypeOf<ReturnType<typeof EvmAssetManagerService.depositToData>>().toEqualTypeOf<Hex>();
    expectTypeOf<ReturnType<typeof EvmAssetManagerService.withdrawAssetData>>().toEqualTypeOf<Hex>();
    expectTypeOf<ReturnType<EvmAssetManagerService['getAssetAddress']>>().toEqualTypeOf<Promise<Address>>();
  });
});
