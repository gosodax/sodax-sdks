import { SelectChain } from '@/components/swaps-api/SelectChain';
import { PartnerFeeFields, usePartnerFeeDraft } from '@/components/shared/PartnerFeeFields';
import { SelectToken } from '@/components/shared/SelectToken';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { calculateExchangeRate, formatMutationFailureMessage, formatTokenAmount } from '@/lib/utils';
import { parseUnits, formatUnits } from 'viem';
import type {
  BitcoinRawTransaction,
  ChainType,
  CreateIntentParamsV2,
  Hex,
  IBitcoinWalletProvider,
  QuoteRequestV2,
  SpokeChainKey,
  SubmitTxRequestV2,
  SwapTokenV2,
} from '@sodax/dapp-kit';
import BigNumber from 'bignumber.js';
import { ArrowDownUp, ArrowLeftRight, Loader2 } from 'lucide-react';
import React, { type SetStateAction, useEffect, useMemo, useRef, useState } from 'react';
import {
  loadRadfiSession,
  useSodaxContext,
  useNearStorageGate,
  useStellarGate,
  useBitcoinTradingSetup,
  useBalances,
  runApprovalPlan,
  ChainKeys,
  isBitcoinChainKey,
  isStacksChainKey,
} from '@sodax/dapp-kit';
import { useQuery } from '@tanstack/react-query';
import { HOOK_LABELS, resolveAvailableHookKind } from '@/lib/deliveryHooks';
import {
  getXChainType,
  useEvmSwitchChain,
  useWalletProvider,
  useXAccount,
  useXDisconnect,
} from '@sodax/wallet-sdk-react';
import { buildOrderSummary, type Order } from '@/components/swaps/OrderStatus';
import { appendOrder } from '@/lib/orderHistory';
import { loadSwapsApiSelection, saveSwapsApiSelection } from '@/components/swaps-api/lib/lastSelection';
import { toIntentRequest, toXToken } from '@/components/swaps-api/lib/mappers';
import {
  formatSwapsApiError,
  retryUnlessSwapsApiAuthFailure,
  useSwapsApiClient,
} from '@/components/swaps-api/lib/swapsApi';
import { isSignableSwapsApiChain, signAndBroadcastSwapsApiTx } from '@/components/swaps-api/lib/signAndBroadcast';
import { useDebouncedValue } from '@/components/swaps-api/lib/useDebouncedValue';
import { useAppStore } from '@/zustand/useAppStore';
import { BitcoinSetupPanel } from '@/components/bitcoin/BitcoinSetupPanel';

