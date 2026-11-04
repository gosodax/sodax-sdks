import { SelectChain } from '@/components/swaps/SelectChain';
import { TokenIcon } from '@/components/shared/TokenIcon';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatMutationFailureMessage } from '@/lib/utils';
import { parseUnits, formatUnits } from 'viem';
import {
  type CreateLimitOrderParams,
  getSupportedSolverTokens,
  useSwapAllowance,
  useSwapApprove,
  useCreateLimitOrder,
  useStellarGate,
  useSodaxContext,
  type SpokeChainKey,
  type XToken,
  type ChainType,
  ChainKeys,
} from '@sodax/dapp-kit';
import BigNumber from 'bignumber.js';
import { ArrowDownUp, ArrowLeftRight, Loader2 } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import {
  getXChainType,
  useEvmSwitchChain,
  useXAccount,
  useXDisconnect,
  useWalletProvider,
} from '@sodax/wallet-sdk-react';
import { useAppStore } from '@/zustand/useAppStore';
import LimitOrderList from './LimitOrderList';
import { useQueryClient } from '@tanstack/react-query';

export default function LimitOrderCard() {
  const { sodax } = useSodaxContext();
  const [sourceChain, setSourceChain] = useState<SpokeChainKey>(ChainKeys.ICON_MAINNET);
  const sourceAccount = useXAccount({ xChainId: sourceChain });
  const sourceWalletProvider = useWalletProvider({ xChainId: sourceChain });
  const [destChain, setDestChain] = useState<SpokeChainKey>(ChainKeys.POLYGON_MAINNET);
  const destAccount = useXAccount({ xChainId: destChain });
  const destWalletProvider = useWalletProvider({ xChainId: destChain });
  const { openWalletModal } = useAppStore();
  const { mutateAsync: createLimitOrder } = useCreateLimitOrder();
  const [sourceToken, setSourceToken] = useState<XToken | undefined>(
    getSupportedSolverTokens(ChainKeys.ICON_MAINNET)[0],
  );
  const [destToken, setDestToken] = useState<XToken | undefined>(
    getSupportedSolverTokens(ChainKeys.POLYGON_MAINNET)[0],
  );
  const [sourceAmount, setSourceAmount] = useState<string>('');
  const [limitOrderPayload, setLimitOrderPayload] = useState<CreateLimitOrderParams | undefined>(undefined);
  const { data: hasAllowed, isLoading: isAllowanceLoading } = useSwapAllowance({
    params: {
      payload: limitOrderPayload,
      srcChainKey: sourceChain,
      walletProvider: sourceWalletProvider,
    },
  });
  const { mutateAsyncSafe: approve, isPending: isApproving } = useSwapApprove();
  const supportedSpokeChains = sodax.config.getSupportedSpokeChains();
  // Keep amount undefined until the payload exists; 0n disables the trustline query.
  const stellar = useStellarGate({
    dstChainKey: destChain,
    token: limitOrderPayload?.outputToken,
    amount: limitOrderPayload ? BigInt(limitOrderPayload.minOutputAmount) : undefined,
    address: destAccount.address,
    walletProvider: destWalletProvider,
  });
  const [open, setOpen] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [stellarError, setStellarError] = useState<string | null>(null);

  const onChangeDirection = () => {
    setSourceChain(destChain);
    setDestChain(sourceChain);
    setSourceToken(destToken);
    setDestToken(sourceToken);
  };

  const onSrcChainChange = (chainId: SpokeChainKey) => {
    setSourceChain(chainId);
    setSourceToken(getSupportedSolverTokens(chainId)[0]);
  };

  const onDestChainChange = (chainId: SpokeChainKey) => {
    setDestChain(chainId);
    setDestToken(getSupportedSolverTokens(chainId)[0]);
  };

  const [limitOrderPrice, setLimitOrderPrice] = useState<string>('0');

  const minOutputAmount = useMemo(() => {
    // Validate sourceAmount and limitOrderPrice
    if (!sourceAmount || Number.isNaN(Number(sourceAmount)) || Number(sourceAmount) <= 0) {
      return undefined;
    }

    if (!limitOrderPrice || Number.isNaN(Number(limitOrderPrice)) || Number(limitOrderPrice) <= 0) {
      return undefined;
    }

    return new BigNumber(sourceAmount)
      .multipliedBy(new BigNumber(limitOrderPrice))
      .multipliedBy(new BigNumber(10).pow(destToken?.decimals ?? 0));
  }, [sourceAmount, limitOrderPrice, destToken]);

  const onSourceAmountChange = (value: string) => {
    setSourceAmount(value);
  };

  const createLimitOrderPayload = async () => {
    if (!sourceToken || !destToken) {
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

    const limitOrderParams = {
      inputToken: sourceToken.address, // The address of the input token on hub chain
      outputToken: destToken.address, // The address of the output token on hub chain
      inputAmount: parseUnits(sourceAmount, sourceToken.decimals), // The amount of input tokens
      minOutputAmount: BigInt(minOutputAmount.toFixed(0)), // The minimum amount of output tokens to accept
      allowPartialFill: false, // Whether the intent can be partially filled
      srcChainKey: sourceChain, // Chain ID where input tokens originate
      dstChainKey: destChain, // Chain ID where output tokens should be delivered
      srcAddress: await sourceWalletProvider.getWalletAddress(), // Source address (original address on spoke chain)
      dstAddress: destAccount.address, // Destination address (original address on spoke chain)
      solver: '0x0000000000000000000000000000000000000000', // Optional specific solver address (address(0) = any solver)
      data: '0x', // Additional arbitrary data
    } satisfies CreateLimitOrderParams;

    setLimitOrderPayload(limitOrderParams);
  };

  const { isWrongChain, handleSwitchChain } = useEvmSwitchChain({ xChainId: sourceChain as SpokeChainKey });

  const queryClient = useQueryClient();

  const handleCreateLimitOrder = async (limitOrderPayload: CreateLimitOrderParams) => {
    if (!sourceWalletProvider) {
      console.error('sourceWalletProvider undefined');
      return;
    }
    setOpen(false);
    try {
      await createLimitOrder({ params: limitOrderPayload, walletProvider: sourceWalletProvider });
      queryClient.invalidateQueries({ queryKey: ['backend', 'intent', 'user'] });
    } catch (error) {
      console.error('Error creating limit order:', error);
    }
  };

  const disconnect = useXDisconnect();
  const handleSourceAccountDisconnect = () => {
    disconnect({ xChainType: getXChainType(sourceChain) as ChainType });
  };

  const handleDestAccountDisconnect = () => {
    disconnect({ xChainType: getXChainType(destChain) as ChainType });
  };

  const handleApprove = async (): Promise<void> => {
    if (!limitOrderPayload || !sourceWalletProvider) {
      console.error('limitOrderPayload or sourceWalletProvider undefined');
      return;
    }

    const result = await approve({ params: limitOrderPayload, walletProvider: sourceWalletProvider });
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

  return (
    <>
      <Card className="w-full max-w-lg mx-auto">
        <CardHeader>
          <CardTitle className="text-xl sm:text-2xl font-bold text-center">Cross Chain Limit Order</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grow">
            <Label htmlFor="limitOrderPrice">
              Price: When 1 {sourceToken?.symbol} is worth {limitOrderPrice} {destToken?.symbol}
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="limitOrderPrice"
                type="number"
                placeholder=""
                value={limitOrderPrice}
                onChange={e => setLimitOrderPrice(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <SelectChain
              chainList={supportedSpokeChains}
              value={sourceChain}
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
            <Select
              value={sourceToken?.symbol}
              onValueChange={v =>
                setSourceToken(getSupportedSolverTokens(sourceChain).find(token => token.symbol === v))
              }
            >
              <SelectTrigger className="w-[110px]">
                <SelectValue placeholder="Token" />
              </SelectTrigger>
              <SelectContent>
                {getSupportedSolverTokens(sourceChain).map(token => (
                  <SelectItem key={`${token.address}-${token.symbol}`} value={token.symbol}>
                    <span className="flex items-center gap-2">
                      <TokenIcon symbol={token.symbol} />
                      {token.symbol}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
          <div className="flex justify-center">
            <Button variant="outline" size="icon" onClick={() => onChangeDirection()}>
              <ArrowDownUp className="h-4 w-4" />
            </Button>
          </div>
          <div className="space-y-2">
            <SelectChain
              chainList={supportedSpokeChains}
              value={destChain}
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
                value={minOutputAmount ? formatUnits(BigInt(minOutputAmount.toFixed(0)), destToken?.decimals ?? 0) : ''}
                readOnly
              />
            </div>
            <Select
              value={destToken?.symbol}
              onValueChange={v => setDestToken(getSupportedSolverTokens(destChain).find(token => token.symbol === v))}
            >
              <SelectTrigger className="w-[110px]">
                <SelectValue placeholder="Token" />
              </SelectTrigger>
              <SelectContent>
                {getSupportedSolverTokens(destChain).map(token => (
                  <SelectItem key={`${token.address}-${token.symbol}`} value={token.symbol}>
                    <span className="flex items-center gap-2">
                      <TokenIcon symbol={token.symbol} />
                      {token.symbol}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grow">
            <Label htmlFor="toAddress">Destination address</Label>
            <div className="flex items-center gap-2">
              <Input id="toAddress" type="text" value={destAccount.address || ''} placeholder="" disabled={true} />
              {destAccount.address ? (
                <Button onClick={handleDestAccountDisconnect}>Disconnect</Button>
              ) : (
                <Button onClick={openWalletModal}>Connect</Button>
              )}
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex flex-col space-y-4">
          <Dialog
            open={open}
            onOpenChange={(nextOpen): void => {
              setOpen(nextOpen);
              if (nextOpen) setApproveError(null);
            }}
          >
            <DialogTrigger asChild>
              <Button variant="outline" onClick={() => createLimitOrderPayload()}>
                Create Limit Order
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl">
              <DialogHeader>
                <DialogTitle>Limit Order Intent</DialogTitle>
                <DialogDescription>See details of limit order intent.</DialogDescription>
              </DialogHeader>
              <div className="">
                <div className="flex flex-col wrap-anywhere">
                  <div>
                    inputToken: {limitOrderPayload?.inputToken} on {limitOrderPayload?.srcChainKey}
                  </div>
                  <div>
                    outputToken: {limitOrderPayload?.outputToken} on {limitOrderPayload?.dstChainKey}
                  </div>
                  <div>
                    inputAmount: {formatUnits(limitOrderPayload?.inputAmount ?? 0n, sourceToken?.decimals ?? 0)}
                  </div>
                  <div>allowPartialFill: {limitOrderPayload?.allowPartialFill.toString()}</div>
                  <div>srcAddress: {limitOrderPayload?.srcAddress}</div>
                  <div>dstAddress: {limitOrderPayload?.dstAddress}</div>
                  <div>solver: {limitOrderPayload?.solver}</div>
                  <div>data: {limitOrderPayload?.data}</div>
                  <div>amount: {formatUnits(limitOrderPayload?.inputAmount ?? 0n, sourceToken?.decimals ?? 0)}</div>
                  <div>
                    outputAmount: {formatUnits(limitOrderPayload?.minOutputAmount ?? 0n, destToken?.decimals ?? 0)}
                  </div>
                  {stellar.needsActivation && (
                    <div className="text-red-500">
                      Destination Stellar account does not exist yet — activate it to proceed. SODAX sponsors the
                      reserve, so this is free.
                    </div>
                  )}
                  {stellar.needsFunding && (
                    <div className="text-red-500">
                      Destination Stellar account holds no XLM, so it cannot pay for a trustline. Send it some XLM first
                      — receiving XLM needs no trustline.
                    </div>
                  )}
                  {stellar.needsTrustline && (
                    <div className="text-red-500">Insufficient Stellar trustline (request trustline to proceed)</div>
                  )}
                  {stellar.checkFailed && (
                    <div className="text-red-500">
                      Couldn't check the destination Stellar account, so the order is on hold
                      {stellar.error ? `: ${stellar.error.message}` : ''}
                    </div>
                  )}
                  {approveError ? <div className="text-red-500 text-sm">{approveError}</div> : null}
                  {stellarError ? <div className="text-red-500 text-sm">{stellarError}</div> : null}
                </div>
              </div>
              <DialogFooter>
                <Button
                  className="w-full"
                  type="button"
                  variant="default"
                  onClick={handleApprove}
                  disabled={isAllowanceLoading || hasAllowed || isApproving}
                >
                  {isApproving ? 'Approving...' : hasAllowed ? 'Approved' : 'Approve'}
                </Button>

                {isWrongChain && (
                  <Button className="w-full" type="button" variant="default" onClick={handleSwitchChain}>
                    Switch Chain
                  </Button>
                )}

                {!isWrongChain &&
                  (limitOrderPayload ? (
                    <Button
                      className="w-full"
                      onClick={() => handleCreateLimitOrder(limitOrderPayload)}
                      disabled={!hasAllowed || stellar.blocksAction}
                    >
                      <ArrowLeftRight className="mr-2 h-4 w-4" /> Create Limit Order
                    </Button>
                  ) : (
                    <span>Limit Order Payload undefined</span>
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
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardFooter>
      </Card>

      <LimitOrderList spokeChainId={sourceChain} />
    </>
  );
}
