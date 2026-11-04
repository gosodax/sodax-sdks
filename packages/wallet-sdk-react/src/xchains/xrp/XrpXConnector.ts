import { getAddress, getPublicKey, isInstalled, signMessage, submitTransaction } from '@gemwallet/api';
import type { GemWalletLike } from '@sodax/wallet-sdk-core';
import type { XAccount } from '@/types/index.js';
import { XConnector } from '@/core/index.js';

// Self-contained data URI (the XRPL mark) — avoids cross-origin/CORS image fetches.
const GEMWALLET_ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='16' fill='%233ea8ff'/%3E%3Cpath d='M9 10l7 6 7-6M9 22l7-6 7 6' fill='none' stroke='%23fff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E";
const GEMWALLET_INSTALL_URL = 'https://gemwallet.app/';

/**
 * GemWallet connector for the XRP Ledger.
 *
 * Unlike TronLink, GemWallet is not usable as a bare injected object: it sets `window.gemWallet`
 * purely as a detection flag and all calls go through `@gemwallet/api`, which talks to the
 * extension over postMessage. So this wraps that API rather than reading a global.
 *
 * The registry's `createWalletProvider` reads {@link getGemWallet} to build a browser-mode
 * `XrpWalletProvider`.
 */
export class XrpXConnector extends XConnector {
  constructor() {
    super('XRP', 'GemWallet', 'GemWallet');
  }

  async connect(): Promise<XAccount | undefined> {
    const installed = await isInstalled();
    if (!installed.result.isInstalled) {
      throw new Error('GemWallet is not installed. Install the extension and reload the page.');
    }

    // Prompts the user on first use; resolves with the connected classic address afterwards.
    const res = await getAddress();
    const address = res.result?.address;
    if (!address) {
      throw new Error('Could not connect an XRPL account. Approve the GemWallet popup and retry.');
    }
    return { address, xChainType: this.xChainType };
  }

  async disconnect(): Promise<void> {
    // GemWallet has no programmatic disconnect; clearing the app-side connection is enough.
  }

  public override get icon(): string {
    return GEMWALLET_ICON;
  }

  public override get isInstalled(): boolean {
    // `window.gemWallet` is the extension's detection flag. The async `isInstalled()` from the API
    // is authoritative, but this getter is sync and on the render path, so use the flag here.
    return typeof window !== 'undefined' && (window as unknown as { gemWallet?: boolean }).gemWallet === true;
  }

  public override get installUrl(): string | undefined {
    return GEMWALLET_INSTALL_URL;
  }

  /**
   * The GemWallet API adapted to the structural shape `XrpWalletProvider` expects, so that package
   * needs no `@gemwallet/api` dependency of its own.
   */
  public getGemWallet(): GemWalletLike {
    return {
      getAddress: () => getAddress(),
      getPublicKey: () => getPublicKey(),
      signMessage: (message: string, isHex?: boolean) => signMessage(message, isHex),
      submitTransaction: (payload: { transaction: Record<string, unknown> }) => submitTransaction(payload as never),
    } as GemWalletLike;
  }
}
