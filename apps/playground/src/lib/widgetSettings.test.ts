import { ChainKeys, getSupportedSolverTokens } from '@sodax/dapp-kit';
import { describe, it, expect } from 'vitest';
import { allowedChoices, tokenId, networkAllowed, readWidgetSettings } from './widgetSettings';
import { readUrlState, toSearch } from './urlState';

describe('widget network configuration', () => {
  it('ignores unknown and prototype chain names and deduplicates selections', () => {
    const widget = readWidgetSettings(new URLSearchParams('allowedSrc=solana,solana,toString,unknown'));
    expect(widget.sourceNetworks).toEqual([ChainKeys.SOLANA_MAINNET]);
    expect(networkAllowed(ChainKeys.BASE_MAINNET, widget.sourceNetworks)).toBe(false);
    expect(networkAllowed(ChainKeys.BASE_MAINNET, [])).toBe(true);
  });
  it('preserves restrictions in exported and rewritten URLs', () => {
    const widget = { sourceNetworks: [ChainKeys.BASE_MAINNET], destinationNetworks: [ChainKeys.SOLANA_MAINNET] };
    const search = toSearch({
      srcChain: ChainKeys.BASE_MAINNET,
      dstChain: ChainKeys.SOLANA_MAINNET,
      srcToken: undefined,
      dstToken: undefined,
      amount: '1',
      embed: true,
      widget,
    });
    expect(readUrlState(search).widget).toEqual(widget);
    expect(readUrlState(search).embed).toBe(true);
  });
});

const choices = [ChainKeys.BASE_MAINNET, ChainKeys.SOLANA_MAINNET].flatMap(chain =>
  getSupportedSolverTokens(chain).map(token => ({ chain, token })),
);

describe('token restrictions and locks', () => {
  it('combines token allowlists with network restrictions', () => {
    const selected = choices.find(choice => choice.chain === ChainKeys.BASE_MAINNET);
    if (!selected) throw new Error('Missing Base fixture');
    expect(allowedChoices(choices, [], [tokenId(selected)])).toEqual([selected]);
    expect(allowedChoices(choices, [ChainKeys.SOLANA_MAINNET], [tokenId(selected)])).toEqual([]);
  });
  it('never substitutes a different token for an unavailable locked pair', () => {
    expect(allowedChoices(choices, [], undefined, { chain: ChainKeys.BASE_MAINNET, symbol: 'unlisted' })).toEqual([]);
    expect(allowedChoices(choices, [], undefined, { chain: undefined, symbol: undefined })).toEqual([]);
    const selected = choices[0];
    if (!selected) throw new Error('Missing token fixture');
    expect(allowedChoices(choices, [], undefined, { chain: selected.chain, symbol: selected.token.symbol })).toEqual([
      selected,
    ]);
  });
  it('empty and malformed token restrictions allow no tokens', () => {
    expect(allowedChoices(choices, [], [])).toEqual([]);
    const widget = readWidgetSettings(
      new URLSearchParams('allowedSrcTokens=toString:ETH,solana:<script>,solana:ETH:extra'),
    );
    expect(widget.sourceTokens).toEqual([]);
    expect(allowedChoices(choices, [], widget.sourceTokens)).toEqual([]);
  });
  it('round-trips restrictions, empty lists and locks without widening them', () => {
    const widget = {
      sourceNetworks: [],
      destinationNetworks: [],
      sourceTokens: [],
      destinationTokens: ['solana:USDC'],
      lockDestination: true,
    };
    const search = toSearch({
      srcChain: ChainKeys.BASE_MAINNET,
      dstChain: ChainKeys.SOLANA_MAINNET,
      srcToken: undefined,
      dstToken: undefined,
      amount: '1',
      widget,
    });
    expect(readUrlState(search).widget).toEqual(widget);
    expect(readWidgetSettings(new URLSearchParams('lockSrc=true&lockDst=0')).lockSource).toBeUndefined();
  });
});
