import type { BtcAddressType } from '@sodax/types';
import { address as bitcoinjsAddress } from 'bitcoinjs-lib';

export type WalletMode = 'USER' | 'TRADING';

export interface BtcPayload {
  src_address: string;
  data: string;
  src_chain_id: number;
  dst_chain_id: number;
  wallet_used: WalletMode;
  timestamp: number;
  address_type: BtcAddressType;
}

const BITCOIN_FEE_SAFETY_VBYTES = 20;

/** Accounts for variable-length pushdata opcodes and script-length varints. */
export function calcOpReturnOutputVbytes(payloadByteLength: number): number {
  // script = OP_RETURN(1) + OP_12(1) + pushdata_overhead + payload
  let scriptSize: number;
  if (payloadByteLength <= 75) {
    scriptSize = 3 + payloadByteLength; // direct push opcode
  } else if (payloadByteLength <= 255) {
    scriptSize = 4 + payloadByteLength; // OP_PUSHDATA1 + 1-byte length
  } else {
    scriptSize = 5 + payloadByteLength; // OP_PUSHDATA2 + 2-byte length
  }
  const scriptLenVarint = scriptSize <= 252 ? 1 : 3;
  return 8 + scriptLenVarint + scriptSize;
}

/**
 * Per-input vB by `addressType`: P2PKH 148, P2SH-P2WPKH 91, P2WPKH 68 (default), P2TR 58. `opReturnOutputVbytes`
 * defaults to 44 (~33-byte payload); use calcOpReturnOutputVbytes() when the payload size is known.
 */
export function estimateBitcoinTxSize(
  inputCount: number,
  outputCount: number,
  addressType?: BtcAddressType,
  opReturnOutputVbytes = 44,
): number {
  // 10.5 vB fixed overhead + one OP_RETURN output (not in outputCount) + 31 vB per other output.
  let inputWeight: number;
  switch (addressType) {
    case 'P2PKH':
      inputWeight = 148;
      break;
    case 'P2SH':
      inputWeight = 91;
      break;
    case 'P2TR':
      inputWeight = 58;
      break;
    default:
      inputWeight = 68;
      break;
  }
  return Math.ceil(
    10.5 + opReturnOutputVbytes + BITCOIN_FEE_SAFETY_VBYTES + inputCount * inputWeight + outputCount * 31,
  );
}

export function encodeBtcPayloadToBytes(payload: BtcPayload): string {
  // Bech32 addresses (P2WPKH/P2TR) are case-insensitive with a lowercase canonical form;
  // Base58Check (P2PKH/P2SH) is case-sensitive, so lowercasing corrupts it.
  const isBase58Check = payload.address_type === 'P2PKH' || payload.address_type === 'P2SH';
  return JSON.stringify({
    src_address: isBase58Check ? payload.src_address : payload.src_address.toLowerCase(),
    data: payload.data.toLowerCase(),
    src_chain_id: payload.src_chain_id,
    dst_chain_id: payload.dst_chain_id,
    wallet_used: payload.wallet_used,
    timestamp: payload.timestamp,
    address_type: payload.address_type,
  });
}

/**
 * Testnet forms are accepted: the network is config-driven and this pure utility can't see it. Decodes via
 * fromBech32/fromBase58Check (payments.p2tr would need initEccLib); prefix checks keep other bech32 chains out.
 */
export function isValidBitcoinAddress(address: string): boolean {
  try {
    const { prefix, version, data } = bitcoinjsAddress.fromBech32(address);
    if (prefix !== 'bc' && prefix !== 'tb') return false;
    return (version === 0 && (data.length === 20 || data.length === 32)) || (version === 1 && data.length === 32);
  } catch {
    // not bech32: fall through to Base58Check
  }
  try {
    const { version } = bitcoinjsAddress.fromBase58Check(address);
    // 0/5 mainnet P2PKH/P2SH, 111/196 their testnet counterparts
    return version === 0 || version === 5 || version === 111 || version === 196;
  } catch {
    return false;
  }
}

/**
 * Canonical byte form of a validated Bitcoin address. bech32 is case-insensitive (BIP-173), so the
 * two cases of one address would otherwise encode to different bytes; Base58Check is case-sensitive.
 */
export function canonicalizeBitcoinAddress(address: string): string {
  try {
    bitcoinjsAddress.fromBech32(address);
    return address.toLowerCase();
  } catch {
    return address;
  }
}

/** Unisat/OKX return hex, Xverse base64; Bound Exchange expects base64. */
export function normalizePsbtToBase64(signedPsbt: string): string {
  const isHex = /^[0-9a-fA-F]+$/.test(signedPsbt);
  return isHex ? Buffer.from(signedPsbt, 'hex').toString('base64') : signedPsbt;
}

/** The intent relay requires base64; browser wallets return base64, a private-key wallet may return hex. */
export function normalizeSignatureToBase64(signature: string): string {
  const isHex = /^[0-9a-fA-F]+$/.test(signature);
  return isHex ? Buffer.from(signature, 'hex').toString('base64') : signature;
}
