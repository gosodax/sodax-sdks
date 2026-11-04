# Recipe: Sign Message

`useXSignMessage` is a single React Query mutation that delegates message signing to the connected wallet's per-chain `signMessage` implementation. The signature shape and encoding rules differ per chain — Bitcoin in particular auto-selects between BIP-322 and ECDSA based on the connected address type.

**Depends on:** [`setup.md`](./setup.md), one of [`connect-button.md`](./connect-button.md) / [`multi-chain-modal.md`](./multi-chain-modal.md)

---

## Hook API

```typescript
import { useXSignMessage } from '@sodax/wallet-sdk-react';

const sign = useXSignMessage();

const signature = await sign.mutateAsync({
  xChainType: 'EVM',
  message: 'Sign in to MyDApp\nNonce: abc123',
});
// signature: `0x${string}` | Uint8Array | string | undefined
```

| Field | Type | Notes |
|-------|------|-------|
| `xChainType` | `ChainType` | Which chain to sign with (`'EVM'`, `'BITCOIN'`, …) |
| `message` | `string` | Plain UTF-8; per-chain wrappers handle encoding |

Return type is the discriminated union `` `0x${string}` | Uint8Array | string | undefined `` because each chain returns its native signature shape (hex for EVM, base64 for Stellar and Solana, etc.). Cast or branch on `xChainType` when consuming.

`undefined` is returned (not thrown) when the chain doesn't implement `signMessage` — ICON, NEAR, and Stacks. A one-time `console.warn` accompanies the `undefined`.

---

## Per-chain support matrix

| Chain | Implementation | Signature shape |
|-------|----------------|-----------------|
| EVM | `signMessageAsync` from wagmi → personal_sign | `` `0x${string}` `` |
| Solana | `signMessage` from `@solana/wallet-adapter` | `string` (base64) |
| Sui | `signPersonalMessage` from `@mysten/dapp-kit-react` | `string` (base64 signature) |
| Bitcoin | Auto-detect: BIP-322 (P2WPKH/P2TR) or ECDSA (P2SH/P2PKH) | `string` |
| Stellar | `walletsKit.signMessage` from `@creit.tech/stellar-wallets-kit` | `string` (base64) |
| Injective | `walletStrategy.signArbitrary` from `@injectivelabs/wallet-base` | `string` |
| **NEAR** | **Not supported** — registers no `signMessage` action | `undefined` |
| **Stacks** | **Not supported** — registers no `signMessage` action | `undefined` |
| **ICON** | **Not supported** — Hana wallet does not expose a signing API | `undefined` |

---

## Bitcoin — BIP-322 vs ECDSA auto-detect

Bitcoin's signing flow inspects the connected address and picks the right method automatically:

| Address type | Signing method | Connectors that support it |
|--------------|----------------|----------------------------|
| P2WPKH (native segwit, `bc1q…`) | BIP-322 | Unisat, Xverse, OKX, Hana |
| P2TR (taproot, `bc1p…`) | BIP-322 | Unisat, Xverse, OKX, Hana |
| P2SH (legacy multi-sig, `3…`) | ECDSA | Unisat, Xverse, OKX, Hana |
| P2PKH (legacy, `1…`) | ECDSA | Unisat, Xverse, OKX, Hana |

The methods live on the connector's `IBitcoinWalletProvider`, not on the connector: `chainRegistry` resolves the provider via `getWalletProvider()` (falling back to `recreateWalletProvider(xAccount)` after a page reload) and dispatches on it. A custom connector must return a provider implementing both methods; if it implements only one, calling `signMessage` from a wrongly-typed address surfaces the error inline.

The same logic mirrors the SDK's `RadfiProvider.authenticateWithWallet` — the React layer doesn't reinvent the dispatch.

---

## ICON not supported

Hana wallet on ICON exposes account / transaction APIs but no general-purpose `signMessage` endpoint. `sign.mutateAsync({ xChainType: 'ICON' })` returns `undefined` and logs:

```
[useXSignMessage] signMessage not supported for chain "ICON"
```

If you need a signature on ICON for SIWE-style auth, fall back to a transaction-based proof or skip ICON in your auth flow.

---

## Error handling

```tsx
// @ai-snippets-skip
'use client';

import { useXSignMessage } from '@sodax/wallet-sdk-react';

export function SignButton() {
  const sign = useXSignMessage();

  const handleSign = async () => {
    try {
      const signature = await sign.mutateAsync({
        xChainType: 'EVM',
        message: 'Sign in',
      });
      if (!signature) {
        // ICON or other unsupported chain
        return;
      }
      submitSignature(signature);
    } catch (error) {
      // User rejection, wallet disconnect mid-sign, address mismatch, etc.
      console.error('sign failed:', error);
    }
  };

  return (
    <button onClick={handleSign} disabled={sign.isPending}>
      {sign.isPending ? 'Waiting for wallet…' : 'Sign'}
    </button>
  );
}
```

Common error messages by chain:

| Chain | Typical error |
|-------|---------------|
| EVM | `User rejected the request` (MetaMask), `User denied message signature` (Rabby) |
| Solana | `WalletSignMessageError: User rejected the request` |
| Sui | `User rejected the signature request` |
| Bitcoin | `<connector.id> does not support BIP-322 signing` (mismatch with address type), `User canceled the request` |
| Stellar | `Stellar signature not found` |
| Injective | `Injective signature not found`, `Injective address not found` |

`mutation.error` reflects the latest failure; `mutation.isError` / `mutation.isPending` follow standard React Query semantics.

---

## Verification

```bash
# 1. Type check
pnpm checkTs

# 2. Manual — connect wallet, click sign button, approve in wallet, confirm signature in handler
# 3. Manual — reject the signature, confirm error renders
```
