import { ChainKeys, type XToken } from '@sodax/dapp-kit';
import { describe, expect, it } from 'vitest';
import { NO_BRAND } from './brand';
import { embedUrl, readUrlState, toBrowserSearch, toSearch } from './urlState';

const SRC_CHAIN = ChainKeys.BASE_MAINNET;
const DST_CHAIN = ChainKeys.SOLANA_MAINNET;

function token(symbol: string, address: string): XToken {
  return {
    symbol,
    name: symbol,
    address,
    decimals: 18,
    chainKey: SRC_CHAIN,
    hubAsset: '0x0000000000000000000000000000000000000001',
    vault: '0x0000000000000000000000000000000000000002',
  };
}

const USDC = token('USDC', '0xaaa');
const WETH = token('WETH', '0xbbb');

const BLANK = {
  srcChain: undefined,
  dstChain: undefined,
  srcSymbol: undefined,
  dstSymbol: undefined,
  amount: undefined,
  slippage: undefined,
  embed: false,
  brand: NO_BRAND,
};

describe('readUrlState', () => {
  it('is all-undefined for an empty query string', () => {
    expect(readUrlState('')).toEqual(BLANK);
  });

  // Syntax only here: the chain is resolved against the loaded token list, which is the allowlist.
  it('keeps a chain-key-shaped value for the caller to resolve', () => {
    expect(readUrlState(`?srcChain=${SRC_CHAIN}`).srcChain).toBe(SRC_CHAIN);
    expect(readUrlState('?srcChain=solana').srcChain).toBe('solana');
  });

  it.each([
    '../../etc/passwd',
    'a'.repeat(33),
    '<script>',
    'base mainnet',
    '',
  ])('drops the malformed chain %j', value => {
    expect(readUrlState(`?srcChain=${encodeURIComponent(value)}`).srcChain).toBeUndefined();
  });

  it.each(['12.5', '0.001', '7'])('keeps the decimal amount %s', value => {
    expect(readUrlState(`?amount=${value}`).amount).toBe(value);
  });

  it.each(['1e10', '-1', 'abc', '1.2.3', '0x10'])('drops the non-decimal amount %j', value => {
    expect(readUrlState(`?amount=${encodeURIComponent(value)}`).amount).toBeUndefined();
  });

  it.each(['<script>', 'a'.repeat(65), 'US/DC'])('drops the malformed token symbol %j', value => {
    expect(readUrlState(`?srcToken=${encodeURIComponent(value)}`).srcSymbol).toBeUndefined();
  });

  it('reads the theme parameters a partner set on the frame', () => {
    const state = readUrlState('?embed=1&theme=light&accent=7c3aed&radius=sharp');

    expect(state.brand).toEqual({ ...NO_BRAND, theme: 'light', accent: '#7c3aed', radius: 'sharp' });
  });

  it('reads embed mode only from the exact flag', () => {
    expect(readUrlState('?embed=1').embed).toBe(true);
    expect(readUrlState('?embed=true').embed).toBe(false);
    expect(readUrlState('').embed).toBe(false);
  });

  // A crafted link must not be able to redirect a partner's fee.
  it('carries no partner fee', () => {
    const state = readUrlState('?feeAddress=0x1234567890abcdef1234567890abcdef12345678&feeBps=100');
    expect(state).toEqual(BLANK);
  });
});

