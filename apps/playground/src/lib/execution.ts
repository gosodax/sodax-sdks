import {
  ACCOUNT_UPGRADE_DECLINED,
  ATOMIC_BATCH_UNCONFIRMED,
  baseChainInfo,
  confirmApprovalBatch,
  isAtomicBatchRefusal,
  isSodaxError,
  type ChainKey,
  type ChainType,
  type CreateIntentParamsV2,
  type CreateIntentResponseV2,
  type IntentResponseV2,
  type IntentRequestV2,
  type InjectiveRawTransaction,
  type IEvmWalletProvider,
  type IWalletProvider,
  type NearRawTransaction,
  type RawTxReturnType,
  type SolanaRawTransaction,
  type StacksRawTransaction,
  type SubmitTxRequestV2,
  type Sodax,
  type EvmRawTransaction,
} from '@sodax/dapp-kit';
import { isAddress, isHex } from 'viem';
import type { PendingBatch } from './activity';

/**
 * Wallet families this widget can sign for. Bitcoin is deliberately absent: it settles through a
 * funded Bound trading wallet rather than a signed swaps-API payload, so it is a separate flow.
 */
export const EXECUTABLE_CHAIN_TYPES = ['EVM', 'SOLANA', 'SUI', 'STELLAR', 'NEAR', 'STACKS', 'INJECTIVE'] as const;

export type ExecutableChainType = (typeof EXECUTABLE_CHAIN_TYPES)[number];

export function isExecutableChainType(type: ChainType): type is ExecutableChainType {
  return (EXECUTABLE_CHAIN_TYPES as readonly ChainType[]).includes(type);
}

export function canExecute(chain: ChainKey | undefined): boolean {
  return chain ? isExecutableChainType(baseChainInfo[chain].type) : false;
}

/**
 * Source-chain extras the swaps API needs to build the intent. Stacks alone: a Stacks address cannot
 * yield its signer public key, so the wallet is the only place the intent can get one.
 */
export function sourceExtras(type: ChainType, publicKey: string | undefined): { srcPublicKey?: string } {
  return type === 'STACKS' && publicKey ? { srcPublicKey: publicKey } : {};
}

/**
 * The `{ from, to, value, data }` payload EVM, Solana, Sui, Stellar and Bitcoin all share. The
 * chain type — never the shape — decides which wallet signs it; these members are indistinguishable.
 */
function isTransfer(tx: RawTxReturnType): tx is SolanaRawTransaction {
  return (
    'from' in tx &&
    typeof tx.from === 'string' &&
    'to' in tx &&
    typeof tx.to === 'string' &&
    'value' in tx &&
    typeof tx.value === 'bigint' &&
    'data' in tx &&
    typeof tx.data === 'string'
  );
}

function isEvmTransfer(tx: RawTxReturnType): tx is EvmRawTransaction {
  return isTransfer(tx) && isAddress(tx.from) && isAddress(tx.to) && isHex(tx.data);
}

function isNearCall(tx: RawTxReturnType): tx is NearRawTransaction {
  if (!('signerId' in tx) || typeof tx.signerId !== 'string' || !('params' in tx)) return false;
  const params = tx.params as NearRawTransaction['params'] | undefined;
  return !!params && typeof params.contractId === 'string' && typeof params.method === 'string';
}

function isStacksPayload(tx: RawTxReturnType): tx is StacksRawTransaction {
  return 'payload' in tx && typeof tx.payload === 'string' && tx.payload.length > 0;
}

function isInjectiveDoc(tx: RawTxReturnType): tx is InjectiveRawTransaction {
  if (!('signedDoc' in tx)) return false;
  const doc = tx.signedDoc as InjectiveRawTransaction['signedDoc'] | undefined;
  return (
    !!doc &&
    doc.bodyBytes instanceof Uint8Array &&
    doc.authInfoBytes instanceof Uint8Array &&
    typeof doc.chainId === 'string'
  );
}

/**
 * The sender field the payload carries, or `undefined` when the family has none to check against
 * the connected account. Injective is deliberately absent: its raw tx reports a hex `from` while the
 * wallet reports bech32, so comparing them rejects every valid swap.
 */
async function senderMismatch(tx: RawTxReturnType, wallet: IWalletProvider): Promise<boolean> {
  if (wallet.chainType === 'INJECTIVE') return false;
  const claimed = isNearCall(tx) ? tx.signerId : isTransfer(tx) ? tx.from : undefined;
  if (claimed === undefined) return false;
  const account = await wallet.getWalletAddress();
  return wallet.chainType === 'EVM' ? claimed.toLowerCase() !== account.toLowerCase() : claimed !== account;
}

async function assertSigner(chain: ChainKey, tx: RawTxReturnType, wallet: IWalletProvider): Promise<void> {
  if (baseChainInfo[chain].type !== wallet.chainType) throw new Error('Reconnect the wallet for the source network.');
  if (await senderMismatch(tx, wallet)) throw new Error('The signing account changed. Review the swap again.');
}

