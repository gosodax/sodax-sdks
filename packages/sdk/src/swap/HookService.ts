import { type Address, encodeAbiParameters } from 'viem';
import { HookKind, getSpokeHook, type Hex, type SpokeChainKey } from '@sodax/types';
import { invariant } from '../shared/utils/tiny-invariant.js';
import type { CreateIntentParams, HookRequest } from '../shared/types/intent-types.js';

/** `deliveryData` schema each deployed hook's `hook(token, amount, deliveryData)` decodes, by {@link HookKind}. */
const HOOK_DELIVERY_ABI = {
  // The HyperCore account to credit.
  [HookKind.HYPERCORE_DEPOSIT]: [{ name: 'recipient', type: 'address' }],
  // The ERC-7540 controller that owns the resulting flUSD shares; separate entry so it can diverge from HyperCore.
  [HookKind.FLINT_DEPOSIT]: [{ name: 'recipient', type: 'address' }],
} as const satisfies Record<HookKind, readonly { name: string; type: string }[]>;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/** Exhaustiveness check: a missing {@link HookKind} case fails to compile; the throw covers untyped JS. */
const assertUnsupportedHook = (request: never): never => {
  throw new Error(
    `[HookService.encodeDeliveryData] Unsupported delivery hook kind: ${(request as { kind: string }).kind}`,
  );
};

/** Fuses each delivery hook's deployed address (from `@sodax/types`) with its `deliveryData` codec so they cannot drift. */
export class HookService {
  private constructor() {}

  /** Rejects the zero recipient: the hook would revert in `SpokeAssetManager.recvMessage` and wedge the message forever. */
  public static encodeDeliveryData(request: HookRequest, recipient: string): Hex {
    invariant(
      recipient.toLowerCase() !== ZERO_ADDRESS,
      '[HookService.encodeDeliveryData] recipient (dstAddress) must not be the zero address',
    );

    switch (request.kind) {
      case HookKind.HYPERCORE_DEPOSIT:
        return encodeAbiParameters(HOOK_DELIVERY_ABI[HookKind.HYPERCORE_DEPOSIT], [recipient as Address]);
      case HookKind.FLINT_DEPOSIT:
        return encodeAbiParameters(HOOK_DELIVERY_ABI[HookKind.FLINT_DEPOSIT], [recipient as Address]);
      default:
        return assertUnsupportedHook(request);
    }
  }

  public static resolveDeliveryHook(
    chainKey: SpokeChainKey,
    request: HookRequest,
    recipient: string,
  ): { dstAddress: Address; deliveryData: Hex } {
    const hook = getSpokeHook(chainKey, request.kind);
    invariant(hook, `No '${request.kind}' delivery hook is deployed on chain ${chainKey}`);

    return { dstAddress: hook.address, deliveryData: HookService.encodeDeliveryData(request, recipient) };
  }

  /** With `params.hook`, the hook address overrides `dstAddress`; otherwise the caller's values pass through. */
  public static resolveDelivery(params: CreateIntentParams): { dstAddress: string; deliveryData: Hex | undefined } {
    if (!params.hook) {
      return { dstAddress: params.dstAddress, deliveryData: params.deliveryData };
    }
    return HookService.resolveDeliveryHook(params.dstChainKey, params.hook, params.dstAddress);
  }
}
