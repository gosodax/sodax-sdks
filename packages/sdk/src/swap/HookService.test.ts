/**
 * Tests for HookService — delivery-hook resolution + payload encoding for solver intents.
 *
 * Covers the public statics:
 *   - `encodeDeliveryData` — the single, type-differentiated payload encoder.
 *   - `resolveDeliveryHook` — registry lookup fused with the codec (address + payload together).
 *   - `resolveDelivery` — the CreateIntentParams entry point (hook vs. low-level pass-through).
 *
 * The hook registry (addresses) lives in `@sodax/types`; these tests assert against it via
 * `getSpokeHook` so a registry change is reflected rather than hard-coded here.
 */
import { describe, expect, it } from 'vitest';
import { ChainKeys, HookKind, getSpokeHook } from '@sodax/types';
import { encodeAbiParameters } from 'viem';
import { HookService } from './HookService.js';
import type { CreateIntentParams } from '../shared/types/intent-types.js';

const HC_RECIPIENT = '0x00000000000000000000000000000000000000Ad' as const;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

describe('HookService.encodeDeliveryData', () => {
  it('encodes the HyperCore and Flint payloads as abi.encode(address) (32 bytes)', () => {
    for (const kind of [HookKind.HYPERCORE_DEPOSIT, HookKind.FLINT_DEPOSIT] as const) {
      const encoded = HookService.encodeDeliveryData({ kind }, HC_RECIPIENT);
      expect(encoded).toBe(encodeAbiParameters([{ name: 'recipient', type: 'address' }], [HC_RECIPIENT]));
      expect((encoded.length - 2) / 2).toBe(32);
    }
  });

  // A zero recipient makes the destination receiver revert, which wedges the cross-chain message
  // unrecoverably — so it must fail here, before an intent exists.
  // The guard runs before the per-kind switch, so one kind covers it.
  it('rejects a zero-address recipient', () => {
    expect(() => HookService.encodeDeliveryData({ kind: HookKind.FLINT_DEPOSIT }, ZERO_ADDRESS)).toThrow(
      /zero address/,
    );
  });

  it('throws on an unknown hook kind', () => {
    expect(() =>
      HookService.encodeDeliveryData(
        { kind: 'notAHook' } as unknown as { kind: typeof HookKind.HYPERCORE_DEPOSIT },
        HC_RECIPIENT,
      ),
    ).toThrow();
  });
});

describe('HookService.resolveDeliveryHook', () => {
  it('throws when the requested hook is not deployed on the chain', () => {
    expect(() =>
      HookService.resolveDeliveryHook(ChainKeys.ETHEREUM_MAINNET, { kind: HookKind.HYPERCORE_DEPOSIT }, HC_RECIPIENT),
    ).toThrow();
  });
});

describe('HookService.resolveDelivery', () => {
  const base = (): CreateIntentParams => ({
    inputToken: '0x1111111111111111111111111111111111111111',
    outputToken: '0x2222222222222222222222222222222222222222',
    inputAmount: 1_000_000n,
    minOutputAmount: 0n,
    deadline: 0n,
    allowPartialFill: false,
    srcChainKey: ChainKeys.BSC_MAINNET,
    dstChainKey: ChainKeys.HYPEREVM_MAINNET,
    srcAddress: HC_RECIPIENT,
    dstAddress: HC_RECIPIENT,
    data: '0x',
  });

  it('passes through dstAddress + low-level deliveryData when no hook is set', () => {
    const params = { ...base(), deliveryData: '0xdeadbeef' as const };
    expect(HookService.resolveDelivery(params)).toEqual({ dstAddress: HC_RECIPIENT, deliveryData: '0xdeadbeef' });
  });

  // This is the function EvmSolverService/SonicSpokeService actually call to apply a hook, so both hook kinds
  // run through it here, not just through the lower-level resolveDeliveryHook lookup above.
  it('overrides dstAddress with the hook and derives deliveryData when a HyperCore or Flint hook is set', () => {
    for (const [dstChainKey, kind] of [
      [ChainKeys.HYPEREVM_MAINNET, HookKind.HYPERCORE_DEPOSIT],
      [ChainKeys.ETHEREUM_MAINNET, HookKind.FLINT_DEPOSIT],
    ] as const) {
      const params = { ...base(), dstChainKey, hook: { kind } };
      expect(HookService.resolveDelivery(params)).toEqual({
        dstAddress: getSpokeHook(dstChainKey, kind)?.address,
        deliveryData: HookService.encodeDeliveryData({ kind }, HC_RECIPIENT),
      });
    }
  });
});
