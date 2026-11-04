import type {
  baseChainInfo,
  BitcoinChainKey,
  BitcoinRpcConfig,
  ChainKey,
  ChainType,
  EvmChainKey,
  IconChainKey,
  InjectiveChainKey,
  InjectiveRpcConfig,
  NearChainKey,
  SolanaChainKey,
  StacksChainKey,
  StacksNetworkLike,
  StacksNetworkName,
  StellarChainKey,
  StellarRpcConfig,
  SuiChainKey,
} from '@sodax/types';
import type {
  BitcoinWalletDefaults,
  EvmWalletDefaults,
  IconWalletDefaults,
  InjectiveWalletDefaults,
  NearWalletDefaults,
  SolanaWalletDefaults,
  StacksWalletDefaults,
  StellarWalletDefaults,
  SuiWalletDefaults,
} from '@sodax/wallet-sdk-core';
import type { State as WagmiState } from 'wagmi';
import type { WalletConnectParameters } from 'wagmi/connectors';
import type { IXConnector } from './interfaces.js';

// ─── Per-chain entry types ──────────────────────────────────────────────────
// Each chain key entry holds chain-specific data (rpcUrl, defaults, network
// endpoints). Shape varies by chain — most chains share `{ rpcUrl, defaults }`,
// while Stellar/Bitcoin/Injective extend their respective `*RpcConfig` and
// Stacks accepts a network preset string.

// Chains whose RPC config is a single URL string use `{ rpcUrl, defaults }`.
type SimpleChainEntry<D> = {
  rpcUrl?: string;
  defaults?: D;
};

export type EvmChainEntry = SimpleChainEntry<EvmWalletDefaults>;
export type SolanaChainEntry = SimpleChainEntry<SolanaWalletDefaults>;
/**
 * Sui speaks gRPC-web, not JSON-RPC — hence `grpcUrl` rather than the shared `rpcUrl`. The two names
 * are mutually exclusive; passing both is a configuration error, not a precedence question.
 */
export type SuiChainEntry = { defaults?: SuiWalletDefaults } & (
  | { grpcUrl?: string; rpcUrl?: never }
  /** @deprecated Renamed to `grpcUrl`. */
  | { grpcUrl?: never; rpcUrl?: string }
);
export type IconChainEntry = SimpleChainEntry<IconWalletDefaults>;
export type NearChainEntry = SimpleChainEntry<NearWalletDefaults>;

// Chains with multi-field RPC config (horizon+soroban, indexer+grpc)
// extend the existing `*RpcConfig` from @sodax/types instead.
export type StellarChainEntry = StellarRpcConfig & { defaults?: StellarWalletDefaults };
export type BitcoinChainEntry = BitcoinRpcConfig & { defaults?: BitcoinWalletDefaults };
export type InjectiveChainEntry = InjectiveRpcConfig & { defaults?: InjectiveWalletDefaults };

// Stacks is the only chain whose SDK accepts two forms — preset name string
// or full `StacksNetworkLike` object. Mirrors `RpcConfig[STACKS_MAINNET]` in
// @sodax/types; we only extend the object branch with `defaults`.
export type StacksChainEntry = StacksNetworkName | (StacksNetworkLike & { defaults?: StacksWalletDefaults });

// ─── Per-chain-type adapter fields ──────────────────────────────────────────
// Settings that are wallet-adapter-instance-level (one React provider, one
// value) — not per-chain. Live on the chain-type slot.

/** Wagmi-config-level settings shared across all configured EVM chains. */
export type EvmAdapterFields = {
  /** Attempt to reconnect previously connected wallets on mount. @default false */
  reconnectOnMount?: boolean;
  /**
   * wagmi hydration-timing flag (not an "app is SSR" flag).
   * `true` defers wagmi reconnect into `useEffect`; `false` runs it in render
   * and triggers React's "setState during render" warning. Keep `true` unless
   * you know you need otherwise. @default true
   */
  ssr?: boolean;
  /**
   * Base key for wagmi's cookie storage (state cookie = `<persistKey>.store`). @default 'sodax'.
   * SSR server and client must build from the same key, else the server reads the wrong cookie.
   * The cookie is plaintext and unsigned; `persistKey` only namespaces it — it does not authenticate or encrypt it.
   */
  persistKey?: string;
  /** Wagmi SSR hydration state — pass `tryCookieToInitialState()` to avoid disconnect flash on first load (Next.js only). */
  initialState?: WagmiState;
  /** WalletConnect configuration. Adds a WalletConnect connector when provided. */
  walletConnect?: WalletConnectParameters;
};

