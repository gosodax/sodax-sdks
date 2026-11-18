/**
 * Compile-time contract for `Erc20Service`: `approve` follows the execution mode (`Hex` or
 * `EvmRawTransaction`); reads, planning and encoders pin one exact result type each.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type {
  ChainKeys,
  EvmContractCall,
  EvmRawTransaction,
  Hex,
  IEvmWalletProvider,
  ISolanaWalletProvider,
  Result,
} from '../../../index.js';
import {
  type Erc20ApprovalPlan,
  type Erc20ApproveParams,
  type Erc20IsAllowanceParams,
  Erc20Service,
  type Erc20Token,
} from './Erc20Service.js';

type Flat<A> = Omit<A, 'raw' | 'walletProvider'>;

declare const evm: IEvmWalletProvider;
declare const solana: ISolanaWalletProvider;
declare const approveP: Flat<Erc20ApproveParams<false>>;
declare const bscAllowance: Erc20IsAllowanceParams<typeof ChainKeys.BSC_MAINNET>;
declare const sonicAllowance: Erc20IsAllowanceParams<typeof ChainKeys.SONIC_MAINNET>;

describe('Erc20Service', () => {
  it('approve: walletProvider or raw: false → Hex, raw: true → EvmRawTransaction, boolean → both', () => {
    const rows = () =>
      [
        Erc20Service.approve({ ...approveP, walletProvider: evm }),
        Erc20Service.approve({ ...approveP, raw: false, walletProvider: evm }),
        Erc20Service.approve({ ...approveP, raw: true }),
      ] as const;
    expectTypeOf<ReturnType<typeof rows>>().toEqualTypeOf<
      readonly [Promise<Hex>, Promise<Hex>, Promise<EvmRawTransaction>]
    >();
    const runtime = (p: Erc20ApproveParams<boolean>) => Erc20Service.approve(p);
    expectTypeOf<ReturnType<typeof runtime>>().toEqualTypeOf<Promise<Hex | EvmRawTransaction>>();
    const invalid = () => [
      // @ts-expect-error — raw: true forbids walletProvider.
      Erc20Service.approve({ ...approveP, raw: true, walletProvider: evm }),
      // @ts-expect-error — ERC-20 approvals need an EVM wallet provider.
      Erc20Service.approve({ ...approveP, walletProvider: solana }),
    ];
    expectTypeOf(invalid).toBeFunction();
  });

  it('isAllowanceValid resolves to Result<boolean> for spoke and hub EVM chains', () => {
    const rows = () =>
      [Erc20Service.isAllowanceValid(bscAllowance), Erc20Service.isAllowanceValid(sonicAllowance)] as const;
    // Known gap against ADR 0001: the error is a caught value returned as thrown, so it is unknown.
    expectTypeOf<ReturnType<typeof rows>>().toEqualTypeOf<
      readonly [Promise<Result<boolean>>, Promise<Result<boolean>>]
    >();
  });

  it('reads, planning and encoders pin one result type', () => {
    expectTypeOf<ReturnType<typeof Erc20Service.getErc20Token>>().toEqualTypeOf<Promise<Erc20Token>>();
    expectTypeOf<ReturnType<typeof Erc20Service.getAllowance>>().toEqualTypeOf<Promise<bigint>>();
    expectTypeOf<ReturnType<typeof Erc20Service.planApproval>>().toEqualTypeOf<Promise<Erc20ApprovalPlan>>();
    expectTypeOf<Erc20ApprovalPlan['reason']>().toEqualTypeOf<
      | 'native-token'
      | 'zero-allowance'
      | 'probe-passed'
      | 'reset-required'
      | 'reset-not-viable'
      | 'allowance-read-failed'
    >();
    expectTypeOf<ReturnType<typeof Erc20Service.encodeTransfer>>().toEqualTypeOf<EvmContractCall>();
    expectTypeOf<ReturnType<typeof Erc20Service.encodeTransferFrom>>().toEqualTypeOf<EvmContractCall>();
    expectTypeOf<ReturnType<typeof Erc20Service.encodeApprove>>().toEqualTypeOf<EvmContractCall>();
  });
});
