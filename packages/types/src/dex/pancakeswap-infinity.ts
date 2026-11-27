import type { Address } from '../shared/shared.js';
import type { Prettify } from '../common/common.js';

export type BigintIsh = bigint | number | string;
export declare enum TradeType {
  EXACT_INPUT = 0,
  EXACT_OUTPUT = 1,
}
export declare enum Rounding {
  ROUND_DOWN = 0,
  ROUND_HALF_UP = 1,
  ROUND_UP = 2,
}
export declare const MINIMUM_LIQUIDITY = 1000n;
export declare const ZERO = 0n;
export declare const ONE = 1n;
export declare const TWO = 2n;
export declare const THREE = 3n;
export declare const FIVE = 5n;
export declare const TEN = 10n;
export declare const _100 = 100n;
export declare const _9975 = 9975n;
export declare const _10000 = 10000n;
export declare const MaxUint256: bigint;
export declare enum VMType {
  uint8 = 'uint8',
  uint256 = 'uint256',
}
export declare const VM_TYPE_MAXIMA: {
  uint8: bigint;
  uint256: bigint;
};
export declare const ZERO_ADDRESS: '0x0000000000000000000000000000000000000000';

// biome-ignore lint/suspicious/noExplicitAny: importing from @pancakeswap/swap-sdk-core
export declare abstract class BaseCurrency<T extends BaseCurrency<any> = BaseCurrency<any>> {
  /** Native to the chain; must be wrapped for PancakeSwap (e.g. Ether). */
  abstract readonly isNative: boolean;
  /** Usable in PancakeSwap without wrapping. */
  abstract readonly isToken: boolean;
  readonly chainId: number;
  readonly decimals: number;
  /** Short, non-unique identifier. */
  readonly symbol: string;
  readonly name?: string;
  protected constructor(chainId: number, decimals: number, symbol: string, name?: string);
  abstract equals(other: BaseCurrency<T>): boolean;
  /** Wrapped version usable with the PancakeSwap contracts. */
  abstract get wrapped(): T;
  get asToken(): T;
}

export interface SerializedToken {
  chainId: number;
  address: `0x${string}`;
  decimals: number;
  symbol: string;
  name?: string;
  projectLink?: string;
}
export declare class Token extends BaseCurrency<Token> {
  readonly isNative: false;
  readonly isToken: true;
  readonly address: `0x${string}`;
  readonly projectLink?: string;
  constructor(
    chainId: number,
    address: `0x${string}`,
    decimals: number,
    symbol: string,
    name?: string,
    projectLink?: string,
  );
  /** Equal when chainId and address match. */
  equals(other: BaseCurrency): boolean;
  /** Compares by address; throws if the addresses are equal or the chains differ. */
  sortsBefore(other: Token): boolean;
  /** Returns itself: a token needs no wrapping. */
  get wrapped(): Token;
  get serialize(): SerializedToken;
}

export declare abstract class NativeCurrency extends BaseCurrency<Token> {
  readonly isNative: true;
  readonly isToken: false;
  get asToken(): Token;
}

export interface SerializedSPLToken {
  chainId: number;
  address: string;
  programId: string;
  decimals: number;
  symbol: string;
  name?: string;
  projectLink?: string;
}
/** SPL token on Solana or other non-EVM chains. */
export declare class SPLToken extends BaseCurrency<SPLToken> {
  readonly isNative: false;
  readonly isToken: true;
  readonly address: string;
  readonly programId: string;
  readonly logoURI: string;
  readonly projectLink?: string;
  static isSPLToken(token?: UnifiedCurrency): boolean;
  constructor({
    chainId,
    programId,
    address,
    decimals,
    symbol,
    logoURI,
    name,
    projectLink,
  }: {
    chainId: number;
    programId: string;
    address: string;
    decimals: number;
    symbol: string;
    logoURI: string;
    name?: string;
    projectLink?: string;
    isNative?: boolean;
  });
  /** Equal when chainId and programId match. */
  equals(other: BaseCurrency): boolean;
  sortsBefore(other: SPLToken): boolean;
  get wrapped(): SPLToken;
  get serialize(): SerializedSPLToken;
}

export declare abstract class SPLNativeCurrency extends BaseCurrency<SPLToken> {
  readonly isNative: true;
  readonly isToken: false;
  readonly address: string;
}

