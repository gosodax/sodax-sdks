import { Address, Cell, SendMode, internal } from '@ton/core';
import { keyPairFromSeed, sign, type KeyPair } from '@ton/crypto';
import { TonClient, WalletContractV4 } from '@ton/ton';
import { sha256 } from 'viem';
import type { ITonWalletProvider, TonSignedMessage, TonUnsignedTransaction } from '@sodax/types';
import { BaseWalletProvider } from '../BaseWalletProvider.js';
import type {
  PrivateKeyTonWalletConfig,
  TonConnectLike,
  TonConnectTonWalletConfig,
  TonWalletConfig,
  TonWalletDefaults,
} from './types.js';

const DEFAULT_RPC = 'https://toncenter.com/api/v2/jsonRPC';
const DEFAULT_SIGN_DATA_DOMAIN = 'sodax.com';

export function isPrivateKeyTonWalletConfig(config: TonWalletConfig): config is PrivateKeyTonWalletConfig {
  return 'privateKey' in config;
}

export function isTonConnectTonWalletConfig(config: TonWalletConfig): config is TonConnectTonWalletConfig {
  return 'tonConnect' in config;
}

/** The readable line a scheme-5 withdrawal signs; must match the NEAR contract's rebuild. */
function withdrawSignText(hash: string): string {
  return `SODAX withdrawal\nmessage: ${hash.toLowerCase()}`;
}

/**
 * The bytes a TonConnect `signData` of `text` has a wallet sign, before sha256. A raw key signs `sha256`
 * of this, so its envelope verifies exactly as a TonConnect wallet's would.
 */
export function tonSignDataMessage(p: {
  workchain: number;
  addressHash: Uint8Array;
  domain: string;
  timestamp: number;
  text: string;
}): Buffer {
  const domain = Buffer.from(p.domain, 'utf8');
  const payload = Buffer.from(p.text, 'utf8');
  const workchain = Buffer.alloc(4);
  workchain.writeInt32BE(p.workchain, 0);
  const domainLen = Buffer.alloc(4);
  domainLen.writeUInt32BE(domain.length, 0);
  const timestamp = Buffer.alloc(8);
  timestamp.writeBigUInt64BE(BigInt(p.timestamp), 0);
  const payloadLen = Buffer.alloc(4);
  payloadLen.writeUInt32BE(payload.length, 0);
  return Buffer.concat([
    Buffer.from([0xff, 0xff]),
    Buffer.from('ton-connect/sign-data/', 'ascii'),
    workchain,
    Buffer.from(p.addressHash),
    domainLen,
    domain,
    timestamp,
    Buffer.from('txt', 'ascii'),
    payloadLen,
    payload,
  ]);
}

/**
 * TON wallet provider. Two modes:
 *   - private key: an ed25519 seed signing locally, sending from the key's wallet-v4R2 address.
 *   - TonConnect: a browser wallet (e.g. Tonkeeper) signs and sends.
 *
 * The provider's wallet address is the account's 32-byte public key — the MPC relay's identity for a TON
 * user. {@link getAccountAddress} is the address it actually sends from.
 */
export class TonWalletProvider extends BaseWalletProvider<TonWalletDefaults> implements ITonWalletProvider {
  public readonly chainType = 'TON' as const;
  private readonly keyPair?: KeyPair;
  private readonly client?: TonClient;
  private readonly signDataDomain: string;
  private readonly tonConnect?: TonConnectLike;

  constructor(config: TonWalletConfig) {
    super(config.defaults);
    this.signDataDomain = DEFAULT_SIGN_DATA_DOMAIN;

    if (isPrivateKeyTonWalletConfig(config)) {
      const seed = config.privateKey.replace(/^0x/i, '');
      if (!/^[0-9a-fA-F]{64}$/.test(seed)) throw new Error('TON private key must be a 32-byte hex seed');
      this.keyPair = keyPairFromSeed(Buffer.from(seed, 'hex'));
      this.signDataDomain = config.signDataDomain ?? DEFAULT_SIGN_DATA_DOMAIN;
      this.client = new TonClient({
        endpoint: config.endpoint ?? this.defaults.rpcUrl ?? DEFAULT_RPC,
        ...(config.apiKey ? { apiKey: config.apiKey } : {}),
      });
      return;
    }
    if (isTonConnectTonWalletConfig(config)) {
      this.tonConnect = config.tonConnect;
      return;
    }
    throw new Error('Invalid TON wallet configuration');
  }

