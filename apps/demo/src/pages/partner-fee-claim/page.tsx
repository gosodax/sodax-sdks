import React, { useMemo, useState } from 'react';
import {
  useApproveToken,
  useBridgeApprove,
  useFeeClaimSwap,
  useFeeClaimWithdraw,
  useFetchAssetsBalances,
  useGetAutoSwapPreferences,
  useGetIntentDetails,
  useGetUserIntent,
  useIsTokenApproved,
  usePartnerCancelIntent,
  useSetSwapPreference,
  useSodaxContext,
  ChainKeys,
  type SpokeChainKey,
} from '@sodax/dapp-kit';
import { useEvmSwitchChain, useWalletProvider, useXAccount } from '@sodax/wallet-sdk-react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { type Address, formatUnits, isAddress, parseUnits } from 'viem';
import { chainIdToChainName } from '@/constants';
import { SelectChain } from '@/components/swaps/SelectChain';

const SONIC: typeof ChainKeys.SONIC_MAINNET = ChainKeys.SONIC_MAINNET;
const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000';

/**
 * v2 SDK errors are tagged: `error.message` carries the CODE (e.g. FETCH_ASSETS_BALANCES_FAILED),
 * `error.cause` carries the underlying viem/RPC error. Surface both so users can debug.
 */
function formatSdkError(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback;
  const cause = (err as { cause?: unknown }).cause;
  const causeText = cause instanceof Error ? ` — ${cause.message}` : '';
  return `${err.message}${causeText}`;
}

