// Keep these invariants aligned with the sponsoring backend's domain validator.

import {
  Account,
  FeeBumpTransaction,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  type Transaction,
} from '@stellar/stellar-sdk';
import type { StellarSponsorConfig } from '@sodax/types';
import { messageOf } from '../../errors/wrappers.js';
import { sponsoringInvariant } from '../errors.js';

/** Required begin/create/end operation count. */
export const SPONSORED_CREATE_OP_COUNT = 3n;

/** Transaction validity window in seconds. */
export const SPONSOR_TIMEBOUND_SECONDS = 300;

function parseStroops(value: string, field: string): bigint {
  try {
    return BigInt(value);
  } catch {
    sponsoringInvariant(false, `sponsor config ${field} is not a valid integer: "${value}"`, { field });
  }
}

type SponsorFeeConfig = Pick<
  StellarSponsorConfig,
  | 'minTotalFeeStroops'
  | 'maxTotalFeeStroops'
  | 'operationCount'
  | 'minPerOperationFeeStroops'
  | 'maxPerOperationFeeStroops'
  | 'recommendedPerOperationFeeStroops'
>;

/**
 * Use the server's per-operation fee verbatim, then verify both published bands: a fee can fit the
 * total band yet violate the per-operation one, and the server validates both.
 */
export function deriveSponsorBaseFee(config: SponsorFeeConfig): { baseFee: string; totalFee: bigint } {
  const min = parseStroops(config.minTotalFeeStroops, 'minTotalFeeStroops');
  const max = parseStroops(config.maxTotalFeeStroops, 'maxTotalFeeStroops');
  sponsoringInvariant(min > 0n, `sponsor config minTotalFeeStroops must be positive, got ${min}`, {
    field: 'minTotalFeeStroops',
  });
  sponsoringInvariant(max >= min, `sponsor config fee band is inverted (min ${min} > max ${max})`, {
    field: 'maxTotalFeeStroops',
  });

  const minPerOp = parseStroops(config.minPerOperationFeeStroops, 'minPerOperationFeeStroops');
  const maxPerOp = parseStroops(config.maxPerOperationFeeStroops, 'maxPerOperationFeeStroops');
  sponsoringInvariant(minPerOp > 0n, `sponsor config minPerOperationFeeStroops must be positive, got ${minPerOp}`, {
    field: 'minPerOperationFeeStroops',
  });
  sponsoringInvariant(
    maxPerOp >= minPerOp,
    `sponsor config per-operation fee band is inverted (min ${minPerOp} > max ${maxPerOp})`,
    { field: 'maxPerOperationFeeStroops' },
  );

  // Check integer-ness before converting to BigInt.
  sponsoringInvariant(
    Number.isInteger(config.operationCount) && BigInt(config.operationCount) === SPONSORED_CREATE_OP_COUNT,
    `sponsor config expects ${config.operationCount} operations but this builder emits ${SPONSORED_CREATE_OP_COUNT} — the sponsored-create shape has changed server-side`,
    { field: 'operationCount' },
  );

  const baseFee = parseStroops(config.recommendedPerOperationFeeStroops, 'recommendedPerOperationFeeStroops');
  const totalFee = baseFee * SPONSORED_CREATE_OP_COUNT;

  // An out-of-band fee means the published config is inconsistent.
  sponsoringInvariant(
    baseFee >= minPerOp && baseFee <= maxPerOp,
    `per-operation fee ${baseFee} is outside the accepted per-operation band [${minPerOp}, ${maxPerOp}]`,
    { field: 'recommendedPerOperationFeeStroops' },
  );
  sponsoringInvariant(
    totalFee >= min && totalFee <= max,
    `per-operation fee ${baseFee} yields a total of ${totalFee} stroops, outside the accepted band [${min}, ${max}]`,
    { field: 'recommendedPerOperationFeeStroops' },
  );

  return { baseFee: baseFee.toString(), totalFee };
}

