import { invariant } from './tiny-invariant.js';
import {
  isBitcoinChainKeyType,
  isIconAddress,
  isPartnerFeeAmount,
  isPartnerFeePercentage,
  isValidInjectiveAddress,
  isValidNearAccountId,
} from '../guards.js';
import { canonicalizeBitcoinAddress, isValidBitcoinAddress } from '../entities/btc/btc-utils.js';
import type { ConfigService } from '../config/ConfigService.js';
import {
  type SpokeChainKey,
  type Hex,
  type XToken,
  getChainType,
  isNativeBitcoinToken,
  DEFAULT_MAX_RETRY,
  DEFAULT_RETRY_DELAY_MS,
  FEE_PERCENTAGE_SCALE,
  type PartnerFee,
  type QuoteType,
  isMpcRelayChainKey,
} from '@sodax/types';
import { hexToBytes, isAddress, toHex } from 'viem';
import { tronHashToBase58, tronIdentityBytes } from '../services/spoke/tron-utils.js';
import { bcs } from '@mysten/sui/bcs';
import { PublicKey } from '@solana/web3.js';
import { Address as StellarAddress, xdr } from '@stellar/stellar-sdk';
import { Cl, cvToString, deserializeCV, serializeCV } from '@sodax/libs/stacks/core';

/**
 * True when `(chainKey, token)` denotes native BTC on the Bitcoin chain — the only transfer whose amount is
 * denominated in satoshis and therefore subject to `BITCOIN_DUST_SATS`. BTC-family tokens are 8-decimal,
 * so a base-unit amount equals its satoshi value on both the deposit (source) and delivery (destination) side.
 */
export function isNativeBitcoinTransfer(
  config: ConfigService,
  chainKey: SpokeChainKey,
  token: XToken | undefined,
): boolean {
  return (
    isBitcoinChainKeyType(chainKey) && !!token && isNativeBitcoinToken(config.getChainConfig(chainKey), token.address)
  );
}

export async function retry<T>(
  action: (retryCount: number) => Promise<T>,
  retryCount: number = DEFAULT_MAX_RETRY,
  delayMs = DEFAULT_RETRY_DELAY_MS,
): Promise<T> {
  do {
    try {
      return await action(retryCount);
    } catch (e) {
      retryCount--;

      if (retryCount <= 0) {
        console.error(`Failed to perform operation even after ${DEFAULT_MAX_RETRY} attempts.. Throwing origin error..`);
        throw e;
      }
    }

    await new Promise(resolve => setTimeout(resolve, delayMs));
  } while (retryCount > 0);

  throw new Error(`Retry exceeded MAX_RETRY_DEFAULT=${DEFAULT_MAX_RETRY}`);
}

export function getRandomBytes(length: number): Uint8Array {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('Web Crypto (crypto.getRandomValues) is unavailable in this runtime');
  }
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

export function randomUint256(): bigint {
  const bytes = getRandomBytes(32); // 256 bits
  let hex = '';

  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0') ?? '';
  }

  return BigInt(`0x${hex}`);
}

/**
 * Calculate the fee amount as a percentage of the input amount
 * @param {bigint} amount - The amount to calculate the fee for
 * @param {number} percentage - The percentage of the fee in basis points (e.g. 100 = 1%, 10000 = 100%)
 * @returns {bigint} The fee amount
 */
export function calculatePercentageFeeAmount(amount: bigint, percentage: number) {
  // Calculate fee as a percentage of the input amount
  return (amount * BigInt(percentage)) / FEE_PERCENTAGE_SCALE;
}

/**
 * Calculate the fee amount for a given input amount and fee
 * @param {bigint} inputAmount - The amount of input tokens
 * @param {PartnerFee} fee - The fee to calculate
 * @returns {bigint} The fee amount
 */