export async function broadcast(chain: ChainKey, tx: RawTxReturnType, wallet: IWalletProvider): Promise<string> {
  const network = baseChainInfo[chain];
  await assertSigner(chain, tx, wallet);

  if (wallet.chainType === 'EVM' && typeof network.chainId === 'number' && isEvmTransfer(tx)) {
    return wallet.sendTransaction(tx, { expectedChainId: network.chainId });
  }
  if (wallet.chainType === 'SOLANA' && isTransfer(tx) && wallet.signAndSendTransaction) {
    return wallet.signAndSendTransaction(tx);
  }
  if (wallet.chainType === 'SUI' && isTransfer(tx)) {
    return wallet.signAndExecuteTxn({ toJSON: async () => tx.data });
  }
  if (wallet.chainType === 'STELLAR' && isTransfer(tx) && wallet.signAndSendTransaction) {
    return wallet.signAndSendTransaction(tx);
  }
  if (wallet.chainType === 'NEAR' && isNearCall(tx)) {
    return wallet.signAndSubmitTxn(tx);
  }
  if (wallet.chainType === 'STACKS' && isStacksPayload(tx) && wallet.signAndSendTransaction) {
    return wallet.signAndSendTransaction(tx);
  }
  if (wallet.chainType === 'INJECTIVE' && isInjectiveDoc(tx) && wallet.signAndSendTransaction) {
    return wallet.signAndSendTransaction(tx);
  }
  throw new Error('This wallet cannot sign this transaction. Try another wallet.');
}

/** `broadcast`'s checks for an EVM deposit, handing back the narrowed payload and wallet a batch needs. */
export async function evmDeposit(
  chain: ChainKey,
  tx: RawTxReturnType,
  wallet: IWalletProvider,
): Promise<{ tx: EvmRawTransaction; wallet: IEvmWalletProvider }> {
  await assertSigner(chain, tx, wallet);
  if (wallet.chainType !== 'EVM' || !isEvmTransfer(tx)) {
    throw new Error('This wallet cannot sign this transaction. Try another wallet.');
  }
  return { tx, wallet };
}

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

export type ExecutionPhase = 'checking' | 'approving' | 'building' | 'signing' | 'submitting';

export type ExecutionDependencies = {
  api: Pick<Sodax['api']['swaps'], 'getQuote' | 'checkAllowance' | 'getDeadline' | 'createIntent' | 'submitTx'>;
  approve: (body: CreateIntentParamsV2) => Promise<void>;
  /** `'atomic-batch'` when the wallet can approve and sign the deposit in one prompt. */
  approvalStrategy: (body: CreateIntentParamsV2) => Promise<'atomic-batch' | 'sequential'>;
  /**
   * Approve and sign the deposit in one wallet prompt; resolves to the deposit's hash. Rejects with an
   * `isAtomicBatchRefusal` error when the wallet turns the batch down, so the two-step path runs instead.
   */
  approveAndSign: (
    body: CreateIntentParamsV2,
    tx: RawTxReturnType,
    onBatchSent: (batchId: string, callCount: number) => void,
  ) => Promise<string>;
  sign: (tx: RawTxReturnType) => Promise<string>;
  onPhase: (phase: ExecutionPhase) => void;
  /** The wallet took the one-signature batch. Persist it: it may land after the wait has given up. */
  onBatchSent: (
    batch: { batchId: string; callCount: number },
    submission: Omit<SubmitTxRequestV2, 'txHash'>,
    intent: IntentResponseV2,
  ) => void;
  onBroadcast: (request: SubmitTxRequestV2, intent: IntentResponseV2) => void;
  /** The relay holds the deposit. Durable, because only a resubmission can move one it does not. */
  onRelayAccepted: () => void;
};

