import {
  baseChainInfo,
  ChainKeys,
  spokeChainConfig,
  isNativeToken,
  resolveApprovalStrategy,
  useBalances,
  useNearStorageGate,
  useSodaxContext,
  useStellarGate,
  useSwapsApiApproveAndBroadcast,
  useSwapsApiBroadcastWithApproval,
  useSwapsApiSubmitTxStatus,
  type ChainKey,
  type ChainType,
  type IntentResponseV2,
  type SpokeChainKey,
  type XToken,
  type PartnerFeePercentage,
  type Result,
} from '@sodax/dapp-kit';
import {
  useWalletProvider,
  useXAccounts,
  useXConnectors,
  useConnectionFlow,
  useXDisconnect,
  useEvmSwitchChain,
} from '@sodax/wallet-sdk-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatUnits } from 'viem';
import {
  activityFromBatch,
  loadActivity,
  loadPendingBatch,
  saveActivity,
  saveBatchActivity,
  savePendingBatch,
  submissionFor,
  type Activity,
  type PendingBatch,
} from '../lib/activity';
import {
  type PairDimensions,
  trackSwapCompleted,
  trackSwapFailed,
  trackSwapSubmitted,
  type SwapFailureReason,
} from '../lib/analytics';
import type { TokenChoice } from '../lib/chains';
import { postEmbedEvent } from '../lib/embedMessages';
import { resolveDestinationGate } from '../lib/destinationGate';
import { type ReviewSnapshot, reviewFromActivity } from '../lib/review';
import {
  broadcast,
  canExecute,
  checkHeldBatch,
  evmDeposit,
  executeSwap,
  executionError,
  isUnconfirmedBatch,
  isUpgradeDeclined,
  isUserRejection,
  sourceExtras,
  type ExecutionPhase,
} from '../lib/execution';

/** How long one "check my wallet again" waits for a held batch before saying it is still pending. */
const BATCH_RECHECK_TIMEOUT_MS = 15_000;

function spokeKey(chain: ChainKey | undefined): SpokeChainKey | undefined {
  return chain && isSpoke(chain) ? chain : undefined;
}
function isSpoke(chain: ChainKey): chain is SpokeChainKey {
  return Object.hasOwn(spokeChainConfig, chain);
}

type ExecutionInput = {
  enabled: boolean;
  srcChain: ChainKey | undefined;
  dstChain: ChainKey | undefined;
  srcToken: XToken | undefined;
  dstToken: XToken | undefined;
  amount: string;
  inputAmount: bigint | undefined;
  minOutputAmount: bigint | undefined;
  partnerFee: PartnerFeePercentage | undefined;
  pair: PairDimensions | undefined;
  /** Every asset the API quotes — what a restored swap resolves its own tokens against. */
  choices: readonly TokenChoice[];
  ready: boolean;
};

