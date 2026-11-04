import type { Address, GetChainType, Hex, IntentRelayChainId, PartnerFee, SpokeChainKey, HookKind } from '@sodax/types';
/**
 * High-level request for routing an intent's output through a deployed delivery hook. Pick a hook by
 * its {@link HookKind}; the SDK resolves the hook's deployed address and encodes the payload it expects
 * (so address and codec can never drift). The recipient is taken from the intent's `dstAddress`.
 *
 * Prefer this over setting {@link CreateIntentParams.deliveryData} + `dstAddress` by hand — those remain
 * available as a low-level escape hatch for hooks not yet in the registry.
 */
export type HookRequest =
  | { kind: typeof HookKind.HYPERCORE_DEPOSIT }
  // Flint takes no extra params: the recipient comes from `dstAddress`, and the vault's referral
  // attribution is configured on the deployed hook rather than carried per-intent.
  | { kind: typeof HookKind.FLINT_DEPOSIT };
// Future hooks that need extra params become additional union members, e.g.
//   | { kind: typeof HookKind.SOME_HOOK; someParam: Address };

export type CreateIntentParams<K extends SpokeChainKey = SpokeChainKey> = {
  inputToken: string;
  outputToken: string;
  inputAmount: bigint;
  minOutputAmount: bigint;
  deadline: bigint;
  allowPartialFill: boolean;
  srcChainKey: K;
  dstChainKey: SpokeChainKey;
  srcAddress: string;
  dstAddress: string;
  solver?: Address; // Optional specific solver address (address(0) = any solver)
  data: Hex;
  /**
   * High-level delivery-hook selector. When set, the SDK routes the output through the chosen hook:
   * it overrides `dstAddress` with the hook's deployed address and encodes `deliveryData` from this
   * request (the recipient is the `dstAddress` you supply). This is the preferred way to use hooks —
   * the hook address and its payload codec come from the registry, so they can never drift.
   */
  hook?: HookRequest;
  /**
   * Low-level delivery payload forwarded with the output transfer — an escape hatch for hooks not in
   * the registry. On arrival at the destination spoke, `SpokeAssetManager` calls
   * `ISpokeReceiver(dstAddress).hook(token, amount, deliveryData)`. Opaque bytes whose schema is
   * defined by the destination receiver; when set, you must also point `dstAddress` at that receiver.
   * Prefer {@link hook} when the target is a registered hook. Ignored when {@link hook} is set.
   */
  deliveryData?: Hex;
};

/**
 * Parameters for creating a limit order intent.
 * Makes the `deadline` field optional for limit orders.
 */
export type CreateLimitOrderParams<K extends SpokeChainKey = SpokeChainKey> = Omit<
  CreateIntentParams<K>,
  'deadline'
> & { deadline?: bigint };

// srcPublicKey only matters for Stacks (its `SP…` address can't be derived at raw-tx build time);
// key it off K so non-Stacks actions can't set it.
type SrcPublicKeySlot<K extends SpokeChainKey> =
  GetChainType<K> extends 'STACKS' ? { srcPublicKey?: string } : { srcPublicKey?: never };

/** Bound Exchange (Radfi) inputs for raw Bitcoin TRADING-mode swap intents. */
export type BitcoinBoundExtras = {
  /** Bound token, for raw Bitcoin TRADING callers; falls back to the RadfiProvider instance token when omitted. */
  accessToken?: string;
};

// Grouped so future Bound inputs (trading mode, refresh token) extend BitcoinBoundExtras instead of
// adding a top-level extras slot per field. Keyed off K so non-Bitcoin actions can't set it.
type BitcoinBoundSlot<K extends SpokeChainKey> =
  GetChainType<K> extends 'BITCOIN' ? { bound?: BitcoinBoundExtras } : { bound?: never };

/**
 * Per-action extras for swap intent creation, supplied via the `extras` slot of the swap
 * action params.
 */
export type SwapExtras<K extends SpokeChainKey = SpokeChainKey> = {
  /** Overrides the configured swap partner fee for this action; falls back to config when omitted. */
  partnerFee?: PartnerFee;
  /**
   * Overrides the configured backend API key for this action's backend submit-tx leg; sent as the
   * `x-api-key` header. Falls back to config when omitted.
   */
  apiKey?: string;
} & SrcPublicKeySlot<K> &
  BitcoinBoundSlot<K>;

export type Intent = {
  intentId: bigint;
  creator: Address;
  inputToken: Address;
  outputToken: Address;
  inputAmount: bigint;
  minOutputAmount: bigint;
  deadline: bigint;
  allowPartialFill: boolean;
  srcChain: IntentRelayChainId;
  dstChain: IntentRelayChainId;
  srcAddress: Hex;
  dstAddress: Hex;
  solver: Address;
  data: Hex;
};

export enum IntentDataType {
  ARRAY = 0,
  FEE = 1,
  HOOK = 2,
  DELIVERY = 3,
}

export type FeeData = {
  fee: bigint;
  receiver: Address;
};

export type IntentData = {
  type: IntentDataType;
  data: Hex;
};

export type IntentState = {
  exists: boolean;
  remainingInput: bigint;
  receivedOutput: bigint;
  pendingPayment: boolean;
};