/** Persist the broadcast before relay submission; retries must never sign a second deposit. */
export async function executeSwap(body: CreateIntentParamsV2, deps: ExecutionDependencies): Promise<void> {
  const { api, onPhase } = deps;
  const checkQuote = async () => {
    const quote = await api.getQuote({
      tokenSrcChainKey: body.srcChainKey,
      tokenDstChainKey: body.dstChainKey,
      tokenSrc: body.inputToken,
      tokenDst: body.outputToken,
      amount: body.inputAmount,
      quoteType: 'exact_input',
      ...(body.partnerFee ? { partnerFee: body.partnerFee } : {}),
    });
    if (!quote.ok) throw quote.error;
    if (BigInt(quote.value.quotedAmount) < BigInt(body.minOutputAmount)) {
      throw new Error('The quote changed beyond your slippage. Review a new quote before swapping.');
    }
  };
  const approveSeparately = async () => {
    onPhase('approving');
    await deps.approve(body);
    await checkQuote();
  };
  const build = async (): Promise<CreateIntentResponseV2> => {
    const deadline = await api.getDeadline();
    if (!deadline.ok) throw deadline.error;
    onPhase('building');
    const created = await api.createIntent({ ...body, deadline: deadline.value.deadline });
    if (!created.ok) throw created.error;
    return created.value;
  };
  const submissionOf = (created: CreateIntentResponseV2): Omit<SubmitTxRequestV2, 'txHash'> => ({
    srcChainKey: body.srcChainKey,
    walletAddress: body.srcAddress,
    intent: toIntentRequest(created.intent),
    relayData: created.relayData.payload,
  });

  onPhase('checking');
  await checkQuote();
  const allowance = await api.checkAllowance(body);
  if (!allowance.ok) throw allowance.error;
  const batch = !allowance.value.valid && (await deps.approvalStrategy(body)) === 'atomic-batch';
  if (!allowance.value.valid && !batch) await approveSeparately();
  let created = await build();
  onPhase('signing');
  let txHash: string;
  if (batch) {
    const batched = created;
    try {
      // The approval lands with the deposit, so the quote just checked is the one it signs against.
      txHash = await deps.approveAndSign(body, batched.tx, (batchId, callCount) =>
        deps.onBatchSent({ batchId, callCount }, submissionOf(batched), batched.intent),
      );
    } catch (error) {
      if (!isAtomicBatchRefusal(error)) throw error;
      // Refused before signing, so nothing was sent: take the two-step path, re-quote included.
      await approveSeparately();
      created = await build();
      onPhase('signing');
      txHash = await deps.sign(created.tx);
    }
  } else {
    txHash = await deps.sign(created.tx);
  }
  const request: SubmitTxRequestV2 = { txHash, ...submissionOf(created) };
  deps.onBroadcast(request, created.intent);
  onPhase('submitting');
  const submitted = await api.submitTx(request);
  if (!submitted.ok) throw submitted.error;
  if (!submitted.value.success) throw new Error('The relay has not accepted this swap yet. Retry tracking.');
  deps.onRelayAccepted();
}

/** What the widget says while a batch the wallet took but never confirmed holds its review. */
export const UNCONFIRMED_BATCH_MESSAGE =
  'Your wallet accepted the swap but it has not confirmed yet. Check your wallet activity before swapping again.';

/**
 * The held dialog's line. A batch the browser could not save is held only in memory and a reload
 * forgets it, so that warning outranks anything a recheck has to say.
 */
export function heldBatchMessage(error: string | undefined, saved: boolean): string {
  if (!saved)
    return 'Your wallet has not confirmed this swap, and this browser blocked saving it. Keep this page open and check your wallet activity.';
  return error ?? UNCONFIRMED_BATCH_MESSAGE;
}

/** A batch the wallet took but did not confirm. It may still land, so the swap must not be signed again. */
export function isUnconfirmedBatch(error: unknown): boolean {
  return (
    isSodaxError(error) && error.code === 'TX_VERIFICATION_FAILED' && error.context?.reason === ATOMIC_BATCH_UNCONFIRMED
  );
}

/** What asking the wallet about a held batch found. */
export type HeldBatchCheck =
  | { status: 'connect' }
  | { status: 'wrong-account' }
  | { status: 'pending' }
  | { status: 'failed' }
  | { status: 'confirmed'; txHash: string };

/**
 * Asks the wallet that sent a held batch whether its deposit landed. Only that EVM account can answer
 * for its batch id, so a missing or different connection is reported instead of asked.
 */
export async function checkHeldBatch(
  batch: Pick<PendingBatch, 'batchId' | 'callCount' | 'walletAddress'>,
  wallet: IWalletProvider | undefined,
  timeoutMs: number,
  confirm: typeof confirmApprovalBatch = confirmApprovalBatch,
): Promise<HeldBatchCheck> {
  if (!wallet || wallet.chainType !== 'EVM') return { status: 'connect' };
  const account = await wallet.getWalletAddress();
  if (account.toLowerCase() !== batch.walletAddress.toLowerCase()) return { status: 'wrong-account' };
  const confirmed = await confirm({
    walletProvider: wallet,
    batchId: batch.batchId,
    callCount: batch.callCount,
    timeoutMs,
    feature: 'swap',
  });
  if (confirmed.ok) return { status: 'confirmed', txHash: confirmed.value.txHash };
  // Anything but "unconfirmed" means the wallet reported the batch never landed: nothing was deposited.
  return isUnconfirmedBatch(confirmed.error) ? { status: 'pending' } : { status: 'failed' };
}

/** The visitor declined the smart-account upgrade a batch needed; the next attempt approves separately. */
export function isUpgradeDeclined(error: unknown): boolean {
  return isSodaxError(error) && error.code === 'USER_REJECTED' && error.context?.reason === ACCOUNT_UPGRADE_DECLINED;
}

export function isUserRejection(error: unknown): boolean {
  const message = error instanceof Error ? error.message : '';
  return /reject|denied|cancelled by user|canceled by user/i.test(message);
}

export function executionError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Could not complete this step. Please try again.';
  if (/\b403\b|access forbidden/i.test(message))
    return 'The network connection refused this request (403). Please try again once the connection is restored.';
  if (isUnconfirmedBatch(error)) return UNCONFIRMED_BATCH_MESSAGE;
  if (isUserRejection(error)) return 'Request declined in your wallet. You can try again.';
  return message;
}