  /** The key's wallet-v4R2 contract, for the raw-key mode. */
  private wallet(): WalletContractV4 {
    if (!this.keyPair) throw new Error('[TonWalletProvider] no private key configured');
    return WalletContractV4.create({ workchain: 0, publicKey: this.keyPair.publicKey });
  }

  private connectedAccount(): { address: string; publicKey: string } {
    const account = this.tonConnect?.account;
    if (!account) throw new Error('[TonWalletProvider] no TON wallet connected');
    if (!account.publicKey) {
      throw new Error('[TonWalletProvider] the connected TON wallet did not expose its public key');
    }
    return { address: account.address, publicKey: account.publicKey };
  }

  /** The account's 32-byte ed25519 public key, lowercase `0x` hex. */
  public async getWalletAddress(): Promise<`0x${string}`> {
    const key = this.keyPair ? this.keyPair.publicKey.toString('hex') : this.connectedAccount().publicKey;
    return `0x${key.toLowerCase()}`;
  }

  /** The friendly address the wallet sends from. */
  public async getAccountAddress(): Promise<string> {
    if (this.keyPair) return this.wallet().address.toString({ bounceable: false });
    return Address.parseRaw(this.connectedAccount().address).toString({ bounceable: false });
  }

  public async sendTransaction(tx: TonUnsignedTransaction): Promise<void> {
    if (this.tonConnect) {
      await this.tonConnect.sendTransaction(tx);
      return;
    }
    if (!this.keyPair || !this.client) throw new Error('[TonWalletProvider] no private key configured');
    const contract = this.client.open(this.wallet());
    const seqno = await contract.getSeqno();
    await contract.sendTransfer({
      seqno,
      secretKey: this.keyPair.secretKey,
      sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
      messages: tx.messages.map(m => {
        const to = Address.parseFriendly(m.address);
        return internal({
          to: to.address,
          value: BigInt(m.amount),
          bounce: to.isBounceable,
          body: Cell.fromBoc(Buffer.from(m.payload, 'base64'))[0],
        });
      }),
    });
  }

  /**
   * `signData` the withdraw-auth hash as the scheme-5 text line. A TonConnect wallet signs it itself; a raw
   * key reproduces the TonConnect envelope — its wallet-v4R2 address, the configured domain, the current
   * time — and signs the same digest.
   */
  public async signMessage(hash: `0x${string}`): Promise<TonSignedMessage> {
    const text = withdrawSignText(hash);

    if (this.tonConnect) {
      const res = await this.tonConnect.signData({ type: 'text', text });
      const signer = Address.parseRaw(res.address);
      return {
        signature: `0x${Buffer.from(res.signature, 'base64').toString('hex')}`,
        workchain: signer.workChain,
        addressHash: `0x${Buffer.from(signer.hash).toString('hex')}`,
        domain: res.domain,
        timestamp: res.timestamp,
        payloadType: 'txt',
      };
    }

    if (!this.keyPair) throw new Error('[TonWalletProvider] no private key configured');
    const address = this.wallet().address;
    const timestamp = Math.floor(Date.now() / 1000);
    const digest = sha256(
      tonSignDataMessage({
        workchain: address.workChain,
        addressHash: address.hash,
        domain: this.signDataDomain,
        timestamp,
        text,
      }),
      'bytes',
    );
    return {
      signature: `0x${sign(Buffer.from(digest), this.keyPair.secretKey).toString('hex')}`,
      workchain: address.workChain,
      addressHash: `0x${Buffer.from(address.hash).toString('hex')}`,
      domain: this.signDataDomain,
      timestamp,
      payloadType: 'txt',
    };
  }
}
