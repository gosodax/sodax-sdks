import { deriveKeypair, sign } from 'ripple-keypairs';
import { ECDSA, Wallet } from 'xrpl';
import type {
  IXrpWalletProvider,
  XrpRawTransactionReceipt,
  XrpSignedTransaction,
  XrpUnsignedTransaction,
} from '@sodax/types';
import { BaseWalletProvider } from '../BaseWalletProvider.js';
import type {
  GemWalletLike,
  GemWalletXrpWalletConfig,
  PrivateKeyXrpWalletConfig,
  XrpWalletConfig,
  XrpWalletDefaults,
} from './types.js';

const DEFAULT_RPC = 'https://xrplcluster.com';

export function isPrivateKeyXrpWalletConfig(config: XrpWalletConfig): config is PrivateKeyXrpWalletConfig {
  return 'privateKey' in config;
}

export function isGemWalletXrpWalletConfig(config: XrpWalletConfig): config is GemWalletXrpWalletConfig {
  return 'gemWallet' in config;
}

/**
 * A local wallet from an XRPL family seed (`sEd…`) or 16 bytes of seed entropy as hex. Anything else is
 * refused rather than read: `fromEntropy` keeps only the first 16 bytes, so a longer value would sign for
 * an account other than the one its owner expects. The secret never appears in an error.
 */
function walletFromSecret(secret: string): Wallet {
  let wallet: Wallet;
  if (secret.startsWith('s')) {
    let keypair: { publicKey: string; privateKey: string };
    try {
      // Not `Wallet.fromSeed`: it derives ed25519 whatever the seed encodes, i.e. another account.
      keypair = deriveKeypair(secret);
    } catch {
      // The decoder's own message quotes the offending character of the seed.
      throw new Error('XRPL privateKey is not a valid family seed');
    }
    wallet = new Wallet(keypair.publicKey, keypair.privateKey);
  } else {
    const hex = secret.replace(/^0x/i, '');
    if (!/^[0-9a-fA-F]{32}$/.test(hex)) {
      throw new Error(
        `XRPL privateKey must be a family seed (s…) or 16 bytes of seed entropy as hex, got ${hex.length} hex characters — a 32-byte value used to be read as its first 16 bytes, so pass those to keep the same account`,
      );
    }
    wallet = Wallet.fromEntropy(Buffer.from(hex, 'hex'), { algorithm: ECDSA.ed25519 });
  }
  // Scheme 3 verifies only ed25519, so a secp256k1 account could deposit and then never withdraw.
  if (!wallet.publicKey.toUpperCase().startsWith('ED')) {
    throw new Error('XRPL privateKey is a secp256k1 seed; withdrawals need an ed25519 (sEd…) account');
  }
  return wallet;
}

/**
 * XRPL wallet provider. Two modes:
 *   - GemWallet: wraps the injected API — the wallet holds the key and autofills transactions.
 *   - private key: signs locally via `xrpl`, for headless flows/tests.
 *
 * Implements {@link IXrpWalletProvider}: the sdk's `XrpSpokeService` builds the memo Payment and
 * the withdraw-auth message; the wallet only signs.
 *
 * Scheme 3 (withdraw auth) differs from Tron's scheme 1 in two ways that are easy to get wrong,
 * and both are handled here:
 *   - `signMessage` returns a RAW ed25519 signature over the 32-byte hash — no prefix, no envelope;
 *   - `getPublicKey` returns the 33-byte `0xED`-prefixed key, which must be submitted with the
 *     withdrawal because an ed25519 signature cannot recover its signer.
 */
export class XrpWalletProvider extends BaseWalletProvider<XrpWalletDefaults> implements IXrpWalletProvider {
  public readonly chainType = 'XRP' as const;
  private readonly rpcUrl: string;
  private readonly wallet?: Wallet;
  private readonly gemWallet?: GemWalletLike;
  private readonly browserAddress?: string;

  constructor(config: XrpWalletConfig) {
    super(config.defaults);
    this.rpcUrl = config.endpoint ?? this.defaults.rpcUrl ?? DEFAULT_RPC;

    if (isPrivateKeyXrpWalletConfig(config)) {
      this.wallet = walletFromSecret(config.privateKey);
      return;
    }
    if (isGemWalletXrpWalletConfig(config)) {
      this.gemWallet = config.gemWallet;
      this.browserAddress = config.address;
      return;
    }
    throw new Error('Invalid XRPL wallet configuration');
  }

  public async getWalletAddress(): Promise<string> {
    if (this.wallet) return this.wallet.classicAddress;
    if (this.browserAddress) return this.browserAddress;
    const res = await this.gemWallet?.getAddress();
    const address = res?.result?.address;
    if (!address) throw new Error('XRPL wallet not connected (no address)');
    return address;
  }

