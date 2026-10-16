// Sign-and-broadcast dispatcher for the unsigned transactions the Swaps API returns
// (`approve.tx`, `createIntent.tx`, `cancelIntent.tx`). The API leaves signing entirely to the
// client, and neither @sodax/dapp-kit nor @sodax/sdk ship a utility for this step — every consumer
// has to hand-roll the per-chain dispatch below. Remaining gaps this file works around:
//
// a. No shared sign+broadcast hook/utility — every consumer hand-rolls the per-chain dispatch below.
//    Bitcoin is the one chain not handled here: its 2-of-2 Bound Exchange trading wallet needs the
//    SDK's BitcoinSpokeService.signAndSubmitRawTransaction (sign → Bound co-sign + broadcast), which
//    SwapCard calls directly with the client's Bound session.
// b. No `IntentResponseV2` → `IntentRequestV2` converter (see ./mappers.ts).
// c. `approve` cannot auto-invalidate the `['swapsApi','allowance']` query — confirmation happens
//    client-side, so callers refetch allowance manually. Signing/confirming an approve plan is the
//    one step dapp-kit does cover: `runApprovalPlan` sequences `resetTx` before `tx` and checks
//    each receipt's execution status, so this file deliberately does not reimplement it.
//
// `tx` is the typed `RawTxReturnType` union: the @sodax/swaps-api client validates each response
// against the chain-specific schema and reconstructs bigints, so no structural validation or
// numeric coercion is needed here — narrowing to a per-chain variant is driven by the chain type.

import type {
  EvmRawTransaction,
  IEvmWalletProvider,
  IIconWalletProvider,
  IInjectiveWalletProvider,
  INearWalletProvider,
  ISolanaWalletProvider,
  IStacksWalletProvider,
  IStellarWalletProvider,
  ISuiWalletProvider,
  IWalletProvider,
  IcxCallTransaction,
  InjectiveRawTransaction,
  NearRawTransaction,
  RawTxReturnType,
  SolanaChainKey,
  SpokeChainKey,
  StacksRawTransaction,
  StellarRawTransaction,
  SuiRawTransaction,
  TxReturnType,
} from '@sodax/dapp-kit';
import { getEvmViemChain, type EvmChainKey } from '@sodax/dapp-kit';
import { getXChainType } from '@sodax/wallet-sdk-react';

export class SwapsApiSignError extends Error {
  constructor(
    readonly chainKey: string,
    readonly reason: 'sdk-gap' | 'malformed-payload',
    message: string,
    readonly payload?: unknown,
  ) {
    super(message);
    this.name = 'SwapsApiSignError';
  }
}

/**
 * Sign and broadcast an unsigned transaction returned by the Swaps API using only the chain's
 * wallet provider. Returns the spoke-chain tx hash / signature / digest. `tx` is the typed
 * `RawTxReturnType` variant for `chainKey` (already validated + bigint-reconstructed by the SDK),
 * so narrowing it to the per-chain variant below is sound. Chains whose wallet-provider interface
 * cannot complete sign+broadcast throw a `SwapsApiSignError` naming the missing SDK surface.
 */
export async function signAndBroadcastSwapsApiTx(args: {
  chainKey: SpokeChainKey;
  tx: RawTxReturnType;
  walletProvider: IWalletProvider;
}): Promise<string> {
  const { chainKey, tx, walletProvider } = args;
  const chainType = getXChainType(chainKey);

  switch (chainType) {
    case 'EVM':
      // Chain-bind the send: the wallet must be on `chainKey`'s network, not wherever it happens to be.
      return await (walletProvider as IEvmWalletProvider).sendTransaction(tx as EvmRawTransaction, {
        expectedChainId: getEvmViemChain(chainKey as EvmChainKey).id,
      });
    case 'SUI': {
      // SuiTransaction is structurally { toJSON(): Promise<string> }; the wallet provider rebuilds
      // via Transaction.from(...), which accepts the base64-serialized tx bytes in `data`.
      const { data } = tx as SuiRawTransaction;
      return await (walletProvider as ISuiWalletProvider).signAndExecuteTxn({ toJSON: async () => data });
    }
    case 'ICON':
      // The ICON raw tx is a hex-string-field call transaction; it survives JSON unchanged.
      return await (walletProvider as IIconWalletProvider).sendTransaction(tx as unknown as IcxCallTransaction);
    case 'NEAR':
      return await (walletProvider as INearWalletProvider).signAndSubmitTxn(tx as NearRawTransaction);
    case 'SOLANA': {
      const solana = walletProvider as ISolanaWalletProvider;
      if (!solana.signAndSendTransaction) {
        throw new SwapsApiSignError(
          chainKey,
          'sdk-gap',
          'Solana: this wallet provider does not implement signAndSendTransaction.',
          tx,
        );
      }
      return await solana.signAndSendTransaction(tx as TxReturnType<SolanaChainKey, true>);
    }
    case 'STELLAR': {
      const stellar = walletProvider as IStellarWalletProvider;
      if (!stellar.signAndSendTransaction) {
        throw new SwapsApiSignError(
          chainKey,
          'sdk-gap',
          'Stellar: this wallet provider does not implement signAndSendTransaction.',
          tx,
        );
      }
      return await stellar.signAndSendTransaction(tx as StellarRawTransaction);
    }
    case 'STACKS': {
      const stacks = walletProvider as IStacksWalletProvider;
      if (!stacks.signAndSendTransaction) {
        throw new SwapsApiSignError(
          chainKey,
          'sdk-gap',
          'Stacks: this wallet provider does not implement signAndSendTransaction.',
          tx,
        );
      }
      return await stacks.signAndSendTransaction(tx as StacksRawTransaction);
    }
    case 'INJECTIVE': {
      const injective = walletProvider as IInjectiveWalletProvider;
      if (!injective.signAndSendTransaction) {
        throw new SwapsApiSignError(
          chainKey,
          'sdk-gap',
          'Injective: this wallet provider does not implement signAndSendTransaction.',
          tx,
        );
      }
      return await injective.signAndSendTransaction(tx as InjectiveRawTransaction);
    }
    case 'BITCOIN':
      // Bitcoin is signable but not through this wallet-only dispatcher: the 2-of-2 Bound Exchange
      // trading wallet needs the SDK's BitcoinSpokeService.signAndSubmitRawTransaction (sign → Bound
      // co-sign + broadcast), which requires the client's Bound session + relay identity. SwapCard
      // routes Bitcoin source there directly, so this branch should not be reached.
      throw new SwapsApiSignError(
        chainKey,
        'sdk-gap',
        'Bitcoin must be signed + submitted via BitcoinSpokeService.signAndSubmitRawTransaction (Bound trading-wallet flow), not this wallet-only dispatcher.',
        tx,
      );
    default:
      throw new SwapsApiSignError(chainKey, 'sdk-gap', `Unknown chain type for ${chainKey}`, tx);
  }
}

/** Chain types the dispatcher can sign+broadcast with the current wallet-provider interfaces. */
export function isSignableSwapsApiChain(chainKey: SpokeChainKey): boolean {
  const chainType = getXChainType(chainKey);
  return (
    chainType === 'EVM' ||
    chainType === 'SUI' ||
    chainType === 'ICON' ||
    chainType === 'NEAR' ||
    chainType === 'SOLANA' ||
    chainType === 'STELLAR' ||
    chainType === 'STACKS' ||
    chainType === 'INJECTIVE'
  );
}
