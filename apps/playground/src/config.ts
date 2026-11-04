import { ChainKeys } from '@sodax/dapp-kit';
import { readPartnerFee } from './lib/fee';

const env = import.meta.env as Record<string, string | undefined>;

/**
 * Origin an embed snippet points at. Set it per deployment; without it the snippet quotes whatever
 * origin is serving the page, which is right for a preview and wrong for a copied `<iframe>`.
 * Guarded for the pure `src/lib` tests, which import this module with no DOM.
 */
export const embedOrigin =
  env.VITE_EMBED_ORIGIN ?? (typeof window === 'undefined' ? 'https://localhost' : window.location.origin);

/** Optional per-deployment quota on the swaps API. Anything in a Vite bundle is public. */
export const swapsApiKey = env.VITE_SWAPS_API_KEY;

/** GTM container, as on sodax.com. Unset, and nothing loads and nothing is pushed. */
export const gtmId = env.VITE_GTM_ID;

/** Whether the container also loads inside a partner's `<iframe>`. See `lib/analytics.ts`. */
export const trackInEmbed = env.VITE_GTM_IN_EMBED === '1';

export const DEFAULT_SLIPPAGE_PERCENT = '0.5';

/** Seeded so the widget opens on a live quote rather than an empty form. A `?amount=` link wins. */
export const DEFAULT_AMOUNT = '0.1';

/**
 * ETH on Base → TSLAx on Solana: one EVM leg, one non-EVM leg, and a tokenized equity. Both sides resolve against the loaded token list, so a delisted default
 * falls back to that chain's first asset rather than breaking the form.
 */
export const DEFAULT_PAIR = {
  srcChain: ChainKeys.BASE_MAINNET,
  srcSymbol: 'ETH',
  dstChain: ChainKeys.SOLANA_MAINNET,
  dstSymbol: 'TSLAx',
} as const;

/** Fallback for routes without an in-widget execution path. */
export const EXCHANGE_URL = 'https://www.sodax.com/exchange/swap';

export const walletConnectProjectId = env.VITE_WALLETCONNECT_PROJECT_ID;
// The SDK's packaged Solana endpoint refuses browser traffic with 403, which reads as an empty
// balance and a failed swap; a deployment overrides this with its own keyed provider.
const SOLANA_FALLBACK_RPC_URL = 'https://solana-rpc.publicnode.com';
export const solanaRpcUrl = env.VITE_SOLANA_RPC_URL?.trim() || SOLANA_FALLBACK_RPC_URL;
export const deploymentFeeInput = {
  address: env.VITE_PARTNER_FEE_RECIPIENT ?? '',
  bps: env.VITE_PARTNER_FEE_BPS ?? '',
};
export const deploymentFee = readPartnerFee(deploymentFeeInput);
