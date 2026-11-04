import React from 'react';
import { Button } from '@/components/ui/button';
import { TableCell, TableRow } from '@/components/ui/table';
import { formatUnits } from 'viem';
import {
  type IntentResponse,
  type Intent,
  type IntentRelayChainId,
  type SpokeChainKey,
  useCancelLimitOrder,
  useSodaxContext,
} from '@sodax/dapp-kit';
import { useMemo } from 'react';
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';

interface LimitOrderItemProps {
  intent: IntentResponse;
}

/**
 * Component for displaying a single limit order in the table
 */
export default function LimitOrderItem({ intent }: LimitOrderItemProps) {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  const srcChainKey = sodax.config.getSpokeChainKeyFromIntentRelayChainId(
    BigInt(intent.intent.srcChain) as IntentRelayChainId,
  ) as SpokeChainKey;
  const dstChainKey = sodax.config.getSpokeChainKeyFromIntentRelayChainId(
    BigInt(intent.intent.dstChain) as IntentRelayChainId,
  ) as SpokeChainKey;

  // Find tokens by address on their respective chains
  const inputToken = useMemo(() => {
    // !TODO: make a util function to find token by spoke chain id and hub asset address. and simplify the code.
    const originalAssetAddress = sodax.config.getOriginalAssetAddress(
      srcChainKey,
      intent.intent.inputToken as `0x${string}`,
    );
    return originalAssetAddress
      ? sodax.config
          .getSupportedTokensPerChain()
          .get(srcChainKey)
          ?.find(token => token.address.toLowerCase() === originalAssetAddress.toLowerCase())
      : undefined;
  }, [srcChainKey, intent.intent.inputToken, sodax.config]);

  const outputToken = useMemo(() => {
    // !TODO: make a util function to find token by spoke chain id and hub asset address. and simplify the code.
    const originalAssetAddress = sodax.config.getOriginalAssetAddress(
      dstChainKey,
      intent.intent.outputToken as `0x${string}`,
    );
    return originalAssetAddress
      ? sodax.config
          .getSupportedTokensPerChain()
          .get(dstChainKey)
          ?.find(token => token.address.toLowerCase() === originalAssetAddress.toLowerCase())
      : undefined;
  }, [dstChainKey, intent.intent.outputToken, sodax.config]);

  // Format amounts
  const inputAmount = useMemo(() => {
    if (!inputToken) {
      return undefined;
    }

    return formatUnits(BigInt(intent.intent.inputAmount), inputToken.decimals);
  }, [intent.intent.inputAmount, inputToken]);

  const outputAmount = useMemo(() => {
    if (!outputToken) {
      return undefined;
    }

    return formatUnits(BigInt(intent.intent.minOutputAmount), outputToken.decimals);
  }, [intent.intent.minOutputAmount, outputToken]);

  // Wallet provider for canceling (use srcChain since that's where the intent was created)
  const walletProvider = useWalletProvider({ xChainId: srcChainKey });
  const { mutateAsync: cancelLimitOrder, isPending: isCanceling } = useCancelLimitOrder();

  const handleCancel = async (): Promise<void> => {
    try {
      if (!walletProvider) {
        return;
      }
      const intentData: Intent = {
        intentId: BigInt(intent.intent.intentId),
        creator: intent.intent.creator as `0x${string}`,
        inputToken: intent.intent.inputToken as `0x${string}`,
        outputToken: intent.intent.outputToken as `0x${string}`,
        inputAmount: BigInt(intent.intent.inputAmount),
        minOutputAmount: BigInt(intent.intent.minOutputAmount),
        deadline: BigInt(intent.intent.deadline),
        allowPartialFill: intent.intent.allowPartialFill,
        srcChain: BigInt(intent.intent.srcChain) as IntentRelayChainId,
        dstChain: BigInt(intent.intent.dstChain) as IntentRelayChainId,
        srcAddress: intent.intent.srcAddress as `0x${string}`,
        dstAddress: intent.intent.dstAddress as `0x${string}`,
        solver: intent.intent.solver as `0x${string}`,
        data: intent.intent.data as `0x${string}`,
      };

      await cancelLimitOrder({ intent: intentData, srcChainKey: srcChainKey, walletProvider });
      // Invalidate queries to refresh the list
      queryClient.invalidateQueries({ queryKey: ['backend', 'intent', 'user'] });
    } catch (error) {
      console.error('Error canceling intent:', error);
    }
  };

  if (!inputToken || !outputToken || !inputAmount || !outputAmount) {
    console.log('invalid intent', intent);
    return (
      <TableRow>
        <TableCell colSpan={3} className="text-center">
          <div className="text-muted-foreground">Invalid token or amount</div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow>
      <TableCell className="font-medium wrap-anywhere">
        {inputAmount} {inputToken.symbol} on {inputToken.chainKey}
      </TableCell>
      <TableCell className="font-medium wrap-anywhere">
        {outputAmount} {outputToken.symbol} on {outputToken.chainKey}
      </TableCell>
      <TableCell className="text-right">
        {intent.open ? (
          <Button size="sm" onClick={handleCancel} disabled={isCanceling}>
            <X className="h-4 w-4 mr-1" />
            {isCanceling ? 'Canceling...' : 'Cancel'}
          </Button>
        ) : (
          <span className="text-muted-foreground font-medium">Solved</span>
        )}
      </TableCell>
    </TableRow>
  );
}
