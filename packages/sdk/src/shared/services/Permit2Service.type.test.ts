/**
 * Compile-time contract for `Permit2Service`: reads resolve to `Result<…>`, encoders to an
 * `EvmContractCall`, and write actions follow the trailing `raw` flag (`Hex` or `EvmRawTransaction`).
 */
import { describe, expectTypeOf, it } from 'vitest';
import type { Address, EvmContractCall, EvmRawTransaction, Hex, IEvmWalletProvider, Result } from '../../index.js';
import {
  type AllowanceInfo,
  type AllowanceTransferDetails,
  type PermitBatch,
  Permit2Service,
  type PermitSingle,
  type TokenSpenderPair,
} from './Permit2Service.js';

declare const a: Address;
declare const sig: Hex;
declare const evm: IEvmWalletProvider;
declare const isRaw: boolean;
declare const single: PermitSingle;
declare const batch: PermitBatch;
declare const transfers: AllowanceTransferDetails[];
declare const pairs: TokenSpenderPair[];

type Modes = readonly [Promise<Hex>, Promise<Hex>, Promise<EvmRawTransaction>, Promise<Hex | EvmRawTransaction>];

describe('Permit2Service', () => {
  it('write actions: omitted or false raw → Hex, true → EvmRawTransaction, boolean → both', () => {
    const rows = () =>
      ({
        approve: [
          Permit2Service.approve(a, a, a, a, 1n, 0, evm),
          Permit2Service.approve(a, a, a, a, 1n, 0, evm, false),
          Permit2Service.approve(a, a, a, a, 1n, 0, evm, true),
          Permit2Service.approve(a, a, a, a, 1n, 0, evm, isRaw),
        ],
        permit: [
          Permit2Service.permit(a, a, a, single, sig, evm),
          Permit2Service.permit(a, a, a, single, sig, evm, false),
          Permit2Service.permit(a, a, a, single, sig, evm, true),
          Permit2Service.permit(a, a, a, single, sig, evm, isRaw),
        ],
        permitBatch: [
          Permit2Service.permitBatch(a, a, a, batch, sig, evm),
          Permit2Service.permitBatch(a, a, a, batch, sig, evm, false),
          Permit2Service.permitBatch(a, a, a, batch, sig, evm, true),
          Permit2Service.permitBatch(a, a, a, batch, sig, evm, isRaw),
        ],
        transferFrom: [
          Permit2Service.transferFrom(a, a, a, a, 1n, a, evm),
          Permit2Service.transferFrom(a, a, a, a, 1n, a, evm, false),
          Permit2Service.transferFrom(a, a, a, a, 1n, a, evm, true),
          Permit2Service.transferFrom(a, a, a, a, 1n, a, evm, isRaw),
        ],
        transferFromBatch: [
          Permit2Service.transferFromBatch(a, a, transfers, evm),
          Permit2Service.transferFromBatch(a, a, transfers, evm, false),
          Permit2Service.transferFromBatch(a, a, transfers, evm, true),
          Permit2Service.transferFromBatch(a, a, transfers, evm, isRaw),
        ],
        lockdown: [
          Permit2Service.lockdown(a, a, pairs, evm),
          Permit2Service.lockdown(a, a, pairs, evm, false),
          Permit2Service.lockdown(a, a, pairs, evm, true),
          Permit2Service.lockdown(a, a, pairs, evm, isRaw),
        ],
        invalidateNonces: [
          Permit2Service.invalidateNonces(a, a, a, a, 1, evm),
          Permit2Service.invalidateNonces(a, a, a, a, 1, evm, false),
          Permit2Service.invalidateNonces(a, a, a, a, 1, evm, true),
          Permit2Service.invalidateNonces(a, a, a, a, 1, evm, isRaw),
        ],
      }) as const;
    expectTypeOf<ReturnType<typeof rows>>().toEqualTypeOf<{
      readonly approve: Modes;
      readonly permit: Modes;
      readonly permitBatch: Modes;
      readonly transferFrom: Modes;
      readonly transferFromBatch: Modes;
      readonly lockdown: Modes;
      readonly invalidateNonces: Modes;
    }>();
  });

  it('reads pin Result<AllowanceInfo> / Result<boolean>', () => {
    // Known gap against ADR 0001: declared as plain Result<T>, so the error is unknown.
    expectTypeOf<ReturnType<typeof Permit2Service.getAllowance>>().toEqualTypeOf<Promise<Result<AllowanceInfo>>>();
    expectTypeOf<AllowanceInfo>().toEqualTypeOf<{ amount: bigint; expiration: number; nonce: number }>();
    expectTypeOf<ReturnType<typeof Permit2Service.isAllowanceValid>>().toEqualTypeOf<Promise<Result<boolean>>>();
  });

  it('encoders return an EvmContractCall', () => {
    expectTypeOf<ReturnType<typeof Permit2Service.encodeApprove>>().toEqualTypeOf<EvmContractCall>();
    expectTypeOf<ReturnType<typeof Permit2Service.encodePermit>>().toEqualTypeOf<EvmContractCall>();
    expectTypeOf<ReturnType<typeof Permit2Service.encodeTransferFrom>>().toEqualTypeOf<EvmContractCall>();
    expectTypeOf<ReturnType<typeof Permit2Service.encodeTransferFromBatch>>().toEqualTypeOf<EvmContractCall>();
  });
});
