/** Build parameters enforced by the Stellar sponsoring service. */
export interface StellarSponsorConfig {
  /** Rotatable sponsor public key; do not hardcode it in clients. */
  sponsorAccount: string;
  networkPassphrase: string;
  minTotalFeeStroops: string;
  maxTotalFeeStroops: string;
  operationCount: number;
  minPerOperationFeeStroops: string;
  maxPerOperationFeeStroops: string;
  /** Fee per operation to pass to `TransactionBuilder`. */
  recommendedPerOperationFeeStroops: string;
  /** Maximum distance from now to the transaction's `maxTime`, in seconds. */
  maxTimeboundSeconds: number;
  /** Required `createAccount.startingBalance`; do not hardcode it. */
  requiredStartingBalance: string;
}

/** Request body for a Stellar sponsored account creation. Extra fields are rejected. */
export interface StellarSponsoredAccountRequest {
  /** Base64 transaction XDR signed by the account being created; must not be a fee-bump envelope. */
  data: string;
}

/** An already-active account is also a success, but has no submitted transaction hash. */
export type StellarSponsoredAccountResponse =
  | {
      hash: string;
      alreadyActive: false;
    }
  | {
      hash: null;
      alreadyActive: true;
    };

export type SponsoringApiErrorCode =
  | 'INVALID_SPONSOR_XDR'
  | 'INVALID_RESERVE_DATA'
  | 'SPONSOR_SEQUENCE_CONFLICT'
  | 'SPONSOR_TRANSACTION_REJECTED'
  | 'HORIZON_UNAVAILABLE'
  | 'SPONSOR_RATE_LIMITED'
  | 'SPONSOR_BUDGET_EXHAUSTED';

/** Runtime values used to distinguish domain codes from framework error labels. */
export const SPONSORING_API_ERROR_CODES = [
  'INVALID_SPONSOR_XDR',
  'INVALID_RESERVE_DATA',
  'SPONSOR_SEQUENCE_CONFLICT',
  'SPONSOR_TRANSACTION_REJECTED',
  'HORIZON_UNAVAILABLE',
  'SPONSOR_RATE_LIMITED',
  'SPONSOR_BUDGET_EXHAUSTED',
] as const satisfies readonly SponsoringApiErrorCode[];

// Keep the runtime list exhaustive.
true satisfies [SponsoringApiErrorCode] extends [(typeof SPONSORING_API_ERROR_CODES)[number]] ? true : false;

/** `error` may be a domain code, a framework label, or absent; check it against {@link SPONSORING_API_ERROR_CODES}. */
export interface SponsoringApiErrorResponse {
  statusCode: number;
  /** Human-readable only; do not use for control flow. */
  message: string;
  error?: SponsoringApiErrorCode | string;
  /** Per-key rate-limit backoff in seconds. */
  retryAfterSeconds?: number;
  /** Sponsor sequence on a sequence conflict; advisory, as another submission can make it stale at once. */
  sponsorSequence?: string;
}

export interface IStellarSponsoringApi<GetConfigArgs extends unknown[] = [], CreateAccountArgs extends unknown[] = []> {
  /** GET /sponsorships/stellar/config */
  getStellarSponsorConfig(...extraArgs: GetConfigArgs): Promise<StellarSponsorConfig>;

  /** POST /sponsorships/stellar/accounts */
  createStellarSponsoredAccount(
    body: StellarSponsoredAccountRequest,
    ...extraArgs: CreateAccountArgs
  ): Promise<StellarSponsoredAccountResponse>;
}
