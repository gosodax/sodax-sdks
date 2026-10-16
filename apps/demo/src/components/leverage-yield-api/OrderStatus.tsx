import React, { useMemo } from 'react';
import { useLeverageYieldApiSubmitTxStatus } from '@sodax/dapp-kit';

export type LeverageYieldApiOrder = {
  txHash: string;
  srcChainKey: string;
  apiBaseURL: string;
  kind: 'deposit' | 'withdraw';
};

export default function OrderStatus({ order }: { order: LeverageYieldApiOrder }) {
  const apiConfig = useMemo(() => ({ baseURL: order.apiBaseURL }), [order.apiBaseURL]);
  // Polls /leverage-yield/submit-tx/status every second and stops on 'solved' | 'failed'.
  const { data: statusResponse } = useLeverageYieldApiSubmitTxStatus({
    params: { txHash: order.txHash, srcChainKey: order.srcChainKey, apiConfig },
  });

  if (!statusResponse) {
    return (
      <div className="flex flex-col text-center pb-4 wrap-anywhere">
        <div>
          {order.kind === 'deposit' ? 'Deposit' : 'Withdraw'} Tx Hash: {order.txHash}
        </div>
        <div>Status: Loading...</div>
      </div>
    );
  }

  const { status, result, failedAtStep, failureReason, userMessage } = statusResponse.data;

  return (
    <div className="flex flex-col text-center pb-4 wrap-anywhere">
      <div>
        {order.kind === 'deposit' ? 'Deposit' : 'Withdraw'} Tx Hash: {order.txHash}
      </div>
      <div>Src Chain: {order.srcChainKey}</div>
      <div>Status: {status}</div>
      {status === 'solved' && result?.dstIntentTxHash && <div>Dst Intent Tx Hash: {result.dstIntentTxHash}</div>}
      {status === 'solved' && result?.intent_hash && <div>Intent Hash: {result.intent_hash}</div>}
      {status === 'failed' && failedAtStep && <div className="text-red-500">Failed at: {failedAtStep}</div>}
      {status === 'failed' && failureReason && <div className="text-red-500">Reason: {failureReason}</div>}
      {userMessage && <div className="text-muted-foreground">{userMessage}</div>}
    </div>
  );
}
