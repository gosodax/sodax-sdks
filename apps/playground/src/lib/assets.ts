import {
  type Address,
  type ChainKey,
  ChainKeys,
  type GetSwapTokensResponseV2,
  LsodaTokens,
  SodaTokens,
  type SwapTokenV2,
  type XToken,
} from '@sodax/dapp-kit';
import { type TokenChoice, chainName, isChainKey } from './chains';

/**
 * Vault shares: `soda*` money-market shares and `lsoda*` leverage-yield shares. The API surfaces
 * them on spoke chains too (sodaBTC on Stellar), and neither is a swappable asset — same filter
 * `sodax.com/exchange/swap` applies to the same response.
 *
 * Matched by the `SodaTokens` / `LsodaTokens` *keys*, which the API still uses as symbols, and on
 * the hub by address — `.symbol` follows on-chain metadata (`sodaBTC` reads `BTC`) and cannot be used.
 */
const HUB_SHARES = [...Object.entries(SodaTokens), ...Object.entries(LsodaTokens)].filter(([key]) =>
  /^l?soda/.test(key),
);
const VAULT_SHARE_SYMBOLS = new Set<string>(HUB_SHARES.map(([key]) => key));
const HUB_SHARE_ADDRESSES = new Set<string>(HUB_SHARES.map(([, token]) => token.address.toLowerCase()));

function isVaultShare(token: SwapTokenV2, chain: ChainKey): boolean {
  if (VAULT_SHARE_SYMBOLS.has(token.symbol)) return true;
  return chain === ChainKeys.SONIC_MAINNET && HUB_SHARE_ADDRESSES.has(token.address.toLowerCase());
}

/**
 * Chains this widget never offers, not even for a quote. The API may keep listing one after the
 * product has stopped routing it; dropping it here keeps it out of the pickers, the network filters
 * and the chains a link can resolve, in one place.
 */
export const EXCLUDED_CHAINS: ReadonlySet<ChainKey> = new Set([ChainKeys.ICON_MAINNET]);

export type SwapAssets = {
  /** Every chain the API quotes, widest token list first. */
  chains: readonly ChainKey[];
  choices: readonly TokenChoice[];
  /** Distinct symbols across every chain — the same asset on two chains counts once. */
  assetCount: number;
};

export const NO_ASSETS: SwapAssets = { chains: [], choices: [], assetCount: 0 };

/** `SwapTokenV2` carries `XToken`'s fields as plain JSON strings; cast the branded two back. */
function toXToken(token: SwapTokenV2, chain: ChainKey): XToken {
  return {
    symbol: token.symbol,
    name: token.name,
    decimals: token.decimals,
    address: token.address,
    chainKey: chain,
    hubAsset: token.hubAsset as Address,
    vault: token.vault as Address,
  };
}

/**
 * Projects the `/swaps/tokens` response into the picker's shape. Chains the running SDK cannot name
 * or badge are dropped rather than rendered as a raw key — the API may list one before
 * `@sodax/types` carries its config — as are the `EXCLUDED_CHAINS`.
 *
 * Addresses are deduplicated per chain, because a token that appears twice in one chain's list
 * would otherwise produce two tiles that select the same asset.
 */
export function readSwapAssets(response: GetSwapTokensResponseV2 | undefined): SwapAssets {
  if (!response) return NO_ASSETS;

  const perChain: { chain: ChainKey; tokens: XToken[] }[] = [];

  for (const [key, tokens] of Object.entries(response)) {
    if (!isChainKey(key) || EXCLUDED_CHAINS.has(key)) continue;

    const byAddress = new Map<string, XToken>();
    for (const token of tokens) {
      if (isVaultShare(token, key)) continue;
      byAddress.set(token.address.toLowerCase(), toXToken(token, key));
    }

    if (byAddress.size > 0) perChain.push({ chain: key, tokens: [...byAddress.values()] });
  }

  // The exchange sorts by held value; with no balances here, reach is the honest stand-in — it puts
  // the networks carrying the most assets first, in the picker and in the network filter alike.
  perChain.sort((a, b) => b.tokens.length - a.tokens.length || chainName(a.chain).localeCompare(chainName(b.chain)));

  const choices = perChain.flatMap(({ chain, tokens }) => tokens.map(token => ({ chain, token })));

  return {
    chains: perChain.map(({ chain }) => chain),
    choices,
    assetCount: new Set(choices.map(({ token }) => token.symbol)).size,
  };
}

export function tokensOn(assets: SwapAssets, chain: ChainKey): readonly XToken[] {
  return assets.choices.filter(choice => choice.chain === chain).map(({ token }) => token);
}

/** Resolves a symbol against a chain's list, falling back to its first token. */
export function pickToken(tokens: readonly XToken[], symbol: string | undefined): XToken | undefined {
  if (!symbol) return tokens[0];
  return tokens.find(token => token.symbol.toLowerCase() === symbol.toLowerCase()) ?? tokens[0];
}

/** Resolves a requested chain against the loaded list, falling back to a positional default. */
export function pickChain(
  assets: SwapAssets,
  requested: string | undefined,
  fallbackIndex: number,
): ChainKey | undefined {
  return assets.chains.find(chain => chain === requested) ?? assets.chains[fallbackIndex] ?? assets.chains[0];
}
