# Recipe: DEX

Concentrated liquidity positions and asset management.

**Depends on:** [setup.md](setup.md), [wallet-connectivity.md](wallet-connectivity.md)

## Hooks

### Assets

| Hook | Type | Purpose |
|------|------|---------|
| `useDexDeposit` | Mutation | Deposit assets into pool tokens |
| `useDexWithdraw` | Mutation | Withdraw assets from pool tokens |
| `useDexAllowance` | Query | Check approval for deposit |
| `useDexApprove` | Mutation | Approve tokens |
| `usePoolBalances` | Query | User's pool token balances |

### Liquidity

| Hook | Type | Purpose |
|------|------|---------|
| `useSupplyLiquidity` | Mutation | Supply liquidity to a position |
| `useDecreaseLiquidity` | Mutation | Remove liquidity |
| `useClaimRewards` | Mutation | Claim trading fees |
| `usePools` | Query | List available pools |
| `usePoolData` | Query | Pool details (price, tick, liquidity) |
| `usePositionInfo` | Query | Position details |
| `useLiquidityAmounts` | Query | Token amounts for a tick range |

### Param Builders

| Hook | Purpose |
|------|---------|
| `useCreateDepositParams` | Build deposit params with ERC-4626 conversion |
| `useCreateWithdrawParams` | Build withdraw params |
| `useCreateSupplyLiquidityParams` | Build tick range + liquidity params |
| `useCreateDecreaseLiquidityParams` | Build decrease params from position state |

## List Pools

```tsx
import { usePools } from '@sodax/dapp-kit';

function PoolsList() {
  // `usePools` returns `PoolKey[]` — pool keys carry `currency0`, `currency1`, `fee`,
  // `hooks`, `poolManager`, and `parameters`. Resolve token symbols via your own
  // token-list lookup (e.g. config-derived).
  const { data: pools } = usePools({});
  return (
    <div>
      {pools?.map((pool, i) => (
        <div key={`${pool.currency0}-${pool.currency1}-${pool.fee}-${i}`}>
          <h3>{pool.currency0} / {pool.currency1}</h3>
          <p>Fee: {pool.fee / 10000}%</p>
        </div>
      ))}
    </div>
  );
}
```

## Deposit Assets

```tsx
import { useDexDeposit, useDexAllowance, useDexApprove } from '@sodax/dapp-kit';
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys, type CreateAssetDepositParams } from '@sodax/sdk';

function DepositToPool({ srcAddress }: { srcAddress: `0x${string}` }) {
  const walletProvider = useWalletProvider({ xChainId: ChainKeys.BASE_MAINNET });
  const depositParams: CreateAssetDepositParams<typeof ChainKeys.BASE_MAINNET> = {
    srcChainKey: ChainKeys.BASE_MAINNET,
    srcAddress,
    asset: '0x0000000000000000000000000000000000000000',
    amount: 1_000_000_000_000_000_000n,
    poolToken: '0x0000000000000000000000000000000000000000',
  };

  // useDexAllowance wraps CreateAssetDepositParams under params.payload. Read-only;
  // no walletProvider needed (the SDK call uses `raw: true`).
  const { data: isApproved } = useDexAllowance({
    params: { payload: depositParams },
  });
  const { mutateAsync: approve, isPending: isApproving } = useDexApprove();
  const { mutateAsync: deposit, isPending: isDepositing } = useDexDeposit();

  const handleDeposit = async () => {
    if (!walletProvider) return;
    try {
      if (!isApproved) await approve({ params: depositParams, walletProvider });
      const txHashPair = await deposit({ params: depositParams, walletProvider });
      console.log('Deposited:', txHashPair);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <button onClick={handleDeposit} disabled={isDepositing || isApproving || !walletProvider}>
      {isApproving ? 'Approving...' : isDepositing ? 'Depositing...' : 'Deposit'}
    </button>
  );
}
```

## Supply Liquidity

