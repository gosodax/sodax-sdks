import {
  CHAIN_KEYS,
  ChainKeys,
  type GetSwapTokensResponseV2,
  SodaTokens,
  type SwapTokenV2,
  getSupportedSolverTokens,
} from '@sodax/dapp-kit';
import { describe, expect, it } from 'vitest';
import { EXCLUDED_CHAINS, pickChain, pickToken, readSwapAssets, tokensOn } from './assets';

function apiToken(symbol: string, address: string, decimals = 18): SwapTokenV2 {
  return {
    symbol,
    name: symbol,
    decimals,
    address,
    chainKey: 'ignored — the response key is the chain',
    hubAsset: '0x0000000000000000000000000000000000000001',
    vault: '0x0000000000000000000000000000000000000002',
  };
}

const RESPONSE: GetSwapTokensResponseV2 = {
  [ChainKeys.SOLANA_MAINNET]: [
    apiToken('SOL', '11111111111111111111111111111111', 9),
    apiToken('USDC', 'EPjFWdd5Auf', 6),
    apiToken('TSLAx', 'XsDoVfqeBuk', 8),
  ],
  [ChainKeys.BASE_MAINNET]: [apiToken('ETH', '0x0000000000000000000000000000000000000000'), apiToken('USDC', '0xusdc')],
  [ChainKeys.BITCOIN_MAINNET]: [apiToken('BTC', 'bc1q', 8)],
};

describe('readSwapAssets', () => {
  it('is empty before the list arrives', () => {
    expect(readSwapAssets(undefined)).toEqual({ chains: [], choices: [], assetCount: 0 });
  });

  // The API still lists Icon; the widget must not offer it, quote it, or resolve a link to it.
  it('drops an excluded chain the API still lists', () => {
    const assets = readSwapAssets({
      ...RESPONSE,
      [ChainKeys.ICON_MAINNET]: [apiToken('ICX', 'cx0000000000000000000000000000000000000000')],
    });
    expect(assets.chains).not.toContain(ChainKeys.ICON_MAINNET);
    expect(assets.choices.some(({ token }) => token.symbol === 'ICX')).toBe(false);
    expect(tokensOn(assets, ChainKeys.ICON_MAINNET)).toEqual([]);
    expect(pickChain(assets, ChainKeys.ICON_MAINNET, 0)).not.toBe(ChainKeys.ICON_MAINNET);
  });

  it('excludes Icon', () => {
    expect(EXCLUDED_CHAINS.has(ChainKeys.ICON_MAINNET)).toBe(true);
  });

  it('reaches non-EVM chains, which is the whole reason the list comes from the API', () => {
    const { chains } = readSwapAssets(RESPONSE);
    expect(chains).toContain(ChainKeys.SOLANA_MAINNET);
    expect(chains).toContain(ChainKeys.BITCOIN_MAINNET);
  });

  it('pairs every token with the chain the response filed it under, not the one it claims', () => {
    for (const { chain, token } of readSwapAssets(RESPONSE).choices) {
      expect(token.chainKey).toBe(chain);
    }
  });

  it('counts an asset once however many chains carry it', () => {
    // SOL · USDC · TSLAx · ETH · BTC — USDC is on two chains.
    expect(readSwapAssets(RESPONSE).assetCount).toBe(5);
    expect(readSwapAssets(RESPONSE).choices).toHaveLength(6);
  });

  it('orders chains by reach, so the network filter leads with the widest list', () => {
    expect(readSwapAssets(RESPONSE).chains).toEqual([
      ChainKeys.SOLANA_MAINNET,
      ChainKeys.BASE_MAINNET,
      ChainKeys.BITCOIN_MAINNET,
    ]);
  });

  // The API lists a chain before `@sodax/types` carries its config; rendering the raw key as a
  // network name — with no logo — is worse than not offering it yet.
  it('drops a chain this SDK cannot name', () => {
    const { chains } = readSwapAssets({ ...RESPONSE, 'not.a.chain': [apiToken('X', '0x1')] });
    expect(chains).not.toContain('not.a.chain');
    expect(chains).toHaveLength(3);
  });

  it('drops a chain whose whole list is filtered away', () => {
    const vaultShareOnly = { [ChainKeys.SONIC_MAINNET]: [apiToken('sodaBNB', '0xshare')] };
    expect(readSwapAssets(vaultShareOnly).chains).toHaveLength(0);
  });

  // Vault shares are positions in a vault, not assets to swap. The API surfaces them on spoke
  // chains too, so the filter runs on every chain rather than only on the hub.
  it('drops soda vault shares wherever they appear', () => {
    const withShare = {
      ...RESPONSE,
      [ChainKeys.STELLAR_MAINNET]: [apiToken('XLM', 'native', 7), apiToken('sodaBTC', 'CBTC')],
    };
    const symbols = readSwapAssets(withShare).choices.map(({ token }) => token.symbol);

    expect(symbols).toContain('XLM');
    expect(symbols).not.toContain('sodaBTC');
  });

  // `SodaTokens.sodaBTC.symbol` is the on-chain `BTC`; a hub share listed under that symbol is
  // still a share, while `BTC` on Bitcoin is the asset itself.
  it('drops a hub share by address even when the API adopts its on-chain symbol', () => {
    const onChainSymbols = {
      ...RESPONSE,
      [ChainKeys.SONIC_MAINNET]: [
        apiToken('BTC', SodaTokens.sodaBTC.address, 8),
        apiToken('TSLA', SodaTokens.TSLA.address),
      ],
    };
    const choices = readSwapAssets(onChainSymbols).choices;

    expect(choices.filter(({ token }) => token.symbol === 'BTC').map(({ chain }) => chain)).toEqual([
      ChainKeys.BITCOIN_MAINNET,
    ]);
    expect(choices.some(({ token }) => token.symbol === 'TSLA')).toBe(true);
  });

  it('keeps SODA itself, which is not a vault share', () => {
    const withSoda = { [ChainKeys.SONIC_MAINNET]: [apiToken('SODA', '0xsoda')] };
    expect(readSwapAssets(withSoda).choices).toHaveLength(1);
  });

  // Two tiles that select the same asset read as a bug in the picker.
  it('deduplicates one address listed twice on a chain', () => {
    const duplicated = { [ChainKeys.BASE_MAINNET]: [apiToken('ETH', '0xAbC'), apiToken('ETH', '0xabc')] };
    expect(readSwapAssets(duplicated).choices).toHaveLength(1);
  });
});