describe('toSearch', () => {
  const base = {
    srcChain: SRC_CHAIN,
    dstChain: DST_CHAIN,
    srcToken: USDC,
    dstToken: WETH,
    amount: '1.5',
    slippage: '0.5',
  };

  it('round-trips through readUrlState', () => {
    expect(readUrlState(`?${toSearch(base)}`)).toEqual({
      srcChain: SRC_CHAIN,
      dstChain: DST_CHAIN,
      srcSymbol: 'USDC',
      dstSymbol: 'WETH',
      amount: '1.5',
      slippage: '0.5',
      embed: false,
      brand: NO_BRAND,
    });
  });

  // The widget rewrites the query string on every change; dropping the flag would take a framed
  // widget out of embed mode on its first reload.
  it('keeps embed mode on a rewrite', () => {
    expect(readUrlState(`?${toSearch({ ...base, embed: true })}`).embed).toBe(true);
  });

  // The form is rewritten on every change; dropping these would strip a partner's styling from a
  // framed widget on its first reload, exactly as it would strip embed mode.
  it('keeps the styling on a rewrite', () => {
    const styled = { ...base, brand: { ...NO_BRAND, accent: '#7c3aed', font: 'serif' as const } };

    expect(readUrlState(`?${toSearch(styled)}`).brand).toEqual(styled.brand);
  });

  it('writes no theme parameters for an unstyled widget', () => {
    expect(toSearch(base)).not.toContain('accent=');
    expect(toSearch({ ...base, brand: NO_BRAND })).not.toContain('theme=');
  });

  it('omits an empty amount rather than writing amount=', () => {
    expect(toSearch({ ...base, amount: '   ' })).not.toContain('amount=');
  });

  it('omits a token the chain could not supply', () => {
    expect(toSearch({ ...base, srcToken: undefined })).not.toContain('srcToken=');
  });
});

describe('toBrowserSearch', () => {
  const defaults = {
    srcChain: SRC_CHAIN,
    dstChain: DST_CHAIN,
    srcSymbol: 'USDC',
    dstSymbol: 'WETH',
    amount: '1.5',
    slippage: '0.5',
  };
  const base = {
    srcChain: SRC_CHAIN,
    dstChain: DST_CHAIN,
    srcToken: USDC,
    dstToken: WETH,
    amount: '1.5',
    slippage: '0.5',
  };

  it('writes nothing for a form nobody has touched', () => {
    expect(toBrowserSearch(base, defaults)).toBe('');
  });

  it('writes only what the visitor changed', () => {
    expect(toBrowserSearch({ ...base, amount: '3' }, defaults)).toBe('amount=3');
  });

  it('omits a default symbol reached on another chain, which the reader resolves the same way', () => {
    const moved = { ...base, dstChain: SRC_CHAIN };

    expect(toBrowserSearch(moved, defaults)).toBe(`dstChain=${SRC_CHAIN}`);
  });

  // What it leaves out is what the widget seeds anyway, so the pair survives the shorter URL.
  it('reads back as the same form through the defaults', () => {
    const changed = { ...base, srcToken: WETH };
    const read = readUrlState(`?${toBrowserSearch(changed, defaults)}`);

    expect(read.srcSymbol ?? defaults.srcSymbol).toBe('WETH');
    expect(read.srcChain ?? defaults.srcChain).toBe(SRC_CHAIN);
    expect(read.amount ?? defaults.amount).toBe('1.5');
  });

  it('keeps styling and restrictions, which have no default to fall back to', () => {
    const styled = { ...base, brand: { ...NO_BRAND, accent: '#7c3aed' }, embed: true };

    expect(toBrowserSearch(styled, defaults)).toBe('embed=1&accent=7c3aed');
  });
});

describe('embedUrl', () => {
  const state = {
    srcChain: SRC_CHAIN,
    dstChain: DST_CHAIN,
    srcToken: USDC,
    dstToken: WETH,
    amount: '1.5',
    slippage: '0.5',
  };

  it('opens the framed widget on the form as it stands', () => {
    const url = embedUrl('https://widget.sodax.com', state);
    const query = readUrlState(url.slice(url.indexOf('?')));

    expect(url.startsWith('https://widget.sodax.com/?')).toBe(true);
    expect(query.embed).toBe(true);
    expect(query.srcChain).toBe(SRC_CHAIN);
    expect(query.dstSymbol).toBe('WETH');
  });

  // What makes the copy-paste story work: the visitor styles the widget and the snippet is the answer.
  it('carries the styling the visitor configured', () => {
    const brand = { ...NO_BRAND, accent: '#7c3aed', radius: 'round' as const, theme: 'light' as const };
    const url = embedUrl('https://widget.sodax.com', { ...state, brand });

    expect(readUrlState(url.slice(url.indexOf('?'))).brand).toEqual(brand);
  });
});
