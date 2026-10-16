import type { ChainKey, IntentResponseV2, SubmitTxRequestV2 } from '@sodax/dapp-kit';
import type { PairDimensions } from './analytics';
import { isChainKey } from './chains';
import { toIntentRequest } from './execution';

/**
 * v2 adds what the dialog is rebuilt from; a v1 record has none of it and cannot restore one.
 *
 * A v1 record is left in storage rather than removed: it still carries the hash, intent and relay
 * payload `submissionFor` needs, so deleting it would destroy the only recoverable trace of a swap
 * this version cannot display. Nothing reads it today — a deployment that reached real users on v1
 * needs a migration or a legacy recovery view before that becomes acceptable.
 */
export const ACTIVITY_KEY = 'sodax-widget-activity-v2';

export type Activity = {
  txHash: string;
  srcChainKey: ChainKey;
  dstChainKey: ChainKey;
  /** Spoke-side, as reviewed: `intent`'s own token fields are hub assets and name nothing on a spoke. */
  srcTokenAddress: string;
  dstTokenAddress: string;
  /** The gross the visitor confirmed. `intent.inputAmount` is net of the partner fee and restates it lower. */
  inputAmount: string;
  walletAddress: string;
  recipient: string;
  summary: string;
  createdAt: number;
  intent: IntentResponseV2;
  relayData: string;
  pair?: PairDimensions;
  /** The relay has the deposit. Absent means it still needs submitting — the one state a reload must
      not lose, because the deposit is already broadcast and only resubmission can move it. */
  relaySubmitted?: boolean;
  settlementReported?: boolean;
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Every family spells an address its own way, so only presence and a length bound are checkable. */
function isAddressText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200;
}

/** A smallest-unit amount, as the intent carries one: decimal digits and nothing else. */
function isAmountText(value: unknown): value is string {
  return typeof value === 'string' && /^\d{1,78}$/.test(value);
}

function isIntent(value: unknown): value is IntentResponseV2 {
  if (!record(value)) return false;
  const numbers = ['intentId', 'inputAmount', 'minOutputAmount', 'deadline', 'srcChain', 'dstChain'];
  const strings = ['creator', 'inputToken', 'outputToken', 'srcAddress', 'dstAddress', 'solver', 'data'];
  return (
    numbers.every(key => typeof value[key] === 'string' && /^\d{1,78}$/.test(value[key])) &&
    strings.every(key => typeof value[key] === 'string' && value[key].length < 10000) &&
    typeof value.allowPartialFill === 'boolean'
  );
}

function readPair(value: unknown): PairDimensions | undefined {
  if (
    !record(value) ||
    typeof value.source_chain !== 'string' ||
    !isChainKey(value.source_chain) ||
    typeof value.destination_chain !== 'string' ||
    !isChainKey(value.destination_chain) ||
    typeof value.input_token_symbol !== 'string' ||
    !/^[A-Za-z0-9 ._()-]{1,64}$/.test(value.input_token_symbol) ||
    typeof value.output_token_symbol !== 'string' ||
    !/^[A-Za-z0-9 ._()-]{1,64}$/.test(value.output_token_symbol) ||
    typeof value.input_amount !== 'string' ||
    !/^\d{1,30}(\.\d{0,30})?$/.test(value.input_amount) ||
    typeof value.has_partner_fee !== 'boolean'
  )
    return undefined;
  return {
    source_chain: value.source_chain,
    destination_chain: value.destination_chain,
    input_token_symbol: value.input_token_symbol,
    output_token_symbol: value.output_token_symbol,
    input_amount: value.input_amount,
    has_partner_fee: value.has_partner_fee,
  };
}

export function readActivity(value: string | null): Activity | undefined {
  if (!value || value.length > 50000) return undefined;
  try {
    const data: unknown = JSON.parse(value);
    if (
      !record(data) ||
      typeof data.txHash !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,127}$/.test(data.txHash) ||
      typeof data.srcChainKey !== 'string' ||
      !isChainKey(data.srcChainKey) ||
      typeof data.dstChainKey !== 'string' ||
      !isChainKey(data.dstChainKey) ||
      !isAddressText(data.srcTokenAddress) ||
      !isAddressText(data.dstTokenAddress) ||
      !isAmountText(data.inputAmount) ||
      typeof data.walletAddress !== 'string' ||
      typeof data.recipient !== 'string' ||
      typeof data.summary !== 'string' ||
      data.summary.length > 300 ||
      typeof data.createdAt !== 'number' ||
      !Number.isFinite(data.createdAt) ||
      typeof data.relayData !== 'string' ||
      !/^0x[\da-f]*$/i.test(data.relayData) ||
      !isIntent(data.intent)
    )
      return undefined;
    return {
      txHash: data.txHash,
      srcChainKey: data.srcChainKey,
      dstChainKey: data.dstChainKey,
      srcTokenAddress: data.srcTokenAddress,
      dstTokenAddress: data.dstTokenAddress,
      inputAmount: data.inputAmount,
      walletAddress: data.walletAddress,
      recipient: data.recipient,
      summary: data.summary,
      createdAt: data.createdAt,
      relayData: data.relayData,
      intent: data.intent,
      ...(readPair(data.pair) ? { pair: readPair(data.pair) } : {}),
      ...(data.relaySubmitted === true ? { relaySubmitted: true } : {}),
      ...(data.settlementReported === true ? { settlementReported: true } : {}),
    };
  } catch {
    return undefined;
  }
}

export function loadActivity(): Activity | undefined {
  try {
    return readActivity(localStorage.getItem(ACTIVITY_KEY));
  } catch {
    return undefined;
  }
}

export function saveActivity(activity: Activity | undefined): boolean {
  try {
    if (activity) localStorage.setItem(ACTIVITY_KEY, JSON.stringify(activity));
    else localStorage.removeItem(ACTIVITY_KEY);
    return true;
  } catch {
    return false;
  }
}

export function submissionFor(activity: Activity): SubmitTxRequestV2 {
  return {
    txHash: activity.txHash,
    srcChainKey: activity.srcChainKey,
    walletAddress: activity.walletAddress,
    intent: toIntentRequest(activity.intent),
    relayData: activity.relayData,
  };
}
