import type { XToken } from '@sodax/types';
import { cardanoAddressFromRawHex } from '@sodax/wallet-sdk-core';
import { XService } from '@/core/XService.js';
import { readCardanoUtxo } from './cardano-utxo.js';
import { getLaceAddressHex, getLaceWallet, readCip30Api } from './laceWallet.js';

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
    let end = rpcUrl.length;
    // Scanning back, not a regex, which would backtrack on a long run of slashes.
    while (end > 0 && rpcUrl[end - 1] === '/') end--;
    const res = await fetch(`${rpcUrl.slice(0, end)}/address_info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _addresses: [address] }),
    });
    if (!res.ok) throw new Error(`koios address_info: HTTP ${res.status}`);
    const rows: { balance?: string }[] = await res.json();
    return BigInt(rows[0]?.balance ?? 0);
  }

  /** Sum UTXOs at the connected address when Lace has already approved this site. */
  private async walletBalance(address: string): Promise<bigint> {
    const lace = getLaceWallet();
    if (!lace?.isEnabled || !(await lace.isEnabled())) return 0n;
    const api = readCip30Api(await lace.enable());
    if (!api || (await api.getNetworkId()) !== 1) return 0n;
    const addressHex = await getLaceAddressHex(api);
    const connected = cardanoAddressFromRawHex(addressHex);
    const requested = address.toLowerCase();
    if (requested.replace(/^0x/, '') !== addressHex && requested !== connected) {
      return 0n;
    }

    let balance = 0n;
    for (const utxo of (await api.getUtxos()) ?? []) {
      const output = readCardanoUtxo(utxo);
      if (output.address === addressHex) balance += output.lovelace;
    }
    return balance;
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
      return this.rpcUrl ? await this.rpcBalance(this.rpcUrl, address) : await this.walletBalance(address);
    } catch (error) {
      console.error('Error fetching Cardano balance:', error);
      return 0n;
    }
  }
}