```tsx
// @ai-snippets-skip — illustrative flow only; `useCreateSupplyLiquidityParams` takes
// a flat shape `{ poolData, poolKey, minPrice, maxPrice, liquidityToken0Amount,
// liquidityToken1Amount, slippageTolerance }` and the consumer must add
// `srcChainKey` + `srcAddress` at the mutation call site. Real consumers should
// reference `useCreateSupplyLiquidityParams` source for the full param set.
import { useSupplyLiquidity, useCreateSupplyLiquidityParams } from '@sodax/dapp-kit';
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/sdk';

function SupplyLiquidity() {
  const walletProvider = useWalletProvider({ xChainId: ChainKeys.BASE_MAINNET });
  const supplyParams = useCreateSupplyLiquidityParams({
    params: {
      poolKey: { /* ... */ },
      tickLower: -60000n,
      tickUpper: 60000n,
      amount0: 1_000_000_000_000_000_000n,
      amount1: 1_000_000_000_000_000_000n,
    },
  });
  const { mutateAsync: supplyLiquidity, isPending } = useSupplyLiquidity();

  return (
    <button
      disabled={isPending || !supplyParams || !walletProvider}
      onClick={async () => {
        if (!supplyParams || !walletProvider) return;
        try {
          const txHashPair = await supplyLiquidity({ params: supplyParams, walletProvider });
          console.log('Supplied:', txHashPair);
        } catch (e) {
          console.error(e);
        }
      }}
    >
      {isPending ? 'Supplying...' : 'Supply Liquidity'}
    </button>
  );
}
```

## Position + Claim Rewards

```tsx
// @ai-snippets-skip — illustrative flow only. Real call-shape notes:
//   - `usePositionInfo` params.tokenId is `string | null`, not bigint
//   - `usePositionInfo` data is `{ positionInfo: ClPositionInfo, isValid: boolean }` —
//     access `position.positionInfo.liquidity` etc.
//   - `useClaimRewards` params shape: `{ srcChainKey, srcAddress, poolKey, tokenId,
//     tickLower, tickUpper }` — far richer than shown.
// See `features/dex.md` for the canonical param types.
import { usePositionInfo, useClaimRewards } from '@sodax/dapp-kit';
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/sdk';
import type { PoolKey } from '@sodax/sdk';

function Position({ positionId, poolKey }: { positionId: bigint; poolKey: PoolKey }) {
  const walletProvider = useWalletProvider({ xChainId: ChainKeys.BASE_MAINNET });
  const { data: position } = usePositionInfo({ params: { tokenId: positionId, poolKey } });
  const { mutateAsync: claimRewards, isPending } = useClaimRewards();

  if (!position) return null;
  return (
    <div>
      <p>Liquidity: {position.liquidity.toString()}</p>
      <p>Range: [{position.tickLower}, {position.tickUpper}]</p>
      <button
        onClick={() => walletProvider && claimRewards({ params: { srcChainKey: ChainKeys.BASE_MAINNET, positionId }, walletProvider })}
        disabled={isPending || !walletProvider}
      >
        Claim Fees
      </button>
    </div>
  );
}
```

## Remove Liquidity

Size `amount0Min` / `amount1Min` from the position with `useCreateDecreaseLiquidityParams` (slippage in percent). Zero minimums accept any price. It throws during render when `percentage` or `slippageTolerance` is outside (0, 100], so clamp slider and input values before passing them.

```tsx
import { isUserRejectedError, useCreateDecreaseLiquidityParams, useDecreaseLiquidity } from '@sodax/dapp-kit';
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys, type Address, type ClPositionInfo, type PoolKey } from '@sodax/sdk';

function RemoveLiquidity({ poolKey, tokenId, positionInfo, srcAddress }: { poolKey: PoolKey; tokenId: bigint; positionInfo: ClPositionInfo; srcAddress: Address }) {
  const walletProvider = useWalletProvider({ xChainId: ChainKeys.BASE_MAINNET });
  const { mutateAsyncSafe: decreaseLiquidity, isPending } = useDecreaseLiquidity();
  // positionInfo from usePositionInfo({ params: { tokenId: tokenId.toString(), poolKey } }).data.positionInfo
  const decrease = useCreateDecreaseLiquidityParams({ poolKey, tokenId, percentage: 50, positionInfo, slippageTolerance: 1 });

  const onRemove = async () => {
    if (!walletProvider) return;
    const result = await decreaseLiquidity({
      params: { ...decrease, srcChainKey: ChainKeys.BASE_MAINNET, srcAddress },
      walletProvider,
    });
    if (!result.ok && !isUserRejectedError(result.error)) console.error(result.error); // surface it in your UI
  };

  return <button onClick={onRemove} disabled={isPending || !walletProvider}>Remove 50%</button>;
}
```

## Notes

- **Two-step flow**: deposit assets (spoke → hub pool tokens) then supply liquidity (pool tokens → position).
- **Ticks**: logarithmic price units (like Uniswap V3). Wider range = more trades, less capital efficiency.
- **ERC-4626**: pool tokens are vault shares. Use `useCreateDepositParams` to handle the conversion.