/** Clamp to the server's limit; zero would mean an unbounded timeout, which the service rejects. */
export function resolveTimeboundSeconds(config: Pick<StellarSponsorConfig, 'maxTimeboundSeconds'>): number {
  const ceiling = Math.floor(config.maxTimeboundSeconds);
  const seconds = Math.min(SPONSOR_TIMEBOUND_SECONDS, ceiling);
  sponsoringInvariant(
    Number.isFinite(seconds) && seconds > 0,
    `sponsor config maxTimeboundSeconds leaves no usable window, got ${config.maxTimeboundSeconds}`,
    { field: 'maxTimeboundSeconds' },
  );
  return seconds;
}

export type BuildSponsoredCreateParams = {
  config: StellarSponsorConfig;
  /** Current sponsor sequence; `TransactionBuilder` increments it. */
  sponsorSequence: string;
  address: string;
};

/**
 * Config checks that need no sponsor sequence, run before the Horizon read so a malformed `sponsorAccount`
 * fails locally rather than as a 404. Pure, so {@link buildSponsoredCreate} repeats them.
 */
export function assertSponsoredCreateInputs(params: { config: StellarSponsorConfig; address: string }): void {
  const { config, address } = params;

  // Fail before prompting if a deployment publishes the wrong network.
  sponsoringInvariant(
    config.networkPassphrase === Networks.PUBLIC,
    `sponsored create must target the Stellar public network, got "${config.networkPassphrase}"`,
    { field: 'networkPassphrase' },
  );
  assertValidStellarAccountId(address);
  assertValidStellarAccountId(config.sponsorAccount);
  deriveSponsorBaseFee(config);
  resolveTimeboundSeconds(config);
}

/**
 * The new account is the explicit source of `end`, so it must sign before server submission.
 * Uses a fresh `Account` because `TransactionBuilder.build()` mutates its sequence number.
 */
export function buildSponsoredCreate(params: BuildSponsoredCreateParams): Transaction {
  const { config, sponsorSequence, address } = params;

  assertSponsoredCreateInputs({ config, address });

  const { baseFee } = deriveSponsorBaseFee(config);
  const timeboundSeconds = resolveTimeboundSeconds(config);

  return new TransactionBuilder(new Account(config.sponsorAccount, sponsorSequence), {
    fee: baseFee,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(Operation.beginSponsoringFutureReserves({ sponsoredId: address }))
    .addOperation(Operation.createAccount({ destination: address, startingBalance: config.requiredStartingBalance }))
    .addOperation(Operation.endSponsoringFutureReserves({ source: address }))
    .setTimeout(timeboundSeconds)
    .build();
}

/** Reject a malformed / contract (`C…`) / muxed (`M…`) account id locally instead of as a remote 400. */
export function assertValidStellarAccountId(address: string): void {
  let valid = true;
  try {
    Keypair.fromPublicKey(address);
  } catch {
    valid = false;
  }
  sponsoringInvariant(valid, `"${address}" is not a valid Stellar ed25519 public key`, { field: 'address' });
}

/** Verify the wallet kept the envelope and signed as the account, catching wrong-network signatures locally. */
export function assertSignedByAccount(params: { signedXdr: string; address: string; unsignedHash: Buffer }): void {
  const { signedXdr, address, unsignedHash } = params;

  let parsed: Transaction | FeeBumpTransaction;
  try {
    // Parse under the required network so wrong-network signatures fail verification.
    parsed = TransactionBuilder.fromXDR(signedXdr, Networks.PUBLIC);
  } catch (error) {
    sponsoringInvariant(false, `wallet returned an unparseable transaction: ${messageOf(error, String(error))}`, {
      field: 'signature',
    });
  }

  sponsoringInvariant(
    !(parsed instanceof FeeBumpTransaction),
    'wallet returned a fee-bump envelope; the sponsoring API rejects fee-bump transactions',
    { field: 'signature' },
  );

  const hash = parsed.hash();
  sponsoringInvariant(
    hash.equals(unsignedHash),
    'wallet altered the transaction before signing it (fee, memo, or time bounds changed)',
    { field: 'signature' },
  );

  const keypair = Keypair.fromPublicKey(address);
  const signedByAccount = parsed.signatures.some(signature => {
    try {
      return keypair.verify(hash, signature.signature());
    } catch {
      return false;
    }
  });

  sponsoringInvariant(
    signedByAccount,
    'signed transaction is not signed by the account being activated — the wallet may be connected ' +
      'to a different Stellar network, or may have signed with a different account',
    { field: 'signature' },
  );
}
