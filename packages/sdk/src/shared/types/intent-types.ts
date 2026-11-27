import type { Address, GetChainType, Hex, IntentRelayChainId, PartnerFee, SpokeChainKey, HookKind } from '@sodax/types';
/** Routes the output through a registered delivery hook; the SDK resolves its address and payload codec so they can't drift. */
export type HookRequest =
  | { kind: typeof HookKind.HYPERCORE_DEPOSIT }
  // Flint's referral attribution is configured on the deployed hook, not carried per-intent.
  | { kind: typeof HookKind.FLINT_DEPOSIT };

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
  /** Preferred over `deliveryData`: overrides `dstAddress` with the hook's address; the recipient is the `dstAddress` you supply. */
  hook?: HookRequest;
  /**
   * Escape hatch for unregistered hooks: the destination calls `ISpokeReceiver(dstAddress).hook(token, amount, deliveryData)`,
   * so point `dstAddress` at that receiver. Ignored when {@link hook} is set.
   */
  deliveryData?: Hex;
};

export type CreateLimitOrderParams<K extends SpokeChainKey = SpokeChainKey> = Omit<
  CreateIntentParams<K>,
  'deadline'
> & { deadline?: bigint };

// Only Stacks needs srcPublicKey (its `SP…` address can't be derived at raw-tx build time).
type SrcPublicKeySlot<K extends SpokeChainKey> =
  GetChainType<K> extends 'STACKS' ? { srcPublicKey?: string } : { srcPublicKey?: never };

/** Bound Exchange (Radfi) inputs for raw Bitcoin TRADING-mode swap intents. */
export type BitcoinBoundExtras = {
  /** Falls back to the RadfiProvider instance token when omitted. */
  accessToken?: string;
};

// Grouped so future Bound inputs extend BitcoinBoundExtras instead of adding top-level extras slots.
type BitcoinBoundSlot<K extends SpokeChainKey> =
  GetChainType<K> extends 'BITCOIN' ? { bound?: BitcoinBoundExtras } : { bound?: never };

export type SwapExtras<K extends SpokeChainKey = SpokeChainKey> = {
  /** Falls back to the configured swap partner fee when omitted. */
  partnerFee?: PartnerFee;
  /** Sent as `x-api-key` on this action's backend submit-tx leg; falls back to config when omitted. */
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
