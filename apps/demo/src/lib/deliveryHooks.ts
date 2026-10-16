import { HookKind, isHookSupportedToken, type HookRequest, type SpokeChainKey } from '@sodax/dapp-kit';

// Shared by both swap panels (`components/swaps` drives the SDK directly, `components/swaps-api`
// goes through the Swaps API), so a newly registered hook needs one label, not one per panel.
//
// Typed as a total Record so registering a new `HookKind` fails to compile here until it gets a
// label, rather than silently rendering an unlabelled checkbox.
export const HOOK_LABELS: Record<HookKind, string> = {
  [HookKind.HYPERCORE_DEPOSIT]: 'Deposit to HyperCore (perps)',
  [HookKind.FLINT_DEPOSIT]: 'Deposit to Flint (RWA vault)',
};

// The hook kind (if any) the registry accepts for a destination chain + output token. Shared so
// both panels resolve it identically — including tie-breaking, should a chain+token ever match more
// than one registered kind — instead of each hand-rolling the same `Object.values(HookKind).find`.
export const resolveAvailableHookKind = (
  chainKey: SpokeChainKey,
  tokenAddress: string | undefined,
): HookKind | undefined => {
  if (!tokenAddress) return undefined;
  return Object.values(HookKind).find(kind => isHookSupportedToken(chainKey, kind, tokenAddress));
};

// The SDK's `HookRequest` is a discriminated union, so a widened `HookKind` is not assignable to it
// directly. Switching per kind keeps that type-safe without a cast, and the `default` branch makes a
// new kind a compile error (the `HookRequest` return type also forces every case to construct one, not
// just the two cases below). (The wire type `HookRequestV2` is a plain `{ kind: HookKind }` and needs
// no such helper.)
export const toHookRequest = (kind: HookKind): HookRequest => {
  switch (kind) {
    case HookKind.HYPERCORE_DEPOSIT:
      return { kind: HookKind.HYPERCORE_DEPOSIT } as const;
    case HookKind.FLINT_DEPOSIT:
      return { kind: HookKind.FLINT_DEPOSIT } as const;
    default:
      return kind satisfies never;
  }
};