export type Currency = NativeCurrency | Token;
export type UnifiedNativeCurrency = NativeCurrency | SPLNativeCurrency;
export type UnifiedCurrency = SPLToken | SPLNativeCurrency | Currency;
export type UnifiedToken = SPLToken | Token;

export declare class Fraction {
  readonly numerator: bigint;
  readonly denominator: bigint;
  constructor(numerator: BigintIsh, denominator?: BigintIsh);
  private static readonly tryParseFraction;
  get quotient(): bigint;
  get remainder(): Fraction;
  invert(): Fraction;
  add(other: Fraction | BigintIsh): Fraction;
  subtract(other: Fraction | BigintIsh): Fraction;
  lessThan(other: Fraction | BigintIsh): boolean;
  equalTo(other: Fraction | BigintIsh): boolean;
  greaterThan(other: Fraction | BigintIsh): boolean;
  multiply(other: Fraction | BigintIsh): Fraction;
  divide(other: Fraction | BigintIsh): Fraction;
  toSignificant(significantDigits: number, format?: object, rounding?: Rounding): string;
  toFixed(decimalPlaces: number, format?: object, rounding?: Rounding): string;
  get asFraction(): Fraction;
}

export declare function toPercent(fraction: Fraction): Percent;
export declare class Percent extends Fraction {
  /** Discriminator that stops a plain Fraction from being treated as a Percent. */
  readonly isPercent: true;
  static readonly toPercent: typeof toPercent;
  add(other: Fraction | BigintIsh): Percent;
  subtract(other: Fraction | BigintIsh): Percent;
  multiply(other: Fraction | BigintIsh): Percent;
  divide(other: Fraction | BigintIsh): Percent;
  toSignificant(significantDigits?: number, format?: object, rounding?: Rounding): string;
  toFixed(decimalPlaces?: number, format?: object, rounding?: Rounding): string;
}

export declare class CurrencyAmount<T extends Currency> extends Fraction {
  readonly currency: T;
  readonly decimalScale: bigint;
  /** `rawAmount` is unitless (smallest token unit). */
  static fromRawAmount<T extends Currency>(currency: T, rawAmount: BigintIsh): CurrencyAmount<T>;
  static fromFractionalAmount<T extends Currency>(
    currency: T,
    numerator: BigintIsh,
    denominator: BigintIsh,
  ): CurrencyAmount<T>;
  protected constructor(currency: T, numerator: BigintIsh, denominator?: BigintIsh);
  add(other: CurrencyAmount<T>): CurrencyAmount<T>;
  subtract(value: bigint): CurrencyAmount<T>;
  subtract(other: CurrencyAmount<T>): CurrencyAmount<T>;
  multiply(other: Fraction | BigintIsh): CurrencyAmount<T>;
  divide(other: Fraction | BigintIsh): CurrencyAmount<T>;
  toSignificant(significantDigits?: number, format?: object, rounding?: Rounding): string;
  toFixed(decimalPlaces?: number, format?: object, rounding?: Rounding): string;
  toExact(format?: object): string;
  get wrapped(): CurrencyAmount<Token>;
  info(): string;
}

export declare class UnifiedCurrencyAmount<T extends UnifiedCurrency> extends Fraction {
  readonly currency: T;
  readonly decimalScale: bigint;
  /** `rawAmount` is unitless (smallest token unit). */
  static fromRawAmount<T extends UnifiedCurrency>(currency: T, rawAmount: BigintIsh): UnifiedCurrencyAmount<T>;
  static fromFractionalAmount<T extends UnifiedCurrency>(
    currency: T,
    numerator: BigintIsh,
    denominator: BigintIsh,
  ): UnifiedCurrencyAmount<T>;
  protected constructor(currency: T, numerator: BigintIsh, denominator?: BigintIsh);
  add(other: UnifiedCurrencyAmount<T>): UnifiedCurrencyAmount<T>;
  subtract(value: bigint): UnifiedCurrencyAmount<T>;
  subtract(other: UnifiedCurrencyAmount<T>): UnifiedCurrencyAmount<T>;
  multiply(other: Fraction | BigintIsh): UnifiedCurrencyAmount<T>;
  divide(other: Fraction | BigintIsh): UnifiedCurrencyAmount<T>;
  toSignificant(significantDigits?: number, format?: object, rounding?: Rounding): string;
  toFixed(decimalPlaces?: number, format?: object, rounding?: Rounding): string;
  toExact(format?: object): string;
  get wrapped(): UnifiedCurrencyAmount<UnifiedToken>;
  info(): string;
}

