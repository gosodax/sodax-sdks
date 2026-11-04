import type {
  EvmRawTransaction,
  GetWalletProviderType,
  Hex,
  IEvmWalletProvider,
  IStellarWalletProvider,
  RawTxReturnType,
  SpokeChainKey,
  StellarRawTransaction,
} from '@sodax/sdk';
import {
  getEvmViemChain,
  isApprovalSupportedChainKeyType,
  isEvmSpokeOnlyChainKeyType,
  isHubChainKeyType,
  isStellarChainKeyType,
} from '@sodax/sdk';

/** Hashes of the transactions an approval plan broadcast, in the order they were sent. */
export type ApprovalHashes = {
  /** Present only when the source token needed its stale allowance cleared first. */
  readonly resetTxHash?: string;
  readonly approveTxHash: string;
};

/** The unsigned transactions a backend approve route hands back, in broadcast order. */
export type ApprovalPlan = {
  readonly tx: RawTxReturnType;
  readonly resetTx?: RawTxReturnType;
};

type ApprovalStepId = 'allowance-reset' | 'approve';
type ApprovalPhase = 'signing' | 'broadcast' | 'confirmed' | 'failed';

/** Where an approval has got to. A guarded token takes two transactions, every other token one. */
export type ApprovalProgress = {
  readonly step: ApprovalStepId;
  readonly phase: ApprovalPhase;
  /** 1-based position in `total`. */
  readonly index: number;
  readonly total: number;
  /** Present from `broadcast` onwards. */
  readonly hash?: string;
  /** Only on `failed`. */
  readonly error?: unknown;
};

export type ApprovalProgressListener = (progress: ApprovalProgress) => void;

/** Sends one transaction and decides whether it landed, for one chain family. */
type ChainSender = {
  send: (raw: RawTxReturnType) => Promise<string>;
  /** Resolves once the transaction has landed successfully; throws when it did not. */
  confirm: (hash: string, step: ApprovalStepId) => Promise<void>;
};

/** Reads better than the id inside an error sentence. */
const stepLabel = (step: ApprovalStepId): string => (step === 'allowance-reset' ? 'allowance reset' : 'approve');

/**
 * `EvmRawTransactionReceipt.status` is documented as the JSON-RPC hex flag, but `EvmWalletProvider`
 * passes viem's `'reverted'` through unchanged, so both spellings reach here. A receipt without a
 * status is pre-Byzantium and inconclusive — not a revert.
 */
const isRevertedEvmReceiptStatus = (status: string | undefined): boolean => status === 'reverted' || status === '0x0';

/**
 * How to send and confirm on the chains a SODAX approve route can act on — the hub (Sonic), EVM
 * spokes, and Stellar. Every other chain reports its allowance as always sufficient, so approval
 * never runs for it.
 *
 * Resolved once, before anything is sent: an unsupported chain or a Stellar wallet that cannot sign
 * then fails without first asking the user for a signature that could never be broadcast.
 */
