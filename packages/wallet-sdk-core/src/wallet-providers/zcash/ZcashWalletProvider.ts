import * as ecc from '@bitcoinerlab/secp256k1';
import { bytesToHex, concatBytes, hexToBytes, ripemd160, sha256, stringToBytes } from 'viem';
import { sign } from 'viem/accounts';
import type { IZcashWalletProvider, ZcashTransferParams, ZcashUnsignedTransaction } from '@sodax/types';
import { BaseWalletProvider } from '../BaseWalletProvider.js';
import type {
  BrowserExtensionZcashWalletConfig,
  PrivateKeyZcashWalletConfig,
  ZcashWalletConfig,
  ZcashWalletDefaults,
  ZcashWalletLike,
} from './types.js';
import { SIGHASH_ALL, serializeZcashV5, zip244SignatureDigest } from './zip244.js';

const MAINNET_P2PKH_PREFIX = new Uint8Array([0x1c, 0xb8]);
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function isPrivateKeyZcashWalletConfig(config: ZcashWalletConfig): config is PrivateKeyZcashWalletConfig {
  return 'privateKey' in config;
}

export function isBrowserExtensionZcashWalletConfig(
  config: ZcashWalletConfig,
): config is BrowserExtensionZcashWalletConfig {
  return 'wallet' in config;
}

const sha256d = (bytes: Uint8Array): Uint8Array => sha256(sha256(bytes, 'bytes'), 'bytes');

function base58CheckEncode(body: Uint8Array): string {
  const full = concatBytes([body, sha256d(body).subarray(0, 4)]);
  let n = BigInt(bytesToHex(full));
  let out = '';
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const byte of full) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out;
}

/**
 * The digest `zcash-cli signmessage` signs for scheme 6: `sha256d(len ‖ "Zcash Signed Message:\n" ‖ len ‖
 * "0x<hash>")`. It signs the 66-character hex TEXT of the hash, not its 32 bytes — signing the bytes recovers
 * a valid but wrong key and the contract rejects the withdrawal.
 */
export function zcashSignedMessageDigest(hash: `0x${string}`): Uint8Array {
  const magic = stringToBytes('Zcash Signed Message:\n');
  const message = stringToBytes(`0x${hash.slice(2).toLowerCase()}`);
  return sha256d(concatBytes([new Uint8Array([magic.length]), magic, new Uint8Array([message.length]), message]));
}

/** A strict DER encoding of a 64-byte compact signature. */
function toDer(compact: Uint8Array): Uint8Array {
  const integer = (bytes: Uint8Array): Uint8Array => {
    let i = 0;
    while (i < bytes.length - 1 && bytes[i] === 0) i++;
    const trimmed = bytes.subarray(i);
    return (trimmed[0] ?? 0) & 0x80 ? concatBytes([new Uint8Array([0]), trimmed]) : trimmed;
  };
  const r = integer(compact.subarray(0, 32));
  const s = integer(compact.subarray(32, 64));
  return concatBytes([
    new Uint8Array([0x30, 4 + r.length + s.length, 0x02, r.length]),
    r,
    new Uint8Array([0x02, s.length]),
    s,
  ]);
}

/** A script push of `data` (up to 75 bytes — a signature or a compressed key). */
const push = (data: Uint8Array): Uint8Array => concatBytes([new Uint8Array([data.length]), data]);

/**
 * Zcash transparent wallet provider. Two modes:
 *   - private key: a secp256k1 key signing locally — ZIP-244 per input for transactions, `signmessage` for
 *     scheme-6 withdraw authorizations.
 *   - browser extension: a wallet sends payments and signs messages, through {@link ZcashWalletLike}.
 */
export class ZcashWalletProvider extends BaseWalletProvider<ZcashWalletDefaults> implements IZcashWalletProvider {
  public readonly chainType = 'ZCASH' as const;
  private readonly privateKey?: `0x${string}`;
  private readonly publicKey?: Uint8Array;
  private readonly wallet?: ZcashWalletLike;

  constructor(config: ZcashWalletConfig) {
    super(config.defaults);

    if (isPrivateKeyZcashWalletConfig(config)) {
      const key = config.privateKey.replace(/^0x/i, '');
      if (!/^[0-9a-fA-F]{64}$/.test(key)) throw new Error('Zcash private key must be 32 bytes of hex');
      const publicKey = ecc.pointFromScalar(hexToBytes(`0x${key}`), true);
      if (!publicKey) throw new Error('Zcash private key is not a valid secp256k1 scalar');
      this.privateKey = `0x${key.toLowerCase()}`;
      this.publicKey = publicKey;
      return;
    }
    if (isBrowserExtensionZcashWalletConfig(config)) {
      this.wallet = config.wallet;
      return;
    }
    throw new Error('Invalid Zcash wallet configuration');
  }

  /** The transparent `t1…` address: base58check of the mainnet prefix and hash160(compressed pubkey). */
  public async getWalletAddress(): Promise<string> {
    if (this.wallet) return this.wallet.getAddress();
    if (!this.publicKey) throw new Error('[ZcashWalletProvider] no private key configured');
    const hash160 = ripemd160(sha256(this.publicKey, 'bytes'), 'bytes');
    return base58CheckEncode(concatBytes([MAINNET_P2PKH_PREFIX, hash160]));
  }

  /**
   * Browser-wallet mode: the wallet builds, signs and broadcasts the payment. A raw key signs transactions the
   * sdk builds instead, so this is only available with a wallet.
   */
  public get sendTransfer(): ((params: ZcashTransferParams) => Promise<string>) | undefined {
    const wallet = this.wallet;
    return wallet ? params => wallet.sendTransfer(params) : undefined;
  }

  /** Raw-key mode: sign every input of a transaction the sdk built. Undefined with a browser wallet. */
  public get signTransaction(): ((tx: ZcashUnsignedTransaction) => Promise<string>) | undefined {
    return this.wallet ? undefined : tx => this.signWithKey(tx);
  }

  private async signWithKey(tx: ZcashUnsignedTransaction): Promise<string> {
    if (!this.privateKey || !this.publicKey) throw new Error('[ZcashWalletProvider] no private key configured');

    const key = hexToBytes(this.privateKey);
    const publicKey = this.publicKey;
    const inputs = tx.inputs.map((input, index) => {
      const signature = ecc.sign(zip244SignatureDigest(tx, index), key);
      const der = concatBytes([toDer(signature), new Uint8Array([SIGHASH_ALL])]);
      return { ...input, scriptSig: bytesToHex(concatBytes([push(der), push(publicKey)])).slice(2) };
    });
    return bytesToHex(serializeZcashV5({ ...tx, inputs })).slice(2);
  }

  /**
   * Scheme 6: `signmessage` over the hex text of `hash`, as a 65-byte compact signature `header ‖ r ‖ s` with
   * `header = 31 + recid` — 27 plus 4 marking a compressed key, which a transparent address always hashes.
   */
  public async signMessage(hash: `0x${string}`): Promise<`0x${string}`> {
    if (this.wallet) return this.wallet.signMessage(`0x${hash.slice(2).toLowerCase()}`);
    if (!this.privateKey) throw new Error('[ZcashWalletProvider] no private key configured');
    const digest = zcashSignedMessageDigest(hash);
    const signature = await sign({ hash: bytesToHex(digest), privateKey: this.privateKey });
    const header = 31 + Number(signature.yParity);
    return `0x${header.toString(16)}${signature.r.slice(2).padStart(64, '0')}${signature.s.slice(2).padStart(64, '0')}`;
  }
}
