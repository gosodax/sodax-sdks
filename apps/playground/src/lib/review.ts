import type { ChainKey, CreateIntentParamsV2, XToken } from '@sodax/dapp-kit';
import type { Activity } from './activity';
import type { TokenChoice } from './chains';

/**
 * Everything the confirm dialog shows, frozen when the visitor opened it. The dialog reads this and
 * never the live form: the form keeps re-quoting behind it, and a reload reseeds it from the URL —
 * neither may restate a swap that is already signed.
 */
export type ReviewSnapshot = {
  intent: CreateIntentParamsV2;
  srcChain: ChainKey;
  dstChain: ChainKey;
  srcToken: XToken;
  dstToken: XToken;
  estimatedSeconds: number | undefined;
};

/**
 * The token an address names on a chain. Exact match first: only an EVM address is re-cased in
 * transit, so falling back case-insensitively for anything else could answer with a different
 * Solana or Sui token than the one that was signed.
 */
export function tokenAt(choices: readonly TokenChoice[], chain: ChainKey, address: string): XToken | undefined {
  const on = choices.filter(choice => choice.chain === chain);
  const exact = on.find(choice => choice.token.address === address);
  if (exact || !/^0x[\da-f]+$/i.test(address)) return exact?.token;
  return on.find(choice => choice.token.address.toLowerCase() === address.toLowerCase())?.token;
}

/**
 * The dialog a reload lost, rebuilt from the stored record. Amounts and addresses come from the
 * intent that was signed; decimals and symbols are resolved against the live asset list instead of
 * being trusted from storage, so an edited record cannot restate what was sent.
 *
 * The tokens resolve from the record's own spoke-side addresses, never the intent's: that struct is
 * the hub's, and its `inputToken` / `outputToken` name Sonic assets no spoke chain carries. The
 * source amount is the record's for the same reason — `intent.inputAmount` is net of the partner
 * fee, so restating from it would show a smaller swap than the one the visitor confirmed.
 */
export function reviewFromActivity(
  activity: Activity,
  choices: readonly TokenChoice[],
  estimate: (from: XToken, to: XToken) => number | undefined,
): ReviewSnapshot | undefined {
  const srcToken = tokenAt(choices, activity.srcChainKey, activity.srcTokenAddress);
  const dstToken = tokenAt(choices, activity.dstChainKey, activity.dstTokenAddress);
  if (!srcToken || !dstToken) return undefined;

  return {
    intent: {
      srcChainKey: activity.srcChainKey,
      dstChainKey: activity.dstChainKey,
      inputToken: srcToken.address,
      outputToken: dstToken.address,
      inputAmount: activity.inputAmount,
      minOutputAmount: activity.intent.minOutputAmount,
      srcAddress: activity.walletAddress,
      dstAddress: activity.recipient,
      deadline: activity.intent.deadline,
      allowPartialFill: activity.intent.allowPartialFill,
    },
    srcChain: activity.srcChainKey,
    dstChain: activity.dstChainKey,
    srcToken,
    dstToken,
    estimatedSeconds: estimate(srcToken, dstToken),
  };
}