function resolveChainSender(
  srcChainKey: SpokeChainKey,
  walletProvider: GetWalletProviderType<SpokeChainKey>,
  hookName: string,
): ChainSender {
  const fail = (message: string): Error => new Error(`[${hookName}] ${message}`);

  // Single SDK-exported source for "which chains support approval" — the same partition
  // SpokeService's approve-params guards resolve to, so a chain added there isn't silently
  // missed here too.
  if (!isApprovalSupportedChainKeyType(srcChainKey)) {
    throw fail(
      `${srcChainKey} cannot be approved — SODAX approve routes support the hub (Sonic), EVM spokes, and Stellar.`,
    );
  }

  if (isHubChainKeyType(srcChainKey) || isEvmSpokeOnlyChainKeyType(srcChainKey)) {
    const evm = walletProvider as IEvmWalletProvider;

    return {
      // Chain-bind the send: the wallet broadcasts on ITS active chain, so refuse when that differs
      // from the srcChainKey the user asked for. (Verifying the tx CONTENT is a separate concern.)
      send: raw => evm.sendTransaction(raw as EvmRawTransaction, { expectedChainId: getEvmViemChain(srcChainKey).id }),
      confirm: async (hash, step) => {
        const receipt = await evm.waitForTransactionReceipt(hash as Hex);
        // Mined is not succeeded: a revert here would let the approve go out over an unmoved allowance.
        if (isRevertedEvmReceiptStatus(receipt.status)) {
          throw fail(`the ${stepLabel(step)} transaction ${hash} reverted on chain.`);
        }
      },
    };
  }

  if (isStellarChainKeyType(srcChainKey)) {
    const stellar = walletProvider as IStellarWalletProvider;
    // Optional on the interface — not every Stellar wallet implements it.
    if (!stellar.signAndSendTransaction) {
      throw fail('this Stellar wallet provider does not implement signAndSendTransaction.');
    }
    const signAndSend = stellar.signAndSendTransaction.bind(stellar);

    return {
      send: raw => signAndSend(raw as StellarRawTransaction),
      confirm: async (hash, step) => {
        const receipt = await stellar.waitForTransactionReceipt(hash);
        if (receipt.successful === false) {
          throw fail(`the ${stepLabel(step)} transaction ${hash} failed on chain.`);
        }
      },
    };
  }

  // Unreachable: isApprovalSupportedChainKeyType above already confirmed srcChainKey is hub, EVM-spoke,
  // or Stellar, and the two branches above cover all three — kept only to satisfy TypeScript's
  // return-path check (the guard is a plain boolean, so it doesn't narrow srcChainKey's type here).
  throw fail(
    `${srcChainKey} cannot be approved — SODAX approve routes support the hub (Sonic), EVM spokes, and Stellar.`,
  );
}

/**
 * Broadcasts an approval plan in the only order that can work: `resetTx` mined first, then the
 * approve, which is not a valid state transition until the allowance has been zeroed on-chain.
 *
 * Not a pure helper like its neighbours here — it signs and sends through the caller's wallet
 * provider — but it is framework-free, and shared by the swaps and bridge approve-and-broadcast
 * hooks so the ordering is not re-derived per feature. `hookName` prefixes the errors.
 *
 * `onProgress` reports which transaction the user is being prompted for — `isPending` alone cannot
 * say whether a popup is the reset or the approve.
 */
export async function runApprovalPlan({
  plan,
  srcChainKey,
  walletProvider,
  hookName,
  onProgress,
}: {
  plan: ApprovalPlan;
  srcChainKey: SpokeChainKey;
  walletProvider: GetWalletProviderType<SpokeChainKey>;
  hookName: string;
  onProgress?: ApprovalProgressListener;
}): Promise<ApprovalHashes> {
  const sender = resolveChainSender(srcChainKey, walletProvider, hookName);
  const total = plan.resetTx === undefined ? 1 : 2;

  // Advisory: a listener that throws must not abort a broadcast the user has already paid for.
  const report = (step: ApprovalStepId, phase: ApprovalPhase, extra?: { hash?: string; error?: unknown }): void => {
    try {
      onProgress?.({ step, phase, index: step === 'approve' ? total : 1, total, ...extra });
    } catch {
      // ignored on purpose
    }
  };

  // Sending and confirming are coupled deliberately: returning before confirmation would hand the
  // ordering hazard back to the caller.
  const sendAndWait = async (raw: RawTxReturnType, step: ApprovalStepId): Promise<string> => {
    let hash: string | undefined;
    report(step, 'signing');

    try {
      hash = await sender.send(raw);
      report(step, 'broadcast', { hash });
      await sender.confirm(hash, step);
    } catch (error) {
      report(step, 'failed', { hash, error });
      throw error;
    }

    report(step, 'confirmed', { hash });
    return hash;
  };

  // A throw aborts before the approve is sent: an unconfirmed reset leaves the allowance untouched,
  // so a retry re-plans and costs a single transaction.
  const resetTxHash = plan.resetTx === undefined ? undefined : await sendAndWait(plan.resetTx, 'allowance-reset');
  const approveTxHash = await sendAndWait(plan.tx, 'approve');

  return resetTxHash === undefined ? { approveTxHash } : { resetTxHash, approveTxHash };
}
