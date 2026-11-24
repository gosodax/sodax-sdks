import type { CardanoDataSignature, ICardanoWalletProvider } from '@sodax/types';
import { BaseWalletProvider } from '../BaseWalletProvider.js';
import type { CardanoWalletConfig, CardanoWalletDefaults, CardanoWalletLike } from './types.js';

/**
 * Cardano wallet provider over a CIP-30 wallet. The wallet holds the key: the sdk builds the deposit transaction
 * and the wallet adds its witness and submits it, and a withdraw authorization is a `signData` over the readable
 * `0x<hash>` payload (scheme 7).
 */
export class CardanoWalletProvider extends BaseWalletProvider<CardanoWalletDefaults> implements ICardanoWalletProvider {
  public readonly chainType = 'CARDANO' as const;
  private readonly wallet: CardanoWalletLike;

  constructor(config: CardanoWalletConfig) {
    super(config.defaults);
    if (!config.wallet) throw new Error('Invalid Cardano wallet configuration: a CIP-30 wallet is required');
    this.wallet = config.wallet;
  }

  public async getWalletAddress(): Promise<string> {
    return this.wallet.getAddress();
  }

  public async signTransaction(unsignedTx: string): Promise<string> {
    return this.wallet.signTx(unsignedTx.replace(/^0x/i, ''));
  }

  public async submitTransaction(signedTx: string): Promise<string> {
    return this.wallet.submitTx(signedTx.replace(/^0x/i, ''));
  }

  public async signData(payload: `0x${string}`): Promise<CardanoDataSignature> {
    return this.wallet.signData(payload.slice(2));
  }
}
