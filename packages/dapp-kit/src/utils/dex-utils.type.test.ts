/**
 * Compile-time contract: the DEX param builders return the chain-agnostic core of each SDK params
 * type, without `srcChainKey` / `srcAddress`.
 */
import type { Address, DestinationParamsType, PoolKey } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type {
  UseCreateDecreaseLiquidityParamsProps,
  UseCreateDepositParamsProps,
  UseCreateSupplyLiquidityParamsProps,
  UseCreateWithdrawParamsProps,
} from '../hooks/dex/index.js';
import type {
  createDecreaseLiquidityParamsProps,
  createDepositParamsProps,
  createSupplyLiquidityParamsProps,
  createWithdrawParamsProps,
} from './dex-utils.js';

type Flat<T> = { [K in keyof T]: T[K] };
type AssetCore = { asset: string; amount: bigint; poolToken: Address; dst?: DestinationParamsType };

describe('createDecreaseLiquidityParamsProps', () => {
  it('returns the decrease-liquidity core', () => {
    expectTypeOf<Parameters<typeof createDecreaseLiquidityParamsProps>>().toEqualTypeOf<
      [props: UseCreateDecreaseLiquidityParamsProps]
    >();
    expectTypeOf<Flat<ReturnType<typeof createDecreaseLiquidityParamsProps>>>().toEqualTypeOf<{
      poolKey: PoolKey;
      tokenId: bigint;
      liquidity: bigint;
      amount0Min: bigint;
      amount1Min: bigint;
    }>();
  });
});

describe('createDepositParamsProps', () => {
  it('returns the asset-deposit core', () => {
    expectTypeOf<Parameters<typeof createDepositParamsProps>>().toEqualTypeOf<[props: UseCreateDepositParamsProps]>();
    expectTypeOf<Flat<ReturnType<typeof createDepositParamsProps>>>().toEqualTypeOf<AssetCore>();
  });
});

describe('createWithdrawParamsProps', () => {
  it('returns the asset-withdraw core', () => {
    expectTypeOf<Parameters<typeof createWithdrawParamsProps>>().toEqualTypeOf<[props: UseCreateWithdrawParamsProps]>();
    expectTypeOf<Flat<ReturnType<typeof createWithdrawParamsProps>>>().toEqualTypeOf<AssetCore>();
  });
});

describe('createSupplyLiquidityParamsProps', () => {
  it('returns the supply / increase-liquidity core with the optional position fields', () => {
    expectTypeOf<Parameters<typeof createSupplyLiquidityParamsProps>>().toEqualTypeOf<
      [props: UseCreateSupplyLiquidityParamsProps]
    >();
    expectTypeOf<Flat<ReturnType<typeof createSupplyLiquidityParamsProps>>>().toEqualTypeOf<{
      poolKey: PoolKey;
      tickLower: bigint;
      tickUpper: bigint;
      liquidity: bigint;
      amount0Max: bigint;
      amount1Max: bigint;
      sqrtPriceX96: bigint;
      tokenId?: string | bigint;
      positionId?: string | null;
      isValidPosition?: boolean;
    }>();
  });
});
