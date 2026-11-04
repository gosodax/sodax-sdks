import { XService } from '@/core/XService.js';
import type { XToken } from '@sodax/types';
import { getLaceWallet, readCip30Api, readLovelace } from './laceWallet.js';

export class CardanoXService extends XService {
  private static instance: CardanoXService;

  /** Koios REST base URL (`https://…/api/v1`). Browsers need a CORS-enabled endpoint: public Koios is not one. */
  public rpcUrl: string | undefined;

  private constructor(config?: { rpcUrl?: string }) {
    super('CARDANO');
    this.rpcUrl = config?.rpcUrl;
  }

  public static getInstance(config?: { rpcUrl?: string }): CardanoXService {
    if (!CardanoXService.instance) {
      CardanoXService.instance = new CardanoXService(config);
    } else if (config?.rpcUrl) {
      CardanoXService.instance.rpcUrl = config.rpcUrl;
    }
    return CardanoXService.instance;
  }

  /** `address_info` from Koios, in lovelace. An address Koios has never seen is an empty array. */
  private async rpcBalance(rpcUrl: string, address: string): Promise<bigint> {
    const res = await fetch(`${rpcUrl.replace(/\/+$/, '')}/address_info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _addresses: [address] }),
    });
    if (!res.ok) throw new Error(`koios address_info: HTTP ${res.status}`);
    const rows: { balance?: string }[] = await res.json();
    return BigInt(rows[0]?.balance ?? 0);
  }

  /** Lace's own balance, read only when it has already approved this site, so a read never opens a prompt. */
  private async walletBalance(): Promise<bigint> {
    const lace = getLaceWallet();
    if (!lace?.isEnabled || !(await lace.isEnabled())) return 0n;
    const api = readCip30Api(await lace.enable());
    return (api && readLovelace(await api.getBalance())) ?? 0n;
  }

  /**
   * ADA only. Reads the configured Koios endpoint when there is one, otherwise the approved Lace wallet.
   *
   * @warning Network / fetch failures are silently swallowed — `0n` is returned on any error.
   * Callers cannot distinguish "zero balance" from "fetch failed". Matches the other XServices.
   */
  override async getBalance(address: string | undefined, _xToken: XToken): Promise<bigint> {
    if (!address) return 0n;
    try {
      return this.rpcUrl ? await this.rpcBalance(this.rpcUrl, address) : await this.walletBalance();
    } catch (error) {
      console.error('Error fetching Cardano balance:', error);
      return 0n;
    }
  }
}
