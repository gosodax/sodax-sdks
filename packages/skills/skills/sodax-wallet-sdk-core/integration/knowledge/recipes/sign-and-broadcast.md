# Recipe: Sign and broadcast (per chain)

Minimal raw-tx flows for each chain. Use these as smoke tests after construction, or when integrating outside of `@sodax/sdk`.

**Depends on:** [`setup-private-key.md`](./setup-private-key.md) or [`setup-browser-extension.md`](./setup-browser-extension.md).

For SDK-mediated flows (deposit, swap, bridge, lend, stake) see [`bridge-to-sdk.md`](./bridge-to-sdk.md) instead — this recipe is for chain-native raw transactions.

---

## EVM

```ts
import type { EvmRawTransaction } from '@sodax/types';

const tx: EvmRawTransaction = {
  from:  '0x…',                            // required — the sender (your wallet address)
  to:    '0x…',
  value: 1_000_000_000_000_000n,           // 0.001 ETH
  data:  '0x',
};

const hash = await provider.sendTransaction(tx);
// Optional per-call override: { gas: 5_000_000n }

const receipt = await provider.waitForTransactionReceipt(hash);
// Receipt is bigint-stringified — JSON-safe.  receipt.blockNumber: string.
console.log(receipt.status, receipt.blockNumber);
```

---

## Solana

```ts
import type { SolanaRawTransactionInstruction } from '@sodax/types';

const instructions: SolanaRawTransactionInstruction[] = [/* … */];

const rawTx = await provider.buildV0Txn(instructions);
const signature = await provider.sendTransactionWithConfirmation(rawTx);

console.log('signature:', signature);
```

`buildV0Txn` picks the keypair-vs-adapter signing path internally. `sendTransactionWithConfirmation` waits to the `defaults.confirmCommitment` level (default `'finalized'`).

---

## Sui

```ts
import type { SuiTransaction } from '@sodax/types';

const tx: SuiTransaction = /* build with @mysten/sui Transaction builder */;

const digest = await provider.signAndExecuteTxn(tx);
// Pre-flight dry-run is on by default.  Disable for a doomed-tx flow:
//   await provider.signAndExecuteTxn(tx, { dryRun: { enabled: false } });
```

---

## Bitcoin

```ts
// 1. Build a PSBT externally (or via your wallet kit) and serialise to base64.
const psbtBase64 = '/* … */';

// 2. Sign (finalize defaults to defaults.defaultFinalize, default true).
const signedTxOrPsbt = await provider.signTransaction(psbtBase64);

// 3. Broadcast — either via the wallet kit (browser mode) or your own broadcaster.
//    PK mode does not implement a broadcaster in this provider — you submit the
//    finalised tx to your own node or a public API.
```

For message signing:

```ts
const sig    = await provider.signEcdsaMessage('hello');
const sig322 = await provider.signBip322Message('hello');
```

---

## Stellar

```ts
import type { XDR } from '@sodax/types';

// 1. Build the XDR externally (TransactionBuilder from @stellar/stellar-sdk).
const txXdr: XDR = '/* … */';

// 2. Sign.
const signedXdr = await provider.signTransaction(txXdr);

// 3. Submit to Horizon (the provider's `server` is private; build a Horizon.Server
//    yourself or use a service layer that wraps submit).

// 4. Wait for inclusion (polls Horizon).
const receipt = await provider.waitForTransactionReceipt(submittedHash);
```

---

## ICON

```ts
import type { IcxCallTransaction } from '@sodax/types';

const tx: IcxCallTransaction = /* build with icon-sdk-js IcxTransactionBuilder */;

const hash = await provider.sendTransaction(tx);
// Override step limit / version per call: { stepLimit: 5_000_000 }

const result = await provider.waitForTransactionReceipt(hash);
console.log(result.status);
```

---

## Injective

```ts
// Reads the address (and pubkey) from the configured secret / msgBroadcaster.
const address = await provider.getWalletAddress();
const pubKey  = await provider.getWalletPubKey();

// Build + execute via the upstream MsgBroadcaster.  See @injectivelabs/sdk-ts
// docs for the canonical message builders (MsgSend, MsgExecuteContract, …).
const txResp = await provider.execute(/* params per @sodax/types */);
```

For inspection-only flows, `getRawTransaction(…)` returns the unsigned tx without broadcasting.

---

## NEAR

```ts
import type { CallContractParams, NearRawTransaction } from '@sodax/types';

const params: CallContractParams = /* … */;
const tx: NearRawTransaction = await provider.getRawTransaction(params);

const hash = await provider.signAndSubmitTxn(tx);
// Override waitUntil per call: { waitUntil: 'EXECUTED' }
```

---

## Stacks

```ts
import type { StacksTransactionParams } from '@sodax/types';
import { PostConditionMode } from '@sodax/wallet-sdk-core';

const params: StacksTransactionParams = {
  postConditionMode: PostConditionMode.Deny,
  /* … */
};

const txResp = await provider.sendTransaction(params);

// Read-only call (no broadcast):
const clarityValue = await provider.readContract(params);
```

---

## Tron

The provider does not build transactions: get an unsigned one from your node (TronGrid `createtransaction` / `triggersmartcontract`), then call `signTransaction`, `sendTransaction` (returns the tx id) and `waitForTransactionReceipt`. The receipt comes back once the tx is in a block, reverted or not, so check its `receipt?.result`. `signMessage` takes a 32-byte hash, not free text — see [`../features/tron.md`](../features/tron.md). [`TronWalletProvider.test.ts`](https://github.com/gosodax/sodax-sdks/blob/main/packages/wallet-sdk-core/src/wallet-providers/tron/TronWalletProvider.test.ts) covers each call, with the node stubbed.

---

## Verification (any chain)

```bash
pnpm checkTs
```

```ts
// Smoke test: address read
console.log(await provider.getWalletAddress());

// Then attempt a tiny tx on testnet.  Save the returned hash and inspect it
// in the chain's explorer.
```

---

## Patterns to avoid

| Anti-pattern | Why bad | Replacement |
|---|---|---|
| Constructing the `Connection` / `SuiClient` / `Horizon.Server` yourself in PK mode | Duplicates work the provider already does | Read it off the provider (`provider.connection`, etc.) when exposed; otherwise just call the method. |
| Storing the signed tx in localStorage / IndexedDB | Persists secrets in browser storage | Sign + broadcast in one flow; don't persist signed-but-unbroadcast txs. |
| Catching every error generically and logging "tx failed" | Hides real causes (nonce, insufficient gas, malformed XDR, …) | Surface the upstream error; the provider doesn't wrap them. |

---

## See also

- [`bridge-to-sdk.md`](./bridge-to-sdk.md) — handing off to `@sodax/sdk` for SODAX hub/spoke flows.
- [`defaults-and-overrides.md`](./defaults-and-overrides.md) — tuning the defaults slice.
- [`../features/<chain>.md`](../features/) — chain-specific method signatures and quirks.
