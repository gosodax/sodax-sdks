import React, { useMemo } from 'react';
import { useBridgeApiSubmitTxStatus } from '@sodax/dapp-kit';

export type BridgeApiOrder = {
  txHash: string;
  srcChainKey: string;
  apiBaseURL: string;
};

export default function OrderStatus({ order }: { order: BridgeApiOrder }) {
  const apiConfig = useMemo(() => ({ baseURL: order.apiBaseURL }), [order.apiBaseURL]);
  // Polls /bridge/submit-tx/status every second and stops on 'executed' | 'failed'.
  const { data: statusResponse } = useBridgeApiSubmitTxStatus({
    params: { txHash: order.txHash, srcChainKey: order.srcChainKey, apiConfig },
  });

  if (!statusResponse) {
    return (
      <div className="flex flex-col text-center pb-4 wrap-anywhere">
        <div>Tx Hash: {order.txHash}</div>
        <div>Status: Loading...</div>
      </div>
    );
  }

  const { status, result, failedAtStep, failureReason, userMessage } = statusResponse.data;

  return (
    <div className="flex flex-col text-center pb-4 wrap-anywhere">
      <div>Tx Hash: {order.txHash}</div>
      <div>Src Chain ID: {order.srcChainKey}</div>
      <div>Status: {status}</div>
      {/* No solver intent_hash for bridge — destination tx hash is the terminal artifact. */}
      {status === 'executed' && result?.dstIntentTxHash && <div>Dst Intent Tx Hash: {result.dstIntentTxHash}</div>}
      {status === 'failed' && failedAtStep && <div className="text-red-500">Failed at: {failedAtStep}</div>}
      {status === 'failed' && failureReason && <div className="text-red-500">Reason: {failureReason}</div>}
      {userMessage && <div className="text-muted-foreground">{userMessage}</div>}
    </div>
  );
}