describe('tokensOn', () => {
  it('returns only that chain’s tokens', () => {
    const assets = readSwapAssets(RESPONSE);
    const tokens = tokensOn(assets, ChainKeys.SOLANA_MAINNET);

    expect(tokens.map(token => token.symbol)).toEqual(['SOL', 'USDC', 'TSLAx']);
  });

  it('is empty for a chain the list does not carry', () => {
    expect(tokensOn(readSwapAssets(RESPONSE), ChainKeys.HEDERA_MAINNET)).toHaveLength(0);
  });
});

describe('pickChain', () => {
  const assets = readSwapAssets(RESPONSE);

  it('resolves a chain the loaded list offers', () => {
    expect(pickChain(assets, ChainKeys.BITCOIN_MAINNET, 0)).toBe(ChainKeys.BITCOIN_MAINNET);
  });

  // The loaded list is the allowlist: a chain key from a URL or a stale default never reaches the
  // API on its own.
  it.each(['0xdead.notachain', ChainKeys.HEDERA_MAINNET, undefined])('falls back for %j', value => {
    expect(pickChain(assets, value, 1)).toBe(ChainKeys.BASE_MAINNET);
  });

  it('is undefined before the list arrives', () => {
    expect(pickChain(readSwapAssets(undefined), ChainKeys.BASE_MAINNET, 0)).toBeUndefined();
  });
});

describe('pickToken', () => {
  const solana = tokensOn(readSwapAssets(RESPONSE), ChainKeys.SOLANA_MAINNET);

  it('falls back to the first token when no symbol is given', () => {
    expect(pickToken(solana, undefined)?.symbol).toBe('SOL');
  });

  it('resolves a symbol case-insensitively', () => {
    expect(pickToken(solana, 'tslax')?.symbol).toBe('TSLAx');
  });

  it('falls back to the first token when the symbol is not on this chain', () => {
    expect(pickToken(solana, 'DOGE')?.symbol).toBe('SOL');
  });

  it('is undefined when the chain has no tokens', () => {
    expect(pickToken([], 'USDC')).toBeUndefined();
  });

  // This also re-resolves the token on a chain change, so it must never hand back an object from
  // the previous chain: every EVM chain's native token is address 0x0, and decimals differ across
  // chains (SOL is 9, HBAR is 8, ETH is 18). Carrying the old one over misparses the amount by
  // orders of magnitude.
  it('never carries the previous chain’s token across a chain change', () => {
    const chains = CHAIN_KEYS.filter(key => getSupportedSolverTokens(key).length > 0);

    for (const from of chains) {
      const carriedOver = getSupportedSolverTokens(from)[0];

      for (const to of chains) {
        const tokens = getSupportedSolverTokens(to);
        const resolved = pickToken(tokens, carriedOver?.symbol);
        if (!resolved) continue;

        expect(tokens).toContain(resolved);
        expect(resolved.chainKey).toBe(to);
      }
    }
  });
});
