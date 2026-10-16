import {
  baseChainInfo,
  type ChainKey,
  type ChainType,
  type CreateIntentParamsV2,
  type IntentResponseV2,
  type IntentRequestV2,
  type InjectiveRawTransaction,
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

export async function broadcast(chain: ChainKey, tx: RawTxReturnType, wallet: IWalletProvider): Promise<string> {
  const network = baseChainInfo[chain];
  if (network.type !== wallet.chainType) throw new Error('Reconnect the wallet for the source network.');
  if (await senderMismatch(tx, wallet)) throw new Error('The signing account changed. Review the swap again.');

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
  sign: (tx: RawTxReturnType) => Promise<string>;
  onPhase: (phase: ExecutionPhase) => void;
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
  onPhase('checking');
  await checkQuote();
  const allowance = await api.checkAllowance(body);
  if (!allowance.ok) throw allowance.error;
  if (!allowance.value.valid) {
    onPhase('approving');
    await deps.approve(body);
    await checkQuote();
  }
  const deadline = await api.getDeadline();
  if (!deadline.ok) throw deadline.error;
  onPhase('building');
  const created = await api.createIntent({ ...body, deadline: deadline.value.deadline });
  if (!created.ok) throw created.error;
  onPhase('signing');
  const txHash = await deps.sign(created.value.tx);
  const request: SubmitTxRequestV2 = {
    txHash,
    srcChainKey: body.srcChainKey,
    walletAddress: body.srcAddress,
    intent: toIntentRequest(created.value.intent),
    relayData: created.value.relayData.payload,
  };
  deps.onBroadcast(request, created.value.intent);
  onPhase('submitting');
  const submitted = await api.submitTx(request);
  if (!submitted.ok) throw submitted.error;
  if (!submitted.value.success) throw new Error('The relay has not accepted this swap yet. Retry tracking.');
  deps.onRelayAccepted();
}

export function isUserRejection(error: unknown): boolean {
  const message = error instanceof Error ? error.message : '';
  return /reject|denied|cancelled by user|canceled by user/i.test(message);
}

export function executionError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Could not complete this step. Please try again.';
  if (/\b403\b|access forbidden/i.test(message))
    return 'The network connection refused this request (403). Please try again once the connection is restored.';
  if (isUserRejection(error)) return 'Request declined in your wallet. You can try again.';
  return message;
}
