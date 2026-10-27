# Recipe: Bridge to `@sodax/sdk`

Pass the constructed provider to `@sodax/sdk` so the SDK can sign and submit hub/spoke transactions on the user's behalf.

**Depends on:** a constructed provider (see [`setup-private-key.md`](./setup-private-key.md) or [`setup-browser-extension.md`](./setup-browser-extension.md)).

---

## The contract: `IXxxWalletProvider`

`@sodax/sdk` consumes the chain-specific **interfaces** from `@sodax/types`, not the concrete classes. This is the indirection that keeps the SDK decoupled from `wallet-sdk-core`:

```ts
import type {
  IEvmWalletProvider,
  ISolanaWalletProvider,
  ISuiWalletProvider,
  IBitcoinWalletProvider,
  IStellarWalletProvider,
  IIconWalletProvider,
  IInjectiveWalletProvider,
  INearWalletProvider,
  IStacksWalletProvider,
  ITronWalletProvider,
} from '@sodax/types';
```

Each `*WalletProvider` class from `wallet-sdk-core` `implements` the matching interface. So:

```ts
import { EvmWalletProvider } from '@sodax/wallet-sdk-core';
import type { IEvmWalletProvider } from '@sodax/types';

const evm: IEvmWalletProvider = new EvmWalletProvider({ /* … */ });
```

In your SDK call signatures, take the **interface**, not the class:

```ts
// ✅ DO
async function deposit(wallet: IEvmWalletProvider) { /* … */ }

// ❌ DON'T — couples the function to the implementation
async function deposit(wallet: EvmWalletProvider) { /* … */ }
```

---

## Pattern: pass the provider to a `Sodax` feature service

Construct the wallet provider once, instantiate the `Sodax` facade, and pass the provider as `walletProvider` to the feature method you want (swap, bridge, money market, staking, …). The `Sodax` facade owns the per-chain spoke services internally — you do **not** construct `*SpokeService` yourself.

```ts
import { Sodax } from '@sodax/sdk';
import { EvmWalletProvider } from '@sodax/wallet-sdk-core';
import { ChainKeys } from '@sodax/types';

const walletProvider = new EvmWalletProvider({
  privateKey: process.env.EVM_PK as `0x${string}`,
  chainId: ChainKeys.SONIC_MAINNET,
  rpcUrl: process.env.EVM_RPC,
});

const sodax = new Sodax(/* optional SodaxConfig — see @sodax/sdk docs */);

// Example: supply to the money market on BSC. The wallet provider goes in
// at the feature-method call, not at facade construction.
const result = await sodax.moneyMarket.supply({
  params: {
    srcChainKey: ChainKeys.BSC_MAINNET,
    srcAddress:  await walletProvider.getWalletAddress(),
    token:       '0x…',
    amount:      1_000n,
    action:      'supply',
  },
  walletProvider,                           // ← the IEvmWalletProvider
});
```

The same shape applies to `sodax.swaps.*`, `sodax.bridge.*`, `sodax.staking.*`, `sodax.migration.*`, etc. — each feature service method that needs signing takes a `walletProvider` argument typed to the chain-specific interface.

> If you need the underlying spoke service for advanced read-only operations, get it via `sodax.spoke.getSpokeService(chainKey)` — but never `new EvmSpokeService(...)` yourself.

For SDK-level recipes (initialise the `Sodax` facade, configure hub provider, raw-tx flows, error handling) load the `sodax-sdk` (integration mode) skill (sibling under `@sodax/skills`).

---

## Pattern: React layer (typical)

In a React dApp you almost never construct providers manually. `@sodax/wallet-sdk-react` returns the typed interface for you, and `@sodax/dapp-kit` wraps SDK calls into hooks:

```tsx
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { useSwap } from '@sodax/dapp-kit';
import { ChainKeys } from '@sodax/types';

function SwapButton() {
  const evm = useWalletProvider({ xChainId: ChainKeys.SONIC_MAINNET });
  // evm: IEvmWalletProvider | undefined

  const swap = useSwap();

  return (
    <button
      disabled={!evm}
      onClick={() => evm && swap.mutateAsync({ /* params */, walletProvider: evm })}
    >
      Swap
    </button>
  );
}
```

The hook narrows on `xChainId`, returns the chain-specific interface, and is `undefined` until the user is connected on that family. Refer to `@sodax/wallet-sdk-react`'s own docs for the full pattern.

---

## Patterns to avoid

| Anti-pattern | Why bad | Replacement |
|---|---|---|
| Re-constructing the provider in every call site | Wastes work, can drop default config | Construct once, pass the instance around |
| Typing functions on the concrete class (`EvmWalletProvider`) | Couples to `wallet-sdk-core` | Use the `IXxxWalletProvider` interface |
| Casting between provider classes (`as ISolanaWalletProvider`) | Hides a chain-type mismatch | Pick the right provider for the chain at the call site |
| Storing the provider in a long-lived Zustand / Redux store | Provider holds live SDK clients / network connections | Store the **config** (e.g. PK + chainId), construct on demand |

---

## Verification

```bash
# 1. Type check passes
pnpm checkTs

# 2. SDK calls type-check against the interface, not the class
grep -rn "IEvmWalletProvider\|ISolanaWalletProvider\|IBitcoinWalletProvider" <user-src>
# expect at least one match in your function signatures
```

---

## Next steps

- [`defaults-and-overrides.md`](./defaults-and-overrides.md) — fine-tune the `defaults` slice for tx options.
- [`library-exports.md`](./library-exports.md) — type-only re-exports to avoid upstream chain-SDK deps.
- [`testing.md`](./testing.md) — mocking providers in tests.