  /**
   * The 33-byte `0xED`-prefixed ed25519 public key, 0x-hex.
   *
   * Required by scheme 3: the contract derives `ripemd160(sha256(publicKey))` and compares it to
   * the withdrawal's `sender`, so a key from a different account fails as an identity mismatch
   * rather than a bad signature.
   */
  public async getPublicKey(): Promise<`0x${string}`> {
    const raw = this.wallet ? this.wallet.publicKey : (await this.gemWallet?.getPublicKey())?.result?.publicKey;
    if (!raw) throw new Error('XRPL wallet returned no public key');
    const hex = raw.replace(/^0x/, '').toUpperCase();
    if (!hex.startsWith('ED')) {
      // Fail loudly rather than submit a withdrawal the contract will reject: a secp256k1 account
      // has no supported scheme, so this account can deposit but can never withdraw.
      throw new Error(`XRPL account is not ed25519 (public key ${hex.slice(0, 4)}…) — scheme 3 requires ed25519`);
    }
    return `0x${hex.toLowerCase()}`;
  }

  /** Sign the 32-byte withdraw-auth hash as a raw ed25519 signature — the bytes signed are the hash. */
  public async signMessage(hash: `0x${string}`): Promise<`0x${string}`> {
    const hex = hash.replace(/^0x/, '').toUpperCase();
    if (this.wallet) {
      // `sign` over raw bytes; xrpl exposes the keypair's ed25519 signing directly.
      return `0x${sign(hex, this.wallet.privateKey).toLowerCase()}`;
    }
    // `isHex`: sign the 32 decoded bytes, not the 64-character string.
    const res = await this.gemWallet?.signMessage(hex, true);
    const sig = res?.result?.signedMessage;
    if (!sig) throw new Error('XRPL wallet returned no signature');
    return `0x${sig.replace(/^0x/, '').toLowerCase()}`;
  }

  /**
   * Sign an unsigned Payment.
   *
   * Sequence/Fee/LastLedgerSequence are deliberately absent from the transaction the sdk builds —
   * GemWallet autofills them and rejects a transaction that pins them, and the raw-key path
   * autofills from the node here rather than racing the wallet for the account's Sequence.
   */
  public async signTransaction(tx: XrpUnsignedTransaction): Promise<XrpSignedTransaction> {
    if (this.wallet) {
      const autofilled = await this.autofill(tx);
      const signed = this.wallet.sign(autofilled as never);
      return { tx_blob: signed.tx_blob, hash: signed.hash };
    }
    // GemWallet submits to whichever ledger it is set to; on another, a deposit pays a reserve the relay never watches.
    const network = (await this.gemWallet?.getNetwork?.())?.result;
    if (network && (network.chain !== 'XRPL' || network.network !== 'Mainnet')) {
      throw new Error(`GemWallet is set to ${network.chain} ${network.network} — switch it to the XRPL Mainnet`);
    }
    // GemWallet submits as well as signs, so there is no blob to hand back — the hash it returns
    // is the settled identifier the caller needs.
    const res = await this.gemWallet?.submitTransaction({ transaction: tx as Record<string, unknown> });
    const hash = res?.result?.hash;
    if (!hash) throw new Error('GemWallet returned no transaction hash');
    return { tx_blob: '', hash };
  }

  /** Fill Sequence/Fee/LastLedgerSequence from the node for the raw-key path. */
  private async autofill(tx: XrpUnsignedTransaction): Promise<XrpUnsignedTransaction> {
    const [info, ledger, fee] = await Promise.all([
      this.rpc<{ account_data?: { Sequence?: number } }>('account_info', {
        account: tx.Account,
        ledger_index: 'validated',
      }),
      this.rpc<{ ledger_current_index?: number }>('ledger_current', {}),
      this.rpc<{ drops?: { open_ledger_fee?: string } }>('fee', {}),
    ]);
    return {
      ...tx,
      Sequence: tx.Sequence ?? info.account_data?.Sequence,
      Fee: tx.Fee ?? fee.drops?.open_ledger_fee ?? '12',
      // A ledger window bounds how long a signed transaction stays submittable, so a stalled
      // submit expires instead of landing unexpectedly later.
      LastLedgerSequence: tx.LastLedgerSequence ?? (ledger.ledger_current_index ?? 0) + 20,
      SigningPubKey: this.wallet?.publicKey,
    };
  }

  public async waitForTransactionReceipt(txHash: string): Promise<XrpRawTransactionReceipt> {
    const value = txHash.replace(/^0x/, '').toUpperCase();
    for (let i = 0; i < 30; i++) {
      try {
        const tx = await this.rpc<XrpRawTransactionReceipt>('tx', { transaction: value, binary: false });
        // Only a VALIDATED ledger is final on XRPL; an unvalidated result can still change.
        if (tx.validated) return tx;
      } catch {
        // `txnNotFound` until the transaction is in a ledger — expected, keep polling.
      }
      await new Promise(r => setTimeout(r, 2000));
    }
    throw new Error(`xrpl tx ${txHash} not validated in time`);
  }

  private async rpc<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const res = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, params: [params] }),
    });
    if (!res.ok) throw new Error(`xrpl rpc ${method}: ${res.status}`);
    const body = (await res.json()) as { result?: T & { error?: string } };
    if (!body.result) throw new Error(`xrpl rpc ${method}: no result`);
    if (body.result.error) throw new Error(`xrpl rpc ${method}: ${body.result.error}`);
    return body.result;
  }
}
