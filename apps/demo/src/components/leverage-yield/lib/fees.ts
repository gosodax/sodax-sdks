import type { PartnerFee } from '@sodax/dapp-kit';

/**
 * Per-intent partner fee on SDK vault DEPOSITS (10 bps = 0.1%). Passed to both the quote and the deposit builder,
 * so the SDK deducts the same fee from both; withdraws use the configured fee (`leverageYield.partnerFee ?? fee`).
 */
export const DEPOSIT_PARTNER_FEE = {
  address: '0x93D5CE288b3BF6b33F913b98FD1fA844Acc462d4',
  percentage: 10,
} as const satisfies PartnerFee;
