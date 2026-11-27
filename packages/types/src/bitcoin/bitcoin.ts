import type { ICoreWallet } from '../wallet/wallet.js';
import type { XToken } from '../chains/tokens.js';

/** Dust limit in satoshis: nodes reject outputs below it, so native-BTC deposits and deliveries must clear it. */
export const BITCOIN_DUST_SATS = 546n;

/**
 * Matches 'btc', the `nativeToken` symbol or the BTC token address (e.g. '0:0'), case-insensitively. Use this,
 * not `isNativeToken`: Bitcoin's `nativeToken` is a symbol, not an on-chain address.
 */
export function isNativeBitcoinToken(
  chainConfig: { nativeToken: string; supportedTokens: Partial<Record<string, XToken>> },
  token: string,
): boolean {
  const nativeBtcTokens = new Set(
    ['btc', chainConfig.nativeToken, chainConfig.supportedTokens.BTC?.address]
      .filter((value): value is string => !!value)
      .map(value => value.toLowerCase()),
  );
  return nativeBtcTokens.has(token.toLowerCase());
}

export function isSupportedBitcoinAddressType(addressType: string): addressType is BtcAddressType {
  return (BTC_ADDRESS_TYPES as readonly string[]).includes(addressType);
}

export function detectBitcoinAddressType(address: string): BtcAddressType {
  if (address.startsWith('bc1p') || address.startsWith('tb1p')) return 'P2TR';
  if (address.startsWith('bc1') || address.startsWith('tb1')) return 'P2WPKH';
  if (address.startsWith('3') || address.startsWith('2')) return 'P2SH';
  if (address.startsWith('1') || address.startsWith('m') || address.startsWith('n')) return 'P2PKH';
  throw new Error(`Unknown Bitcoin address type: ${address}`);
}

/**
 * Signers and verifiers must branch on this: Taproot keys are x-only so ECDSA cannot sign for them, while
 * UniSat/OKX reject BIP-322 on P2SH/P2PKH, which therefore use ECDSA (BIP-137).
 */
export function usesBip322MessageSigning(addressType: BtcAddressType): boolean {
  return addressType === 'P2WPKH' || addressType === 'P2TR';
}

export const BTC_WALLET_ADDRESS_TYPES = ['taproot', 'segwit'] as const;
export type BtcWalletAddressType = (typeof BTC_WALLET_ADDRESS_TYPES)[number];

const BTC_ADDRESS_TYPES = ['P2PKH', 'P2SH', 'P2WPKH', 'P2TR'] as const;

export type BtcAddressType = (typeof BTC_ADDRESS_TYPES)[number];

export interface BitcoinTransactionStatus {
  confirmed: boolean;
  block_height?: number;
  block_hash?: string;
  block_time?: number;
}

export interface BitcoinTransactionInput {
  txid: string;
  vout: number;
  prevout?: {
    scriptpubkey: string;
    scriptpubkey_asm: string;
    scriptpubkey_type: string;
    scriptpubkey_address?: string;
    value: number;
  };
  scriptsig: string;
  scriptsig_asm: string;
  witness?: string[];
  is_coinbase: boolean;
  sequence: number;
  inner_redeemscript_asm?: string;
}

export interface BitcoinTransactionOutput {
  scriptpubkey: string;
  scriptpubkey_asm: string;
  scriptpubkey_type: string;
  scriptpubkey_address?: string;
  value: number;
}

export interface BitcoinRawTransactionReceipt {
  txid: string;
  version: number;
  locktime: number;
  vin: BitcoinTransactionInput[];
  vout: BitcoinTransactionOutput[];
  size: number;
  weight: number;
  fee?: number;
  status: BitcoinTransactionStatus;
}

export interface RadfiDepositTxResponse {
  base64Psbt: string;
  fee: BitcoinFee;
  userInputIndexes: number[];
  txId: string;
}

export interface BitcoinFee {
  feeRate: number;
  totalFee: number;
}

export type BitcoinRawTransaction = {
  from: string;
  to: string;
  value: bigint;
  data: string;
};

export type BitcoinReturnType<Raw extends boolean> = Raw extends true
  ? BitcoinRawTransaction | string
  : Raw extends false
    ? string
    : BitcoinRawTransaction | string;

export interface IBitcoinWalletProvider extends ICoreWallet {
  readonly chainType: 'BITCOIN';
  getWalletAddress(): Promise<string>;

  /** `psbt` is hex-encoded; resolves to the signed transaction hex. */
  signTransaction(psbt: string, finalize?: boolean): Promise<string>;

  signEcdsaMessage(message: string): Promise<string>;

  signBip322Message(message: string): Promise<string>;

  /** Hex. Needed only by money-market borrow/withdraw, where the relay verifies a non-recoverable BIP-322 signature;
   * callers guard before use. */
  getPublicKey?(): Promise<string>;

  /** Resolves to the transaction hash. */
  sendBitcoin(toAddress: string, satoshis: bigint): Promise<string>;
}

export interface UTXO {
  txid: string;
  vout: number;
  value: number;
  status: {
    confirmed: boolean;
    block_height?: number;
    block_hash?: string;
    block_time?: number;
  };
}
