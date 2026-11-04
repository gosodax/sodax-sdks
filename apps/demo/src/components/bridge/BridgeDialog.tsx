import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  ACCOUNT_UPGRADE_DECLINED,
  isSodaxError,
  useBridgeApprovalStrategy,
  useBridgeWithApproval,
  useStellarGate,
  useBitcoinBalance,
  useNearStorageGate,
  ChainKeys,
  type ChainType,
  type SpokeChainKey,
  type XToken,
  type GetWalletProviderType,
  type IBitcoinWalletProvider,
  type CreateBridgeIntentParams,
} from '@sodax/dapp-kit';
import { useEvmSwitchChain, useWalletProvider, useXAccount } from '@sodax/wallet-sdk-react';
import { BitcoinSetupPanel } from '@/components/bitcoin/BitcoinSetupPanel';
import { formatMutationFailureMessage, rescaleTokenAmount } from '@/lib/utils';
import { type UnconfirmedBatch, unconfirmedBatchOf } from '@/lib/heldBatch';
import { ArrowLeftRight, Loader2 } from 'lucide-react';
import { formatUnits } from 'viem';

/** A bridge batch the wallet took but never confirmed, kept with the order it was sent for. */
export type HeldBridgeBatch = UnconfirmedBatch & { order: CreateBridgeIntentParams };

interface BridgeDialogProps {
  open: boolean;
  onClose: () => void;
  order: CreateBridgeIntentParams;
  fromToken: XToken | undefined;
  toToken: XToken | undefined;
  walletProvider: GetWalletProviderType<SpokeChainKey>;
  fromChainType: ChainType | undefined;
  toChainKey: SpokeChainKey;
  /** A batch the wallet took but never confirmed. Owned by the manager, which outlives this dialog. */
  heldBatch: HeldBridgeBatch | null;
  onBatchHeld: (batch: HeldBridgeBatch | null) => void;
}

