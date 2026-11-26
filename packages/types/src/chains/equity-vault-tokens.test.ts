import { describe, expect, it } from 'vitest';
import { ChainKeys, spokeChainConfig, type SpokeChainKey } from './chains.js';
import {
  HubVaultSymbols,
  SodaTokens,
  hederaSupportedTokens,
  robinhoodSupportedTokens,
  stellarSupportedTokens,
  xrpSupportedTokens,
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

// The Robinhood tokenized equities: canonical vaults and production solver assets on four chains,
// of which only MONEY_MARKET_EQUITY_SYMBOLS are money-market reserves. A `SodaTokens` entry is
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
  'AMC',
  'HIMS',
  'LLY',
  'COST',
  'TTWO',
  'RBLX',
  'IBM',
  'MRNA',
  'LULU',
  'SNAP',
  'WYFI',
  'RIVN',
  'NFLX',
  'BULL',
  'QUBT',
  'NET',
  'SKHY',
  'JNJ',
  'UPS',
  'DJT',
  'RDDT',
  'GLD',
  'ANT',
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

// The only equity vaults listed as money-market reserves (collateral, borrowing disabled).
const MONEY_MARKET_EQUITY_SYMBOLS = new Set<string>([
  'AAPL',
  'MSFT',
  'NVDA',
  'GOOGL',
  'AMZN',
  'META',
  'TSLA',
  'SPCX',
  'SPY',
  'QQQ',
  'GLD',
] satisfies EquitySymbol[]);

describe('only the listed equity vaults are money-market assets', () => {
  const unlisted = EQUITY_SYMBOLS.filter(symbol => !MONEY_MARKET_EQUITY_SYMBOLS.has(symbol));
  const unlistedAddresses = new Set(
    EQUITY_CHAINS.flatMap(chainKey => unlisted.map(symbol => representation(chainKey, symbol).address.toLowerCase())),
  );

  it('has the lists it claims to check — otherwise every assertion below is vacuous', () => {
    expect(unlisted.length).toBe(EQUITY_SYMBOLS.length - MONEY_MARKET_EQUITY_SYMBOLS.size);
    expect(unlistedAddresses.size).toBe(EQUITY_CHAINS.length * unlisted.length);
    // A legacy vault is still a reserve asset, so absence below means absence, not an empty list.
    expect(moneyMarketReserveAssets.map(address => address.toLowerCase())).toContain(
      SodaTokens.sodaETH.address.toLowerCase(),
    );
  });

  for (const [chainKey, tokens] of Object.entries(moneyMarketSupportedTokens) as [SpokeChainKey, readonly XToken[]][]) {
    it(`${chainKey}: money-market list holds no unlisted equity representation`, () => {
      const offenders = tokens.filter(token => unlistedAddresses.has(token.address.toLowerCase()));
      expect(offenders.map(token => token.symbol)).toEqual([]);
    });
  }

  it('moneyMarketReserveAssets holds every listed equity vault and no other', () => {
    const reserves = new Set(moneyMarketReserveAssets.map(address => address.toLowerCase()));
    const listed = EQUITY_SYMBOLS.filter(symbol => reserves.has(SodaTokens[symbol].address.toLowerCase()));
    expect(new Set(listed)).toEqual(MONEY_MARKET_EQUITY_SYMBOLS);
  });
});

// The XRPL stocks are STAGING-ONLY swap tokens (the production solver does not price them yet). They share ONE
// issuer, so an issuer-only address could not name a single stock: each carries `<40-hex currency>:<issuer>`.
describe('XRPL Robinhood stocks', () => {
  const STOCK_ISSUER = 'rhQeeggWNoaN6ttBEaSqLPJZekFYBvPxtn';
  const xrpChain = ChainKeys.XRP_MAINNET;
  const asciiHex = (s: string) => Buffer.from(s, 'ascii').toString('hex').toUpperCase().padEnd(40, '0');
  // Asset ids up to 0x0031 are live: the 46 stocks the relay's XRP_TOKEN_MAP covers. Add a symbol here when its entry is added.
  const LIVE = [
    'SPCX',
    'NVDA',
    'GME',
    'DJT',
    'RDDT',
    'MSTR',
    'AAPL',
    'TSLA',
    'MU',
    'SNDK',
    'SPY',
    'QQQ',
    'SGOV',
    'USO',
    'GLD',
    'SLV',
    'AMC',
    'GOOGL',
    'HIMS',
    'AMZN',
    'MSFT',
    'LLY',
    'META',
    'CRCL',
    'COIN',
    'PLTR',
    'COST',
    'TSM',
    'AMD',
    'TTWO',
    'INTC',
    'RBLX',
    'IBM',
    'MRNA',
    'LULU',
    'SNAP',
    'WYFI',
    'RIVN',
    'BABA',
    'NFLX',
    'BULL',
    'QUBT',
    'NET',
    'SKHY',
    'JNJ',
    'UPS',
  ] as const satisfies readonly EquitySymbol[];
  const stock = (symbol: (typeof LIVE)[number]): XToken => xrpSupportedTokens[symbol];

  it('registers exactly the live stocks and no other equity yet', () => {
    const registered = (EQUITY_SYMBOLS as readonly string[]).filter(symbol => symbol in xrpSupportedTokens);
    expect([...registered].sort()).toEqual([...LIVE].sort());
  });

  it('are registered under their own symbol, flagged RWA, and point at the Sonic vault', () => {
    for (const symbol of LIVE) {
      const token = stock(symbol);
      expect(token.symbol, symbol).toBe(symbol);
      expect(token.chainKey, symbol).toBe(xrpChain);
      expect(token.isRwa, symbol).toBe(true);
      expect(token.decimals, symbol).toBe(8);
      expect(token.vault, symbol).toBe(SodaTokens[symbol].address);
      expect(spokeChainConfig[xrpChain].supportedTokens[symbol], symbol).toBe(token);
    }
  });

  it('each has a unique <currency>:<issuer> address, with the ticker as its 160-bit currency', () => {
    const addresses = LIVE.map(symbol => stock(symbol).address);
    expect(new Set(addresses).size).toBe(LIVE.length);
    for (const symbol of LIVE) {
      expect(stock(symbol).address, symbol).toBe(`${asciiHex(symbol)}:${STOCK_ISSUER}`);
    }
  });

  it('have distinct hub assets, none shared with another XRPL token', () => {
    const hubAssets = Object.values(xrpSupportedTokens).map(token => token.hubAsset.toLowerCase());
    expect(new Set(hubAssets).size).toBe(hubAssets.length);
  });

  it('are staging-only: in the staging list and its accessor, not in production', () => {
    for (const symbol of LIVE) {
      const token = stock(symbol);
      expect(stagingSwapSupportedTokens[xrpChain], symbol).toContain(token);
      expect(getStagingSolverTokens(xrpChain), symbol).toContain(token);
      expect(swapSupportedTokens[xrpChain], symbol).not.toContain(token);
      expect(getSupportedSolverTokens(xrpChain), symbol).not.toContain(token);
    }
  });

  it('pass swap validation case-insensitively, and the production XRPL assets are untouched', () => {
    for (const symbol of LIVE) {
      const { address } = stock(symbol);
      expect(isSwapSupportedToken(xrpChain, address), symbol).toBe(true);
      expect(isSwapSupportedToken(xrpChain, address.toLowerCase()), symbol).toBe(true);
    }
    expect(swapSupportedTokens[xrpChain].map(token => token.symbol)).toEqual(['XRP', 'RLUSD', 'USDC']);
  });

  it('are not money-market assets', () => {
    const addresses = new Set(LIVE.map(symbol => stock(symbol).address.toLowerCase()));
    const offenders = (moneyMarketSupportedTokens[xrpChain] ?? []).filter(token =>
      addresses.has(token.address.toLowerCase()),
    );
    expect(offenders.map(token => token.symbol)).toEqual([]);
  });
});