export function useExecution(input: ExecutionInput) {
  const { sodax } = useSodaxContext();
  const accounts = useXAccounts();
  const sourceType = input.srcChain ? baseChainInfo[input.srcChain].type : 'EVM';
  const destinationType = input.dstChain ? baseChainInfo[input.dstChain].type : 'EVM';
  const source = accounts[sourceType];
  const destination = accounts[destinationType];
  const wallet = useWalletProvider({ xChainType: canExecute(input.srcChain) ? sourceType : undefined });
  const destinationWallet = useWalletProvider({
    xChainType: canExecute(input.dstChain) ? destinationType : undefined,
  });
  const srcKey = spokeKey(input.srcChain);
  const dstKey = spokeKey(input.dstChain);
  const { isWrongChain, handleSwitchChain } = useEvmSwitchChain({ xChainId: srcKey ?? ChainKeys.SONIC_MAINNET });
  const [connectType, setConnectType] = useState<ChainType>();
  const connectors = useXConnectors({ xChainType: connectType ?? sourceType });
  const connection = useConnectionFlow();
  const disconnect = useXDisconnect();
  const balanceQuery = useBalances({
    params: {
      chainKey: srcKey,
      address: source?.address,
      tokens: input.srcToken ? [input.srcToken] : [],
    },
  });
  const balance = input.srcToken ? balanceQuery.data?.[input.srcToken.address] : undefined;
  const balanceText =
    balance !== undefined && input.srcToken ? formatUnits(balance, input.srcToken.decimals) : undefined;
  const canMax = !!srcKey && !!input.srcToken && !isNativeToken(srcKey, input.srcToken) && balance !== undefined;
  const insufficientBalance = balance !== undefined && input.inputAmount !== undefined && input.inputAmount > balance;

  const [review, setReview] = useState<ReviewSnapshot>();
  // Stellar and NEAR can accept a swap the recipient cannot receive: an unactivated account, a
  // missing trustline, or unregistered NEP-141 storage. Both gates go inert off their own chain.
  const stellarGate = useStellarGate({
    dstChainKey: dstKey,
    token: input.dstToken?.address,
    // The reviewed minimum while a review is open: it is what the swap will deliver at least, and
    // it keeps a quote refresh from re-querying the trustline underneath the confirm button.
    amount: review ? BigInt(review.intent.minOutputAmount) : input.minOutputAmount,
    address: destination?.address,
    walletProvider: destinationWallet,
  });
  const nearGate = useNearStorageGate({
    dstChainKey: dstKey ?? ChainKeys.SONIC_MAINNET,
    token: input.dstToken?.address,
    accountId: destination?.address,
    walletProvider: destinationWallet,
  });
  const [preparation, setPreparation] = useState<Result<unknown>>();
  const destinationGate = resolveDestinationGate(stellarGate, nearGate, preparation);
  const [activity, setActivity] = useState<Activity | undefined>(() => (input.enabled ? loadActivity() : undefined));
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [phase, setPhase] = useState<ExecutionPhase>();
  const [error, setError] = useState<string>();
  const busyRef = useRef(false);
  const phaseRef = useRef<ExecutionPhase>('checking');
  // Dimensions as they were at signing, so a form edited while the swap settles cannot relabel it.
  const submittedPair = useRef<PairDimensions | undefined>(activity?.pair);
  const settledTx = useRef<string | undefined>(undefined);
  const { mutateAsync: approve } = useSwapsApiApproveAndBroadcast();
  const { mutateAsync: broadcastWithApproval } = useSwapsApiBroadcastWithApproval();
  // Once declined, the smart-account upgrade is not asked for again this session.
  const upgradeDeclined = useRef(false);
  // A one-signature batch the wallet took but never confirmed. It may still land, so it is stored and
  // holds the widget — across reloads — until it resolves or the visitor explicitly starts over.
  const [pendingBatch, setPendingBatch] = useState<PendingBatch | undefined>(() =>
    input.enabled ? loadPendingBatch() : undefined,
  );
  const storePendingBatch = (batch: PendingBatch | undefined) => {
    setStorageAvailable(savePendingBatch(batch));
    setPendingBatch(batch);
  };
  // The batch's own wallet, not the form's source: only the account that sent it can say where it went.
  const batchWallet = useWalletProvider({ xChainType: pendingBatch ? 'EVM' : undefined });
  const statusQuery = useSwapsApiSubmitTxStatus({
    params: { txHash: activity?.txHash, srcChainKey: activity?.srcChainKey },
  });
  const status = statusQuery.data?.data;
  const solved = status?.status === 'solved';
  const failed = status?.status === 'failed' || !!status?.abandonedAt;
  const terminal = solved || failed;
  const signable = canExecute(input.srcChain) && canExecute(input.dstChain) && !!srcKey;
  // The confirm dialog carries the swap to settlement, and the fingerprint effect below does not
  // re-run as it advances — so what it must not close is read from a ref.
  const inFlightRef = useRef(false);
  inFlightRef.current = !!activity && !terminal;

  useEffect(() => {
    if (connection.status === 'success') setConnectType(undefined);
  }, [connection.status]);

  useEffect(() => {
    if (!terminal || !activity || activity.settlementReported || settledTx.current === activity.txHash) return;
    settledTx.current = activity.txHash;
    const pair = submittedPair.current ?? activity.pair;
    if (status?.status === 'solved') {
      if (pair) trackSwapCompleted(pair);
      postEmbedEvent({ type: 'sodax:swap', status: 'completed' });
    } else {
      if (pair) trackSwapFailed(pair, status?.abandonedAt ? 'abandoned' : 'settlement_failed');
      postEmbedEvent({ type: 'sodax:swap', status: 'failed' });
    }
    const reported = { ...activity, settlementReported: true };
    setStorageAvailable(saveActivity(reported));
    setActivity(reported);
  }, [terminal, status, activity]);

  const fingerprint = `${input.srcChain}|${input.dstChain}|${input.srcToken?.address}|${input.dstToken?.address}|${input.amount}|${input.partnerFee?.address}|${input.partnerFee?.percentage}|${source?.address}|${destination?.address}`;
  useEffect(() => {
    void fingerprint;
    setPreparation(undefined);
    if (!busyRef.current && !inFlightRef.current) setReview(undefined);
  }, [fingerprint]);

  const speedTier = useCallback(
    (from: XToken, to: XToken) => sodax.swaps.getSwapSpeedTier({ srcToken: from, dstToken: to }).estimatedSeconds,
    [sodax],
  );

  // The full snapshot needs the live list to resolve its tokens. Absent it the record's own summary
  // still states the swap, so the dialog degrades rather than disappearing — see `dismissed` below.
  const restorable = useMemo(() => {
    if (activity) return reviewFromActivity(activity, input.choices, speedTier);
    // The hash is the one field a review does not read, so a pending batch rebuilds the same dialog.
    if (pendingBatch) return reviewFromActivity(activityFromBatch(pendingBatch, ''), input.choices, speedTier);
    return undefined;
  }, [activity, pendingBatch, input.choices, speedTier]);

  // A reload leaves the swap running with no dialog on it, because the record outlives the state
  // that opened one. Rebuild it, once, unless the visitor has already dismissed this swap's dialog.
  // State rather than a ref: it is what decides whether the degraded dialog shows too.
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (!restorable || review || dismissed) return;
    setReview(restorable);
  }, [restorable, review, dismissed]);

  const openConnect = (type: ChainType) => {
    connection.reset();
    setConnectType(type);
  };
  const prepareDestination = async () => {
    const action = destinationGate.action;
    if (!action || destinationGate.busy) return;
    setPreparation(undefined);
    setPreparation(await action.run());
  };
  const openReview = () => {
    if (pendingBatch) {
      resumeReview();
      return;
    }
    setError(undefined);
    if (
      !input.enabled ||
      !input.ready ||
      !signable ||
      !input.srcChain ||
      !input.dstChain ||
      !input.srcToken ||
      !input.dstToken ||
      !source?.address ||
      !destination?.address ||
      input.inputAmount === undefined ||
      input.minOutputAmount === undefined ||
      input.minOutputAmount <= 0n ||
      insufficientBalance ||
      isWrongChain ||
      destinationGate.blocked ||
      activity ||
      busyRef.current
    )
      return;
    setReview({
      intent: {
        srcChainKey: input.srcChain,
        dstChainKey: input.dstChain,
        inputToken: input.srcToken.address,
        outputToken: input.dstToken.address,
        inputAmount: input.inputAmount.toString(),
        minOutputAmount: input.minOutputAmount.toString(),
        srcAddress: source.address,
        dstAddress: destination.address,
        deadline: '0',
        allowPartialFill: false,
        ...(input.partnerFee ? { partnerFee: input.partnerFee } : {}),
        ...sourceExtras(sourceType, source?.publicKey),
      },
      srcChain: input.srcChain,
      dstChain: input.dstChain,
      srcToken: input.srcToken,
      dstToken: input.dstToken,
      estimatedSeconds: speedTier(input.srcToken, input.dstToken),
    });
  };

  const confirm = async () => {
    if (!input.enabled || !review || review.restored || !wallet || busyRef.current || activity || pendingBatch) return;
    busyRef.current = true;
    phaseRef.current = 'checking';
    setPhase('checking');
    setError(undefined);
    let broadcasted = false;
    let batchSent = false;
    // The record as broadcast, so relay acceptance can be written onto it before state settles.
    let broadcastRecord: Activity | undefined;
    postEmbedEvent({ type: 'sodax:swap', status: 'started' });
    try {
      const currentAddress = await wallet.getWalletAddress();
      if (
        currentAddress !== review.intent.srcAddress ||
        source?.address !== review.intent.srcAddress ||
        destination?.address !== review.intent.dstAddress
      ) {
        throw new Error('The connected account changed. Review the swap again.');
      }
      if (destinationGate.blocked) throw new Error('The receiving account is not ready. Review the swap again.');
      const { srcChain: srcChainKey, dstChain: dstChainKey } = review;
      const recordFields = (walletAddress: string, relayData: string, intent: IntentResponseV2) => ({
        srcChainKey,
        dstChainKey,
        srcTokenAddress: review.srcToken.address,
        dstTokenAddress: review.dstToken.address,
        inputAmount: review.intent.inputAmount,
        walletAddress,
        recipient: review.intent.dstAddress,
        summary: `${input.amount} ${review.srcToken.symbol} → ${review.dstToken.symbol}`,
        createdAt: Date.now(),
        intent,
        relayData,
        pair: input.pair,
      });
      await executeSwap(review.intent, {
        api: sodax.api.swaps,
        approve: async body => {
          await approve({ body, walletProvider: wallet });
        },
        approvalStrategy: () =>
          resolveApprovalStrategy({
            srcChainKey,
            walletProvider: wallet,
            allowAccountUpgrade: !upgradeDeclined.current,
          }),
        approveAndSign: async (body, tx, onBatchSent) => {
          const deposit = await evmDeposit(srcChainKey, tx, wallet);
          const { txHash } = await broadcastWithApproval({
            body,
            intentTx: deposit.tx,
            walletProvider: deposit.wallet,
            allowAccountUpgrade: !upgradeDeclined.current,
            onBatchSent,
            // A refused batch comes back to `executeSwap`, whose two-step path re-quotes after the approval.
            fallbackOnRefusal: false,
          });
          return txHash;
        },
        sign: tx => broadcast(srcChainKey, tx, wallet),
        onPhase: next => {
          phaseRef.current = next;
          setPhase(next);
        },
        onBatchSent: ({ batchId, callCount }, submission, intent) => {
          batchSent = true;
          storePendingBatch({
            ...recordFields(submission.walletAddress, submission.relayData, intent),
            batchId,
            callCount,
          });
        },
        onBroadcast: (request, intent) => {
          broadcasted = true;
          broadcastRecord = {
            txHash: request.txHash,
            ...recordFields(request.walletAddress, request.relayData, intent),
          };
          setStorageAvailable(batchSent ? saveBatchActivity(broadcastRecord) : saveActivity(broadcastRecord));
          setActivity(broadcastRecord);
          // A batch that confirmed is an ordinary broadcast now, with its hash on the record.
          if (batchSent) setPendingBatch(undefined);
          postEmbedEvent({ type: 'sodax:swap', status: 'submitted' });
          submittedPair.current = input.pair;
          if (input.pair) trackSwapSubmitted(input.pair);
        },
        onRelayAccepted: () => {
          if (broadcastRecord) markRelaySubmitted(broadcastRecord);
        },
      });
      void balanceQuery.refetch();
    } catch (cause) {
      setError(executionError(cause));
      const unconfirmed = isUnconfirmedBatch(cause);
      // A batch the wallet reports as never included or reverted deposited nothing: it holds nothing.
      if (batchSent && !broadcasted && !unconfirmed) storePendingBatch(undefined);
      if (isUpgradeDeclined(cause)) upgradeDeclined.current = true;
      // An unconfirmed batch may still land, so it is not reported as failed.
      if (unconfirmed) return;
      if (!broadcasted) postEmbedEvent({ type: 'sodax:swap', status: 'failed' });
      if (input.pair) {
        const reason: SwapFailureReason = isUserRejection(cause) ? 'rejected' : phaseRef.current;
        trackSwapFailed(input.pair, reason);
      }
    } finally {
      busyRef.current = false;
      setPhase(undefined);
    }
  };

  // Durable, unlike the error that used to stand in for it: a reload keeps the deposit but loses
  // every in-memory reason it might still need submitting.
  const markRelaySubmitted = (record: Activity) => {
    if (record.relaySubmitted) return;
    const accepted = { ...record, relaySubmitted: true };
    setStorageAvailable(saveActivity(accepted));
    setActivity(accepted);
  };

  const clearActivity = () => {
    if (!terminal) return;
    saveActivity(undefined);
    // A batch kept because its activity could not be saved settles with that activity.
    savePendingBatch(undefined);
    setPendingBatch(undefined);
    setActivity(undefined);
    submittedPair.current = undefined;
    setError(undefined);
    setReview(undefined);
    setDismissed(false);
  };

  // Closable from the moment the deposit is broadcast, never during a step the widget is driving:
  // tracking can stall for reasons neither end controls, and a dialog nobody can dismiss is worse
  // than one left early. Only a settled swap leaves with its record — a failed one keeps its hashes
  // for support, so closing it dismisses rather than deletes, and the form's action asks it back.
  const closeReview = () => {
    if (busyRef.current) return;
    if (solved) {
      clearActivity();
      return;
    }
    if (activity) setDismissed(true);
    setReview(undefined);
  };

  const resumeReview = () => {
    setDismissed(false);
    if ((activity || pendingBatch) && !review && restorable) setReview(restorable);
  };

  // A restored snapshot gives way to the form's own review, current fee included, or closes when the
  // form cannot build one yet.
  const reviewAgain = () => {
    if (busyRef.current) return;
    setReview(undefined);
    openReview();
  };

  const submitRecord = async (record: Activity) => {
    const result = await sodax.api.swaps.submitTx(submissionFor(record));
    if (!result.ok) throw result.error;
    if (!result.value.success) throw new Error('The relay has not accepted this swap yet. Try again shortly.');
    markRelaySubmitted(record);
    await statusQuery.refetch();
  };

  const retrySubmission = async () => {
    if (!activity || busyRef.current || terminal) return;
    busyRef.current = true;
    setPhase('submitting');
    setError(undefined);
    try {
      await submitRecord(activity);
    } catch (cause) {
      setError(executionError(cause));
    } finally {
      busyRef.current = false;
      setPhase(undefined);
    }
  };

  // Asks the wallet again about the held batch. A confirmed one becomes the swap's activity and goes
  // to the relay; one that never landed releases the hold; anything else keeps holding.
  const recheckBatch = async () => {
    if (!pendingBatch || busyRef.current) return;
    busyRef.current = true;
    setPhase('submitting');
    setError(undefined);
    try {
      const check = await checkHeldBatch(pendingBatch, batchWallet, BATCH_RECHECK_TIMEOUT_MS);
      if (check.status === 'connect') {
        setError('Connect the wallet that sent this swap, then check again.');
        openConnect('EVM');
        return;
      }
      if (check.status === 'wrong-account') {
        const sender = pendingBatch.walletAddress;
        setError(`Switch your wallet to ${sender.slice(0, 6)}…${sender.slice(-4)}, the account that sent this swap.`);
        return;
      }
      if (check.status === 'pending') {
        setError('Your wallet still has not confirmed this swap. Check its activity, then try again.');
        return;
      }
      if (check.status === 'failed') {
        storePendingBatch(undefined);
        setError('This swap did not go through, and nothing was deposited. You can review it again.');
        // Reported as `confirm` would have, had the batch failed there: at signing.
        postEmbedEvent({ type: 'sodax:swap', status: 'failed' });
        if (pendingBatch.pair) trackSwapFailed(pendingBatch.pair, 'signing');
        return;
      }
      const recovered = activityFromBatch(pendingBatch, check.txHash);
      setStorageAvailable(saveBatchActivity(recovered));
      setActivity(recovered);
      setPendingBatch(undefined);
      postEmbedEvent({ type: 'sodax:swap', status: 'submitted' });
      submittedPair.current = recovered.pair;
      if (recovered.pair) trackSwapSubmitted(recovered.pair);
      await submitRecord(recovered);
    } catch (cause) {
      setError(executionError(cause));
    } finally {
      busyRef.current = false;
      setPhase(undefined);
    }
  };

  return {
    source,
    destination,
    sourceType,
    destinationType,
    connectType,
    connectors,
    connection,
    openConnect,
    closeConnect: () => setConnectType(undefined),
    disconnect,
    signable,
    balanceText,
    canMax,
    insufficientBalance,
    balanceLoading: balanceQuery.isFetching,
    balanceError: balanceQuery.isError,
    isWrongChain,
    handleSwitchChain,
    destinationGate,
    prepareDestination,
    review,
    openReview,
    confirm,
    pendingBatch,
    held: !!pendingBatch,
    recheckBatch,
    releaseHeld: () => {
      if (busyRef.current) return;
      storePendingBatch(undefined);
      setError(undefined);
      setReview(undefined);
      setDismissed(false);
      // The widget stops tracking it; whether it landed is the wallet's to tell the visitor now.
      postEmbedEvent({ type: 'sodax:swap', status: 'failed' });
    },
    closeReview,
    resumeReview,
    reviewAgain,
    dismissed,
    phase,
    error,
    activity,
    status,
    solved,
    failed,
    terminal,
    storageAvailable,
    retrySubmission,
    statusError: statusQuery.isError,
    refreshStatus: () => statusQuery.refetch(),
    clearActivity,
  };
}

export type Execution = ReturnType<typeof useExecution>;