export function BridgeDialog({
  open,
  onClose,
  order,
  fromToken,
  toToken,
  walletProvider,
  fromChainType,
  toChainKey,
  heldBatch,
  onBatchHeld,
}: BridgeDialogProps) {
  const [isFromBtcReady, setIsFromBtcReady] = useState(false);
  const [isToBtcReady, setIsToBtcReady] = useState(false);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [allowAccountUpgrade, setAllowAccountUpgrade] = useState(true);
  const [upgradeDeclined, setUpgradeDeclined] = useState(false);

  useEffect(() => {
    if (!open) return;
    setBridgeError(null);
    setUpgradeDeclined(false);
  }, [open]);

  const toAccount = useXAccount({ xChainId: toChainKey });

  const { data: approvalStrategy } = useBridgeApprovalStrategy({
    params: {
      payload: order,
      walletProvider: walletProvider as GetWalletProviderType<typeof order.srcChainKey>,
      allowAccountUpgrade,
    },
  });

  const { mutateAsyncSafe: bridgeWithApproval, isPending: isBridging } = useBridgeWithApproval();

  const { isWrongChain, handleSwitchChain } = useEvmSwitchChain({ xChainId: order.srcChainKey });

  const toWalletProvider = useWalletProvider({ xChainId: toChainKey });
  // Batches are EVM-only; the source chain may have changed since the held one was sent.
  const evmWalletProvider = useWalletProvider({ xChainType: 'EVM' });

  const fromBtcWalletProvider =
    walletProvider.chainType === 'BITCOIN' ? (walletProvider as IBitcoinWalletProvider) : undefined;
  const toBtcWalletProvider =
    toWalletProvider?.chainType === 'BITCOIN' ? (toWalletProvider as IBitcoinWalletProvider) : undefined;

  // The gate checks the DESTINATION asset, so the amount must be in its decimals too — Stellar's
  // trustline check works in stroops (7dp). `order.amount` is source-denominated, so an 18dp source
  // would overstate it by 1e11 and block on a healthy trustline. Left undefined while either side's
  // decimals are unknown: `resolveStellarGate` reads that as unresolved and fails closed.
  const dstAmount =
    fromToken && toToken ? rescaleTokenAmount(order.amount, fromToken.decimals, toToken.decimals) : undefined;

  // Below the destination asset's smallest unit the rescale floors to `0n`, which the trustline
  // query reads as "no amount" and skips — the gate then blocks on an unresolved check with nothing
  // on screen. Reject the amount so the dialog can say why.
  const isBelowDestinationUnit = dstAmount === 0n && order.amount > 0n;

  const stellar = useStellarGate({
    dstChainKey: toChainKey,
    token: order.dstToken,
    amount: isBelowDestinationUnit ? undefined : dstAmount,
    address: toAccount.address,
    walletProvider: toWalletProvider,
  });

  const nearStorage = useNearStorageGate({
    dstChainKey: toChainKey,
    token: order.dstToken,
    accountId: toAccount.address,
    walletProvider: toWalletProvider,
  });

  const toBtcAddress = toChainKey === ChainKeys.BITCOIN_MAINNET ? toAccount.address : undefined;
  const { data: toBtcBalance } = useBitcoinBalance({ params: { address: toBtcAddress } });

  const handleBridge = async (upgrade = allowAccountUpgrade): Promise<void> => {
    setBridgeError(null);
    setUpgradeDeclined(false);
    const result = await bridgeWithApproval({ params: order, walletProvider, allowAccountUpgrade: upgrade });
    if (!result.ok) {
      const { error } = result;
      const batch = unconfirmedBatchOf(error);
      const context = isSodaxError(error) ? error.context : undefined;
      if (batch) {
        onBatchHeld({ ...batch, order });
      } else if (context?.reason === ACCOUNT_UPGRADE_DECLINED) {
        setUpgradeDeclined(true);
      } else {
        setBridgeError(formatMutationFailureMessage(error, 'Bridge failed'));
      }
      return;
    }
    onClose();
  };

  // Sends nothing: waits for the held batch again and finishes the bridge once it lands.
  const recheckHeldBatch = async (): Promise<void> => {
    if (!heldBatch) return;
    if (!evmWalletProvider) {
      setBridgeError('Connect the EVM wallet that sent the batch to check it.');
      return;
    }
    setBridgeError(null);
    const result = await bridgeWithApproval({
      params: heldBatch.order,
      walletProvider: evmWalletProvider,
      resumeBatchId: heldBatch.batchId,
      resumeBatchCallCount: heldBatch.callCount,
    });
    if (result.ok) {
      onBatchHeld(null);
      onClose();
      return;
    }
    const context = isSodaxError(result.error) ? result.error.context : undefined;
    if (unconfirmedBatchOf(result.error)) {
      setBridgeError('The batch is still not confirmed. Check again in a moment.');
    } else if (context?.reason === 'atomic-batch-failed') {
      onBatchHeld(null);
      setBridgeError('The batch never landed, so nothing was bridged.');
    } else {
      setBridgeError(formatMutationFailureMessage(result.error, 'Recheck failed'));
    }
  };

  const bridgeWithoutUpgrade = async (): Promise<void> => {
    setAllowAccountUpgrade(false);
    await handleBridge(false);
  };

  const handleActivateStellarAccount = async () => {
    const result = await stellar.activate();
    if (result && !result.ok) {
      setBridgeError(formatMutationFailureMessage(result.error, 'Stellar account activation failed'));
    }
  };

  const handleRequestTrustline = async () => {
    const result = await stellar.requestTrustline();
    if (result && !result.ok) {
      setBridgeError(formatMutationFailureMessage(result.error, 'Trustline request failed'));
    }
  };

  const handleRegisterNearStorage = async () => {
    const result = await nearStorage.registerStorage();
    if (result && !result.ok) {
      setBridgeError(formatMutationFailureMessage(result.error, 'Storage registration failed'));
    }
  };

  const isBridgeDisabled =
    isBridging ||
    heldBatch !== null ||
    isBelowDestinationUnit ||
    (order.srcChainKey === ChainKeys.BITCOIN_MAINNET && !isFromBtcReady) ||
    (toChainKey === ChainKeys.BITCOIN_MAINNET && !isToBtcReady) ||
    stellar.blocksAction ||
    nearStorage.blocksAction;

  return (
    <Dialog open={open} onOpenChange={isOpen => !isOpen && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Bridge Order</DialogTitle>
          <DialogDescription>Review and confirm your cross-chain transfer.</DialogDescription>
        </DialogHeader>

        <div className="space-y-2 text-sm">
          <div>
            From: {fromToken?.symbol ?? order.srcToken} on {order.srcChainKey}
          </div>
          <div>
            To: {toToken?.symbol ?? order.dstToken} on {order.dstChainKey}
          </div>
          <div>Amount: {formatUnits(order.amount, fromToken?.decimals ?? 0)}</div>
          <div className="break-all">Recipient: {order.recipient}</div>

          {isBelowDestinationUnit && toToken && (
            <div className="text-red-500">
              Amount is below the smallest {toToken.symbol} unit on {order.dstChainKey} — close this and bridge at least{' '}
              {formatUnits(1n, toToken.decimals)}.
            </div>
          )}

          {/* Keep activation in-flow; funding has no client-side remedy. */}
          {stellar.needsActivation && (
            <div className="text-red-500">
              Recipient's Stellar account does not exist yet — activate it to proceed. SODAX sponsors the reserve, so
              this is free.
            </div>
          )}

          {stellar.needsFunding && (
            <div className="text-red-500">
              Recipient's Stellar account holds no XLM, so it cannot pay for a trustline. Send it some XLM first —
              receiving XLM needs no trustline.
            </div>
          )}

          {stellar.needsTrustline && (
            <div className="text-red-500">Insufficient Stellar trustline — request trustline to proceed.</div>
          )}

          {stellar.checkFailed && (
            <div className="text-red-500">
              Couldn't check the recipient's Stellar account, so the bridge is on hold
              {stellar.error ? `: ${stellar.error.message}` : ''}
            </div>
          )}

          {nearStorage.needsRegistration && (
            <div className="text-red-500">
              Recipient is not storage-registered for this token on NEAR — register storage to proceed.
            </div>
          )}
        </div>

        {fromBtcWalletProvider && order.srcChainKey === ChainKeys.BITCOIN_MAINNET && (
          <BitcoinSetupPanel walletProvider={fromBtcWalletProvider} onReadyChange={setIsFromBtcReady} />
        )}

        {toBtcWalletProvider && toChainKey === ChainKeys.BITCOIN_MAINNET && toBtcBalance !== undefined && (
          <BitcoinSetupPanel
            walletProvider={toBtcWalletProvider}
            onReadyChange={setIsToBtcReady}
            nativeBalance={toBtcBalance}
            isDestination
          />
        )}

        {bridgeError && <div className="text-red-500 text-sm wrap-anywhere">{bridgeError}</div>}

        {heldBatch !== null && (
          <div className="text-amber-600 text-sm wrap-anywhere">
            Your wallet sent the bridge (batch {heldBatch.batchId}) but it was not confirmed in time. It may still land,
            so check it again instead of bridging again.{' '}
            <button type="button" className="underline" disabled={isBridging} onClick={() => void recheckHeldBatch()}>
              {isBridging ? 'Checking…' : 'Check the batch again'}
            </button>
            {' · '}
            <button type="button" className="underline" onClick={() => onBatchHeld(null)}>
              I checked — start over
            </button>
          </div>
        )}

        {upgradeDeclined && (
          <div className="text-amber-600 text-sm">
            You declined the smart account upgrade, so nothing was sent.{' '}
            <button type="button" className="underline" onClick={() => void bridgeWithoutUpgrade()}>
              Bridge without upgrading (2 signatures)
            </button>
          </div>
        )}

        <DialogFooter className="flex flex-col gap-2 sm:flex-col">
          {stellar.isStellar && stellar.isChecking && <span className="text-sm">Checking Stellar account…</span>}

          {stellar.needsActivation && (
            <Button className="w-full" onClick={handleActivateStellarAccount} disabled={stellar.isActivating}>
              {stellar.isActivating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Activating…
                </>
              ) : (
                'Activate Stellar Account'
              )}
            </Button>
          )}

          {stellar.needsTrustline && (
            <Button className="w-full" onClick={handleRequestTrustline} disabled={stellar.isRequestingTrustline}>
              {stellar.isRequestingTrustline ? 'Requesting…' : 'Request Trustline'}
            </Button>
          )}

          {stellar.checkFailed && (
            <Button className="w-full" onClick={stellar.retry} disabled={stellar.isChecking}>
              {stellar.isChecking ? 'Rechecking…' : 'Retry Stellar Check'}
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
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Checking storage…
                </>
              ) : nearStorage.isRegistering ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Registering…
                </>
              ) : (
                'Register Storage'
              )}
            </Button>
          )}

          {isWrongChain && fromChainType === 'EVM' && (
            <Button className="w-full" onClick={handleSwitchChain}>
              Switch Chain
            </Button>
          )}

          {!isWrongChain && (
            <Button className="w-full" onClick={() => void handleBridge()} disabled={isBridgeDisabled}>
              {isBridging ? (
                'Bridging…'
              ) : (
                <>
                  <ArrowLeftRight className="mr-2 h-4 w-4" />{' '}
                  {approvalStrategy === 'atomic-batch'
                    ? 'Approve & Bridge (1 signature)'
                    : approvalStrategy === 'sequential'
                      ? 'Approve, then Bridge'
                      : 'Bridge'}
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