export default function PartnerFeeClaimPage() {
  const { sodax } = useSodaxContext();
  const sonicAccount = useXAccount({ xChainId: SONIC });
  const walletProvider = useWalletProvider({ xChainId: SONIC });
  const srcAddress = sonicAccount?.address as Address | undefined;
  // The wallet address (connection intent) is tracked independently of the active network, but the
  // EVM walletProvider only hydrates once the wallet is on Sonic — without it every write action
  // (claim, withdraw, recover) stays disabled with no hint. Prompt a network switch instead.
  const { isWrongChain, handleSwitchChain } = useEvmSwitchChain({ xChainId: SONIC });

  const supportedSpokeChains = useMemo(() => sodax.config.getSupportedSpokeChains(), [sodax]);

  const [address, setAddress] = useState<string>('');
  const [submittedAddress, setSubmittedAddress] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const candidateAddress = useMemo(() => {
    const trimmed = address.trim();
    if (trimmed && isAddress(trimmed)) return trimmed;
    if (srcAddress) return srcAddress;
    return undefined;
  }, [address, srcAddress]);

  const {
    data: balances,
    isFetching: isFetchingBalances,
    error: balancesError,
  } = useFetchAssetsBalances({ params: { queryAddress: submittedAddress } });

  const balancesArray = useMemo(() => (balances ? Array.from(balances.values()) : []), [balances]);

  const handleFetchBalances = (): void => {
    setError(null);
    if (!candidateAddress) {
      setError('No address provided and wallet not connected');
      return;
    }
    setSubmittedAddress(candidateAddress);
  };

  // Approve token state
  const [approveTokenAddress, setApproveTokenAddress] = useState<string>('');
  const [approveError, setApproveError] = useState<string | null>(null);

  const isApprovedParams = useMemo(
    () =>
      approveTokenAddress.trim() && isAddress(approveTokenAddress.trim()) && srcAddress
        ? { srcChainKey: SONIC, srcAddress, token: approveTokenAddress.trim() as Address }
        : undefined,
    [approveTokenAddress, srcAddress],
  );

  const { data: isApproved } = useIsTokenApproved({ params: { payload: isApprovedParams } });
  const { mutateAsync: approveToken, isPending: approveLoading } = useApproveToken();

  const handleApproveToken = async (): Promise<void> => {
    setApproveError(null);
    if (!srcAddress || !walletProvider || !approveTokenAddress.trim()) {
      setApproveError('Please provide a token address and connect your wallet');
      return;
    }
    try {
      await approveToken({
        params: {
          srcChainKey: SONIC,
          srcAddress,
          token: approveTokenAddress.trim() as Address,
        },
        walletProvider,
      });
    } catch (error) {
      setApproveError(formatSdkError(error, 'Failed to approve token'));
    }
  };

  // Set swap preference state
  const [outputToken, setOutputToken] = useState<string>('');
  const [dstChain, setDstChain] = useState<SpokeChainKey>(SONIC);
  const [dstAddress, setDstAddress] = useState<string>('');
  const [setPreferenceError, setSetPreferenceError] = useState<string | null>(null);
  const [setPreferenceSuccess, setSetPreferenceSuccess] = useState<string | null>(null);
  const { mutateAsync: setSwapPreference, isPending: setPreferenceLoading } = useSetSwapPreference();

  const handleSetSwapPreference = async (): Promise<void> => {
    setSetPreferenceError(null);
    setSetPreferenceSuccess(null);
    if (!srcAddress || !walletProvider || !outputToken.trim() || !dstAddress.trim()) {
      setSetPreferenceError('Please fill in all fields and connect your wallet');
      return;
    }
    try {
      const txReturn = await setSwapPreference({
        params: {
          srcChainKey: SONIC,
          srcAddress,
          outputToken: outputToken.trim() as Address,
          dstChainKey: dstChain,
          dstAddress: dstAddress.trim(),
        },
        walletProvider,
      });
      setSetPreferenceSuccess(`Transaction sent: ${txReturn}`);
    } catch (error) {
      setSetPreferenceError(formatSdkError(error, 'Failed to set swap preference'));
    }
  };

  // Swap state
  const [swapFromToken, setSwapFromToken] = useState<string>('');
  const [swapAmount, setSwapAmount] = useState<string>('');
  const [swapError, setSwapError] = useState<string | null>(null);
  const [swapSuccess, setSwapSuccess] = useState<string | null>(null);
  const { mutateAsync: feeClaimSwap, isPending: swapLoading } = useFeeClaimSwap();

  const handleSwap = async (): Promise<void> => {
    setSwapError(null);
    setSwapSuccess(null);
    if (!srcAddress || !walletProvider || !swapFromToken.trim() || !swapAmount.trim()) {
      setSwapError('Please fill in all fields and connect your wallet');
      return;
    }
    const token = balancesArray.find(a => a.address.toLowerCase() === swapFromToken.trim().toLowerCase());
    if (!token) {
      setSwapError('Token not found in balances. Please fetch balances first or provide a valid token address.');
      return;
    }
    const amount = parseUnits(swapAmount, token.decimal);
    try {
      const intentResult = await feeClaimSwap({
        params: {
          srcChainKey: SONIC,
          srcAddress,
          fromToken: swapFromToken.trim() as Address,
          amount,
        },
        walletProvider,
      });
      setSwapSuccess(
        `Swap executed successfully! Intent: ${intentResult.solverExecutionResponse.intent_hash || 'N/A'}`,
      );
    } catch (error) {
      setSwapError(formatSdkError(error, 'Failed to execute swap'));
    }
  };

  // ── Same-token detection (prevention) ──────────────────────────────────────
  // The on-chain auto-swap preference (not the dropdown) drives the claim's output token. When it
  // equals the fee token being claimed, the solver can't fill the swap and funds get stuck — warn
  // and steer to Withdraw Directly instead.
  const { data: autoSwapPrefs } = useGetAutoSwapPreferences({ params: { queryAddress: srcAddress } });
  const isSameTokenSwap = useMemo(() => {
    const out = autoSwapPrefs?.outputToken?.toLowerCase();
    const from = swapFromToken.trim().toLowerCase();
    return !!out && !!from && out === from;
  }, [autoSwapPrefs, swapFromToken]);

  // ── Recover a stuck intent ─────────────────────────────────────────────────
  const [recoverFromToken, setRecoverFromToken] = useState<string>('');
  const [recoverToToken, setRecoverToToken] = useState<string>('');
  const [recoverTxHash, setRecoverTxHash] = useState<string>('');
  const [recoverTxLoading, setRecoverTxLoading] = useState<boolean>(false);
  const [recoverError, setRecoverError] = useState<string | null>(null);
  const [recoverSuccess, setRecoverSuccess] = useState<string | null>(null);
  const { mutateAsync: cancelIntent, isPending: recoverLoading } = usePartnerCancelIntent();

  // Convenience: derive the from/to tokens from the original claim transaction so the partner can
  // recover by pasting a tx hash instead of typing token addresses. The on-chain cancel still keys
  // on the token pair — this only fills the inputs.
  const handleLoadFromTx = async (): Promise<void> => {
    setRecoverError(null);
    setRecoverSuccess(null);
    const txHash = recoverTxHash.trim();
    if (!txHash) {
      setRecoverError('Enter the claim transaction hash');
      return;
    }
    setRecoverTxLoading(true);
    try {
      const result = await sodax.swaps.getIntent(txHash as `0x${string}`);
      if (!result.ok) throw result.error;
      setRecoverFromToken(result.value.inputToken);
      setRecoverToToken(result.value.outputToken);
    } catch (error) {
      setRecoverError(formatSdkError(error, 'Could not read an intent from this transaction'));
    } finally {
      setRecoverTxLoading(false);
    }
  };

  const recoverPairValid = isAddress(recoverFromToken.trim()) && isAddress(recoverToToken.trim()) && !!srcAddress;

  const { data: stuckIntentHash } = useGetUserIntent({
    params: recoverPairValid
      ? { user: srcAddress, fromToken: recoverFromToken.trim() as Address, toToken: recoverToToken.trim() as Address }
      : undefined,
  });
  const hasStuckIntent = !!stuckIntentHash && stuckIntentHash !== ZERO_HASH;
  const { data: stuckIntent } = useGetIntentDetails({
    params: { intentHash: hasStuckIntent ? stuckIntentHash : undefined },
  });

  const handleRecover = async (): Promise<void> => {
    setRecoverError(null);
    setRecoverSuccess(null);
    if (!srcAddress || !walletProvider || !recoverPairValid) {
      setRecoverError('Connect your wallet and enter valid from/to token addresses');
      return;
    }
    try {
      const txHash = await cancelIntent({
        params: {
          srcChainKey: SONIC,
          srcAddress,
          fromToken: recoverFromToken.trim() as Address,
          toToken: recoverToToken.trim() as Address,
        },
        walletProvider,
      });
      setRecoverSuccess(`Recovered! Tokens returned to your wallet. Tx: ${txHash}`);
    } catch (error) {
      setRecoverError(formatSdkError(error, 'Failed to recover intent'));
    }
  };

  // ── Withdraw directly (no swap) ────────────────────────────────────────────
  const [withdrawToken, setWithdrawToken] = useState<string>('');
  const [withdrawAmount, setWithdrawAmount] = useState<string>('');
  const [withdrawDstChain, setWithdrawDstChain] = useState<SpokeChainKey>(SONIC);
  const [withdrawRecipient, setWithdrawRecipient] = useState<string>('');
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawSuccess, setWithdrawSuccess] = useState<string | null>(null);
  // Withdraw is gated on a successful bridge approval. The approval is specific to the
  // token/amount/destination/recipient — record what was approved and only enable Withdraw while the
  // current inputs still match, so editing any field auto-invalidates the prior approval.
  const [approvedWithdrawKey, setApprovedWithdrawKey] = useState<string | null>(null);
  const { mutateAsync: feeClaimWithdraw, isPending: withdrawLoading } = useFeeClaimWithdraw();
  const { mutateAsync: bridgeApprove, isPending: withdrawApproveLoading } = useBridgeApprove();

  const withdrawAsset = useMemo(
    () => balancesArray.find(a => a.address.toLowerCase() === withdrawToken.trim().toLowerCase()),
    [balancesArray, withdrawToken],
  );

  const withdrawKey = `${withdrawToken.trim()}|${withdrawAmount.trim()}|${withdrawDstChain}|${withdrawRecipient.trim()}`;
  const withdrawApproved = approvedWithdrawKey !== null && approvedWithdrawKey === withdrawKey;

  /**
   * Maps the selected fee balance + destination to bridge params. The fee token's wrapped hub-asset
   * address is the bridge `srcToken` on Sonic; the destination token is the same hub asset on Sonic
   * (same-chain delivery) or the token's original address on its native chain.
   */
  const buildWithdrawParams = (): { srcToken: Address; amount: bigint; dstToken: string } | { error: string } => {
    if (!withdrawAsset) return { error: 'Select a fee token from balances' };
    if (!withdrawAmount.trim()) return { error: 'Enter an amount' };
    if (!withdrawRecipient.trim()) return { error: 'Enter a recipient address' };
    let dstToken: string;
    if (withdrawDstChain === SONIC) dstToken = withdrawAsset.address;
    else if (withdrawDstChain === withdrawAsset.originalChain) dstToken = withdrawAsset.originalAddress;
    else
      return {
        error: `This fee token can only be withdrawn to Sonic or its native chain (${chainIdToChainName(
          withdrawAsset.originalChain,
        )})`,
      };
    return { srcToken: withdrawAsset.address, amount: parseUnits(withdrawAmount, withdrawAsset.decimal), dstToken };
  };

  const handleWithdrawApprove = async (): Promise<void> => {
    setWithdrawError(null);
    setWithdrawSuccess(null);
    if (!srcAddress || !walletProvider) {
      setWithdrawError('Please connect your wallet');
      return;
    }
    const built = buildWithdrawParams();
    if ('error' in built) {
      setWithdrawError(built.error);
      return;
    }
    try {
      await bridgeApprove({
        params: {
          srcChainKey: SONIC,
          srcAddress,
          srcToken: built.srcToken,
          amount: built.amount,
          dstChainKey: withdrawDstChain,
          dstToken: built.dstToken,
          recipient: withdrawRecipient.trim(),
        },
        walletProvider,
      });
      setApprovedWithdrawKey(withdrawKey);
      setWithdrawSuccess('Approved for bridge. You can withdraw now.');
    } catch (error) {
      setWithdrawError(formatSdkError(error, 'Failed to approve'));
    }
  };

  const handleWithdraw = async (): Promise<void> => {
    setWithdrawError(null);
    setWithdrawSuccess(null);
    if (!srcAddress || !walletProvider) {
      setWithdrawError('Please connect your wallet');
      return;
    }
    const built = buildWithdrawParams();
    if ('error' in built) {
      setWithdrawError(built.error);
      return;
    }
    try {
      const result = await feeClaimWithdraw({
        params: {
          srcAddress,
          feeToken: built.srcToken,
          amount: built.amount,
          dstChainKey: withdrawDstChain,
          dstToken: built.dstToken,
          recipient: withdrawRecipient.trim(),
        },
        walletProvider,
      });
      setWithdrawSuccess(`Withdrawn! Source tx: ${result.srcChainTxHash}, destination tx: ${result.dstChainTxHash}`);
    } catch (error) {
      setWithdrawError(formatSdkError(error, 'Failed to withdraw'));
    }
  };

  return (
    <main className="container mx-auto px-4 py-8 max-w-4xl">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-cherry-dark mb-2">Partner Fee Claim Demo</h1>
          <p className="text-clay">Query asset balances for any address on Sonic chain</p>
        </div>

        {srcAddress && isWrongChain && (
          <div className="flex flex-wrap items-center gap-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
            <AlertTriangle className="w-5 h-5 text-yellow-600 shrink-0" />
            <span className="flex-1 min-w-[12rem] text-sm text-yellow-800">
              Your wallet is connected to a different network. Switch to Sonic to claim, withdraw, or recover fees.
            </span>
            <Button variant="cherry" size="sm" onClick={handleSwitchChain} className="ml-auto shrink-0">
              Switch to Sonic
            </Button>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Fetch Asset Balances</CardTitle>
            <CardDescription>
              Enter an address to query balances, or leave empty to use your connected wallet address
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="address">Address (optional)</Label>
              <Input
                id="address"
                placeholder={sonicAccount?.address || 'Enter address or connect wallet'}
                value={address}
                onChange={e => setAddress(e.target.value)}
                className="font-mono"
              />
              {sonicAccount?.address && (
                <p className="text-sm text-muted-foreground">
                  Connected: {sonicAccount.address.slice(0, 10)}...{sonicAccount.address.slice(-8)}
                </p>
              )}
            </div>

            <Button onClick={handleFetchBalances} disabled={isFetchingBalances || !candidateAddress}>
              {isFetchingBalances ? 'Loading...' : 'Fetch Balances'}
            </Button>

            {error && (
              <div className="p-3 bg-negative border border-red rounded-lg text-black text-sm wrap-anywhere">
                {error}
              </div>
            )}
            {balancesError && (
              <div className="p-3 bg-negative border border-red rounded-lg text-black text-sm break-all">
                {formatSdkError(balancesError, 'Failed to fetch balances')}
              </div>
            )}

            {!srcAddress && (
              <div className="p-3 bg-negative border border-negative rounded-lg text-black text-sm">
                Please connect your Sonic wallet to use this feature
              </div>
            )}
          </CardContent>
        </Card>

        {balances && (
          <Card>
            <CardHeader>
              <CardTitle>Asset Balances</CardTitle>
              <CardDescription>
                Found {balancesArray.length} assets with non-zero balances on Sonic chain
              </CardDescription>
            </CardHeader>
            <CardContent>
              {balancesArray.length === 0 ? (
                <p className="text-muted-foreground">No balances found</p>
              ) : (
                <div className="space-y-2">
                  <div className="max-h-96 overflow-y-auto space-y-2">
                    {balancesArray.map(asset => (
                      <div
                        key={asset.address}
                        className="flex items-center justify-between gap-3 p-3 rounded-lg border bg-white/90 border-cherry-soda/30"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-black">{asset.symbol}</div>
                          <div className="text-sm text-gray-800">{asset.name}</div>
                          <div className="text-xs mt-1 text-gray-700">
                            From: {chainIdToChainName(asset.originalChain)}
                          </div>
                          <div className="text-xs font-mono mt-1 text-gray-600">
                            Wrapped: {asset.address.slice(0, 10)}...{asset.address.slice(-8)}
                          </div>
                        </div>
                        <div className="min-w-0 text-right break-all">
                          <div className="font-semibold text-cherry-bright">
                            {formatUnits(asset.balance, asset.decimal)}
                          </div>
                          <div className="text-xs text-gray-700">{asset.symbol}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Approve Token</CardTitle>
            <CardDescription>Approve a token to the protocol intents contract (max allowance)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="approve-token">Token Address</Label>
              <Input
                id="approve-token"
                placeholder="0x..."
                value={approveTokenAddress}
                onChange={e => setApproveTokenAddress(e.target.value)}
                className="font-mono"
              />
              {balancesArray.length > 0 && (
                <select
                  className="w-full p-2 border rounded-lg text-sm"
                  onChange={e => {
                    if (e.target.value) {
                      setApproveTokenAddress(e.target.value);
                    }
                  }}
                  value=""
                >
                  <option value="">Select from balances...</option>
                  {balancesArray.map(asset => (
                    <option key={asset.address} value={asset.address}>
                      {asset.symbol} ({asset.address.slice(0, 10)}...{asset.address.slice(-8)})
                    </option>
                  ))}
                </select>
              )}
              {isApprovedParams && isApproved !== undefined && (
                <p className={`text-sm ${isApproved ? 'text-green-500' : 'text-negative'}`}>
                  {isApproved ? '✓ Token is already approved' : 'Token is not approved'}
                </p>
              )}
            </div>

            <Button
              onClick={handleApproveToken}
              disabled={approveLoading || !srcAddress || !walletProvider || !approveTokenAddress.trim()}
            >
              {approveLoading ? 'Approving...' : 'Approve Token'}
            </Button>

            {approveError && (
              <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-black text-sm break-all">
                {approveError}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Set Swap Preference</CardTitle>
            <CardDescription>Configure auto-swap preferences for partner fee claims</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="output-token">Output Token Address</Label>
              <Input
                id="output-token"
                placeholder="0x..."
                value={outputToken}
                onChange={e => setOutputToken(e.target.value)}
                className="font-mono"
              />
              {balancesArray.length > 0 && (
                <select
                  className="w-full p-2 border rounded-lg text-sm"
                  onChange={e => {
                    if (e.target.value) {
                      setOutputToken(e.target.value);
                    }
                  }}
                  value=""
                >
                  <option value="">Select from balances...</option>
                  {balancesArray.map(asset => (
                    <option key={asset.address} value={asset.address}>
                      {asset.symbol} ({asset.address.slice(0, 10)}...{asset.address.slice(-8)})
                    </option>
                  ))}
                </select>
              )}
            </div>

            <SelectChain
              chainList={supportedSpokeChains}
              value={dstChain}
              setChain={setDstChain}
              label="Destination Chain"
              id="dst-chain"
            />

            <div className="space-y-2">
              <Label htmlFor="dst-address">Destination Address</Label>
              <Input
                id="dst-address"
                placeholder="0x... or address"
                value={dstAddress}
                onChange={e => setDstAddress(e.target.value)}
                className="font-mono"
              />
              {sonicAccount?.address && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDstAddress(sonicAccount.address ?? '')}
                  className="text-xs"
                >
                  Use Connected Wallet
                </Button>
              )}
            </div>

            <Button
              onClick={handleSetSwapPreference}
              disabled={
                setPreferenceLoading || !srcAddress || !walletProvider || !outputToken.trim() || !dstAddress.trim()
              }
            >
              {setPreferenceLoading ? 'Setting...' : 'Set Swap Preference'}
            </Button>

            {setPreferenceError && (
              <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200 text-sm wrap-anywhere">
                {setPreferenceError}
              </div>
            )}

            {setPreferenceSuccess && (
              <div className="p-3 bg-green-500/20 border border-green-500/50 rounded-lg text-black text-sm wrap-anywhere">
                {setPreferenceSuccess}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Execute Swap</CardTitle>
            <CardDescription>Create an intent auto-swap (minOutputAmount is always 0)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="swap-from-token">From Token Address</Label>
              <Input
                id="swap-from-token"
                placeholder="0x..."
                value={swapFromToken}
                onChange={e => setSwapFromToken(e.target.value)}
                className="font-mono"
              />
              {balancesArray.length > 0 && (
                <select
                  className="w-full p-2 border rounded-lg text-sm"
                  onChange={e => {
                    if (e.target.value) {
                      setSwapFromToken(e.target.value);
                      setSwapAmount('');
                    }
                  }}
                  value=""
                >
                  <option value="">Select from balances...</option>
                  {balancesArray.map(asset => (
                    <option key={asset.address} value={asset.address}>
                      {asset.symbol} - Balance: {formatUnits(asset.balance, asset.decimal)} (
                      {asset.address.slice(0, 10)}...{asset.address.slice(-8)})
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="swap-amount">Amount</Label>
              <Input
                id="swap-amount"
                type="number"
                placeholder="0.0"
                value={swapAmount}
                onChange={e => setSwapAmount(e.target.value)}
                step="any"
              />
              {swapFromToken &&
                balancesArray.length > 0 &&
                (() => {
                  const token = balancesArray.find(a => a.address.toLowerCase() === swapFromToken.toLowerCase());
                  if (!token) return null;
                  const maxBalance = formatUnits(token.balance, token.decimal);
                  return (
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSwapAmount(maxBalance)}
                        className="h-auto min-h-9 whitespace-normal text-center text-xs wrap-anywhere"
                      >
                        Use Max ({maxBalance} {token.symbol})
                      </Button>
                    </div>
                  );
                })()}
            </div>

            {isSameTokenSwap && (
              <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
                Your configured output token equals this fee token — the solver cannot swap a token into itself, and
                claiming would lock the funds in an unfillable intent. Use{' '}
                <span className="font-semibold">Withdraw Directly</span> below instead, or change your swap preference.
              </div>
            )}

            <Button
              onClick={handleSwap}
              disabled={
                swapLoading ||
                !srcAddress ||
                !walletProvider ||
                !swapFromToken.trim() ||
                !swapAmount.trim() ||
                isSameTokenSwap
              }
            >
              {swapLoading ? 'Swapping...' : 'Execute Swap'}
            </Button>

            {swapError && (
              <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200 text-sm wrap-anywhere">
                {swapError}
              </div>
            )}

            {swapSuccess && (
              <div className="p-3 bg-green-500/20 border border-green-500/50 rounded-lg text-black text-sm wrap-anywhere">
                {swapSuccess}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Withdraw Directly (No Swap)</CardTitle>
            <CardDescription>
              Send a fee token to your wallet as-is, bypassing the solver. Use this when you want the fee token itself
              (no conversion) — e.g. claiming BTC fees as BTC. Bridges the wrapped token from Sonic to its native chain,
              or transfers it on Sonic.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="withdraw-token">Fee Token</Label>
              <Input
                id="withdraw-token"
                placeholder="0x..."
                value={withdrawToken}
                onChange={e => setWithdrawToken(e.target.value)}
                className="font-mono"
              />
              {balancesArray.length > 0 && (
                <select
                  className="w-full p-2 border rounded-lg text-sm"
                  onChange={e => {
                    const asset = balancesArray.find(a => a.address === e.target.value);
                    if (asset) {
                      setWithdrawToken(asset.address);
                      setWithdrawDstChain(asset.originalChain);
                      setWithdrawAmount('');
                    }
                  }}
                  value=""
                >
                  <option value="">Select from balances...</option>
                  {balancesArray.map(asset => (
                    <option key={asset.address} value={asset.address}>
                      {asset.symbol} - Balance: {formatUnits(asset.balance, asset.decimal)} (
                      {asset.address.slice(0, 10)}...{asset.address.slice(-8)})
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="withdraw-amount">Amount</Label>
              <Input
                id="withdraw-amount"
                type="number"
                placeholder="0.0"
                value={withdrawAmount}
                onChange={e => setWithdrawAmount(e.target.value)}
                step="any"
              />
              {withdrawAsset && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setWithdrawAmount(formatUnits(withdrawAsset.balance, withdrawAsset.decimal))}
                  className="h-auto min-h-9 whitespace-normal text-center text-xs wrap-anywhere"
                >
                  Use Max ({formatUnits(withdrawAsset.balance, withdrawAsset.decimal)} {withdrawAsset.symbol})
                </Button>
              )}
            </div>

            <SelectChain
              chainList={withdrawAsset ? Array.from(new Set([SONIC, withdrawAsset.originalChain])) : [SONIC]}
              value={withdrawDstChain}
              setChain={setWithdrawDstChain}
              label="Destination Chain"
              id="withdraw-dst-chain"
            />

            <div className="space-y-2">
              <Label htmlFor="withdraw-recipient">Recipient Address</Label>
              <Input
                id="withdraw-recipient"
                placeholder="0x... or address on the destination chain"
                value={withdrawRecipient}
                onChange={e => setWithdrawRecipient(e.target.value)}
                className="font-mono"
              />
              {sonicAccount?.address && withdrawDstChain === SONIC && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setWithdrawRecipient(sonicAccount.address ?? '')}
                  className="text-xs"
                >
                  Use Connected Wallet
                </Button>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={handleWithdrawApprove}
                disabled={withdrawApproveLoading || !srcAddress || !walletProvider || !withdrawAsset}
              >
                {withdrawApproveLoading ? 'Approving...' : 'Approve for Bridge'}
              </Button>
              <Button
                onClick={handleWithdraw}
                disabled={withdrawLoading || !srcAddress || !walletProvider || !withdrawAsset || !withdrawApproved}
              >
                {withdrawLoading ? 'Withdrawing...' : 'Withdraw'}
              </Button>
            </div>

            {withdrawError && (
              <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-black text-sm break-all">
                {withdrawError}
              </div>
            )}
            {withdrawSuccess && (
              <div className="p-3 bg-green-500/20 border border-green-500/50 rounded-lg text-black text-sm break-all">
                {withdrawSuccess}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recover Stuck Claim</CardTitle>
            <CardDescription>
              Cancel an unfillable auto-swap intent and return the locked tokens to your wallet. This happens when a
              claim's output token equals its input token (same-token swap). Enter the claim's from/to tokens — for a
              same-token claim they are identical.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="recover-txhash">Claim Transaction Hash (optional)</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="recover-txhash"
                  placeholder="0x... (paste the failed claim tx to auto-fill tokens)"
                  value={recoverTxHash}
                  onChange={e => setRecoverTxHash(e.target.value)}
                  className="font-mono"
                />
                <Button
                  variant="outline"
                  onClick={handleLoadFromTx}
                  disabled={recoverTxLoading || !recoverTxHash.trim()}
                >
                  {recoverTxLoading ? 'Loading...' : 'Load from Tx'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Optional shortcut — reads the intent from the transaction and fills the From/To tokens below. The cancel
                itself uses the token pair, not the hash.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="recover-from">From Token (fee token claimed)</Label>
              <Input
                id="recover-from"
                placeholder="0x..."
                value={recoverFromToken}
                onChange={e => setRecoverFromToken(e.target.value)}
                className="font-mono"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="recover-to">To Token (configured output token)</Label>
              <Input
                id="recover-to"
                placeholder="0x..."
                value={recoverToToken}
                onChange={e => setRecoverToToken(e.target.value)}
                className="font-mono"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRecoverToToken(recoverFromToken)}
                  className="text-xs"
                >
                  Same as From (same-token)
                </Button>
                {autoSwapPrefs?.outputToken && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setRecoverToToken(autoSwapPrefs.outputToken)}
                    className="text-xs"
                  >
                    Use my output preference
                  </Button>
                )}
              </div>
            </div>

            {recoverPairValid && (
              <div
                className={`p-3 rounded-lg border text-sm ${
                  hasStuckIntent
                    ? 'bg-yellow-50 border-yellow-200 text-yellow-800'
                    : 'bg-gray-50 border-gray-200 text-gray-700'
                }`}
              >
                {hasStuckIntent ? (
                  <>
                    Stuck intent found.
                    {stuckIntent &&
                      ` Locked: ${formatUnits(
                        stuckIntent.inputAmount,
                        balancesArray.find(a => a.address.toLowerCase() === stuckIntent.inputToken.toLowerCase())
                          ?.decimal ?? 18,
                      )} (${stuckIntent.inputToken.slice(0, 10)}...${stuckIntent.inputToken.slice(-8)}).`}{' '}
                    Click Recover to return the tokens to your wallet.
                  </>
                ) : (
                  'No stuck intent found for this token pair.'
                )}
              </div>
            )}

            <Button
              onClick={handleRecover}
              disabled={recoverLoading || !srcAddress || !walletProvider || !recoverPairValid}
            >
              {recoverLoading ? 'Recovering...' : 'Recover'}
            </Button>

            {recoverError && (
              <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-black text-sm break-all">
                {recoverError}
              </div>
            )}
            {recoverSuccess && (
              <div className="p-3 bg-green-500/20 border border-green-500/50 rounded-lg text-black text-sm break-all">
                {recoverSuccess}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