/** `@solana/wallet-adapter-react` provider settings. */
export type SolanaAdapterFields = {
  /** Auto-connect previously connected Solana wallet on mount. @default true */
  autoConnect?: boolean;
};

/** `@mysten/dapp-kit-react` provider settings. */
export type SuiAdapterFields = {
  autoConnect?: boolean;
  /** Default network for the dApp Kit instance. @default 'mainnet' */
  network?: 'mainnet' | 'testnet';
};

// ─── Central chain registry ─────────────────────────────────────────────────
// Single source of truth for per-chain-type data. Adding a new chain type =
// add one entry here. `SodaxWalletConfig` and the per-key dispatchers below derive
// automatically.

/**
 * Per-chain-type metadata — the only place that needs editing when adding a
 * new chain type. Keys must match `ChainType`.
 */
export type ChainMeta = {
  EVM: { keys: EvmChainKey; entry: EvmChainEntry; defaults: EvmWalletDefaults; adapter: EvmAdapterFields };
  SOLANA: {
    keys: SolanaChainKey;
    entry: SolanaChainEntry;
    defaults: SolanaWalletDefaults;
    adapter: SolanaAdapterFields;
  };
  SUI: { keys: SuiChainKey; entry: SuiChainEntry; defaults: SuiWalletDefaults; adapter: SuiAdapterFields };
  ICON: { keys: IconChainKey; entry: IconChainEntry; defaults: IconWalletDefaults; adapter: {} };
  NEAR: { keys: NearChainKey; entry: NearChainEntry; defaults: NearWalletDefaults; adapter: {} };
  STELLAR: { keys: StellarChainKey; entry: StellarChainEntry; defaults: StellarWalletDefaults; adapter: {} };
  BITCOIN: { keys: BitcoinChainKey; entry: BitcoinChainEntry; defaults: BitcoinWalletDefaults; adapter: {} };
  INJECTIVE: { keys: InjectiveChainKey; entry: InjectiveChainEntry; defaults: InjectiveWalletDefaults; adapter: {} };
  STACKS: { keys: StacksChainKey; entry: StacksChainEntry; defaults: StacksWalletDefaults; adapter: {} };
};

// ─── Derived types — change `ChainMeta` and these update automatically ─────

/** Resolves a `ChainKey` to its `ChainType` via the runtime `baseChainInfo` map. */
export type ChainTypeOf<K extends ChainKey> = (typeof baseChainInfo)[K]['type'];

/**
 * Flatten `A & B` into a single object type so TypeScript runs excess-property
 * checks against the merged shape. Intersection types skip EPC, which lets
 * unknown fields like `rpcUrl` slip into the EVM slot silently — flattening
 * forces the check to fire on object literals.
 */
type Merge<A, B> = { [K in keyof (A & B)]: (A & B)[K] };

/** Per-chain-type slot shape — adapter fields + nested chain entries map. */
export type ChainTypeConfig<T extends ChainType> = Merge<
  ChainMeta[T]['adapter'],
  {
    /** Optional connector overrides. If omitted, uses defaults from chainRegistry. */
    connectors?: IXConnector[];
    /** Per-chain-key entries — chain-specific RPC + wallet provider defaults. */
    chains?: Partial<Record<ChainMeta[T]['keys'], ChainMeta[T]['entry']>>;
  }
>;

/** Per-chain-key entry shape — narrows by chain key via `baseChainInfo` lookup. */
export type ChainEntry<K extends ChainKey = ChainKey> = ChainMeta[ChainTypeOf<K>]['entry'];

/** Wallet provider defaults shape for a given chain key. */
export type WalletDefaultsByKey<K extends ChainKey> = ChainMeta[ChainTypeOf<K>]['defaults'];

// Per-chain-type aliases — kept for external typing convenience.
export type EvmTypeConfig = ChainTypeConfig<'EVM'>;
export type SolanaTypeConfig = ChainTypeConfig<'SOLANA'>;
export type SuiTypeConfig = ChainTypeConfig<'SUI'>;
export type BitcoinTypeConfig = ChainTypeConfig<'BITCOIN'>;
export type StellarTypeConfig = ChainTypeConfig<'STELLAR'>;
export type InjectiveTypeConfig = ChainTypeConfig<'INJECTIVE'>;
export type IconTypeConfig = ChainTypeConfig<'ICON'>;
export type NearTypeConfig = ChainTypeConfig<'NEAR'>;
export type StacksTypeConfig = ChainTypeConfig<'STACKS'>;

/** Top-level config for `<SodaxWalletProvider>`. Omitted chain-type slots are not mounted. */
export type SodaxWalletConfig = {
  [T in ChainType]?: ChainTypeConfig<T>;
};
