import {
  type Address,
  type Chain,
  type Client,
  type Hex,
  type Signature,
  type TransactionSerializable,
  type Transport,
  createClient,
  hexToBigInt,
  hexToNumber,
  isAddressEqual,
  keccak256,
  numberToHex,
  recoverAddress,
  serializeTransaction,
} from 'viem';

/** EIP-1193 request envelope. */
export type Eip1193RequestArgs = { method: string; params?: unknown };

/** EIP-712 typed-data payload as received from `eth_signTypedData_v4`. */
export type EvmTypedData = {
  domain: Record<string, unknown>;
  types: Record<string, { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
};

type NumberLike = Hex | bigint | number;

/** Loose shape of an `eth_sendTransaction` / `eth_signTransaction` parameter. */
export type RpcTransactionRequest = {
  from?: Address;
  to?: Address | null;
  data?: Hex;
  input?: Hex;
  value?: NumberLike;
  gas?: NumberLike;
  nonce?: NumberLike;
  gasPrice?: NumberLike;
  maxFeePerGas?: NumberLike;
  maxPriorityFeePerGas?: NumberLike;
  chainId?: NumberLike;
  type?: string;
};

export type BaseEvmHwProviderOptions = {
  /** Derivation path in the device's expected format (Ledger: `44'/…`; Trezor: `m/44'/…`). */
  derivationPath: string;
  /** Active account reported by the device. */
  account: Address;
  /** Initial chain id. */
  chainId: number;
  /** Chains configured on the wagmi config. */
  chains: readonly Chain[];
  /** viem transports keyed by chain id (from the wagmi config). */
  transports: Record<number, Transport | undefined> | undefined;
};

export const strip0x = (hex: string): string => (hex.startsWith('0x') ? hex.slice(2) : hex);
export const prefix0x = (hex: string): Hex => (hex.startsWith('0x') ? (hex as Hex) : (`0x${hex}` as Hex));

const toBigIntLike = (v: NumberLike): bigint =>
  typeof v === 'bigint' ? v : typeof v === 'number' ? BigInt(v) : hexToBigInt(v);
const toNumberLike = (v: NumberLike): number =>
  typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : hexToNumber(v);

/**
 * Device-agnostic EIP-1193 provider for hardware wallets on EVM.
 *
 * Read-only JSON-RPC calls are forwarded to the chain's configured viem transport;
 * account, chain, and the signing primitives are handled by the concrete subclass
 * (the device). Transaction field-filling, signature-recovery (`yParity`), and viem
 * serialization live here so each device only implements the raw signing calls.
 *
 * Returned by a wagmi connector's `getProvider()`; wagmi wraps it with viem's
 * `custom()` transport, so `useWalletProvider` yields a normal `EvmWalletProvider`.
 */
export abstract class BaseEvmHwProvider {
  protected readonly derivationPath: string;
  protected readonly account: Address;
  protected chainId: number;
  protected readonly chains: readonly Chain[];
  protected readonly transports: Record<number, Transport | undefined> | undefined;
  private readonly clientCache = new Map<number, Client>();
  private readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  constructor(options: BaseEvmHwProviderOptions) {
    this.derivationPath = options.derivationPath;
    this.account = options.account;
    this.chainId = options.chainId;
    this.chains = options.chains;
    this.transports = options.transports;
  }

  getChainId(): number {
    return this.chainId;
  }

  setChainId(chainId: number): void {
    this.chainId = chainId;
  }

  // ─── EIP-1193 event surface (device has no events — kept for compatibility) ──
  on(event: string, listener: (...args: unknown[]) => void): this {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener);
    this.listeners.set(event, set);
    return this;
  }
  removeListener(event: string, listener: (...args: unknown[]) => void): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }
  emit(event: string, ...args: unknown[]): void {
    for (const l of this.listeners.get(event) ?? []) l(...args);
  }

  // ─── EIP-1193 request router ─────────────────────────────────────────────────
  async request({ method, params }: Eip1193RequestArgs): Promise<unknown> {
    const args = (params ?? []) as unknown[];
    switch (method) {
      case 'eth_requestAccounts':
      case 'eth_accounts':
        return [this.account];
      case 'eth_chainId':
        return numberToHex(this.chainId);
      case 'net_version':
        return String(this.chainId);
      case 'personal_sign':
        return this.signPersonalMessage((args as [Hex, Address])[0]);
      case 'eth_signTypedData_v4':
        return this.signTypedData(this.parseTypedData((args as [Address, string | EvmTypedData])[1]));
      case 'eth_sendTransaction': {
        const serialized = await this.buildAndSign((args as [RpcTransactionRequest])[0]);
        return this.rpcRequest(this.chainId, { method: 'eth_sendRawTransaction', params: [serialized] });
      }
      case 'eth_signTransaction':
        return this.buildAndSign((args as [RpcTransactionRequest])[0]);
      case 'wallet_switchEthereumChain': {
        this.setChainId(hexToNumber((args as [{ chainId: Hex }])[0].chainId));
        return null;
      }
      case 'wallet_addEthereumChain':
        // Chains are pre-declared in the wagmi config; nothing to add at runtime.
        return null;
      default:
        return this.rpcRequest(this.chainId, { method, params });
    }
  }

  private parseTypedData(data: string | EvmTypedData): EvmTypedData {
    return typeof data === 'string' ? (JSON.parse(data) as EvmTypedData) : data;
  }

  // ─── Read forwarding ────────────────────────────────────────────────────────
  private getRpcClient(chainId: number): Client {
    const cached = this.clientCache.get(chainId);
    if (cached) return cached;
    const chain = this.chains.find(c => c.id === chainId);
    const transport = this.transports?.[chainId];
    if (!transport) {
      throw new Error(
        `[wallet-hw] no RPC transport configured for chainId ${chainId} — add the chain to your SodaxWalletProvider EVM config`,
      );
    }
    const client = createClient({ chain, transport });
    this.clientCache.set(chainId, client);
    return client;
  }

  protected rpcRequest(chainId: number, args: Eip1193RequestArgs): Promise<unknown> {
    return this.getRpcClient(chainId).request(args as Parameters<Client['request']>[0]);
  }

  // ─── Transaction build → device sign → serialize ─────────────────────────────
  private async buildAndSign(tx: RpcTransactionRequest): Promise<Hex> {
    const chainId = tx.chainId !== undefined ? toNumberLike(tx.chainId) : this.chainId;
    const from = (tx.from ?? this.account) as Address;
    const to = (tx.to ?? undefined) as Address | undefined;
    const data = (tx.data ?? tx.input) as Hex | undefined;
    const value = tx.value !== undefined ? toBigIntLike(tx.value) : 0n;

    const nonce =
      tx.nonce !== undefined
        ? toNumberLike(tx.nonce)
        : hexToNumber(
            (await this.rpcRequest(chainId, { method: 'eth_getTransactionCount', params: [from, 'pending'] })) as Hex,
          );

    const gas =
      tx.gas !== undefined
        ? toBigIntLike(tx.gas)
        : hexToBigInt(
            (await this.rpcRequest(chainId, {
              method: 'eth_estimateGas',
              params: [{ from, to, value: numberToHex(value), data }],
            })) as Hex,
          );

    const isLegacy = tx.gasPrice !== undefined;
    let serializable: TransactionSerializable;
    if (isLegacy) {
      serializable = {
        type: 'legacy',
        chainId,
        nonce,
        to,
        value,
        data,
        gas,
        gasPrice: toBigIntLike(tx.gasPrice as NumberLike),
      };
    } else {
      const maxPriorityFeePerGas =
        tx.maxPriorityFeePerGas !== undefined
          ? toBigIntLike(tx.maxPriorityFeePerGas)
          : hexToBigInt((await this.rpcRequest(chainId, { method: 'eth_maxPriorityFeePerGas' })) as Hex);
      let maxFeePerGas: bigint;
      if (tx.maxFeePerGas !== undefined) {
        maxFeePerGas = toBigIntLike(tx.maxFeePerGas);
      } else {
        const block = (await this.rpcRequest(chainId, {
          method: 'eth_getBlockByNumber',
          params: ['latest', false],
        })) as { baseFeePerGas?: Hex } | null;
        const baseFee = block?.baseFeePerGas ? hexToBigInt(block.baseFeePerGas) : 0n;
        maxFeePerGas = baseFee * 2n + maxPriorityFeePerGas;
      }
      serializable = { type: 'eip1559', chainId, nonce, to, value, data, gas, maxFeePerGas, maxPriorityFeePerGas };
    }

    return this.signTransactionToSerialized(serializable, serializeTransaction(serializable));
  }

  /**
   * Assembles a signed serialized transaction from device-returned `r`/`s`, deriving
   * `yParity` by recovery rather than interpreting the device's `v`. Uniform across
   * legacy and EIP-1559 and avoids the EIP-155 `v` reconstruction pitfalls on chains
   * with large chain ids. For subclasses whose device returns a ready serialized tx
   * (e.g. Trezor), return that directly instead of calling this.
   */
  protected async recoverAndSerialize(
    serializable: TransactionSerializable,
    unsigned: Hex,
    r: Hex,
    s: Hex,
  ): Promise<Hex> {
    const recovered = await recoverAddress({ hash: keccak256(unsigned), signature: { r, s, yParity: 0 } });
    const yParity: 0 | 1 = isAddressEqual(recovered, this.account) ? 0 : 1;
    // Legacy serialization derives the EIP-155 `v` from a 27/28 `v`; typed
    // (EIP-1559) serialization uses `yParity` directly.
    const signature: Signature =
      serializable.type === 'legacy' ? { r, s, v: 27n + BigInt(yParity), yParity } : { r, s, yParity };
    return serializeTransaction(serializable, signature);
  }

  // ─── Device-specific signing primitives ──────────────────────────────────────
  /** Sign a prepared transaction and return the full signed serialized tx (`0x…`). */
  protected abstract signTransactionToSerialized(serializable: TransactionSerializable, unsigned: Hex): Promise<Hex>;
  /** Sign an `eth_sign`/`personal_sign` message (hex) and return a 65-byte `0x{r}{s}{v}` signature. */
  protected abstract signPersonalMessage(messageHex: Hex): Promise<Hex>;
  /** Sign EIP-712 typed data and return a 65-byte `0x{r}{s}{v}` signature. */
  protected abstract signTypedData(typedData: EvmTypedData): Promise<Hex>;
}
