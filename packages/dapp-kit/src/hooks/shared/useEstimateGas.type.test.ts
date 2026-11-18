/**
 * Compile-time contract: `useEstimateGas<C>` types the estimate and the `{ tx, chainKey }` variables
 * by chain family. The chain only arrives at `mutate()` time, so `C` is locked with a type argument;
 * without one it resolves to the full spoke-chain union.
 */
import type {
  BitcoinRawTransaction,
  ChainKeys,
  EvmRawTransaction,
  FeeEstimateTransaction,
  IconRawTransaction,
  InjectiveGasEstimate,
  InjectiveRawTransaction,
  NearRawTransaction,
  RawTxReturnType,
  SolanaRawTransaction,
  SpokeChainKey,
  StacksRawTransaction,
  StellarRawTransaction,
  SuiGasEstimate,
  SuiRawTransaction,
} from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { MutationHookParams } from './types.js';
import type { useEstimateGas } from './useEstimateGas.js';
import type { SafeUseMutationResult } from './useSafeMutation.js';

type BSC = typeof ChainKeys.BSC_MAINNET;
type SONIC = typeof ChainKeys.SONIC_MAINNET;
type ICON = typeof ChainKeys.ICON_MAINNET;
type SUI = typeof ChainKeys.SUI_MAINNET;
type SOLANA = typeof ChainKeys.SOLANA_MAINNET;
type STELLAR = typeof ChainKeys.STELLAR_MAINNET;
type INJECTIVE = typeof ChainKeys.INJECTIVE_MAINNET;
type NEAR = typeof ChainKeys.NEAR_MAINNET;
type STACKS = typeof ChainKeys.STACKS_MAINNET;
type BITCOIN = typeof ChainKeys.BITCOIN_MAINNET;

type Mutation<Data, Tx, C> = SafeUseMutationResult<Data, Error, { tx: Tx; chainKey: C }>;
// `C` cannot be inferred from the hook argument (variables arrive at mutate time), hence the instantiations.
type For<C extends SpokeChainKey> = ReturnType<typeof useEstimateGas<C>>;

declare const bscResult: For<BSC>;
declare const stellarTx: StellarRawTransaction;
declare const evmTx: EvmRawTransaction;

describe('useEstimateGas', () => {
  it('defaults to the full spoke-chain union', () => {
    expectTypeOf<ReturnType<typeof useEstimateGas>>().toEqualTypeOf<
      Mutation<
        bigint | number | undefined | SuiGasEstimate | InjectiveGasEstimate | FeeEstimateTransaction,
        RawTxReturnType,
        SpokeChainKey
      >
    >();
  });

  it('narrows the estimate and the raw transaction per chain family', () => {
    expectTypeOf<For<BSC>>().toEqualTypeOf<Mutation<bigint, EvmRawTransaction, BSC>>();
    expectTypeOf<For<SONIC>>().toEqualTypeOf<Mutation<bigint, EvmRawTransaction, SONIC>>();
    expectTypeOf<For<ICON>>().toEqualTypeOf<Mutation<bigint, IconRawTransaction, ICON>>();
    expectTypeOf<For<SUI>>().toEqualTypeOf<Mutation<SuiGasEstimate, SuiRawTransaction, SUI>>();
    expectTypeOf<For<SOLANA>>().toEqualTypeOf<Mutation<number | undefined, SolanaRawTransaction, SOLANA>>();
    expectTypeOf<For<STELLAR>>().toEqualTypeOf<Mutation<bigint, StellarRawTransaction, STELLAR>>();
    expectTypeOf<For<INJECTIVE>>().toEqualTypeOf<Mutation<InjectiveGasEstimate, InjectiveRawTransaction, INJECTIVE>>();
    expectTypeOf<For<NEAR>>().toEqualTypeOf<Mutation<bigint, NearRawTransaction, NEAR>>();
    expectTypeOf<For<STACKS>>().toEqualTypeOf<Mutation<FeeEstimateTransaction, StacksRawTransaction, STACKS>>();
    expectTypeOf<For<BITCOIN>>().toEqualTypeOf<Mutation<bigint, BitcoinRawTransaction | string, BITCOIN>>();
  });

  it('types mutationOptions by the locked chain', () => {
    expectTypeOf<Parameters<typeof useEstimateGas<SUI>>>().toEqualTypeOf<
      [params?: MutationHookParams<SuiGasEstimate, { tx: SuiRawTransaction; chainKey: SUI }>]
    >();
  });

  it('rejects variables for another chain once the chain is locked', () => {
    const wrongTx = () =>
      // @ts-expect-error — a Stellar transaction is not an EVM one
      bscResult.mutate({ tx: stellarTx, chainKey: '0x38.bsc' });
    const wrongChain = () =>
      // @ts-expect-error — the chain key must be the locked one
      bscResult.mutateAsync({ tx: evmTx, chainKey: 'stellar' });
    expectTypeOf(wrongTx).toBeFunction();
    expectTypeOf(wrongChain).toBeFunction();
  });

  it('rejects a chain key outside the spoke-chain union', () => {
    // @ts-expect-error — not a spoke chain key
    expectTypeOf<ReturnType<typeof useEstimateGas<'not-a-chain'>>>().not.toBeAny();
  });
});
