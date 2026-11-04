# `IXxxWalletProvider` interfaces

The signatures `@sodax/sdk` consumes. Sourced from `@sodax/types`; one interface per chain. Pass the **interface**, not the class, in function signatures — see [`../recipes/bridge-to-sdk.md`](../recipes/bridge-to-sdk.md).

The tables below summarise the methods each provider exposes. For full type-level signatures (including the chain-specific param/return types) consult `@sodax/types`'s package — these tables intentionally elide deep generics.

---

## `IEvmWalletProvider`

| Method | Signature (abridged) |
|---|---|
| `getWalletAddress` | `() => Promise<Address>` |
| `sendTransaction` | `(tx: EvmRawTransaction, opts?: EvmSendTransactionPolicy) => Promise<Hash>` |
| `waitForTransactionReceipt` | `(hash: Hash, opts?: EvmWaitForTransactionReceiptPolicy) => Promise<EvmRawTransactionReceipt>` |
| `getAtomicBatchSupport?` | `(chainId: number) => Promise<EvmAtomicBatchSupport>` — optional (EIP-5792) |
| `sendAtomicBatch?` | `(txs: readonly EvmRawTransaction[], opts: EvmSendBatchOptions) => Promise<string>` — optional, returns a batch id |
| `waitForBatch?` | `(batchId: string, opts?: EvmWaitForBatchOptions) => Promise<EvmBatchResult>` — optional; throws on timeout |

Plus public field: `publicClient: PublicClient`. The three EIP-5792 methods are optional on the interface; a custom provider that omits them still works — the SDK falls back to separate transactions.

---

## `ISolanaWalletProvider`

| Method | Signature (abridged) |
|---|---|
| `getWalletAddress` | `() => Promise<string>` |
| `getWalletBase58PublicKey` | `() => SolanaBase58PublicKey` |
| `sendTransaction` | `(rawTx, opts?: SendOptions) => Promise<string>` |
| `sendTransactionWithConfirmation` | `(rawTx, sendOpts?, confirmCommitment?) => Promise<string>` |
| `waitForConfirmation` | `(signature, commitment?) => Promise<…>` |
| `buildV0Txn` | `(rawInstructions) => Promise<SolanaSerializedTransaction>` |
| `getAssociatedTokenAddress` | `(mint) => Promise<SolanaBase58PublicKey>` |
| `getBalance` | `(publicKey) => Promise<number>` |
| `getTokenAccountBalance` | `(publicKey) => Promise<RpcResponseAndContext<TokenAmount>>` |

Plus public field: `connection: Connection`.

---

## `ISuiWalletProvider`

| Method | Signature (abridged) |
|---|---|
| `getWalletAddress` | `() => Promise<string>` |
| `signAndExecuteTxn` | `(txn: SuiTransaction, opts?: SuiSignAndExecutePolicy) => Promise<string>` |
| `viewContract` | `(txn, …) => Promise<…>` |
| `getCoins` | `(address, token, opts?: SuiGetCoinsPolicy) => Promise<SuiPaginatedCoins>` |

---

## `IBitcoinWalletProvider`

| Method | Signature (abridged) |
|---|---|
| `getWalletAddress` | `() => Promise<string>` |
| `getPublicKey` | `() => Promise<string>` |
| `getAddressType` | `(address: string) => Promise<BtcAddressType>` |
| `signTransaction` | `(psbtBase64: string, finalize?: boolean) => Promise<string>` |
| `signEcdsaMessage` | `(message: string) => Promise<string>` |
| `signBip322Message` | `(message: string) => Promise<string>` |
| `getPayment` | `(keyPair, addressType) => bitcoin.Payment` (PK mode helper) |
| `sendBitcoin` | `(toAddress: string, satoshis: bigint) => Promise<string>` (only if wallet kit implements it) |

---

## `IStellarWalletProvider`

| Method | Signature (abridged) |
|---|---|
| `getWalletAddress` | `() => Promise<string>` |
| `signTransaction` | `(tx: XDR) => Promise<XDR>` |
| `waitForTransactionReceipt` | `(hash: string, opts?: Pick<StellarWalletDefaults, 'pollInterval' | 'pollTimeout'>) => Promise<…>` |

---

## `IIconWalletProvider`

| Method | Signature (abridged) |
|---|---|
| `getWalletAddress` | `() => Promise<IconEoaAddress>` |
| `sendTransaction` | `(tx: IcxCallTransaction, opts?: IconWalletDefaults) => Promise<Hash>` |
| `waitForTransactionReceipt` | `(txHash: Hash) => Promise<IconTransactionResult>` |

Plus public field: `iconService: IconService`.

---

## `IInjectiveWalletProvider`

| Method | Signature (abridged) |
|---|---|
| `getWalletAddress` | `() => Promise<InjectiveEoaAddress>` |
| `execute` | `(…) => Promise<InjectiveExecuteResponse>` |
| `sendTransaction?` | `(signedTxRaw: Uint8Array) => Promise<string>` |
| `signAndSendTransaction?` | `(tx: InjectiveRawTransaction) => Promise<string>` — the SDK / Swaps-API handoff path |
| `getWalletPubKey` *(class-only, not on interface)* | `() => Promise<string>` |
| `getRawTransaction` *(class-only, not on interface)* | `(…) => Promise<InjectiveRawTransaction>` |

Plus public field: `wallet: InjectiveWallet`.

---

## `INearWalletProvider`

| Method | Signature (abridged) |
|---|---|
| `getWalletAddress` | `() => Promise<string>` |
| `getRawTransaction` | `(params: CallContractParams) => Promise<NearRawTransaction>` |
| `signAndSubmitTxn` | `(tx: NearRawTransaction) => Promise<string>` *(the concrete class adds an optional `opts?: NearWalletDefaults`)* |

Plus public fields (PK mode only): `account?: Account`, `rpcProvider?: JsonRpcProvider`.

---

## `IStacksWalletProvider`

| Method | Signature (abridged) |
|---|---|
| `getWalletAddress` | `() => Promise<string>` |
| `getPublicKey` | `() => Promise<string>` |
| `sendTransaction` | `(params: StacksTransactionParams) => Promise<…>` |
| `readContract` | `(params: StacksTransactionParams) => Promise<ClarityValue>` |
| `getBalance` | `(address: string) => Promise<bigint>` |

---

## Authoritative source

These tables are summarised. For the full, current type-level signatures (including generics, branded types, and union narrowings) read:

- `@sodax/types/src/wallet-providers/*.ts` (each interface lives here)
- The implementing class in `packages/wallet-sdk-core/src/wallet-providers/<chain>/`.

If a method exists on the class but not on the interface, it is an **implementation detail** — do not depend on it from outside the package.