export function calculateFeeAmount(inputAmount: bigint, fee: PartnerFee | undefined): bigint {
  if (!fee) {
    return 0n;
  }

  invariant(inputAmount > 0n, 'Input amount must be greater than 0');

  let feeAmount = 0n;

  if (isPartnerFeeAmount(fee)) {
    invariant(
      fee.amount >= 0 && fee.amount <= inputAmount,
      `Fee amount must be greater than 0 and less than or equal to the input amount: ${fee.amount}`,
    );
    feeAmount = fee.amount;
  } else if (isPartnerFeePercentage(fee)) {
    invariant(
      fee.percentage >= 0 && fee.percentage <= FEE_PERCENTAGE_SCALE,
      `Fee percentage must be between 0 and ${FEE_PERCENTAGE_SCALE}}`,
    );

    feeAmount = calculatePercentageFeeAmount(inputAmount, fee.percentage);
  }

  return feeAmount;
}

/**
 * Adjust the amount by the fee amount based on the quote type
 * @param {bigint} amount - The amount to adjust
 * @param {PartnerFee | undefined} fee - The fee to adjust
 * @param {QuoteType} quoteType - The quote type
 * @returns {bigint} The adjusted amount
 */
export function adjustAmountByFee(amount: bigint, fee: PartnerFee | undefined, quoteType: QuoteType): bigint {
  invariant(amount > 0n, 'Amount must be greater than 0');
  invariant(quoteType === 'exact_input', 'Invalid quote type');

  if (quoteType === 'exact_input') {
    return amount - calculateFeeAmount(amount, fee);
  }

  throw new Error('Invalid quote type');
}

export function BigIntToHex(value: bigint): Hex {
  return `0x${value.toString(16)}`;
}

/**
 * Recipient bytes for a hub release — the `to` an `AssetManager.transfer` pays out to.
 *
 * This is NOT {@link encodeAddress}, which produces the withdrawal-auth identity / hub-wallet salt.
 * For an MPC-relay chain the release contract reads `data[0..32]` as `12 zero bytes ‖ 20-byte hash`,
 * so the 20-byte identity has to be left-padded into a full word; passing the bare identity
 * mis-decodes the recipient. Intent-relay chains keep their own encoding unchanged.
 */
export function encodeRecipient(spokeChainId: SpokeChainKey, address: string): Hex {
  const encoded = encodeAddress(spokeChainId, address);
  if (!isMpcRelayChainKey(spokeChainId)) return encoded;
  const hash = encoded.replace(/^0x/, '');
  if (hash.length !== 40) {
    throw new Error(`[encodeRecipient] expected a 20-byte identity for ${spokeChainId}, got ${hash.length / 2} bytes`);
  }
  return `0x${'00'.repeat(12)}${hash}`;
}

export function encodeAddress(spokeChainId: SpokeChainKey, address: string): Hex {
  const chainType = getChainType(spokeChainId);
  switch (chainType) {
    case 'EVM':
      // Strict: a wrong-length recipient ABI-encodes cleanly, the hub burns the tokens, and the
      // spoke reverts with no refund path — EIP-55 is what catches a mistyped one. Lowercase passes.
      invariant(isAddress(address), `Invalid EVM address: ${address}`);
      return address as Hex;
    case 'ICON': {
      // Validate type + length before decoding: `Buffer.from(str, 'hex')` silently stops at the
      // first non-hex char, and an unanchored `.replace()` would rewrite any `hx`/`cx` inside the
      // body — either lets a malformed ICON destination slip into an intent. Anchor the prefix to
      // the leading two chars and map it to the version byte (`hx` -> 00, `cx` -> 01).
      invariant(isIconAddress(address), `Invalid ICON address: ${address}`);
      const version = address.slice(0, 2) === 'cx' ? '01' : '00';
      return toHex(Buffer.from(`${version}${address.slice(2)}`, 'hex'));
    }
    case 'SUI':
      return toHex(bcs.Address.serialize(address).toBytes());
    case 'SOLANA':
      return toHex(Buffer.from(new PublicKey(address).toBytes()));
    case 'STELLAR':
      return `0x${StellarAddress.fromString(address).toScVal().toXDR('hex')}`;
    case 'STACKS':
      return `0x${serializeCV(Cl.principal(address))}`;
    case 'BITCOIN':
      invariant(isValidBitcoinAddress(address), `Invalid Bitcoin address: ${address}`);
      return toHex(Buffer.from(canonicalizeBitcoinAddress(address), 'utf-8'));
    case 'NEAR':
      invariant(isValidNearAccountId(address), `Invalid NEAR account id: ${address}`);
      return toHex(Buffer.from(address, 'utf-8'));
    case 'INJECTIVE':
      invariant(isValidInjectiveAddress(address), `Invalid Injective address: ${address}`);
      return toHex(Buffer.from(address, 'utf-8'));
    case 'TRON':
      // Tron's hub-wallet identity is the 20-byte address hash: base58 payload without the 0x41 byte.
      return tronIdentityBytes(address);
    default: {
      const exhaustiveCheck: never = chainType;
      throw new Error(`Invalid spoke chain id: ${exhaustiveCheck}`);
    }
  }
}

