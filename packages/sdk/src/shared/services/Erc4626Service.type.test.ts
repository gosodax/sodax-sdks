/**
 * Compile-time contract for `Erc4626Service`: reads resolve to `Result<…>`, encoders to an
 * `EvmContractCall`, and write actions follow the trailing `raw` flag (`Hex` or `EvmRawTransaction`).
 */
import { describe, expectTypeOf, it } from 'vitest';
import type { Address, EvmContractCall, EvmRawTransaction, Hex, IEvmWalletProvider, Result } from '../../index.js';
import { Erc4626Service } from './Erc4626Service.js';

declare const vault: Address;
declare const user: Address;
declare const evm: IEvmWalletProvider;
declare const isRaw: boolean;

type Modes = readonly [Promise<Hex>, Promise<Hex>, Promise<EvmRawTransaction>, Promise<Hex | EvmRawTransaction>];

describe('Erc4626Service', () => {
  it('write actions: omitted or false raw → Hex, true → EvmRawTransaction, boolean → both', () => {
    const rows = () =>
      ({
        deposit: [
          Erc4626Service.deposit(vault, 1n, user, evm),
          Erc4626Service.deposit(vault, 1n, user, evm, false),
          Erc4626Service.deposit(vault, 1n, user, evm, true),
          Erc4626Service.deposit(vault, 1n, user, evm, isRaw),
        ],
        mint: [
          Erc4626Service.mint(vault, 1n, user, evm),
          Erc4626Service.mint(vault, 1n, user, evm, false),
          Erc4626Service.mint(vault, 1n, user, evm, true),
          Erc4626Service.mint(vault, 1n, user, evm, isRaw),
        ],
        withdraw: [
          Erc4626Service.withdraw(vault, 1n, user, user, evm),
          Erc4626Service.withdraw(vault, 1n, user, user, evm, false),
          Erc4626Service.withdraw(vault, 1n, user, user, evm, true),
          Erc4626Service.withdraw(vault, 1n, user, user, evm, isRaw),
        ],
        redeem: [
          Erc4626Service.redeem(vault, 1n, user, user, evm),
          Erc4626Service.redeem(vault, 1n, user, user, evm, false),
          Erc4626Service.redeem(vault, 1n, user, user, evm, true),
          Erc4626Service.redeem(vault, 1n, user, user, evm, isRaw),
        ],
      }) as const;
    expectTypeOf<ReturnType<typeof rows>>().toEqualTypeOf<{
      readonly deposit: Modes;
      readonly mint: Modes;
      readonly withdraw: Modes;
      readonly redeem: Modes;
    }>();
  });

  it('reads pin Result<Address> / Result<bigint>', () => {
    expectTypeOf<ReturnType<typeof Erc4626Service.getAsset>>().toEqualTypeOf<Promise<Result<Address>>>();
    type Big = Promise<Result<bigint>>;
    expectTypeOf<ReturnType<typeof Erc4626Service.getTotalAssets>>().toEqualTypeOf<Big>();
    expectTypeOf<ReturnType<typeof Erc4626Service.convertToShares>>().toEqualTypeOf<Big>();
    expectTypeOf<ReturnType<typeof Erc4626Service.convertToAssets>>().toEqualTypeOf<Big>();
    expectTypeOf<ReturnType<typeof Erc4626Service.getMaxDeposit>>().toEqualTypeOf<Big>();
    expectTypeOf<ReturnType<typeof Erc4626Service.previewDeposit>>().toEqualTypeOf<Big>();
    expectTypeOf<ReturnType<typeof Erc4626Service.getMaxMint>>().toEqualTypeOf<Big>();
    expectTypeOf<ReturnType<typeof Erc4626Service.previewMint>>().toEqualTypeOf<Big>();
    expectTypeOf<ReturnType<typeof Erc4626Service.getMaxWithdraw>>().toEqualTypeOf<Big>();
    expectTypeOf<ReturnType<typeof Erc4626Service.previewWithdraw>>().toEqualTypeOf<Big>();
    expectTypeOf<ReturnType<typeof Erc4626Service.getMaxRedeem>>().toEqualTypeOf<Big>();
    expectTypeOf<ReturnType<typeof Erc4626Service.previewRedeem>>().toEqualTypeOf<Big>();
  });

  it('encoders return an EvmContractCall', () => {
    expectTypeOf<ReturnType<typeof Erc4626Service.encodeDeposit>>().toEqualTypeOf<EvmContractCall>();
    expectTypeOf<ReturnType<typeof Erc4626Service.encodeMint>>().toEqualTypeOf<EvmContractCall>();
    expectTypeOf<ReturnType<typeof Erc4626Service.encodeWithdraw>>().toEqualTypeOf<EvmContractCall>();
    expectTypeOf<ReturnType<typeof Erc4626Service.encodeRedeem>>().toEqualTypeOf<EvmContractCall>();
  });
});
