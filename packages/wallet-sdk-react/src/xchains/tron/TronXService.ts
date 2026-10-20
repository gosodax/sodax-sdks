import { XService } from '@/core/XService.js';
import type { XToken } from '@sodax/types';

import { TRON_DEFAULT_RPC_URL } from '@/constants.js';

/** Zero-address sentinel the token lists use for native TRX. */
const TRON_NATIVE_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000';

/** base58check Tron address → 41-prefixed hex (drops the 4-byte checksum). */
function tronToHex(addr: string): string {
  if (addr.startsWith('0x') || /^41[0-9a-fA-F]{40}$/.test(addr)) return addr.replace(/^0x/, '');
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = 0n;
  for (const c of addr) n = n * 58n + BigInt(B58.indexOf(c));
  let h = n.toString(16);
  if (h.length % 2) h = `0${h}`;
  return h.slice(0, -8);
}

export class TronXService extends XService {
  private static instance: TronXService;

  public rpcUrl: string;

  private constructor(config?: { rpcUrl?: string }) {
    super('TRON');
    this.rpcUrl = config?.rpcUrl ?? TRON_DEFAULT_RPC_URL;
  }

  public static getInstance(config?: { rpcUrl?: string }): TronXService {
    if (!TronXService.instance) {
      TronXService.instance = new TronXService(config);
    } else if (config?.rpcUrl) {
      TronXService.instance.rpcUrl = config.rpcUrl;
    }
    return TronXService.instance;
  }

  private post(path: string, body: unknown): Promise<Response> {
    return fetch(`${this.rpcUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  /** @warning Any fetch failure returns `0n`, indistinguishable from a zero balance. */
  override async getBalance(address: string | undefined, xToken: XToken): Promise<bigint> {
    if (!address) return 0n;
    try {
      // Native TRX
      if (xToken.symbol === 'TRX' || xToken.address.toLowerCase() === TRON_NATIVE_TOKEN_ADDRESS) {
        const res = await this.post('/wallet/getaccount', { address, visible: true });
        const data = (await res.json()) as { balance?: number };
        return BigInt(data.balance ?? 0);
      }
      // TRC-20 balanceOf(address)
      const ownerHex = tronToHex(address);
      const param = ownerHex.replace(/^41/, '').padStart(64, '0');
      const res = await this.post('/wallet/triggerconstantcontract', {
        owner_address: ownerHex,
        contract_address: tronToHex(xToken.address),
        function_selector: 'balanceOf(address)',
        parameter: param,
        visible: false,
      });
      const data = (await res.json()) as { constant_result?: string[] };
      const raw = data.constant_result?.[0];
      return raw ? BigInt(`0x${raw}`) : 0n;
    } catch (error) {
      console.error('Error fetching Tron balance:', error);
      return 0n;
    }
  }
}