export declare class Price<TBase extends UnifiedCurrency, TQuote extends UnifiedCurrency> extends Fraction {
  readonly baseCurrency: TBase;
  readonly quoteCurrency: TQuote;
  readonly scalar: Fraction;
  constructor(
    ...args:
      | [TBase, TQuote, BigintIsh, BigintIsh]
      | [
          {
            baseAmount: UnifiedCurrencyAmount<TBase>;
            quoteAmount: UnifiedCurrencyAmount<TQuote>;
          },
        ]
  );
  invert(): Price<TQuote, TBase>;
  /** `other`'s base currency must equal this price's quote currency. */
  multiply<TOtherQuote extends UnifiedCurrency>(other: Price<TQuote, TOtherQuote>): Price<TBase, TOtherQuote>;
  quote(currencyAmount: UnifiedCurrencyAmount<TBase>): UnifiedCurrencyAmount<TQuote>;
  private get adjustedForDecimals();
  toSignificant(significantDigits?: number, format?: object, rounding?: Rounding): string;
  toFixed(decimalPlaces?: number, format?: object, rounding?: Rounding): string;
  get wrapped(): Price<TBase['wrapped'], TQuote['wrapped']>;
  static fromDecimal<TBase extends UnifiedCurrency, TQuote extends UnifiedCurrency>(
    base: TBase,
    quote: TQuote,
    value: string,
  ): Price<TBase, TQuote> | undefined;
}

/** The pair's reserves cannot produce the desired output for any input amount. */
export declare class InsufficientReservesError extends Error {
  readonly isInsufficientReservesError: true;
  constructor();
}
/** The input is below the price of a single unit of output after fees, so it produces no output. */
export declare class InsufficientInputAmountError extends Error {
  readonly isInsufficientInputAmountError: true;
  constructor();
}

export declare function validateVMTypeInstance(value: bigint, vmType: VMType): void;
export declare function sqrt(y: bigint): bigint;
export declare function sortedInsert<T>(
  items: T[],
  add: T,
  maxSize: number,
  comparator: (a: T, b: T) => number,
): T | null;
/** Price impact: percent difference between the pre-trade mid price and the execution price. */
export declare function computePriceImpact<TBase extends Currency, TQuote extends Currency>(
  midPrice: Price<TBase, TQuote>,
  inputAmount: CurrencyAmount<TBase>,
  outputAmount: CurrencyAmount<TQuote>,
): Percent;
export declare function getTokenComparator(balances: {
  [tokenAddress: string]: CurrencyAmount<Token> | undefined;
}): (tokenA: Token, tokenB: Token) => number;
export declare function sortCurrencies<T extends Currency>(currencies: T[]): T[];
export declare function sortUnifiedCurrencies<T extends UnifiedCurrency>(currencies: T[]): T[];
export declare const isCurrencySorted: (currencyA: Currency, currencyB: Currency) => boolean;
export declare const isUnifiedCurrencySorted: (currencyA: UnifiedCurrency, currencyB: UnifiedCurrency) => boolean;
export declare function getCurrencyAddress(currency: Currency): `0x${string}`;
export declare function getUnifiedCurrencyAddress(currency: UnifiedCurrency): string;
export declare function getMatchedCurrency(
  currency: Currency,
  list: Currency[],
  matchWrappedCurrency?: boolean,
): Currency | undefined;

