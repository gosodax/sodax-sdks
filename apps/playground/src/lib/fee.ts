import { type Address, type PartnerFee, type PartnerFeePercentage, calculateFeeAmount } from '@sodax/dapp-kit';

/**
 * `PartnerFeePercentage.percentage` is basis points. The type documents 100 (1%) as the maximum,
 * so that is what the form accepts, even though the SDK's runtime invariant allows up to 10000.
 */
export const FEE_BPS_MAX = 100;

export type PartnerFeeInput = { address: string; bps: string };

export const NO_PARTNER_FEE: PartnerFeeInput = { address: '', bps: '' };

/** The form only offers the percentage form of `PartnerFee`, so the set state is narrowed to it. */
export type FeeState =
  | { kind: 'none' }
  | { kind: 'invalid'; message: string }
  | { kind: 'set'; fee: PartnerFeePercentage };

function isEvmAddress(value: string): value is Address {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

function parseBps(value: string): number | undefined {
  if (!/^\d+$/.test(value)) return undefined;
  const bps = Number(value);
  return bps <= FEE_BPS_MAX ? bps : undefined;
}

/**
 * Reads the fee form into what the SDK takes. A half-filled form is `invalid` rather than `none`:
 * a rate with no recipient has nowhere to pay, and quoting without the fee the swap will charge
 * produces a `minOutputAmount` the intent cannot deliver.
 */
export function readPartnerFee({ address, bps }: PartnerFeeInput): FeeState {
  const recipient = address.trim();
  const rate = bps.trim();
  if (!recipient && !rate) return { kind: 'none' };

  const percentage = parseBps(rate);
  if (percentage === undefined) {
    return { kind: 'invalid', message: `Fee must be a whole number of basis points, 0 to ${FEE_BPS_MAX}.` };
  }
  if (!isEvmAddress(recipient)) {
    return { kind: 'invalid', message: 'Fee recipient must be a Sonic address — nothing validates it for you.' };
  }
  if (percentage === 0) return { kind: 'none' };

  return { kind: 'set', fee: { address: recipient, percentage } };
}

/** The fee in input-token units. The SDK takes it off the input before the swap is quoted. */
export function feeAmountOf(inputAmount: bigint, fee: PartnerFee | undefined): bigint {
  return calculateFeeAmount(inputAmount, fee);
}
