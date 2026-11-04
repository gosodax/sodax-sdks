import { cardanoAddressFromRawHex, type CardanoWalletLike } from '@sodax/wallet-sdk-core';
import { XConnector } from '@/core/index.js';
import type { XAccount } from '@/types/index.js';
import { getLaceWallet, readCip30Api, readDataSignature, type Cip30Api } from './laceWallet.js';

// Self-contained data URI — avoids cross-origin/CORS image fetches. A neutral mark; swap in Lace's own art if wanted.
const LACE_ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23181818'/%3E%3Cpath d='M11 8v14h10' fill='none' stroke='%23fff' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E";
const LACE_INSTALL_URL = 'https://www.lace.io/';
const MAINNET_NETWORK_ID = 1;

type Session = { api: Cip30Api; addressHex: string; address: string };

/**
 * Lace connector for Cardano (CIP-30).
 *
 * Lace signs and submits but does not build transactions, so the sdk builds the deposit and Lace adds its witness
 * (`signTx`) and submits it. The account is Lace's first used address: deposits spend only its UTXOs and
 * withdrawals sign with its payment key, so both legs use the same identity. The registry's `createWalletProvider`
 * reads {@link getWallet} to build a `CardanoWalletProvider`.
 */
export class CardanoXConnector extends XConnector {
  private session?: Session;

  constructor() {
    super('CARDANO', 'Lace', 'lace');
  }

  /** Enable Lace (prompts once per site), check it is on mainnet, and pick the account's address. */
  private async open(): Promise<Session> {
    const wallet = getLaceWallet();
    if (!wallet) throw new Error('Lace is not installed. Install the extension and reload the page.');
    const api = readCip30Api(await wallet.enable());
    if (!api) throw new Error('Lace did not return a CIP-30 API');
    const networkId = await api.getNetworkId();
    if (networkId !== MAINNET_NETWORK_ID) {
      throw new Error(
        `Lace is on network id ${networkId}, but SODAX runs on mainnet (id ${MAINNET_NETWORK_ID}); switch Lace to mainnet`,
      );
    }
    const [used] = await api.getUsedAddresses();
    const addressHex = (used ?? (await api.getChangeAddress())).replace(/^0x/i, '').toLowerCase();
    // Throws for a script, reward or testnet address: only a key-hash payment address can sign data.
    const address = cardanoAddressFromRawHex(addressHex);
    this.session = { api, addressHex, address };
    return this.session;
  }

  /** The open session, re-opening it silently after a page reload (Lace remembers the approval). */
  private async current(): Promise<Session> {
    return this.session ?? this.open();
  }

  async connect(): Promise<XAccount | undefined> {
    const { address } = await this.open();
    return { address, xChainType: this.xChainType };
  }

  async disconnect(): Promise<void> {
    // CIP-30 has no disconnect: dropping the session is all there is to do.
    this.session = undefined;
  }

  public override get icon(): string {
    return LACE_ICON;
  }

  public override get isInstalled(): boolean {
    return getLaceWallet() !== undefined;
  }

  public override get installUrl(): string {
    return LACE_INSTALL_URL;
  }

  /** Lace's CIP-30 API adapted to the structural shape `CardanoWalletProvider` expects. */
  public getWallet(): CardanoWalletLike {
    return {
      getAddress: async () => (await this.current()).address,
      signTx: async tx => (await this.current()).api.signTx(tx, false),
      submitTx: async tx => (await this.current()).api.submitTx(tx),
      signData: async payload => {
        const { api, addressHex } = await this.current();
        const signed = readDataSignature(await api.signData(addressHex, payload));
        if (!signed) throw new Error('Lace returned a malformed signData result');
        return signed;
      },
    };
  }
}
