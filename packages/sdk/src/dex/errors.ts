import {
  APPROVE_CODES,
  type ApproveErrorCode,
  CREATE_INTENT_CODES,
  type CreateIntentErrorCode,
  LOOKUP_CODES,
  type LookupErrorCode,
} from '../errors/codes.js';
import { isCodeMember } from '../errors/guards.js';
import { createInvariant, type FeatureInvariant } from '../errors/invariant.js';
import type { SodaxError } from '../errors/SodaxError.js';

export const dexInvariant: FeatureInvariant = createInvariant('dex');

export type DexErrorCode = LookupErrorCode;
export type DexError = SodaxError<DexErrorCode>;

export const isDexError = isCodeMember<DexErrorCode>(LOOKUP_CODES);

export type DexCreateIntentErrorCode = CreateIntentErrorCode;
export type DexCreateIntentError = SodaxError<DexCreateIntentErrorCode>;
export const isDexCreateIntentError = isCodeMember<DexCreateIntentErrorCode>(CREATE_INTENT_CODES);

export type DexApproveErrorCode = ApproveErrorCode;
export type DexApproveError = SodaxError<DexApproveErrorCode>;
export const isDexApproveError = isCodeMember<DexApproveErrorCode>(APPROVE_CODES);
