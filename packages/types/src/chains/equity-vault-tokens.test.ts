import { describe, expect, it } from 'vitest';
import { ChainKeys, spokeChainConfig, type SpokeChainKey } from './chains.js';
import {
  HubVaultSymbols,
  SodaTokens,
  hederaSupportedTokens,
  robinhoodSupportedTokens,
  stellarSupportedTokens,
  type XToken,
} from './tokens.js';
import {
  getStagingSolverTokens,
  getSupportedSolverTokens,
  isSwapSupportedToken,
  stagingSwapSupportedTokens,
  swapSupportedTokens,
} from '../swap/swap.js';
import { moneyMarketReserveAssets, moneyMarketSupportedTokens } from '../moneyMarket/moneyMarket.js';

// The Robinhood tokenized equities are swap-only: canonical vaults and production solver
// assets on four chains, deliberately absent from the money market. A `SodaTokens` entry is
// not evidence of money-market support, so this matrix pins both halves of that split.
const EQUITY_SYMBOLS = [
  'SPCX',
  'NVDA',
  'GME',
  'MSTR',
  'AAPL',
  'TSLA',
  'MU',
  'SNDK',
  'SPY',
  'QQQ',
  'SGOV',
  'USO',
  'SLV',
  'GOOGL',
  'AMZN',
  'MSFT',
  'META',
  'CRCL',
  'COIN',
  'PLTR',
  'TSM',
  'AMD',
  'INTC',
  'BABA',
] as const;

type EquitySymbol = (typeof EQUITY_SYMBOLS)[number];

const EQUITY_REGISTRIES = {
  [ChainKeys.SONIC_MAINNET]: SodaTokens,
  [ChainKeys.STELLAR_MAINNET]: stellarSupportedTokens,
  [ChainKeys.HEDERA_MAINNET]: hederaSupportedTokens,
  [ChainKeys.ROBINHOOD_MAINNET]: robinhoodSupportedTokens,
} as const;

const EQUITY_CHAINS = [
  ChainKeys.SONIC_MAINNET,
  ChainKeys.STELLAR_MAINNET,
  ChainKeys.HEDERA_MAINNET,
  ChainKeys.ROBINHOOD_MAINNET,
] as const;

type EquityChain = (typeof EQUITY_CHAINS)[number];

const representation = (chainKey: EquityChain, symbol: EquitySymbol): XToken => EQUITY_REGISTRIES[chainKey][symbol];

const addressSet = (tokens: readonly XToken[]): Set<string> =>
  new Set(tokens.map(token => token.address.toLowerCase()));

describe('equity vaults are registered on every chain that represents them', () => {
  for (const symbol of EQUITY_SYMBOLS) {
    it(`${symbol}: is a canonical Sonic hub vault`, () => {
      expect(HubVaultSymbols).toContain(symbol);
      expect(SodaTokens[symbol].chainKey).toBe(ChainKeys.SONIC_MAINNET);
      expect(SodaTokens[symbol].symbol).toBe(symbol);
    });

    for (const chainKey of EQUITY_CHAINS) {
      it(`${symbol}: is in the ${chainKey} token registry, keyed by its own symbol`, () => {
        const token = representation(chainKey, symbol);
        expect(token.symbol).toBe(symbol);
        expect(token.chainKey).toBe(chainKey);
        expect(spokeChainConfig[chainKey].supportedTokens[symbol]).toBe(token);
      });

      it(`${symbol}: the ${chainKey} representation points at the Sonic vault`, () => {
        expect(representation(chainKey, symbol).vault).toBe(SodaTokens[symbol].address);
      });
    }
  }
});

describe('equity vaults are production swap tokens on all four chains', () => {
  for (const symbol of EQUITY_SYMBOLS) {
    for (const chainKey of EQUITY_CHAINS) {
      it(`${symbol} on ${chainKey}: in swapSupportedTokens and both solver accessors`, () => {
        const token = representation(chainKey, symbol);
        expect(swapSupportedTokens[chainKey]).toContain(token);
        expect(getSupportedSolverTokens(chainKey)).toContain(token);
        expect(getStagingSolverTokens(chainKey)).toContain(token);
      });

      it(`${symbol} on ${chainKey}: passes swap validation, case-insensitively`, () => {
        const { address } = representation(chainKey, symbol);
        expect(isSwapSupportedToken(chainKey, address)).toBe(true);
        expect(isSwapSupportedToken(chainKey, address.toUpperCase())).toBe(true);
      });

      it(`${symbol} on ${chainKey}: is not duplicated in the staging-only list`, () => {
        // Production membership already reaches staging through getStagingSolverTokens.
        expect(addressSet(stagingSwapSupportedTokens[chainKey])).not.toContain(
          representation(chainKey, symbol).address.toLowerCase(),
        );
      });
    }
  }
});

describe('equity vaults are not money-market assets', () => {
  const equityAddresses = new Set(
    EQUITY_CHAINS.flatMap(chainKey =>
      EQUITY_SYMBOLS.map(symbol => representation(chainKey, symbol).address.toLowerCase()),
    ),
  );

  it('has the lists it claims to check — otherwise every assertion below is vacuous', () => {
    expect(equityAddresses.size).toBe(EQUITY_CHAINS.length * EQUITY_SYMBOLS.length);
    expect(moneyMarketReserveAssets.length).toBeGreaterThan(0);
    // A legacy vault is still a reserve asset, so absence below means absence, not an empty list.
    expect(moneyMarketReserveAssets.map(address => address.toLowerCase())).toContain(
      SodaTokens.sodaETH.address.toLowerCase(),
    );
  });

  for (const [chainKey, tokens] of Object.entries(moneyMarketSupportedTokens) as [SpokeChainKey, readonly XToken[]][]) {
    it(`${chainKey}: money-market list holds no equity representation`, () => {
      const offenders = tokens.filter(token => equityAddresses.has(token.address.toLowerCase()));
      expect(offenders.map(token => token.symbol)).toEqual([]);
    });
  }

  it('moneyMarketReserveAssets holds no equity vault', () => {
    const reserves = new Set(moneyMarketReserveAssets.map(address => address.toLowerCase()));
    const offenders = EQUITY_SYMBOLS.filter(symbol => reserves.has(SodaTokens[symbol].address.toLowerCase()));
    expect(offenders).toEqual([]);
  });
});
