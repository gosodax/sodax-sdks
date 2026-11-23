/** Pins the result types of the static staking contract helpers (encoders and hub reads). */
import { describe, expectTypeOf, it } from 'vitest';
import type { EvmContractCall, UserUnstakeInfo } from '../index.js';
import type { StakingLogic } from './StakingLogic.js';

type L = typeof StakingLogic;

describe('StakingLogic', () => {
  it('staked SODA encoders return an EVM contract call', () => {
    expectTypeOf<ReturnType<L['encodeDepositFor']>>().toEqualTypeOf<EvmContractCall>();
    expectTypeOf<ReturnType<L['encodeWithdrawTo']>>().toEqualTypeOf<EvmContractCall>();
    expectTypeOf<ReturnType<L['encodeUnstake']>>().toEqualTypeOf<EvmContractCall>();
    expectTypeOf<ReturnType<L['encodeCancelUnstakeSodaRequest']>>().toEqualTypeOf<EvmContractCall>();
    expectTypeOf<ReturnType<L['encodeCancelUnstakeRequest']>>().toEqualTypeOf<EvmContractCall>();
    expectTypeOf<ReturnType<L['encodeClaim']>>().toEqualTypeOf<EvmContractCall>();
  });

  it('xSODA vault and staking router encoders return an EVM contract call', () => {
    expectTypeOf<ReturnType<L['encodeXSodaDeposit']>>().toEqualTypeOf<EvmContractCall>();
    expectTypeOf<ReturnType<L['encodeXSodaMint']>>().toEqualTypeOf<EvmContractCall>();
    expectTypeOf<ReturnType<L['encodeXSodaWithdraw']>>().toEqualTypeOf<EvmContractCall>();
    expectTypeOf<ReturnType<L['encodeXSodaRedeem']>>().toEqualTypeOf<EvmContractCall>();
    expectTypeOf<ReturnType<L['encodeStakingRouterStake']>>().toEqualTypeOf<EvmContractCall>();
    expectTypeOf<ReturnType<L['encodeStakingRouterUnstake']>>().toEqualTypeOf<EvmContractCall>();
  });

  it('hub reads resolve to bigints', () => {
    expectTypeOf<ReturnType<L['getXSodaTotalAssets']>>().toEqualTypeOf<Promise<bigint>>();
    expectTypeOf<ReturnType<L['convertSodaToXSodaShares']>>().toEqualTypeOf<Promise<bigint>>();
    expectTypeOf<ReturnType<L['convertXSodaSharesToSoda']>>().toEqualTypeOf<Promise<bigint>>();
    expectTypeOf<ReturnType<L['previewXSodaDeposit']>>().toEqualTypeOf<Promise<bigint>>();
    expectTypeOf<ReturnType<L['previewXSodaMint']>>().toEqualTypeOf<Promise<bigint>>();
    expectTypeOf<ReturnType<L['previewXSodaWithdraw']>>().toEqualTypeOf<Promise<bigint>>();
    expectTypeOf<ReturnType<L['previewXSodaRedeem']>>().toEqualTypeOf<Promise<bigint>>();
    expectTypeOf<ReturnType<L['estimateInstantUnstake']>>().toEqualTypeOf<Promise<bigint>>();
  });

  it('estimateXSodaAmount returns the [xSODA, preview] pair and getUnstakeSodaRequests the user requests', () => {
    expectTypeOf<ReturnType<L['estimateXSodaAmount']>>().toEqualTypeOf<Promise<readonly [bigint, bigint]>>();
    expectTypeOf<ReturnType<L['getUnstakeSodaRequests']>>().toEqualTypeOf<Promise<readonly UserUnstakeInfo[]>>();
  });
});
