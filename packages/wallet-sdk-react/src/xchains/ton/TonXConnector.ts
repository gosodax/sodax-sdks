import type { TonConnectLike } from '@sodax/wallet-sdk-core';
import type { XAccount } from '@/types/index.js';
import { XConnector } from '@/core/index.js';
import { TonXService } from './TonXService.js';

// Self-contained data URI (the TON mark) — avoids cross-origin/CORS image fetches.
const TON_ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='16' fill='%230098ea'/%3E%3Cpath d='M10 10h12l-6 13z' fill='none' stroke='%23fff' stroke-width='1.8' stroke-linejoin='round'/%3E%3Cpath d='M16 10v13' stroke='%23fff' stroke-width='1.8'/%3E%3C/svg%3E";

/**
 * TonConnect connector for TON. TonConnect's modal lists every TON wallet (browser extension or mobile
 * via QR), so there is nothing to detect.
 *
 * The account address it reports is the wallet's 32-byte public key: that is how the MPC relay and the
 * SDK identify a TON user. A wallet that does not expose its public key cannot be used.
 */
export class TonXConnector extends XConnector {
  constructor() {
    super('TON', 'TonConnect', 'tonconnect');
  }

  async connect(): Promise<XAccount | undefined> {
    const ui = await TonXService.getInstance().tonConnect();
    // A restored session is already connected; wait for the restore so it is not opened twice.
    await ui.connectionRestored;
    if (!ui.account) {
      await new Promise<void>((resolve, reject) => {
        const unsubscribe = ui.onStatusChange(
          wallet => {
            if (wallet) {
              unsubscribe();
              resolve();
            }
          },
          error => {
            unsubscribe();
            reject(error instanceof Error ? error : new Error(String(error)));
          },
        );
        ui.openModal().catch(error => {
          unsubscribe();
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      });
    }
    const publicKey = ui.account?.publicKey;
    if (!publicKey) {
      throw new Error(
        'The connected TON wallet did not expose its public key, which SODAX needs to identify the account.',
      );
    }
    return { address: `0x${publicKey.toLowerCase()}`, xChainType: this.xChainType };
  }

  async disconnect(): Promise<void> {
    await TonXService.getInstance().connectedUi?.disconnect();
  }

  public override get icon(): string {
    return TON_ICON;
  }

  public override get isInstalled(): boolean {
    return true;
  }

  /**
   * TonConnect for the registry to build a browser-mode `TonWalletProvider` from. The registry builds
   * providers synchronously, including on a page reload before TonConnect exists, so this hands back an
   * adapter that creates it on first use — and starts creating it now, so the session restores.
   */
  public getTonConnect(): TonConnectLike {
    const service = TonXService.getInstance();
    if (typeof window !== 'undefined' && service.manifestUrl) void service.tonConnect();
    return {
      get account() {
        return service.connectedUi?.account ?? null;
      },
      sendTransaction: async tx => (await service.tonConnect()).sendTransaction(tx),
      signData: async payload => (await service.tonConnect()).signData(payload),
    };
  }
}
