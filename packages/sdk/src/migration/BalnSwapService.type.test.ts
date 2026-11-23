/**
 * Compile-time contract: BALN lock actions run on the Sonic hub and type their result by execution mode
 * (`walletProvider` → `Hex`, `raw: true` → `EvmRawTransaction`), unwrapped, with no `Result`. The
 * encoders and lookups return their fixed types.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type {
  Address,
  BalnLockParams,
  ChainKeys,
  DetailedLock,
  EvmContractCall,
  EvmRawTransaction,
  Hex,
  IEvmWalletProvider,
  IIconWalletProvider,
  WalletProviderSlot,
} from '../index.js';
import type { BalnSwapService } from './BalnSwapService.js';

type SONIC = typeof ChainKeys.SONIC_MAINNET;

declare const svc: BalnSwapService;
declare const evm: IEvmWalletProvider;
declare const icon: IIconWalletProvider;
declare const user: Address;
declare const lock: BalnLockParams;
declare const hubCall: EvmContractCall;
declare const isRaw: boolean;

// [walletProvider, raw: false, raw: true, runtime boolean] per action. Never invoked.
const rows = (slot: WalletProviderSlot<SONIC, boolean>) =>
  ({
    claim: [
      svc.claim(user, lock, { walletProvider: evm }),
      svc.claim(user, lock, { raw: false, walletProvider: evm }),
      svc.claim(user, lock, { raw: true }),
      svc.claim(user, lock, slot),
    ],
    claimUnstaked: [
      svc.claimUnstaked(user, lock, { walletProvider: evm }),
      svc.claimUnstaked(user, lock, { raw: false, walletProvider: evm }),
      svc.claimUnstaked(user, lock, { raw: true }),
      svc.claimUnstaked(user, lock, slot),
    ],
    stake: [
      svc.stake(user, lock, { walletProvider: evm }),
      svc.stake(user, lock, { raw: false, walletProvider: evm }),
      svc.stake(user, lock, { raw: true }),
      svc.stake(user, lock, slot),
    ],
    unstake: [
      svc.unstake(user, lock, { walletProvider: evm }),
      svc.unstake(user, lock, { raw: false, walletProvider: evm }),
      svc.unstake(user, lock, { raw: true }),
      svc.unstake(user, lock, slot),
    ],
    cancelUnstake: [
      svc.cancelUnstake(user, lock, { walletProvider: evm }),
      svc.cancelUnstake(user, lock, { raw: false, walletProvider: evm }),
      svc.cancelUnstake(user, lock, { raw: true }),
      svc.cancelUnstake(user, lock, slot),
    ],
    call: [
      svc.call(user, hubCall, { walletProvider: evm }),
      svc.call(user, hubCall, { raw: false, walletProvider: evm }),
      svc.call(user, hubCall, { raw: true }),
      svc.call(user, hubCall, slot),
    ],
  }) as const;

type Mode = readonly [Promise<Hex>, Promise<Hex>, Promise<EvmRawTransaction>, Promise<Hex | EvmRawTransaction>];

describe('BalnSwapService', () => {
  it('lock actions and call narrow by execution mode on the hub', () => {
    expectTypeOf<ReturnType<typeof rows>>().toEqualTypeOf<{
      readonly claim: Mode;
      readonly claimUnstaked: Mode;
      readonly stake: Mode;
      readonly unstake: Mode;
      readonly cancelUnstake: Mode;
      readonly call: Mode;
    }>();
  });

  it('rejects a mixed mode, a missing provider and a non-hub wallet', () => {
    const calls = () => [
      // @ts-expect-error — raw: true forbids walletProvider.
      svc.stake(user, lock, { raw: true, walletProvider: evm }),
      // @ts-expect-error — a signed call needs a walletProvider.
      svc.claim(user, lock, {}),
      // @ts-expect-error — the hub is EVM; an ICON wallet cannot sign there.
      svc.unstake(user, lock, { walletProvider: icon }),
      // @ts-expect-error — a non-literal boolean cannot pick a branch in an object literal.
      svc.call(user, hubCall, { raw: isRaw }),
    ];
    expectTypeOf(calls).toBeFunction();
  });

  it('getMultiplierForPeriod and calculateSodaAmount → bigint', () => {
    expectTypeOf<ReturnType<BalnSwapService['getMultiplierForPeriod']>>().toEqualTypeOf<bigint>();
    expectTypeOf<ReturnType<BalnSwapService['calculateSodaAmount']>>().toEqualTypeOf<bigint>();
  });

  it('swapData → Hex', () => {
    expectTypeOf<ReturnType<BalnSwapService['swapData']>>().toEqualTypeOf<Hex>();
  });

  it('getDetailedUserLocks → Promise<readonly DetailedLock[]>', () => {
    expectTypeOf<ReturnType<BalnSwapService['getDetailedUserLocks']>>().toEqualTypeOf<
      Promise<readonly DetailedLock[]>
    >();
  });

  it('encoders → EvmContractCall', () => {
    expectTypeOf<ReturnType<BalnSwapService['encodeSwap']>>().toEqualTypeOf<EvmContractCall>();
    expectTypeOf<ReturnType<BalnSwapService['encodeClaim']>>().toEqualTypeOf<EvmContractCall>();
    expectTypeOf<ReturnType<BalnSwapService['encodeClaimUnstaked']>>().toEqualTypeOf<EvmContractCall>();
    expectTypeOf<ReturnType<BalnSwapService['encodeStake']>>().toEqualTypeOf<EvmContractCall>();
    expectTypeOf<ReturnType<BalnSwapService['encodeUnstake']>>().toEqualTypeOf<EvmContractCall>();
    expectTypeOf<ReturnType<BalnSwapService['encodeCancelUnstake']>>().toEqualTypeOf<EvmContractCall>();
  });
});
