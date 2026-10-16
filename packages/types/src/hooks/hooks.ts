// Delivery-hook registry for solver intents.
//
// When an intent's output is delivered on a spoke chain, the `SpokeAssetManager` can call
// `ISpokeReceiver(dstAddress).hook(token, amount, deliveryData)` instead of transferring the
// tokens straight to the recipient. Each deployed hook contract is identified here by a stable
// `HookKind` plus its per-chain address, so consumers never hardcode addresses and the address
// can never drift from the payload codec that targets it (the codec lives in `@sodax/sdk`).

import type { Address } from '../shared/shared.js';
import type { SpokeChainKey } from '../chains/chains.js';
import { ChainKeys, spokeChainConfig } from '../chains/chains.js';

/**
 * Stable identifier for a deployed delivery-hook contract. The string value is the discriminant
 * used by the SDK's hook resolver (`EvmSolverService.resolveDeliveryHook`) to pick the codec.
 */
export const HookKind = {
  /** Deposits delivered USDC into the recipient's HyperCore perps account (HyperEVM). */
  HYPERCORE_DEPOSIT: 'hyperCoreDeposit',
  /**
   * Requests an ERC-7540 deposit of delivered USDC into the Flint RWA vault (Ethereum), with the
   * recipient as the request's controller. Asynchronous: the request mints no shares — Flint's
   * curator settles a NAV and then claims the shares on the controller's behalf.
   */
  FLINT_DEPOSIT: 'flintDeposit',
} as const;
export type HookKind = (typeof HookKind)[keyof typeof HookKind];

export type SpokeHookConfig = {
  kind: HookKind;
  /** Deployed hook contract address on the chain it is registered under. */
  address: Address;
  /**
   * Spoke-token addresses (on the hook's own chain) this hook accepts as the delivered output.
   * `undefined` means no token restriction. HyperCore, for example, only credits USDC. Reference
   * the canonical token addresses from `spokeChainConfig` rather than hardcoding literals.
   */
  supportedTokens?: readonly string[];
};

/**
 * Deployed delivery hooks, keyed by the chain they live on. Many hooks per chain and many chains
 * are supported — add an entry to grow coverage. `Partial` because most chains have no hooks.
 */
export const spokeHooks = {
  [ChainKeys.HYPEREVM_MAINNET]: [
    {
      kind: HookKind.HYPERCORE_DEPOSIT,
      address: '0xc79224a4DEE653C9a26572B941149d95a88432c4',
      supportedTokens: [spokeChainConfig[ChainKeys.HYPEREVM_MAINNET].supportedTokens.USDC.address], // USDC on HyperEVM
    },
  ],
  [ChainKeys.ETHEREUM_MAINNET]: [
    {
      kind: HookKind.FLINT_DEPOSIT,
      // FlintDepositHook, deployed 2026-08-10 (icon-project/sodax-contracts#693). USDC only: any
      // other delivered token is handed to the recipient as a plain transfer by the hook itself.
      address: '0xDf376dE34e9f1474A025Dfe411b7EB5541793C5d',
      supportedTokens: [spokeChainConfig[ChainKeys.ETHEREUM_MAINNET].supportedTokens.USDC.address], // USDC on Ethereum
    },
  ],
} as const satisfies Partial<Record<SpokeChainKey, readonly SpokeHookConfig[]>>;

/** Returns the deployed hook of the given kind on `chainKey`, or `undefined` if none is registered. */
export const getSpokeHook = (chainKey: SpokeChainKey, kind: HookKind): SpokeHookConfig | undefined =>
  spokeHooks[chainKey as keyof typeof spokeHooks]?.find(h => h.kind === kind);

/** Returns every hook deployed on `chainKey` (empty when none). */
export const getSpokeHooks = (chainKey: SpokeChainKey): readonly SpokeHookConfig[] =>
  spokeHooks[chainKey as keyof typeof spokeHooks] ?? [];

/**
 * Whether a hook of `kind` on `chainKey` accepts `token` (case-insensitive) as the delivered output.
 * `false` when the hook is not deployed there; `true` when the hook has no token restriction.
 */
export const isHookSupportedToken = (chainKey: SpokeChainKey, kind: HookKind, token: string): boolean => {
  const hook = getSpokeHook(chainKey, kind);
  if (!hook) {
    return false;
  }
  return !hook.supportedTokens || hook.supportedTokens.some(t => t.toLowerCase() === token.toLowerCase());
};