export default function SwapCard({ setOrders }: { setOrders: (value: SetStateAction<Order[]>) => void }) {
  // Chain + token state. Chains and tokens come from the Swaps API token map, so chain keys
  // are plain strings; wallet-layer hooks get them cast to SpokeChainKey.
  const [src, setSrc] = useState<{ chain: string; token: SwapTokenV2 | undefined }>(() => ({
    chain: loadSwapsApiSelection().src?.chain ?? ChainKeys.ARBITRUM_MAINNET,
    token: undefined,
  }));
  const [dst, setDst] = useState<{ chain: string; token: SwapTokenV2 | undefined }>(() => ({
    chain: loadSwapsApiSelection().dst?.chain ?? ChainKeys.POLYGON_MAINNET,
    token: undefined,
  }));
  const srcChainKey = src.chain as SpokeChainKey;
  const dstChainKey = dst.chain as SpokeChainKey;

  const swapsApi = useSwapsApiClient();

  // The delivery hook — if any — the registry accepts for this destination chain + output token.
  // Registry-driven, so a newly registered hook surfaces here without touching this component.
  // NOTE: the API forwards `hook` to the SDK server-side, so resolution happens on the backend and
  // needs a backend whose pinned SDK has this hook registered — see the checkbox hint below.
  const availableHookKind = useMemo(
    () => resolveAvailableHookKind(dstChainKey, dst.token?.address),
    [dstChainKey, dst.token],
  );

  const sourceAccount = useXAccount({ xChainId: srcChainKey });
  const sourceWalletProvider = useWalletProvider({ xChainId: srcChainKey });
  const destAccount = useXAccount({ xChainId: dstChainKey });
  const destWalletProvider = useWalletProvider({ xChainId: dstChainKey });
  const { openWalletModal } = useAppStore();
  const { sodax } = useSodaxContext();

  const [sourceAmount, setSourceAmount] = useState<string>('');
  const [slippage, setSlippage] = useState<string>('0.5');
  const [intentParams, setIntentParams] = useState<CreateIntentParamsV2 | undefined>(undefined);
  // Last-write-wins for the async build: Radix reopens the dialog immediately, so without this a
  // superseded build could land its params over the newer ones the user is actually looking at.
  const buildIdRef = useRef(0);
  const feeDraft = usePartnerFeeDraft();
  const [open, setOpen] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [swapError, setSwapError] = useState<string | null>(null);
  const [nearStorageError, setNearStorageError] = useState<string | null>(null);
  const [stellarError, setStellarError] = useState<string | null>(null);
  const [isApproving, setIsApproving] = useState(false);
  const [isSwapping, setIsSwapping] = useState(false);
  const [deliveryHookEnabled, setDeliveryHookEnabled] = useState(false);
  const [isSourceBitcoinReady, setIsSourceBitcoinReady] = useState(false);
  const [isDestBitcoinReady, setIsDestBitcoinReady] = useState(false);

  // Reset the toggle whenever the resolved hook kind changes (including to/from `undefined`) — the
  // checkbox must never carry an opt-in for a hook the user didn't see. Without this, checking the box
  // for one destination and then switching to a different destination that resolves a different hook
  // kind would silently submit that other hook instead.
  // biome-ignore lint/correctness/useExhaustiveDependencies: availableHookKind is the intentional reset trigger, not a value read in the effect
  useEffect(() => {
    setDeliveryHookEnabled(false);
  }, [availableHookKind]);

  // Supported chains + tokens straight from the Swaps API.
  const { data: tokensByChain } = useQuery({
    queryKey: ['demo', 'swapsApi', 'tokens'],
    queryFn: () => swapsApi.getTokens(),
    retry: retryUnlessSwapsApiAuthFailure,
  });
  const chainList = useMemo(() => Object.keys(tokensByChain ?? {}), [tokensByChain]);

  // Seed tokens once the map arrives — preferring the last-used symbol per chain, else the first.
  useEffect(() => {
    if (!tokensByChain) return;
    const saved = loadSwapsApiSelection();
    const pick = (chain: string, symbol?: string) => {
      const list = tokensByChain[chain];
      return (symbol ? list?.find(t => t.symbol === symbol) : undefined) ?? list?.[0];
    };
    setSrc(prev => (prev.token ? prev : { ...prev, token: pick(prev.chain, saved.src?.tokenSymbol) }));
    setDst(prev => (prev.token ? prev : { ...prev, token: pick(prev.chain, saved.dst?.tokenSymbol) }));
  }, [tokensByChain]);

  // Persist the latest chain/token picks (symbol only) so From/To restore on reload.
  useEffect(() => {
    if (!src.token || !dst.token) return;
    saveSwapsApiSelection({
      src: { chain: src.chain, tokenSymbol: src.token.symbol },
      dst: { chain: dst.chain, tokenSymbol: dst.token.symbol },
    });
  }, [src, dst]);

  const onChangeDirection = () => {
    setSrc(dst);
    setDst(src);
  };

  const onSrcChainChange = (chain: string) => {
    setSrc({ chain, token: tokensByChain?.[chain]?.[0] });
  };

  const onDestChainChange = (chain: string) => {
    setDst({ chain, token: tokensByChain?.[chain]?.[0] });
  };

  // Balance fetching is wallet-layer (not covered by the Swaps API).
  const { data: sourceBalances } = useBalances({
    params: {
      chainKey: srcChainKey,
      tokens: src.token ? [toXToken(src.token)] : [],
      address: sourceAccount.address,
    },
  });
  const sourceTokenBalance = sourceBalances?.[src.token?.address ?? ''] ?? 0n;

  const { data: destBalances } = useBalances({
    params: {
      chainKey: dstChainKey,
      tokens: dst.token ? [toXToken(dst.token)] : [],
      address: destAccount.address,
    },
  });
  const destTokenBalance = destBalances?.[dst.token?.address ?? ''] ?? 0n;

  // Bitcoin trading setup — each side routes through a Bound Exchange (Radfi) trading wallet; the
  // hook is inert unless its chain is Bitcoin.
  const sourceBitcoin = useBitcoinTradingSetup({
    chainKey: srcChainKey,
    walletProvider: sourceWalletProvider,
    address: sourceAccount.address,
  });
  const destBitcoin = useBitcoinTradingSetup({
    chainKey: dstChainKey,
    walletProvider: destWalletProvider,
    address: destAccount.address,
  });

  // Quote via the Swaps API (debounced so we don't hit the endpoint per keystroke).
  const debouncedAmount = useDebouncedValue(sourceAmount);
  const quoteBody = useMemo((): QuoteRequestV2 | undefined => {
    if (!src.token || !dst.token) {
      return undefined;
    }

    if (Number(debouncedAmount) <= 0) {
      return undefined;
    }

    try {
      return {
        tokenSrc: src.token.address,
        tokenSrcChainKey: src.chain,
        tokenDst: dst.token.address,
        tokenDstChainKey: dst.chain,
        amount: parseUnits(debouncedAmount, src.token.decimals).toString(),
        quoteType: 'exact_input',
        // `/swaps/*` has no configured default — omitting this charges nothing, so the quote must
        // carry the same fee the intent will, or the quoted output overstates what lands.
        ...(feeDraft.partnerFee ? { partnerFee: feeDraft.partnerFee } : {}),
      };
    } catch {
      return undefined;
    }
  }, [src.token, dst.token, src.chain, dst.chain, debouncedAmount, feeDraft.partnerFee]);

  // The whole request body is the cache key so every quote input is a cache dimension
  // (QuoteRequestV2 is bigint-free, so React Query's default key hashing handles it).
  const quoteQuery = useQuery({
    queryKey: ['demo', 'swapsApi', 'quote', quoteBody],
    queryFn: () => (quoteBody ? swapsApi.getQuote(quoteBody) : undefined),
    enabled: !!quoteBody,
    retry: retryUnlessSwapsApiAuthFailure,
  });
  const quote = quoteQuery.data;

  const exchangeRate = useMemo(() => {
    return calculateExchangeRate(
      new BigNumber(debouncedAmount),
      new BigNumber(formatUnits(BigInt(quote?.quotedAmount ?? '0'), dst.token?.decimals ?? 0)),
    );
  }, [quote, debouncedAmount, dst.token]);

  // Minimum output (raw units, decimal string) after slippage.
  const minOutputAmount = useMemo(() => {
    return quote?.quotedAmount
      ? new BigNumber(quote.quotedAmount)
          .multipliedBy(new BigNumber(100).minus(new BigNumber(slippage)))
          .div(100)
          .toFixed(0)
      : undefined;
  }, [quote, slippage]);

  /**
   * Which side of a built intent no longer matches the connected wallet, if any.
   *
   * The build-id guard only orders overlapping builds; it cannot stop a wallet-side account switch,
   * which happens outside the dialog and so is not blocked by the modal. Without this, Approve would
   * grant allowance from the new account while the API checked the old one, and Swap would submit the
   * old address with a transaction the new account signed. Derived during render rather than cleared
   * from an effect so the handlers and the buttons can never read different states.
   */
  const staleSnapshotSide = useMemo((): 'source' | 'destination' | undefined => {
    if (!intentParams) return undefined;
    if (intentParams.srcAddress !== sourceAccount.address) return 'source';
    // A disconnected destination wallet cannot match a built dstAddress either.
    const dstAccountAddress = destAccount.address;
    if (!dstAccountAddress) return 'destination';
    // A Bitcoin destination delivers to the Bound trading wallet, never the connected address, so
    // re-derive the same way the build did instead of comparing the account directly.
    const currentDstAddress =
      dst.chain === ChainKeys.BITCOIN_MAINNET
        ? loadRadfiSession(dstAccountAddress)?.tradingAddress
        : dstAccountAddress;
    return intentParams.dstAddress === currentDstAddress ? undefined : 'destination';
  }, [intentParams, sourceAccount.address, destAccount.address, dst.chain]);

  const staleSnapshotMessage = staleSnapshotSide
    ? `The ${staleSnapshotSide} wallet account changed. Close and reopen the swap to rebuild the intent.`
    : undefined;

  const buildIntentParams = async () => {
    // Drop the previous intent before anything else: an aborted build must not leave it live and
    // actionable against wallet state the user has since changed.
    const buildId = ++buildIdRef.current;
    setIntentParams(undefined);

    if (!quote?.quotedAmount || !minOutputAmount) {
      console.error('Quote undefined');
      return;
    }

    if (!src.token || !dst.token) {
      console.error('sourceToken or destToken undefined');
      return;
    }

    if (!sourceAccount.address || !destAccount.address) {
      console.error('source or destination account undefined');
      return;
    }

    // Bitcoin delivery must target the Bound Exchange trading wallet (never the personal
    // wallet). Block when there's no signed-in trading wallet rather than silently
    // delivering to the personal one.
    let dstAddress = destAccount.address;
    if (dst.chain === ChainKeys.BITCOIN_MAINNET) {
      const tradingAddress = loadRadfiSession(destAccount.address)?.tradingAddress;
      if (!tradingAddress) {
        console.error('Bitcoin destination requires a Bound Exchange trading wallet — sign in first');
        return;
      }
      dstAddress = tradingAddress;
    }

    // Deadline anchored to the hub clock, fetched fresh as the intent is built. The client already
    // retries this idempotent call within its own timeout budget, so a failure here is terminal.
    const deadline = await swapsApi
      .getDeadline({ offsetSeconds: 300 })
      .then(response => response.deadline)
      .catch(error => {
        console.warn('Hub deadline unavailable, falling back to client clock:', error);
        return String(Math.floor(Date.now() / 1000) + 300);
      });

    // Source-chain swap extras the Swaps API only needs for specific chain families:
    //  - Stacks:  the signer public key, which a Stacks address can't derive on its own.
    //  - Bitcoin: the Bound Exchange (Radfi) access token for TRADING-mode intents.
    // Both stay undefined for every other source chain.
    const srcPublicKey = isStacksChainKey(srcChainKey) ? sourceAccount.publicKey : undefined;
    const bound = isBitcoinChainKey(srcChainKey)
      ? { accessToken: loadRadfiSession(sourceAccount.address)?.accessToken }
      : undefined;

    if (buildId !== buildIdRef.current) return;

    setIntentParams({
      srcChainKey: src.chain,
      dstChainKey: dst.chain,
      inputToken: src.token.address,
      outputToken: dst.token.address,
      inputAmount: parseUnits(debouncedAmount, src.token.decimals).toString(),
      minOutputAmount,
      deadline,
      allowPartialFill: false,
      srcAddress: sourceAccount.address,
      dstAddress,
      srcPublicKey,
      bound,
      ...(feeDraft.partnerFee ? { partnerFee: feeDraft.partnerFee } : {}),
      // Wire field: the backend forwards it to the SDK, which overrides the on-chain dstAddress with
      // the hook's address and encodes the payload. `dstAddress` above stays the recipient.
      ...(deliveryHookEnabled && availableHookKind ? { hook: { kind: availableHookKind } } : {}),
    });
  };

  // Allowance check via the Swaps API; self-disabled until the dialog builds intentParams.
  const {
    data: allowance,
    isLoading: isAllowanceLoading,
    refetch: refetchAllowance,
  } = useQuery({
    queryKey: [
      'demo',
      'swapsApi',
      'allowance',
      intentParams?.srcChainKey,
      intentParams?.inputToken,
      intentParams?.inputAmount,
      intentParams?.srcAddress,
    ],
    queryFn: () => (intentParams ? swapsApi.checkAllowance(intentParams) : undefined),
    enabled: !!intentParams,
    retry: retryUnlessSwapsApiAuthFailure,
  });
  const hasAllowed = allowance?.valid === true;

  // Whether the dispatcher can sign+broadcast on the selected source chain (see
  // lib/signAndBroadcast.ts for the chains the wallet-provider interfaces can't serve yet).
  // Bitcoin source isn't handled by the wallet-only dispatcher — it routes through the Bound
  // trading-wallet path in handleSwap — but it is still a signable source for the demo.
  const isSourceSignable = isSignableSwapsApiChain(srcChainKey) || getXChainType(srcChainKey) === 'BITCOIN';

  const { isWrongChain, handleSwitchChain } = useEvmSwitchChain({ xChainId: srcChainKey });

  const stellar = useStellarGate({
    dstChainKey,
    token: intentParams?.outputToken,
    amount: intentParams ? BigInt(intentParams.minOutputAmount) : undefined,
    address: destAccount.address,
    walletProvider: destWalletProvider,
  });
  const nearStorage = useNearStorageGate({
    dstChainKey,
    token: intentParams?.outputToken,
    accountId: destAccount.address,
    walletProvider: destWalletProvider,
  });

  const handleApprove = async (): Promise<void> => {
    if (!intentParams || !sourceWalletProvider) {
      console.error('intentParams or sourceWalletProvider undefined');
      return;
    }

    if (staleSnapshotMessage) {
      setApproveError(staleSnapshotMessage);
      return;
    }

    // Every execution step follows the params the plan was built from, not the live selectors.
    const snapshotChainKey = intentParams.srcChainKey as SpokeChainKey;

    setApproveError(null);
    setIsApproving(true);
    try {
      // The API only builds the unsigned transactions; the shared plan runner signs and broadcasts
      // them. It owns the ordering a guarded source token needs — a stale allowance must be zeroed
      // and MINED before the approve is a valid state transition — and it rejects a reverted receipt
      // instead of reading arrival as success.
      const plan = await swapsApi.approve(intentParams);
      await runApprovalPlan({
        plan,
        srcChainKey: snapshotChainKey,
        walletProvider: sourceWalletProvider,
        hookName: 'SwapCard',
      });

      // Confirmation happened client-side, so the allowance query can't know — refetch manually.
      await refetchAllowance();
    } catch (error) {
      setApproveError(formatSwapsApiError(error, 'Approve failed'));
    } finally {
      setIsApproving(false);
    }
  };

  const handleSwap = async (): Promise<void> => {
    if (!intentParams || !sourceWalletProvider || !sourceAccount.address) {
      console.error('intentParams, sourceWalletProvider or sourceAccount undefined');
      return;
    }

    if (staleSnapshotMessage) {
      setSwapError(staleSnapshotMessage);
      return;
    }

    // As in handleApprove: the tx is built from these params, so signing, submission and the order
    // record all follow them rather than the live selectors.
    const snapshotChainKey = intentParams.srcChainKey as SpokeChainKey;
    const snapshotAddress = intentParams.srcAddress;

    setSwapError(null);
    setIsSwapping(true);
    try {
      // 1. The API builds the unsigned create-intent tx + intent + relay data.
      const { tx, intent, relayData } = await swapsApi.createIntent(intentParams);

      // 2. Sign + broadcast on the source chain.
      let spokeTxHash: string;
      if (getXChainType(snapshotChainKey) === 'BITCOIN') {
        // Bitcoin uses a 2-of-2 Bound Exchange trading wallet: the user signs the Bound-built PSBT,
        // then Bound co-signs + broadcasts. This needs the client's Bound session + the relay
        // identity — context the wallet-only dispatcher doesn't have — so route it through the SDK.
        const session = loadRadfiSession(snapshotAddress);
        if (!session?.accessToken) {
          setSwapError('Bitcoin source requires a Bound Exchange trading wallet — sign in first.');
          return;
        }
        spokeTxHash = await sodax.spoke.getSpokeService(ChainKeys.BITCOIN_MAINNET).signAndSubmitRawTransaction({
          rawTx: tx as BitcoinRawTransaction,
          walletProvider: sourceWalletProvider as IBitcoinWalletProvider,
          // The Swaps API types relayData as plain strings; they are hex at runtime.
          relayData: { address: relayData.address as Hex, payload: relayData.payload as Hex },
          accessToken: session.accessToken,
        });
      } else {
        spokeTxHash = await signAndBroadcastSwapsApiTx({
          chainKey: snapshotChainKey,
          tx,
          walletProvider: sourceWalletProvider,
        });
      }

      // 3. Hand the tx back to the API for relay + solver post-execution.
      const request: SubmitTxRequestV2 = {
        txHash: spokeTxHash,
        srcChainKey: intentParams.srcChainKey,
        walletAddress: snapshotAddress,
        intent: toIntentRequest(intent),
        relayData: relayData.payload,
      };
      await swapsApi.submitTx(request);

      setOrders(prev =>
        appendOrder(prev, {
          mode: 'submit-tx',
          txHash: spokeTxHash,
          // Status polling keys on this, so it must be the chain the tx actually went to.
          srcChainKey: intentParams.srcChainKey,
          createdAt: Date.now(),
          summary: buildOrderSummary(
            src,
            dst,
            debouncedAmount,
            quote?.quotedAmount ? BigInt(quote.quotedAmount) : undefined,
          ),
        }),
      );
      setOpen(false);
    } catch (error) {
      setSwapError(formatSwapsApiError(error, 'Swap failed'));
    } finally {
      setIsSwapping(false);
    }
  };

  const disconnect = useXDisconnect();
  const handleSourceAccountDisconnect = () => {
    disconnect({ xChainType: getXChainType(srcChainKey) as ChainType });
  };

  const handleDestAccountDisconnect = () => {
    disconnect({ xChainType: getXChainType(dstChainKey) as ChainType });
  };

  const handleActivateStellarAccount = async () => {
    const result = await stellar.activate();
    if (result && !result.ok) {
      setStellarError(formatMutationFailureMessage(result.error, 'Stellar account activation failed'));
      return;
    }
    setStellarError(null);
  };

  const handleRequestTrustline = async () => {
    const result = await stellar.requestTrustline();
    if (result && !result.ok) {
      setStellarError(formatMutationFailureMessage(result.error, 'Trustline request failed'));
      return;
    }
    setStellarError(null);
  };

  const handleRegisterNearStorage = async () => {
    const result = await nearStorage.registerStorage();
    if (result && !result.ok) {
      setNearStorageError(formatMutationFailureMessage(result.error, 'Storage registration failed'));
      return;
    }
    setNearStorageError(null);
  };

  return (
    <Card className="w-full max-w-lg mx-auto">
      <CardHeader>
        <CardTitle className="text-xl sm:text-2xl font-bold text-center">Cross-Chain Swap (Swaps API)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <SelectChain
            chainList={chainList}
            value={src.chain}
            setChain={onSrcChainChange}
            placeholder={'Select source chain'}
            id={'source-chain'}
            label={'From'}
          />
        </div>
        <div className="flex space-x-2">
          <div className="grow">
            <Input
              type="number"
              placeholder="0.0"
              value={sourceAmount}
              onChange={e => setSourceAmount(e.target.value)}
            />
          </div>
          <SelectToken
            tokens={tokensByChain?.[src.chain] ?? []}
            value={src.token?.symbol}
            onSelect={token => setSrc(prev => ({ ...prev, token }))}
            className="w-[110px]"
          />
        </div>
        <div className="mix-blend-multiply text-black text-(length:--body-comfortable) font-medium flex gap-1">
          <span>Balance:</span>
          <span className="inline">
            {formatTokenAmount(
              src.chain === ChainKeys.BITCOIN_MAINNET && sourceBitcoin.tradingBalance
                ? sourceBitcoin.tradingBalance.btcSatoshi
                : sourceTokenBalance,
              src.token?.decimals ?? 0,
              5,
            )}
          </span>
        </div>
        <div className="grow">
          <Label htmlFor="fromAddress">Source address</Label>
          <div className="flex items-center gap-2">
            <Input id="fromAddress" type="text" placeholder="" value={sourceAccount.address || ''} disabled={true} />
            {sourceAccount.address ? (
              <Button onClick={handleSourceAccountDisconnect}>Disconnect</Button>
            ) : (
              <Button onClick={openWalletModal}>Connect</Button>
            )}
          </div>
        </div>

        {sourceBitcoin.wallet && (
          <BitcoinSetupPanel
            walletProvider={sourceBitcoin.wallet}
            onReadyChange={setIsSourceBitcoinReady}
            nativeBalance={sourceTokenBalance}
          />
        )}

        {!isSourceSignable && (
          <div className="text-amber-600 text-sm wrap-anywhere">
            Source-chain signing for {src.chain} is not yet supported by the wallet-provider interfaces — see
            components/swaps-api/lib/signAndBroadcast.ts.
          </div>
        )}

        <div className="flex justify-center">
          <Button variant="outline" size="icon" onClick={() => onChangeDirection()}>
            <ArrowDownUp className="h-4 w-4" />
          </Button>
        </div>
        <div className="space-y-2">
          <SelectChain
            chainList={chainList}
            value={dst.chain}
            setChain={onDestChainChange}
            placeholder={'Select destination chain'}
            id={'dest-chain'}
            label={'To'}
          />
        </div>
        <div className="flex space-x-2">
          <div className="grow">
            <Input
              type="number"
              placeholder="0.0"
              value={quote ? formatUnits(BigInt(quote.quotedAmount), dst.token?.decimals ?? 0) : ''}
              readOnly
            />
          </div>
          <SelectToken
            tokens={tokensByChain?.[dst.chain] ?? []}
            value={dst.token?.symbol}
            onSelect={token => setDst(prev => ({ ...prev, token }))}
            className="w-[110px]"
          />
        </div>
        <div className="mix-blend-multiply text-black text-(length:--body-comfortable) font-medium flex gap-1">
          <span>Balance:</span>
          <span className="inline">
            {formatTokenAmount(
              dst.chain === ChainKeys.BITCOIN_MAINNET && destBitcoin.tradingBalance
                ? destBitcoin.tradingBalance.btcSatoshi
                : destTokenBalance,
              dst.token?.decimals ?? 0,
              4,
            )}
          </span>
        </div>
        <div className="grow">
          <Label htmlFor="toAddress">Destination address</Label>
          <div className="flex items-center gap-2">
            <Input
              id="toAddress"
              type="text"
              value={
                dst.chain === ChainKeys.BITCOIN_MAINNET && destAccount.address
                  ? loadRadfiSession(destAccount.address)?.tradingAddress || destAccount.address
                  : destAccount.address || ''
              }
              placeholder=""
              disabled={true}
            />
            {destAccount.address ? (
              <Button onClick={handleDestAccountDisconnect}>Disconnect</Button>
            ) : (
              <Button onClick={openWalletModal}>Connect</Button>
            )}
          </div>
        </div>

        {destBitcoin.wallet && (
          <BitcoinSetupPanel
            walletProvider={destBitcoin.wallet}
            onReadyChange={setIsDestBitcoinReady}
            nativeBalance={destTokenBalance}
            isDestination
          />
        )}

        <PartnerFeeFields draft={feeDraft} unsetBehavior="charge no fee" />
      </CardContent>
      <CardFooter className="flex flex-col space-y-4">
        <div className="w-full text-sm text-muted-foreground">
          <div className="flex justify-between items-center gap-2">
            <span>Exchange Rate</span>
            <span className="text-right">
              1 {src.token?.symbol} ≈ {exchangeRate.toString()} {dst.token?.symbol}
            </span>
          </div>
          <div className="flex justify-between items-center gap-2">
            <span>Slippage:</span>
            <div className="flex items-center gap-2">
              <Input type="number" value={slippage} onChange={e => setSlippage(e.target.value)} />
              <span>%</span>
            </div>
          </div>

          <div className="flex justify-between items-center gap-2">
            <span>Minimum Output Amount</span>
            <span className="text-right">
              {minOutputAmount ? formatUnits(BigInt(minOutputAmount), dst.token?.decimals ?? 0) : '0'}{' '}
              {dst.token?.symbol}
            </span>
          </div>
        </div>

        {availableHookKind && (
          <div className="flex items-center gap-2 w-full">
            <label htmlFor="swaps-api-delivery-hook-toggle" className="text-sm font-medium cursor-pointer">
              {HOOK_LABELS[availableHookKind]}
            </label>
            <input
              id="swaps-api-delivery-hook-toggle"
              type="checkbox"
              checked={deliveryHookEnabled}
              onChange={e => setDeliveryHookEnabled(e.target.checked)}
              className="h-4 w-4 cursor-pointer"
            />
          </div>
        )}

        <div className="wrap-anywhere">
          {quoteQuery.error && (
            <div className="text-red-500">{formatSwapsApiError(quoteQuery.error, 'Quote failed')}</div>
          )}
        </div>

        <Dialog
          open={open}
          onOpenChange={(nextOpen): void => {
            setOpen(nextOpen);
            if (nextOpen) {
              setApproveError(null);
              setSwapError(null);
            }
          }}
        >
          <DialogTrigger asChild>
            <Button variant="outline" onClick={() => buildIntentParams()} disabled={!!feeDraft.error}>
              Swap
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Swaps API Intent Order</DialogTitle>
              <DialogDescription>See details of intent order.</DialogDescription>
            </DialogHeader>
            <div className="">
              <div className="flex flex-col wrap-anywhere">
                <div>
                  inputToken: {intentParams?.inputToken} on {intentParams?.srcChainKey}
                </div>
                <div>
                  outputToken: {intentParams?.outputToken} on {intentParams?.dstChainKey}
                </div>
                <div>
                  inputAmount: {formatUnits(BigInt(intentParams?.inputAmount ?? '0'), src.token?.decimals ?? 0)}
                </div>
                <div>deadline: {new Date(Number(intentParams?.deadline) * 1000).toLocaleString()}</div>
                <div>allowPartialFill: {intentParams?.allowPartialFill.toString()}</div>
                <div>srcAddress: {intentParams?.srcAddress}</div>
                <div>dstAddress: {intentParams?.dstAddress}</div>
                <div>
                  minOutputAmount: {formatUnits(BigInt(intentParams?.minOutputAmount ?? '0'), dst.token?.decimals ?? 0)}
                </div>
                {!isSourceSignable && (
                  <div className="text-amber-600">
                    Source-chain signing for {src.chain} is not yet supported by the wallet-provider interfaces.
                  </div>
                )}
                {stellar.needsActivation && (
                  <div className="text-red-500">
                    Destination Stellar account does not exist yet — activate it to proceed. SODAX sponsors the reserve,
                    so this is free.
                  </div>
                )}
                {stellar.needsFunding && (
                  <div className="text-red-500">
                    Destination Stellar account holds no XLM, so it cannot pay for a trustline. Send it some XLM first —
                    receiving XLM needs no trustline.
                  </div>
                )}
                {stellar.needsTrustline && (
                  <div className="text-red-500">Insufficient Stellar trustline (request trustline to proceed)</div>
                )}
                {stellar.checkFailed && (
                  <div className="text-red-500">
                    Couldn't check the destination Stellar account, so the swap is on hold
                    {stellar.error ? `: ${stellar.error.message}` : ''}
                  </div>
                )}
                {nearStorage.needsRegistration && (
                  <div className="text-red-500">
                    Recipient is not storage-registered for this token on NEAR (register storage to proceed)
                  </div>
                )}
                {staleSnapshotMessage ? <div className="text-red-500 text-sm">{staleSnapshotMessage}</div> : null}
                {approveError ? <div className="text-red-500 text-sm">{approveError}</div> : null}
                {swapError ? <div className="text-red-500 text-sm">{swapError}</div> : null}
                {nearStorageError ? <div className="text-red-500 text-sm">{nearStorageError}</div> : null}
                {stellarError ? <div className="text-red-500 text-sm">{stellarError}</div> : null}
              </div>
            </div>
            <DialogFooter>
              <Button
                className="w-full"
                type="button"
                variant="default"
                onClick={handleApprove}
                disabled={
                  !intentParams ||
                  !!staleSnapshotMessage ||
                  !isSourceSignable ||
                  isWrongChain ||
                  isAllowanceLoading ||
                  hasAllowed ||
                  isApproving
                }
              >
                {isApproving ? 'Approving...' : hasAllowed ? 'Approved' : 'Approve'}
              </Button>

              {isWrongChain && (
                <Button className="w-full" type="button" variant="default" onClick={handleSwitchChain}>
                  Switch Chain
                </Button>
              )}

              {!isWrongChain &&
                (intentParams ? (
                  <Button
                    className="w-full"
                    onClick={handleSwap}
                    disabled={
                      !!staleSnapshotMessage ||
                      !isSourceSignable ||
                      !hasAllowed ||
                      isSwapping ||
                      !!feeDraft.error ||
                      (src.chain === ChainKeys.BITCOIN_MAINNET && !isSourceBitcoinReady) ||
                      (dst.chain === ChainKeys.BITCOIN_MAINNET && !isDestBitcoinReady) ||
                      stellar.blocksAction ||
                      nearStorage.blocksAction
                    }
                  >
                    <ArrowLeftRight className="mr-2 h-4 w-4" /> {isSwapping ? 'Swapping...' : 'Swap'}
                  </Button>
                ) : (
                  <span>Preparing intent order...</span>
                ))}
              {stellar.isStellar && stellar.isChecking && <span>Checking Stellar account...</span>}
              {stellar.needsActivation && (
                <Button className="w-full" onClick={handleActivateStellarAccount} disabled={stellar.isActivating}>
                  {stellar.isActivating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Activating...
                    </>
                  ) : (
                    'Activate Stellar Account'
                  )}
                </Button>
              )}
              {stellar.needsTrustline && (
                <Button className="w-full" onClick={handleRequestTrustline} disabled={stellar.isRequestingTrustline}>
                  {stellar.isRequestingTrustline ? 'Requesting...' : 'Request Trustline'}
                </Button>
              )}
              {stellar.checkFailed && (
                <Button className="w-full" onClick={stellar.retry} disabled={stellar.isChecking}>
                  {stellar.isChecking ? 'Rechecking...' : 'Retry Stellar Check'}
                </Button>
              )}
              {nearStorage.isNear && (nearStorage.isChecking || nearStorage.needsRegistration) && (
                <Button
                  className="w-full"
                  onClick={handleRegisterNearStorage}
                  disabled={nearStorage.isChecking || nearStorage.isRegistering}
                >
                  {nearStorage.isChecking ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Checking storage...
                    </>
                  ) : nearStorage.isRegistering ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Registering...
                    </>
                  ) : (
                    'Register Storage'
                  )}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardFooter>
    </Card>
  );
}
