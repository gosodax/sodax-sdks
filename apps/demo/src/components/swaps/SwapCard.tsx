import { SelectChain } from '@/components/swaps/SelectChain';
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
import BigNumber from 'bignumber.js';
import { ArrowDownUp, ArrowLeftRight, Loader2 } from 'lucide-react';
import React, { type SetStateAction, useEffect, useMemo, useState } from 'react';
import {
  useQuote,
  useSwapAllowance,
  useSwapApprove,
  useSwap,
  useStellarGate,
  useSodaxContext,
  loadRadfiSession,
  useTradingWalletBalance,
  useBalances,
  useNearStorageGate,
  getSupportedSolverTokens,
  getStagingSolverTokens,
  type CreateIntentParams,
  type SolverIntentQuoteRequest,
  type GetWalletProviderType,
  type SpokeChainKey,
  type XToken,
  type ChainType,
  ChainKeys,
} from '@sodax/dapp-kit';
import {
  getXChainType,
  useEvmSwitchChain,
  useXAccount,
  useXDisconnect,
  useWalletProvider,
} from '@sodax/wallet-sdk-react';
import type { Order } from '@/components/swaps/OrderStatus';
import { DEFAULT_SELECTED_CHAIN, SolverEnv, useAppStore } from '@/zustand/useAppStore';
import { BitcoinSetupPanel } from '@/components/bitcoin/BitcoinSetupPanel';
import { loadLastSelection, saveLastSelection } from '@/lib/lastSelection';
import { appendOrder } from '@/lib/orderHistory';
import { buildOrderSummary } from '@/components/swaps/OrderStatus';
import { HOOK_LABELS, resolveAvailableHookKind, toHookRequest } from '@/lib/deliveryHooks';

