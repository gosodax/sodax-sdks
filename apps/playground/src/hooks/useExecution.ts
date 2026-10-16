import {
  baseChainInfo,
  ChainKeys,
  spokeChainConfig,
  isNativeToken,
  useBalances,
  useNearStorageGate,
  useSodaxContext,
  useStellarGate,
  useSwapsApiApproveAndBroadcast,
  useSwapsApiSubmitTxStatus,
  type ChainKey,
  type ChainType,
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
import { loadActivity, saveActivity, submissionFor, type Activity } from '../lib/activity';
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
  executeSwap,
  executionError,
  isUserRejection,
  sourceExtras,
  type ExecutionPhase,
} from '../lib/execution';

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
  const restorable = useMemo(
    () => (activity ? reviewFromActivity(activity, input.choices, speedTier) : undefined),
    [activity, input.choices, speedTier],
  );

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
    if (!input.enabled || !review || !wallet || busyRef.current || activity) return;
    busyRef.current = true;
    phaseRef.current = 'checking';
    setPhase('checking');
    setError(undefined);
    let broadcasted = false;
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
      await executeSwap(review.intent, {
        api: sodax.api.swaps,
        approve: async body => {
          await approve({ body, walletProvider: wallet });
        },
        sign: tx => broadcast(srcChainKey, tx, wallet),
        onPhase: next => {
          phaseRef.current = next;
          setPhase(next);
        },
        onBroadcast: (request, intent) => {
          broadcasted = true;
          broadcastRecord = {
            txHash: request.txHash,
            srcChainKey,
            dstChainKey,
            srcTokenAddress: review.srcToken.address,
            dstTokenAddress: review.dstToken.address,
            inputAmount: review.intent.inputAmount,
            walletAddress: review.intent.srcAddress,
            recipient: review.intent.dstAddress,
            summary: `${input.amount} ${review.srcToken.symbol} → ${review.dstToken.symbol}`,
            createdAt: Date.now(),
            intent,
            relayData: request.relayData,
            pair: input.pair,
          };
          setStorageAvailable(saveActivity(broadcastRecord));
          setActivity(broadcastRecord);
          postEmbedEvent({ type: 'sodax:swap', status: 'submitted' });
          if (input.pair) {
            submittedPair.current = input.pair;
            trackSwapSubmitted(input.pair);
          }
        },
        onRelayAccepted: () => {
          if (broadcastRecord) markRelaySubmitted(broadcastRecord);
        },
      });
      void balanceQuery.refetch();
    } catch (cause) {
      setError(executionError(cause));
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
    setActivity(undefined);
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
    if (activity && !review && restorable) setReview(restorable);
  };

  const retrySubmission = async () => {
    if (!activity || busyRef.current || terminal) return;
    busyRef.current = true;
    setPhase('submitting');
    setError(undefined);
    try {
      const result = await sodax.api.swaps.submitTx(submissionFor(activity));
      if (!result.ok) throw result.error;
      if (!result.value.success) throw new Error('The relay has not accepted this swap yet. Try again shortly.');
      markRelaySubmitted(activity);
      await statusQuery.refetch();
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
    closeReview,
    resumeReview,
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
