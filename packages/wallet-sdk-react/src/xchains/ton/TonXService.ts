import { XService } from '@/core/XService.js';
import type { XToken } from '@sodax/types';
import type { TonConnectLike } from '@sodax/wallet-sdk-core';
import { Address, beginCell, Cell } from '@ton/core';

const DEFAULT_RPC = 'https://toncenter.com/api/v2/jsonRPC';
const NATIVE_TON = '0x0000000000000000000000000000000000000000';

export type TonXServiceConfig = {
  rpcUrl?: string;
  /** Public URL of the dApp's `tonconnect-manifest.json` — required by TonConnect to open a wallet. */
  manifestUrl?: string;
};

/**
 * TON service. Holds the single `TonConnectUI` instance, created lazily on first use because it touches
 * the DOM and needs the dApp's manifest URL.
 *
 * A TON account is addressed by its public key; balances are read for the address the connected wallet
 * actually uses, since that differs between wallet versions for the same key.
 */
export class TonXService extends XService {
  private static instance: TonXService;

  public rpcUrl: string;
  public manifestUrl?: string;
  private ui?: TonConnectLike & {
    openModal: () => Promise<void>;
    disconnect: () => Promise<void>;
    onStatusChange: (cb: (wallet: unknown) => void, onError?: (err: unknown) => void) => () => void;
    connectionRestored: Promise<boolean>;
  };

  private constructor(config?: TonXServiceConfig) {
    super('TON');
    this.rpcUrl = config?.rpcUrl ?? DEFAULT_RPC;
    this.manifestUrl = config?.manifestUrl;
  }

  public static getInstance(config?: TonXServiceConfig): TonXService {
    if (!TonXService.instance) {
      TonXService.instance = new TonXService(config);
    } else {
      if (config?.rpcUrl) TonXService.instance.rpcUrl = config.rpcUrl;
      if (config?.manifestUrl) TonXService.instance.manifestUrl = config.manifestUrl;
    }
    return TonXService.instance;
  }

  /** The TonConnect UI instance, created on first use. */
  public async tonConnect(): Promise<NonNullable<TonXService['ui']>> {
    if (this.ui) return this.ui;
    if (typeof window === 'undefined') throw new Error('[TonXService] TonConnect is only available in a browser');
    if (!this.manifestUrl) {
      throw new Error(
        '[TonXService] set TON.manifestUrl in SodaxWalletConfig — TonConnect needs the dApp manifest URL',
      );
    }
    const { TonConnectUI } = await import('@tonconnect/ui');
    this.ui = new TonConnectUI({ manifestUrl: this.manifestUrl }) as unknown as NonNullable<TonXService['ui']>;
    return this.ui;
  }

  /** The TonConnect instance if it has already been created, without creating one. */
  public get connectedUi(): TonXService['ui'] {
    return this.ui;
  }

  private async rpc<T>(method: string, params: Record<string, unknown>): Promise<T | undefined> {
    const res = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 1, jsonrpc: '2.0', method, params }),
    });
    const body = (await res.json()) as { ok?: boolean; result?: T };
    return body.ok ? body.result : undefined;
  }

  /**
   * @warning Network / fetch failures are silently swallowed — `0n` is returned on any error.
   * Callers cannot distinguish "zero balance" from "fetch failed". Matches the other XServices.
   */
  override async getBalance(address: string | undefined, xToken: XToken): Promise<bigint> {
    const account = this.ui?.account;
    if (!address || !account?.publicKey || `0x${account.publicKey.toLowerCase()}` !== address.toLowerCase()) return 0n;
    const owner = Address.parseRaw(account.address).toString();
    try {
      if (xToken.address.toLowerCase() === NATIVE_TON) {
        return BigInt((await this.rpc<string>('getAddressBalance', { address: owner })) ?? 0);
      }
      const ownerBoc = beginCell().storeAddress(Address.parse(owner)).endCell().toBoc().toString('base64');
      const walletRes = await this.rpc<{ exit_code?: number; stack?: [string, { bytes?: string }][] }>('runGetMethod', {
        address: xToken.address,
        method: 'get_wallet_address',
        stack: [['tvm.Slice', ownerBoc]],
      });
      const bytes = walletRes?.stack?.[0]?.[1]?.bytes;
      if (walletRes?.exit_code !== 0 || !bytes) return 0n;
      const jettonWallet = Cell.fromBoc(Buffer.from(bytes, 'base64'))[0]?.beginParse().loadAddress().toString();
      if (!jettonWallet) return 0n;
      const data = await this.rpc<{ exit_code?: number; stack?: [string, string][] }>('runGetMethod', {
        address: jettonWallet,
        method: 'get_wallet_data',
        stack: [],
      });
      const balance = data?.stack?.[0]?.[1];
      return data?.exit_code === 0 && balance !== undefined ? BigInt(balance) : 0n;
    } catch (error) {
      console.error('Error fetching TON balance:', error);
      return 0n;
    }
  }
}
