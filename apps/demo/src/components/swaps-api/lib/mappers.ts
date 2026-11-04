import type { Address, ChainKey, IntentRequestV2, IntentResponseV2, SwapTokenV2, XToken } from '@sodax/dapp-kit';

/**
 * Convert the intent returned by `createIntent` (`IntentResponseV2`, decimal-string numerics)
 * into the intent `submitTx` requires (`IntentRequestV2`, bigint numerics). The SDK exports
 * both types but no converter between them, so the handoff is done here.
 */
export function toIntentRequest(intent: IntentResponseV2): IntentRequestV2 {
  return {
    ...intent,
    intentId: BigInt(intent.intentId),
    inputAmount: BigInt(intent.inputAmount),
    minOutputAmount: BigInt(intent.minOutputAmount),
    deadline: BigInt(intent.deadline),
    srcChain: BigInt(intent.srcChain),
    dstChain: BigInt(intent.dstChain),
  };
}

/**
 * `SwapTokenV2` carries the same fields as `XToken` but as plain JSON strings; cast the
 * branded fields back so the balance hook (`useBalances`) accepts API-sourced tokens.
 */
export function toXToken(token: SwapTokenV2): XToken {
  return {
    ...token,
    chainKey: token.chainKey as ChainKey,
    hubAsset: token.hubAsset as Address,
    vault: token.vault as Address,
  };
}
