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
  const ascii = Buffer.from(symbol, 'ascii');
  return Buffer.concat([ascii, Buffer.alloc(20 - ascii.length)])
    .toString('hex')
    .toUpperCase();
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
      // IOU: the balance lives on the trustline to the issuer, which is the token's `address`.
      const lines = await this.rpc<{ lines?: { currency: string; account: string; balance: string }[] }>(
        'account_lines',
        { account: address, ledger_index: 'validated' },
      );
      const wanted = currencyCode(xToken.symbol);
      const line = lines?.lines?.find(l => l.currency === wanted && l.account === xToken.address);
      if (!line) return 0n;
      // IOU balances are decimal strings; scale to base units so every chain returns the same shape.
      const [whole = '0', frac = ''] = line.balance.split('.');
      return BigInt(whole + frac.padEnd(xToken.decimals, '0').slice(0, xToken.decimals));
    } catch (error) {
      console.error('Error fetching XRPL balance:', error);
      return 0n;
    }
  }
}
