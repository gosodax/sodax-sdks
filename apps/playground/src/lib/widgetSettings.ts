import type { ChainKey } from '@sodax/dapp-kit';
import { isChainKey, type TokenChoice } from './chains';

export type WidgetSettings = {
  sourceNetworks: ChainKey[];
  destinationNetworks: ChainKey[];
  sourceTokens?: string[];
  destinationTokens?: string[];
  lockSource?: boolean;
  lockDestination?: boolean;
};

export function tokenId(choice: TokenChoice): string {
  return `${choice.chain}:${choice.token.symbol}`;
}

export function readWidgetSettings(params: URLSearchParams): WidgetSettings {
  const read = (key: string) => [...new Set((params.get(key) ?? '').split(',').filter(isChainKey))];
  const tokens = (key: string) => [
    ...new Set(
      (params.get(key) ?? '').split(',').filter(value => {
        const [chain, symbol, extra] = value.split(':');
        return chain && isChainKey(chain) && symbol && /^[A-Za-z0-9 ._()-]{1,64}$/.test(symbol) && !extra;
      }),
    ),
  ];
  return {
    sourceNetworks: read('allowedSrc'),
    destinationNetworks: read('allowedDst'),
    ...(params.has('allowedSrcTokens') ? { sourceTokens: tokens('allowedSrcTokens') } : {}),
    ...(params.has('allowedDstTokens') ? { destinationTokens: tokens('allowedDstTokens') } : {}),
    ...(params.get('lockSrc') === '1' ? { lockSource: true } : {}),
    ...(params.get('lockDst') === '1' ? { lockDestination: true } : {}),
  };
}

export function networkAllowed(chain: ChainKey, allowed: readonly ChainKey[]): boolean {
  return allowed.length === 0 || allowed.includes(chain);
}

/** A supplied but empty token list permits nothing; a malformed restriction must not widen access. */
export function allowedChoices(
  choices: readonly TokenChoice[],
  networks: readonly ChainKey[],
  tokens: readonly string[] | undefined,
  lock?: { chain: string | undefined; symbol: string | undefined },
): TokenChoice[] {
  return choices.filter(
    choice =>
      networkAllowed(choice.chain, networks) &&
      (tokens === undefined || tokens.includes(tokenId(choice))) &&
      (!lock || (choice.chain === lock.chain && choice.token.symbol === lock.symbol)),
  );
}