export default function SwapCard({ setOrders }: { setOrders: (value: SetStateAction<Order[]>) => void }) {
  const { sodax } = useSodaxContext();
  //chain and account states — restore last picked chain/token from localStorage, falling back to defaults
  const [src, setSrc] = useState<{ chain: SpokeChainKey; token: XToken }>(
    () =>
      loadLastSelection().src ?? {
        chain: DEFAULT_SELECTED_CHAIN,
        token: getSupportedSolverTokens(DEFAULT_SELECTED_CHAIN)[0],
      },
  );
  const [dst, setDst] = useState<{ chain: SpokeChainKey; token: XToken }>(
    () =>
      loadLastSelection().dst ?? {
        chain: ChainKeys.POLYGON_MAINNET,
        token: getSupportedSolverTokens(ChainKeys.POLYGON_MAINNET)[0],
      },
  );

  // Persist the latest chain/token picks (symbol only) so they restore on reload.
  // Skip while a chain has no solver-supported token yet (e.g. Hedera in production/dev) —
  // src.token/dst.token is undefined right after such a chain switch.
  useEffect(() => {
    if (src.token && dst.token) {
      saveLastSelection(src, dst);
    }
  }, [src, dst]);
  const sourceAccount = useXAccount({ xChainId: src.chain });
  const sourceWalletProvider = useWalletProvider({ xChainId: src.chain });
  const destAccount = useXAccount({ xChainId: dst.chain });
  const destWalletProvider = useWalletProvider({ xChainId: dst.chain });
  const { openWalletModal, solverEnvironment } = useAppStore();
  // Staging solver supports the production tokens PLUS the staging-only ones (getStagingSolverTokens);
  // production/dev expose only the production set. Drive the token dropdowns off the selected env tab.
  const getSolverTokens = useMemo(
    () => (solverEnvironment === SolverEnv.Staging ? getStagingSolverTokens : getSupportedSolverTokens),
    [solverEnvironment],
  );
  const { mutateAsync: swap } = useSwap();
  const [sourceAmount, setSourceAmount] = useState<string>('');
  const [intentOrderPayload, setIntentOrderPayload] = useState<CreateIntentParams | undefined>(undefined);
  const { data: hasAllowed, isLoading: isAllowanceLoading } = useSwapAllowance({
    params: {
      payload: intentOrderPayload,
      srcChainKey: src.chain,
      walletProvider: sourceWalletProvider,
    },
  });
  const { mutateAsyncSafe: approve, isPending: isApproving } = useSwapApprove();
  const supportedSpokeChains = sodax.config.getSupportedSpokeChains();
  // Keep amount undefined until the payload exists; 0n disables the trustline query.
  const stellar = useStellarGate({
    dstChainKey: dst.chain,
    token: intentOrderPayload?.outputToken,
    amount: intentOrderPayload ? BigInt(intentOrderPayload.minOutputAmount) : undefined,
    address: destAccount.address,
    walletProvider: destWalletProvider,
  });
  const nearStorage = useNearStorageGate({
    dstChainKey: dst.chain,
    token: intentOrderPayload?.outputToken,
    accountId: destAccount.address,
    walletProvider: destWalletProvider,
  });
  const [open, setOpen] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [swapError, setSwapError] = useState<string | null>(null);
  const [nearStorageError, setNearStorageError] = useState<string | null>(null);
  const [stellarError, setStellarError] = useState<string | null>(null);
  const [slippage, setSlippage] = useState<string>('0.5');
  const [deliveryHookEnabled, setDeliveryHookEnabled] = useState(false);
  const [isBitcoinReady, setIsBitcoinReady] = useState(false);
  const [isDestBitcoinReady, setIsDestBitcoinReady] = useState(false);

  // The delivery hook — if any — that the registry accepts for this destination chain + output token
  // (HyperCore on HyperEVM+USDC, Flint on Ethereum+USDC today). Resolved from the registry rather than
  // pinned to one kind, so a newly registered hook surfaces here without touching this component.
  const availableHookKind = useMemo(
    () => resolveAvailableHookKind(dst.chain, dst.token?.address),
    [dst.chain, dst.token],
  );

  // Reset the toggle whenever the resolved hook kind changes (including to/from `undefined`) — the
  // checkbox must never carry an opt-in for a hook the user didn't see. Without this, checking the box
  // for one destination and then switching to a different destination that resolves a different hook
  // kind would silently submit that other hook instead.
  // biome-ignore lint/correctness/useExhaustiveDependencies: availableHookKind is the intentional reset trigger, not a value read in the effect
  useEffect(() => {
    setDeliveryHookEnabled(false);
  }, [availableHookKind]);

  const onChangeDirection = () => {
    setSrc(dst);
    setDst(src);
  };

  const onSrcChainChange = (chainId: SpokeChainKey) => {
    setSrc({ chain: chainId, token: getSolverTokens(chainId)[0] });
  };

  const onDestChainChange = (chainId: SpokeChainKey) => {
    setDst({ chain: chainId, token: getSolverTokens(chainId)[0] });
  };

  // Balance fetching- Fetch source token balance for the connected wallet
  const { data: sourceBalances } = useBalances({
    params: {
      chainKey: src.chain,
      tokens: src.token ? [src.token] : [],
      address: sourceAccount.address,
    },
  });
  const sourceTokenBalance = sourceBalances?.[src.token?.address ?? ''] ?? 0n;

  // Fetch destination token balance for the connected wallet
  const { data: destBalances } = useBalances({
    params: {
      chainKey: dst.chain,
      tokens: dst.token ? [dst.token] : [],
      address: destAccount.address,
    },
  });
  const destTokenBalance = destBalances?.[dst.token?.address ?? ''] ?? 0n;

  // Bitcoin trading wallet balances
  const sourceTradingAddress =
    src.chain === ChainKeys.BITCOIN_MAINNET && sourceAccount.address
      ? loadRadfiSession(sourceAccount.address)?.tradingAddress
      : undefined;
  const destTradingAddress =
    dst.chain === ChainKeys.BITCOIN_MAINNET && destAccount.address
      ? loadRadfiSession(destAccount.address)?.tradingAddress
      : undefined;
  const sourceBitcoinWallet =
    src.chain === ChainKeys.BITCOIN_MAINNET
      ? (sourceWalletProvider as GetWalletProviderType<typeof ChainKeys.BITCOIN_MAINNET> | undefined)
      : undefined;
  const destBitcoinWallet =
    dst.chain === ChainKeys.BITCOIN_MAINNET
      ? (destWalletProvider as GetWalletProviderType<typeof ChainKeys.BITCOIN_MAINNET> | undefined)
      : undefined;
  const { data: srcTradingBal } = useTradingWalletBalance({
    params: { walletProvider: sourceBitcoinWallet, tradingAddress: sourceTradingAddress },
  });
  const { data: destTradingBal } = useTradingWalletBalance({
    params: { walletProvider: destBitcoinWallet, tradingAddress: destTradingAddress },
  });

  const payload = useMemo(() => {
    if (!src.token || !dst.token) {
      return undefined;
    }

    if (Number(sourceAmount) <= 0) {
      return undefined;
    }

    return {
      token_src: src.token.address,
      token_src_blockchain_id: src.chain,
      token_dst: dst.token.address,
      token_dst_blockchain_id: dst.chain,
      amount: parseUnits(sourceAmount, src.token.decimals),
      quote_type: 'exact_input',
    } satisfies SolverIntentQuoteRequest;
  }, [src.token, dst.token, src.chain, dst.chain, sourceAmount]);

  const quoteQuery = useQuote({ params: { payload } });

  const quote = useMemo(() => {
    if (quoteQuery.data?.ok) {
      return quoteQuery.data.value;
    }

    return undefined;
  }, [quoteQuery]);

  const exchangeRate = useMemo(() => {
    return calculateExchangeRate(
      new BigNumber(sourceAmount),
      new BigNumber(formatUnits(quote?.quoted_amount ?? 0n, dst.token?.decimals ?? 0)),
    );
  }, [quote, sourceAmount, dst.token]);

  const minOutputAmount = useMemo(() => {
    return quote?.quoted_amount
      ? new BigNumber(quote?.quoted_amount).multipliedBy(new BigNumber(100).minus(new BigNumber(slippage))).div(100)
      : undefined;
  }, [quote, slippage]);

  const speedTier = useMemo(
    () =>
      src.token && dst.token ? sodax.swaps.getSwapSpeedTier({ srcToken: src.token, dstToken: dst.token }) : undefined,
    [sodax, src.token, dst.token],
  );

  const onSourceAmountChange = (value: string) => {
    setSourceAmount(value);
  };

  const createIntentOrderPayload = async () => {
    if (!quote) {
      console.error('Quote undefined');
      return;
    }

    if (!src.token || !dst.token) {
      console.error('sourceToken or destToken undefined');
      return;
    }

    if (!minOutputAmount) {
      console.error('minOutputAmount undefined');
      return;
    }

    if (!sourceAccount.address) {
      console.error('sourceAccount.address undefined');
      return;
    }

    if (!destAccount.address) {
      console.error('destAccount.address undefined');
      return;
    }

    if (!sourceWalletProvider) {
      console.error('sourceWalletProvider undefined');
      return;
    }

    // Bitcoin delivery must target the Bound Exchange trading wallet (never the personal wallet). Block
    // when there's no signed-in trading wallet rather than silently delivering to the personal one.
    let dstAddress = destAccount.address;
    if (dst.chain === ChainKeys.BITCOIN_MAINNET) {
      const tradingAddress = loadRadfiSession(destAccount.address)?.tradingAddress;
      if (!tradingAddress) {
        console.error('Bitcoin destination requires a Bound Exchange trading wallet — sign in first');
        return;
      }
      dstAddress = tradingAddress;
    }

    // Delivery hook: select it by kind and keep dstAddress as the recipient (the user's own address on
    // the destination chain). The SDK resolves the hook's deployed address and encodes the payload.
    const hookRequest = deliveryHookEnabled && availableHookKind ? toHookRequest(availableHookKind) : undefined;

    const createIntentParams = {
      inputToken: src.token.address, // The address of the input token on hub chain
      outputToken: dst.token.address, // The address of the output token on hub chain
      inputAmount: parseUnits(sourceAmount, src.token.decimals), // The amount of input tokens
      minOutputAmount: BigInt(minOutputAmount.toFixed(0)), // The minimum amount of output tokens to accept
      deadline: BigInt(Math.floor(Date.now() / 1000) + 60 * 5), // Optional timestamp after which intent expires (0 = no deadline)
      allowPartialFill: false, // Whether the intent can be partially filled
      srcChainKey: src.chain, // Chain ID where input tokens originate
      dstChainKey: dst.chain, // Chain ID where output tokens should be delivered
      srcAddress: await sourceWalletProvider.getWalletAddress(), // Source address (original address on spoke chain)
      dstAddress, // Recipient — Bitcoin: trading wallet; others: personal wallet (hook keeps this as recipient)
      solver: '0x0000000000000000000000000000000000000000', // Optional specific solver address (address(0) = any solver)
      data: '0x', // Additional arbitrary data
      // When set, the SDK routes the output through this hook (overrides dstAddress, encodes deliveryData).
      hook: hookRequest,
    } satisfies CreateIntentParams;

    setIntentOrderPayload(createIntentParams);
  };

  const { isWrongChain, handleSwitchChain } = useEvmSwitchChain({ xChainId: src.chain });

  const handleSwap = async (intentOrderPayload: CreateIntentParams) => {
    setOpen(false);
    console.log('intentOrderPayload', intentOrderPayload);
    console.log('wallet provider', sourceWalletProvider);
    if (!sourceWalletProvider) return;
    setSwapError(null);
    try {
      const swapResponse = await swap({ params: intentOrderPayload, walletProvider: sourceWalletProvider });
      const { solverExecutionResponse: response, intent, intentDeliveryInfo } = swapResponse;
      setOrders(prev =>
        appendOrder(prev, {
          mode: 'solver',
          intentHash: response.intent_hash,
          orderId: intent.intentId.toString(),
          dstTxHash: intentDeliveryInfo.dstTxHash as string,
          srcTxHash: intentDeliveryInfo.srcTxHash,
          srcChainKey: intentDeliveryInfo.srcChainKey,
          statusEndpoint: sodax.config.solver.solverApiEndpoint,
          createdAt: Date.now(),
          summary: buildOrderSummary(src, dst, sourceAmount, quote?.quoted_amount),
        }),
      );
    } catch (error) {
      console.error('Error creating and submitting intent:', error);
      setSwapError(formatMutationFailureMessage(error, 'Swap failed'));
    }
  };

  const disconnect = useXDisconnect();
  const handleSourceAccountDisconnect = () => {
    disconnect({ xChainType: getXChainType(src.chain) as ChainType });
  };

  const handleDestAccountDisconnect = () => {
    disconnect({ xChainType: getXChainType(dst.chain) as ChainType });
  };

  const handleApprove = async (): Promise<void> => {
    if (!intentOrderPayload || !sourceWalletProvider) {
      console.error('intentOrderPayload or sourceWalletProvider undefined');
      return;
    }

    const result = await approve({ params: intentOrderPayload, walletProvider: sourceWalletProvider });
    if (!result.ok) {
      setApproveError(formatMutationFailureMessage(result.error, 'Approve failed'));
      return;
    }
    setApproveError(null);
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
        <CardTitle className="text-xl sm:text-2xl font-bold text-center">Cross-Chain Swap (SDK)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <SelectChain
            chainList={supportedSpokeChains}
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
              onChange={e => onSourceAmountChange(e.target.value)}
            />
          </div>
          <SelectToken
            tokens={getSolverTokens(src.chain)}
            value={src.token?.symbol}
            onSelect={token => setSrc(prev => ({ ...prev, token }))}
            className="w-[110px]"
          />
        </div>
        <div className="mix-blend-multiply text-black text-(length:--body-comfortable) font-medium flex gap-1">
          <span>Balance:</span>
          <span className="inline">
            {formatTokenAmount(
              src.chain === ChainKeys.BITCOIN_MAINNET && srcTradingBal ? srcTradingBal.btcSatoshi : sourceTokenBalance,
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

        {sourceBitcoinWallet && (
          <BitcoinSetupPanel
            walletProvider={sourceBitcoinWallet}
            onReadyChange={setIsBitcoinReady}
            nativeBalance={sourceTokenBalance}
          />
        )}

        <div className="flex justify-center">
          <Button variant="outline" size="icon" onClick={() => onChangeDirection()}>
            <ArrowDownUp className="h-4 w-4" />
          </Button>
        </div>
        <div className="space-y-2">
          <SelectChain
            chainList={supportedSpokeChains}
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
              value={quote ? formatUnits(quote?.quoted_amount, dst.token?.decimals ?? 0) : ''}
              readOnly
            />
          </div>
          <SelectToken
            tokens={getSolverTokens(dst.chain)}
            value={dst.token?.symbol}
            onSelect={token => setDst(prev => ({ ...prev, token }))}
            className="w-[110px]"
          />
        </div>
        <div className="mix-blend-multiply text-black text-(length:--body-comfortable) font-medium flex gap-1">
          <span>Balance:</span>
          <span className="inline">
            {formatTokenAmount(
              dst.chain === ChainKeys.BITCOIN_MAINNET && destTradingBal ? destTradingBal.btcSatoshi : destTokenBalance,
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

        {destBitcoinWallet && (
          <BitcoinSetupPanel
            walletProvider={destBitcoinWallet}
            onReadyChange={setIsDestBitcoinReady}
            nativeBalance={destTokenBalance}
            isDestination
          />
        )}
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
              {minOutputAmount ? formatUnits(BigInt(minOutputAmount.toFixed(0)), dst.token?.decimals ?? 0) : '0'}{' '}
              {dst.token?.symbol}
            </span>
          </div>

          <div className="flex justify-between items-center gap-2">
            <span>Estimated Settlement</span>
            <span className="text-right">
              {speedTier ? `~${speedTier.estimatedSeconds}s (${speedTier.tier})` : '—'}
            </span>
          </div>
        </div>

        <div className="wrap-anywhere">
          {quoteQuery.data?.ok === false && <div className="text-red-500">{quoteQuery.data.error.detail.message}</div>}
        </div>

        {availableHookKind && (
          <div className="flex items-center gap-2 w-full">
            <label htmlFor="delivery-hook-toggle" className="text-sm font-medium cursor-pointer">
              {HOOK_LABELS[availableHookKind]}
            </label>
            <input
              id="delivery-hook-toggle"
              type="checkbox"
              checked={deliveryHookEnabled}
              onChange={e => setDeliveryHookEnabled(e.target.checked)}
              className="h-4 w-4 cursor-pointer"
            />
          </div>
        )}

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
            <Button variant="outline" onClick={() => createIntentOrderPayload()}>
              Swap
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Intent Swap Order</DialogTitle>
              <DialogDescription>See details of intent order.</DialogDescription>
            </DialogHeader>
            <div className="">
              <div className="flex flex-col wrap-anywhere">
                <div>
                  inputToken: {intentOrderPayload?.inputToken} on {intentOrderPayload?.srcChainKey}
                </div>
                <div>
                  outputToken: {intentOrderPayload?.outputToken} on {intentOrderPayload?.dstChainKey}
                </div>
                <div>inputAmount: {formatUnits(intentOrderPayload?.inputAmount ?? 0n, src.token?.decimals ?? 0)}</div>
                <div>deadline: {new Date(Number(intentOrderPayload?.deadline) * 1000).toLocaleString()}</div>
                <div>allowPartialFill: {intentOrderPayload?.allowPartialFill.toString()}</div>
                <div>srcAddress: {intentOrderPayload?.srcAddress}</div>
                <div>dstAddress: {intentOrderPayload?.dstAddress}</div>
                <div>solver: {intentOrderPayload?.solver}</div>
                <div>data: {intentOrderPayload?.data}</div>
                <div>amount: {formatUnits(intentOrderPayload?.inputAmount ?? 0n, src.token?.decimals ?? 0)}</div>
                <div>
                  outputAmount: {formatUnits(intentOrderPayload?.minOutputAmount ?? 0n, dst.token?.decimals ?? 0)}
                </div>
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
                {approveError ? <div className="text-red-500 text-sm">{approveError}</div> : null}
                {swapError ? <div className="text-red-500 text-sm">{swapError}</div> : null}
                {nearStorageError ? <div className="text-red-500 text-sm">{nearStorageError}</div> : null}
                {stellarError ? <div className="text-red-500 text-sm">{stellarError}</div> : null}
              </div>
            </div>
            <DialogFooter>
              {src.chain !== ChainKeys.BITCOIN_MAINNET && (
                <Button
                  className="w-full"
                  type="button"
                  variant="default"
                  onClick={handleApprove}
                  disabled={isAllowanceLoading || hasAllowed || isApproving}
                >
                  {isApproving ? 'Approving...' : hasAllowed ? 'Approved' : 'Approve'}
                </Button>
              )}

              {isWrongChain && (
                <Button className="w-full" type="button" variant="default" onClick={handleSwitchChain}>
                  Switch Chain
                </Button>
              )}

              {!isWrongChain &&
                (intentOrderPayload ? (
                  <Button
                    className="w-full"
                    onClick={() => handleSwap(intentOrderPayload)}
                    disabled={
                      (src.chain !== ChainKeys.BITCOIN_MAINNET && !hasAllowed) ||
                      (src.chain === ChainKeys.BITCOIN_MAINNET && !isBitcoinReady) ||
                      (dst.chain === ChainKeys.BITCOIN_MAINNET && !isDestBitcoinReady) ||
                      stellar.blocksAction ||
                      nearStorage.blocksAction
                    }
                  >
                    <ArrowLeftRight className="mr-2 h-4 w-4" /> Swap
                  </Button>
                ) : (
                  <span>Intent Order undefined</span>
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
