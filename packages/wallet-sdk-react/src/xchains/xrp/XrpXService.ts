import { XService } from '@/core/XService.js';
import type { XToken } from '@sodax/types';

const DEFAULT_RPC = 'https://xrplcluster.com';
const NATIVE_XRP = '0x0000000000000000000000000000000000000000';

/**
 * XRPL currency code for a symbol: 3 characters stay ASCII, anything longer uses the 160-bit form
 * (ASCII left-aligned, zero-padded to 20 bytes) — which is how rippled reports USDC and RLUSD.
 * Mirrors `xrpCurrencyCode` in the sdk; kept local so this package takes no sdk dependency.
 */
function currencyCode(symbol: string): string {
  if (symbol.length <= 3) return symbol;
  return Array.from(new TextEncoder().encode(symbol), byte => byte.toString(16).padStart(2, '0'))
    .join('')
    .padEnd(40, '0')
    .toUpperCase();
}

/**
 * The XRPL (currency, issuer) of a token. An issuer that issues several tokens (the Robinhood stocks)
 * uses the address `<40-hex currency>:<issuer>`; every other token keeps the issuer-only address and
 * derives the currency from its symbol. Mirrors `xrpTokenRef` in the sdk, kept local for the same reason.
 */
export function xrpTokenRef(token: { address: string; symbol: string }): { currency: string; issuer: string } {
  const sep = token.address.indexOf(':');
  if (sep === -1) return { currency: currencyCode(token.symbol), issuer: token.address };
  return { currency: token.address.slice(0, sep).toUpperCase(), issuer: token.address.slice(sep + 1) };
}

export class XrpXService extends XService {
  private static instance: XrpXService;

  public rpcUrl: string;

  private constructor(config?: { rpcUrl?: string }) {
    super('XRP');
    this.rpcUrl = config?.rpcUrl ?? DEFAULT_RPC;
  }

  public static getInstance(config?: { rpcUrl?: string }): XrpXService {
    if (!XrpXService.instance) {
      XrpXService.instance = new XrpXService(config);
    } else if (config?.rpcUrl) {
      XrpXService.instance.rpcUrl = config.rpcUrl;
    }
    return XrpXService.instance;
  }

  private async rpc<T>(method: string, params: Record<string, unknown>): Promise<T | undefined> {
    const res = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, params: [params] }),
    });
    const body = (await res.json()) as { result?: T };
    return body.result;
  }

  /**
   * @warning Network / fetch failures are silently swallowed — `0n` is returned on any error.
   * Callers cannot distinguish "zero balance" from "fetch failed". Matches the other XServices.
   */
  override async getBalance(address: string | undefined, xToken: XToken): Promise<bigint> {
    if (!address) return 0n;
    try {
      // Native XRP: `account_info` reports drops.
      if (xToken.symbol === 'XRP' || xToken.address.toLowerCase() === NATIVE_XRP) {
        const info = await this.rpc<{ account_data?: { Balance?: string } }>('account_info', {
          account: address,
          ledger_index: 'validated',
        });
        return BigInt(info?.account_data?.Balance ?? 0);
      }
      // IOU: the balance lives on the trustline to the token's issuer, in the token's currency.
      const { currency: wanted, issuer } = xrpTokenRef(xToken);
      let marker: unknown;
      do {
        const page = await this.rpc<{
          lines?: { currency: string; account: string; balance: string }[];
          marker?: unknown;
        }>('account_lines', {
          account: address,
          peer: issuer,
          ledger_index: 'validated',
          ...(marker === undefined ? {} : { marker }),
        });
        const line = page?.lines?.find(l => l.currency === wanted && l.account === issuer);
        if (line) return toBaseUnits(line.balance, xToken.decimals);
        marker = page?.marker;
      } while (marker !== undefined);
      return 0n;
    } catch (error) {
      console.error('Error fetching XRPL balance:', error);
      return 0n;
    }
  }
}

// Mirrors toBaseUnits in the sdk; kept local because this package takes no sdk dependency, like currencyCode.
function toBaseUnits(value: string, decimals: number): bigint {
  const match = /^(-?)(\d*)(?:\.(\d*))?(?:e([+-]?\d{1,3}))?$/i.exec(value);
  const [, sign = '', whole = '', frac = '', exponent = '0'] = match ?? [];
  if (!match || (whole === '' && frac === '')) throw new Error(`Unreadable XRPL amount: ${value}`);
  const digits = BigInt(`${whole}${frac}` || '0');
  const shift = Number(exponent) - frac.length + decimals;
  const units = shift >= 0 ? digits * 10n ** BigInt(shift) : digits / 10n ** BigInt(-shift);
  return sign === '-' ? -units : units;
}