export type Tuple<T, N, R extends T[] = []> = R['length'] extends N ? R : Tuple<T, N, [...R, T]>;
export type Bytes32 = `0x${string}`;
export type HooksRegistration = {
  beforeInitialize?: boolean;
  afterInitialize?: boolean;
  beforeAddLiquidity?: boolean;
  afterAddLiquidity?: boolean;
  beforeRemoveLiquidity?: boolean;
  afterRemoveLiquidity?: boolean;
  beforeSwap?: boolean;
  afterSwap?: boolean;
  beforeDonate?: boolean;
  afterDonate?: boolean;
  beforeSwapReturnsDelta?: boolean;
  afterSwapReturnsDelta?: boolean;
  afterMintReturnsDelta?: boolean;
  afterBurnReturnsDelta?: boolean;
};
export type BinTree = {
  level0: Bytes32;
  level1: Record<number, Bytes32>;
  level2: Record<number, Bytes32>;
};
export declare enum BinLiquidityShape {
  Spot = 'Spot',
  Curve = 'Curve',
  BidAsk = 'BidAsk',
}
export declare enum POOL_TYPE {
  CLAMM = 'CL',
  Bin = 'Bin',
}
export type PoolType = `${POOL_TYPE}`;
export type CLPoolParameter = {
  hooksRegistration?: HooksRegistration;
  tickSpacing: number;
};
export type BinPoolParameter = {
  hooksRegistration?: HooksRegistration;
  binStep: number;
  tickSpacing: number;
};
/** Unique pool identifier, decoded form (see {@link EncodedPoolKey}). */
export type PoolKey<TPoolType extends PoolType = 'CL' | 'Bin'> = {
  /** Lower-sorted currency address; zero address for the native token. */
  currency0: Address;
  /** Higher-sorted currency address. */
  currency1: Address;
  /** Zero address when the pool has no hooks. */
  hooks?: Address;
  poolManager: Address;
  /** LP fee in millionths: max 1_000_000 (100%) for CL, 100_000 (10%) for Bin. Dynamic-fee pools must use exactly 0x800000. */
  fee: number;
  parameters: TPoolType extends 'CL'
    ? CLPoolParameter
    : TPoolType extends 'Bin'
      ? BinPoolParameter
      : CLPoolParameter | BinPoolParameter;
};
/** On-chain encoded PoolKey; see https://github.com/pancakeswap/infinity-core/blob/main/src/types/PoolKey.sol */
export type EncodedPoolKey = {
  currency0: Address;
  currency1: Address;
  hooks: Address;
  poolManager: Address;
  fee: number;
  parameters: Bytes32;
};
export type CLPositionConfig = {
  poolKey: PoolKey<'CL'>;
  tickLower: number;
  tickUpper: number;
};
export type EncodedCLPositionConfig = {
  poolKey: Prettify<
    Omit<PoolKey<'CL'>, 'parameters'> & {
      parameters: Bytes32;
    }
  >;
  tickLower: number;
  tickUpper: number;
};
export type BinPool = {
  poolType: 'Bin';
  token0: Currency;
  token1: Currency;
  fee: number;
  protocolFee: number;
  dynamic: boolean;
  activeId: number;
  binStep: number;
  hooksRegistration?: HooksRegistration | undefined;
};
export type CLSlot0 = {
  sqrtPriceX96: bigint;
  tick: number;
  protocolFee: number;
  lpFee: number;
};
export type BinSlot0 = {
  activeId: number;
  protocolFee: number;
  lpFee: number;
};
export type Slot0<TPoolType extends PoolType | unknown = unknown> = TPoolType extends 'CL'
  ? CLSlot0
  : TPoolType extends 'Bin'
    ? BinSlot0
    : unknown;
export type HookTag = 'CL' | 'Bin' | 'Dynamic' | (string & NonNullable<unknown>);
export declare enum HOOK_CATEGORY {
  DynamicFees = 'Dynamic Fees',
  LiquidityIncentivisation = 'Liquidity Incentivisation',
  YieldOptimisation = 'Yield Optimisation',
  JIT = 'JIT',
  MEV = 'MEV',
  RWA = 'RWA',
  ALM = 'ALM',
  CrossChain = 'Cross-Chain',
  Leverage = 'Leverage',
  PricingCurve = 'Pricing Curve',
  OrderType = 'Order Type',
  Oracle = 'Oracle',
  Others = 'Others',
  BrevisDiscount = 'Fee Discount (Brevis)',
  PrimusDiscount = 'Fee Discount (Primus)',
}
export interface HookData {
  address: Address;
  name?: string;
  category?: HOOK_CATEGORY[];
  description?: string;
  poolType?: POOL_TYPE;
  github?: string;
  audit?: string;
  learnMoreLink?: string;
  creator?: string;
  isVerified?: boolean;
  isUpgradable?: boolean;
  hooksRegistration?: HooksRegistration;
  hookType?: HookType;
  defaultFee?: number;
}
export declare enum HookType {
  Universal = 'Universal',
  PerPool = 'PerPool',
}
