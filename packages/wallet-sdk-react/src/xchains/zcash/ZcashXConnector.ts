import type { ZcashWalletLike } from '@sodax/wallet-sdk-core';
import { formatUnits } from 'viem';
import type { XAccount } from '@/types/index.js';
import { XConnector } from '@/core/index.js';
import {
  getNoirZcashProvider,
  readSignedMessage,
  readTransparentAddress,
  type NoirZcashProvider,
} from './noirWallet.js';

// Self-contained data URI (the Zcash mark) — avoids cross-origin/CORS image fetches.
const NOIR_ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='16' fill='%23111'/%3E%3Cpath d='M11 10h10l-10 12h10M16 7v3M16 22v3' fill='none' stroke='%23f4b728' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E";
const NOIR_INSTALL_URL = 'https://zknoir.com/';
const ZEC_DECIMALS = 8;

/**
 * Noir Wallet connector for Zcash (transparent ZEC).
 *
 * Noir cannot sign a transaction the sdk builds: it pays an address itself (`zcash_sendTransaction`) and signs
 * messages with the transparent address key (`zcash_signMessage`, the `signmessage` format withdrawals need). The
 * registry's `createWalletProvider` reads {@link getWallet} to build a browser-mode `ZcashWalletProvider`.
 */
export class ZcashXConnector extends XConnector {
  constructor() {
    super('ZCASH', 'Noir Wallet', 'noir-wallet');
  }

  private requireProvider(): NoirZcashProvider {
    const provider = getNoirZcashProvider();
    if (!provider) throw new Error('Noir Wallet is not installed. Install the extension and reload the page.');
    return provider;
  }

  async connect(): Promise<XAccount | undefined> {
    const address = readTransparentAddress(await this.requireProvider().request({ method: 'zcash_requestAccounts' }));
    if (!address) {
      throw new Error('Could not connect a Zcash transparent account. Approve the Noir Wallet popup and retry.');
    }
    return { address, xChainType: this.xChainType };
  }

  async disconnect(): Promise<void> {
    await getNoirZcashProvider()?.request({ method: 'zcash_disconnect' });
  }

  public override get icon(): string {
    return NOIR_ICON;
  }

  public override get isInstalled(): boolean {
    return getNoirZcashProvider() !== undefined;
  }

  public override get installUrl(): string {
    return NOIR_INSTALL_URL;
  }

  /** Noir's API adapted to the structural shape `ZcashWalletProvider` expects. */
  public getWallet(): ZcashWalletLike {
    const getAddress = async (): Promise<string> => {
      const address = readTransparentAddress(await this.requireProvider().request({ method: 'zcash_getAddresses' }));
      if (!address) throw new Error('Noir Wallet returned no transparent address');
      return address;
    };

    return {
      getAddress,
      sendTransfer: async ({ to, amount }) => {
        const txid = await this.requireProvider().request({
          method: 'zcash_sendTransaction',
          // Transparent funding: the deposit must come from the account the relay credits and withdrawals sign as.
          params: [{ to, amount: formatUnits(amount, ZEC_DECIMALS), fundingSource: 'transparent' }],
        });
        if (typeof txid !== 'string' || !/^(0x)?[0-9a-fA-F]{64}$/.test(txid)) {
          throw new Error('Noir Wallet did not return a transaction id');
        }
        return txid;
      },
      signMessage: async (message: string) => {
        const [expected, result] = await Promise.all([
          getAddress(),
          this.requireProvider().request({
            method: 'zcash_signMessage',
            params: [message, { signingMode: 'current' }],
          }),
        ]);
        const signed = readSignedMessage(result);
        if (!signed) throw new Error('Noir Wallet returned no signature');
        // Only the transparent address key recovers to the identity the contract checks.
        if (signed.address !== expected) {
          throw new Error(`Noir Wallet signed with ${signed.address}, expected the transparent address ${expected}`);
        }
        const hex = signed.signature.replace(/^0x/, '').toLowerCase();
        if (!/^[0-9a-f]{130}$/.test(hex)) throw new Error('Noir Wallet returned a malformed signature');
        return `0x${hex}`;
      },
    };
  }
}
