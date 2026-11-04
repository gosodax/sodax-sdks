import { XService } from '@/core/XService.js';
import type { XToken } from '@sodax/types';
import { parseUnits } from 'viem';
import { getNoirZcashProvider, readTransparentAddress, readTransparentBalance } from './noirWallet.js';

const ZEC_DECIMALS = 8;

export class ZcashXService extends XService {
  private static instance: ZcashXService;

  public rpcUrl: string | undefined;

  private constructor(config?: { rpcUrl?: string }) {
    super('ZCASH');
    this.rpcUrl = config?.rpcUrl;
  }

  public static getInstance(config?: { rpcUrl?: string }): ZcashXService {
    if (!ZcashXService.instance) {
      ZcashXService.instance = new ZcashXService(config);
    } else if (config?.rpcUrl) {
      ZcashXService.instance.rpcUrl = config.rpcUrl;
    }
    return ZcashXService.instance;
  }

  /** `getaddressbalance` from an address-indexed node, in zatoshis. */
  private async rpcBalance(rpcUrl: string, address: string): Promise<bigint> {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '1.0',
        id: 'sodax',
        method: 'getaddressbalance',
        params: [{ addresses: [address] }],
      }),
    });
    const body: { result?: { balance?: number | string } } = await res.json();
    return BigInt(body.result?.balance ?? 0);
  }

  /** The connected Noir account's transparent balance, when `address` is that account. */
  private async walletBalance(address: string): Promise<bigint> {
    const provider = getNoirZcashProvider();
    if (!provider) return 0n;
    const connected = readTransparentAddress(await provider.request({ method: 'zcash_getAddresses' }));
    if (connected !== address) return 0n;
    const balance = readTransparentBalance(await provider.request({ method: 'zcash_getBalance', params: [] }));
    return balance ? parseUnits(balance, ZEC_DECIMALS) : 0n;
  }

  /**
   * Transparent ZEC only. Reads the configured node when there is one, otherwise the connected wallet.
   *
   * @warning Network / fetch failures are silently swallowed — `0n` is returned on any error.
   * Callers cannot distinguish "zero balance" from "fetch failed". Matches the other XServices.
   */
  override async getBalance(address: string | undefined, _xToken: XToken): Promise<bigint> {
    if (!address) return 0n;
    try {
      return this.rpcUrl ? await this.rpcBalance(this.rpcUrl, address) : await this.walletBalance(address);
    } catch (error) {
      console.error('Error fetching Zcash balance:', error);
      return 0n;
    }
  }
}