/**
 * Encode a chain-native TOKEN IDENTIFIER for hub-side encoding. On BITCOIN/NEAR/INJECTIVE these are
 * not addresses ('0:0', '897442:43', 'inj', 'factory/…', 'NEAR') — utf-8 identifier semantics, so
 * they must not hit {@link encodeAddress}'s recipient validators. Every other family's token IS an
 * address and keeps the validated path.
 */
export function encodeTokenIdentifier(spokeChainId: SpokeChainKey, token: string): Hex {
  switch (getChainType(spokeChainId)) {
    case 'BITCOIN':
    case 'NEAR':
    case 'INJECTIVE':
      return toHex(Buffer.from(token, 'utf-8'));
    default:
      return encodeAddress(spokeChainId, token);
  }
}

/**
 * Decode a hub-style hex address produced by {@link encodeAddress} back to the chain-native string form.
 */
export function reverseEncodeAddress(spokeChainId: SpokeChainKey, encoded: Hex): string {
  const chainType = getChainType(spokeChainId);
  switch (chainType) {
    case 'EVM':
      return encoded;
    case 'ICON': {
      const raw = encoded.startsWith('0x') ? encoded.slice(2) : encoded;
      if (raw.length !== 42) {
        throw new Error(
          `Invalid ICON encoded address length: expected 21 bytes (42 hex chars), got ${raw.length / 2} bytes`,
        );
      }
      const version = raw.slice(0, 2);
      const body = raw.slice(2);
      if (version === '00') {
        return `hx${body}`;
      }
      if (version === '01') {
        return `cx${body}`;
      }
      throw new Error(`Invalid ICON address version byte: 0x${version}`);
    }
    case 'SUI':
      return bcs.Address.parse(hexToBytes(encoded));
    case 'SOLANA':
      return new PublicKey(hexToBytes(encoded)).toBase58();
    case 'STELLAR': {
      const rawHex = encoded.startsWith('0x') ? encoded.slice(2) : encoded;
      const scVal = xdr.ScVal.fromXDR(rawHex, 'hex');
      return StellarAddress.fromScVal(scVal).toString();
    }
    case 'STACKS': {
      const rawHex = encoded.startsWith('0x') ? encoded.slice(2) : encoded;
      const cv = deserializeCV(hexToBytes(`0x${rawHex}`));
      return cvToString(cv);
    }
    case 'BITCOIN':
    case 'NEAR':
    case 'INJECTIVE':
      return Buffer.from(hexToBytes(encoded)).toString('utf8');
    case 'TRON':
      // Inverse of the identity encoding: 20-byte hash → base58check Tron address.
      return tronHashToBase58(encoded);
    default: {
      const exhaustiveCheck: never = chainType;
      throw new Error(`Invalid spoke chain id: ${exhaustiveCheck}`);
    }
  }
}

/**
 * Convert a valid hexadecimal string (with or without "0x") to BigInt.
 * Throws on invalid hex.
 */
export function hexToBigInt(hex: string): bigint {
  const trimmed = hex.trim().toLowerCase();

  // Validate hex: only digits 0-9 and letters a-f, optional 0x prefix
  const isValid = /^(0x)?[0-9a-f]+$/.test(trimmed);
  if (!isValid) {
    throw new Error(`Invalid hex string: "${hex}"`);
  }

  // Normalize with 0x prefix to make BigInt parse it as hexadecimal
  const normalized = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
  return BigInt(normalized);
}

export function parseToStroops(amount: string): bigint {
  // Scale decimal string to integer stroops (1e7 multiplier)
  return BigInt(Math.round(Number.parseFloat(amount) * 1e7));
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
