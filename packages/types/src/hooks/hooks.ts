// On delivery `SpokeAssetManager` may call `ISpokeReceiver(dst).hook(token, amount, deliveryData)` instead of a
// transfer; addresses live here so they never drift from the payload codec in `@sodax/sdk`.

import type { Address } from '../shared/shared.js';
import type { SpokeChainKey } from '../chains/chains.js';
import { ChainKeys, spokeChainConfig } from '../chains/chains.js';

/** The string value is the discriminant `EvmSolverService.resolveDeliveryHook` uses to pick the codec. */
export const HookKind = {
  /** Deposits delivered USDC into the recipient's HyperCore perps account (HyperEVM). */
  HYPERCORE_DEPOSIT: 'hyperCoreDeposit',
  /** ERC-7540 deposit request into the Flint RWA vault (Ethereum), recipient as controller; mints no shares —
   * Flint's curator settles a NAV and then claims the shares on the controller's behalf. */
  FLINT_DEPOSIT: 'flintDeposit',
} as const;
export type HookKind = (typeof HookKind)[keyof typeof HookKind];

export type SpokeHookConfig = {
  kind: HookKind;
  address: Address;
  /** Tokens the hook acts on (others are plainly transferred); `undefined` = all. Metadata only: the backend must not
   * reject a mismatched `outputToken` because of it. Use `spokeChainConfig`, not literals. */
  supportedTokens?: readonly string[];
};

export const spokeHooks = {
  [ChainKeys.HYPEREVM_MAINNET]: [
    {
      kind: HookKind.HYPERCORE_DEPOSIT,
      address: '0xc79224a4DEE653C9a26572B941149d95a88432c4',
      supportedTokens: [spokeChainConfig[ChainKeys.HYPEREVM_MAINNET].supportedTokens.USDC.address],
    },
  ],
  [ChainKeys.ETHEREUM_MAINNET]: [
    {
      kind: HookKind.FLINT_DEPOSIT,
      // FlintDepositHook (icon-project/sodax-contracts#693). Any non-USDC delivered token is plainly transferred by the hook.
      address: '0xDf376dE34e9f1474A025Dfe411b7EB5541793C5d',
      supportedTokens: [spokeChainConfig[ChainKeys.ETHEREUM_MAINNET].supportedTokens.USDC.address],
    },
  ],
} as const satisfies Partial<Record<SpokeChainKey, readonly SpokeHookConfig[]>>;

export const getSpokeHook = (chainKey: SpokeChainKey, kind: HookKind): SpokeHookConfig | undefined =>
  spokeHooks[chainKey as keyof typeof spokeHooks]?.find(h => h.kind === kind);

export const getSpokeHooks = (chainKey: SpokeChainKey): readonly SpokeHookConfig[] =>
  spokeHooks[chainKey as keyof typeof spokeHooks] ?? [];

export const isHookSupportedToken = (chainKey: SpokeChainKey, kind: HookKind, token: string): boolean => {
  const hook = getSpokeHook(chainKey, kind);
  if (!hook) {
    return false;
  }
  return !hook.supportedTokens || hook.supportedTokens.some(t => t.toLowerCase() === token.toLowerCase());
};
