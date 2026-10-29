# Recipe: Bridge

Cross-chain token transfers via the hub-and-spoke vault architecture.

**Depends on:** [setup.md](setup.md), [wallet-connectivity.md](wallet-connectivity.md)

## Hooks

| Hook | Type | Purpose |
|------|------|---------|
| `useBridge` | Mutation | Execute a cross-chain bridge transfer |
| `useBridgeAllowance` | Query | Check if token approval is needed |
| `useBridgeApprove` | Mutation | Approve tokens for bridge |
| `useBridgeWithApproval` | Mutation | Bridge with the approval folded in — one signature on an EIP-5792 wallet |
| `useBridgeApprovalStrategy` | Query | Which approval path `useBridgeWithApproval` would take, for the button label |
| `useGetBridgeableAmount` | Query | Available bridgeable amount between two tokens |
| `useGetBridgeableTokens` | Query | Tokens bridgeable to a destination chain |

## Check Bridgeable Tokens

```tsx
import { useGetBridgeableTokens } from '@sodax/dapp-kit';
import { ChainKeys } from '@sodax/sdk';

function BridgeableTokensList() {
  // `data` is `XToken[] | undefined` — the hook throws on SDK `!ok` so we get the unwrapped value.
  const { data: tokens } = useGetBridgeableTokens({
    params: { from: ChainKeys.BASE_MAINNET, to: ChainKeys.POLYGON_MAINNET, token: '0x0000000000000000000000000000000000000000' },
  });

  if (tokens) {
    return <ul>{tokens.map((t) => <li key={t.address}>{t.symbol}</li>)}</ul>;
  }
  return null;
}
```

## Check Allowance + Approve

```tsx
import { useBridgeAllowance, useBridgeApprove } from '@sodax/dapp-kit';
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/sdk';
import type { CreateBridgeIntentParams } from '@sodax/sdk';

function BridgeApproval({ params }: { params: CreateBridgeIntentParams }) {
  const walletProvider = useWalletProvider({ xChainId: ChainKeys.BASE_MAINNET });
  // useBridgeAllowance wraps payload + walletProvider under params (not at top level).
  const { data: isApproved } = useBridgeAllowance({
    params: { payload: params, walletProvider },
  });
  const { mutateAsync: approve, isPending } = useBridgeApprove();

  if (isApproved) return null;
  return (
    <button onClick={() => walletProvider && approve({ params, walletProvider })} disabled={isPending}>
      {isPending ? 'Approving...' : 'Approve for Bridge'}
    </button>
  );
}
```

## Execute Bridge

```tsx
import { useBridge } from '@sodax/dapp-kit';
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/sdk';

function BridgeButton({ srcAddress }: { srcAddress: `0x${string}` }) {
  const walletProvider = useWalletProvider({ xChainId: ChainKeys.BASE_MAINNET });
  const { mutateAsync: bridge, isPending } = useBridge();

  const handleBridge = async () => {
    if (!walletProvider) return;
    try {
      const { srcChainTxHash, dstChainTxHash } = await bridge({
        params: {
          srcChainKey: ChainKeys.BASE_MAINNET,
          srcAddress,
          srcToken: '0x0000000000000000000000000000000000000000',
          amount: 1000000000000000000n,
          dstChainKey: ChainKeys.POLYGON_MAINNET,
          dstToken: '0x0000000000000000000000000000000000000000',
          recipient: '0x0000000000000000000000000000000000000000',
        },
        walletProvider,
      });
      console.log('Bridge successful:', { srcChainTxHash, dstChainTxHash });
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <button onClick={handleBridge} disabled={isPending}>
      {isPending ? 'Bridging...' : 'Bridge'}
    </button>
  );
}
```

## Full Example

```tsx
import { useState } from 'react';
import { useBridge, useBridgeAllowance, useBridgeApprove, useGetBridgeableAmount } from '@sodax/dapp-kit';
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys, type XToken } from '@sodax/sdk';
import type { CreateBridgeIntentParams } from '@sodax/sdk';
import { parseUnits, formatUnits } from 'viem';

export function BridgePage({ srcXToken, dstXToken, srcAddress }: { srcXToken: XToken; dstXToken: XToken; srcAddress: `0x${string}` }) {
  const [amount, setAmount] = useState('');
  const walletProvider = useWalletProvider({ xChainId: ChainKeys.BASE_MAINNET });
  const parsedAmount = amount ? parseUnits(amount, 6) : 0n;

  const bridgeParams: CreateBridgeIntentParams<typeof ChainKeys.BASE_MAINNET> | undefined = parsedAmount > 0n
    ? {
        srcChainKey: ChainKeys.BASE_MAINNET,
        srcAddress,
        srcToken: srcXToken.address,
        amount: parsedAmount,
        dstChainKey: ChainKeys.POLYGON_MAINNET,
        dstToken: dstXToken.address,
        recipient: '0x0000000000000000000000000000000000000000',
      }
    : undefined;

  // useGetBridgeableAmount in v2 takes a pair of XToken objects (each carries chainKey).
  // `data` is `BridgeLimit | undefined` (already unwrapped; hook throws on SDK !ok).
  const { data: bridgeableAmount } = useGetBridgeableAmount({
    params: { from: srcXToken, to: dstXToken },
  });
  const { data: isApproved } = useBridgeAllowance({
    params: bridgeParams ? { payload: bridgeParams, walletProvider } : undefined,
  });
  const { mutateAsyncSafe: approve, isPending: isApproving } = useBridgeApprove();
  const { mutateAsyncSafe: bridge, isPending: isBridging } = useBridge();

  const handleBridge = async () => {
    if (!bridgeParams || !walletProvider) return;
    if (!isApproved) {
      const r = await approve({ params: bridgeParams, walletProvider });
      if (!r.ok) { alert(r.error instanceof Error ? r.error.message : 'Approve failed'); return; }
    }
    const r = await bridge({ params: bridgeParams, walletProvider });
    if (r.ok) alert(`Bridge complete! src=${r.value.srcChainTxHash}`);
    else alert(r.error instanceof Error ? r.error.message : 'Bridge failed');
  };

  return (
    <div>
      <input placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
      {bridgeableAmount && <p>Max: {formatUnits(bridgeableAmount.amount, bridgeableAmount.decimals)}</p>}
      <button onClick={handleBridge} disabled={isBridging || isApproving || !bridgeParams || !walletProvider}>
        {isApproving ? 'Approving...' : isBridging ? 'Bridging...' : 'Bridge'}
      </button>
    </div>
  );
}
```

## Types

```typescript
type CreateBridgeIntentParams<K extends SpokeChainKey = SpokeChainKey> = {
  srcChainKey: K;
  srcAddress: string;
  srcToken: string;
  amount: bigint;
  dstChainKey: SpokeChainKey;
  dstToken: string;
  recipient: string;   // non-encoded recipient address on the destination chain
};
```
