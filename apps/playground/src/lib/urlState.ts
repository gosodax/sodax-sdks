import { readWidgetSettings, type WidgetSettings } from './widgetSettings';
import type { ChainKey, XToken } from '@sodax/dapp-kit';
import { type Brand, readBrand, writeBrand } from './brand';

/**
 * The form state a link can carry, so a docs page or a partner's `<iframe>` can open the widget on
 * a specific pair instead of always the default one.
 *
 * The partner fee is deliberately **not** in here. It is the one field that redirects money, and a
 * crafted link would set it on a page a reader may never scroll to the form of.
 */
export type UrlState = {
  widget?: WidgetSettings;
  /** Syntax only. A key from a URL is a string until the caller resolves it against a live list. */
  srcChain: string | undefined;
  dstChain: string | undefined;
  srcSymbol: string | undefined;
  dstSymbol: string | undefined;
  amount: string | undefined;
  slippage: string | undefined;
  /** Chrome off: the widget alone, which is what a host page frames. */
  embed: boolean;
  /** How the widget should look. Validated to a closed shape by `readBrand`, never a raw string. */
  brand: Brand;
};

export type UrlStateSource = {
  widget?: WidgetSettings;
  srcChain: ChainKey;
  dstChain: ChainKey;
  srcToken: XToken | undefined;
  dstToken: XToken | undefined;
  amount: string;
  slippage?: string;
  /** Kept on every rewrite, or a framed widget loses its chrome-off mode on the first reload. */
  embed?: boolean;
  /** Kept for the same reason, and it is what makes the copied embed snippet carry the styling. */
  brand?: Brand;
};

const DECIMAL = /^\d{1,30}(\.\d{0,30})?$/;
const SYMBOL = /^[A-Za-z0-9 ._()-]{1,64}$/;
const CHAIN_KEY = /^[A-Za-z0-9._-]{1,32}$/;

function matching(pattern: RegExp, value: string | null): string | undefined {
  return value && pattern.test(value) ? value : undefined;
}

export function readUrlState(search: string): UrlState {
  const params = new URLSearchParams(search);

  return {
    ...(['allowedSrc', 'allowedDst', 'allowedSrcTokens', 'allowedDstTokens', 'lockSrc', 'lockDst'].some(key =>
      params.has(key),
    )
      ? { widget: readWidgetSettings(params) }
      : {}),
    srcChain: matching(CHAIN_KEY, params.get('srcChain')),
    dstChain: matching(CHAIN_KEY, params.get('dstChain')),
    srcSymbol: matching(SYMBOL, params.get('srcToken')),
    dstSymbol: matching(SYMBOL, params.get('dstToken')),
    amount: matching(DECIMAL, params.get('amount')),
    slippage: matching(DECIMAL, params.get('slippage')),
    embed: params.get('embed') === '1',
    brand: readBrand(search),
  };
}

export function toSearch(state: UrlStateSource): string {
  const params = new URLSearchParams();
  params.set('srcChain', state.srcChain);
  params.set('dstChain', state.dstChain);
  if (state.srcToken) params.set('srcToken', state.srcToken.symbol);
  if (state.dstToken) params.set('dstToken', state.dstToken.symbol);
  if (state.amount.trim()) params.set('amount', state.amount.trim());
  if (state.slippage !== undefined) params.set('slippage', state.slippage);
  if (state.embed) params.set('embed', '1');
  if (state.brand) writeBrand(params, state.brand);
  if (state.widget?.sourceNetworks.length) params.set('allowedSrc', state.widget.sourceNetworks.join(','));
  if (state.widget?.destinationNetworks.length) params.set('allowedDst', state.widget.destinationNetworks.join(','));
  if (state.widget?.sourceTokens) params.set('allowedSrcTokens', state.widget.sourceTokens.join(','));
  if (state.widget?.destinationTokens) params.set('allowedDstTokens', state.widget.destinationTokens.join(','));
  if (state.widget?.lockSource) params.set('lockSrc', '1');
  if (state.widget?.lockDestination) params.set('lockDst', '1');
  return params.toString();
}

/** What the widget applies for a key the URL leaves out, so a rewrite can leave that key out too. */
export type UrlDefaults = {
  srcChain: string;
  dstChain: string;
  srcSymbol: string;
  dstSymbol: string;
  amount: string;
  slippage: string;
};

/**
 * The form as the address bar should carry it: only what differs from the defaults, so a visitor who
 * opens the widget and changes nothing keeps a bare URL. Lossless — an absent key reads as its
 * default — but only for the tab the visitor sees. A framed widget keeps the complete `toSearch`,
 * because a lock reads the pair off its own URL and a stripped one would unpin it on reload.
 */
export function toBrowserSearch(state: UrlStateSource, defaults: UrlDefaults): string {
  const params = new URLSearchParams(toSearch(state));
  const defaulted: [string, string][] = [
    ['srcChain', defaults.srcChain],
    ['dstChain', defaults.dstChain],
    ['srcToken', defaults.srcSymbol],
    ['dstToken', defaults.dstSymbol],
    ['amount', defaults.amount],
    ['slippage', defaults.slippage],
  ];
  for (const [key, value] of defaulted) {
    if (params.get(key) === value) params.delete(key);
  }
  return params.toString();
}

/** The address a host page frames: the current form, chrome off. `origin` is set per deployment. */
export function embedUrl(origin: string, state: UrlStateSource): string {
  return `${origin}/?${toSearch({ ...state, embed: true })}`;
}
