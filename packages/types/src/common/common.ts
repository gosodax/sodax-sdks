import type { Address, Hex, HttpUrl } from '../shared/shared.js';
import type { ChainKey, ChainKeys, ChainType } from '../chains/chain-keys.js';
import type { GetChainType, SpokeChainConfig, spokeChainConfig, SpokeChainKey, IconAddress } from '../chains/chains.js';
import type { XToken } from '../chains/tokens.js';
import type { EvmRawTransaction, EvmReturnType } from '../evm/evm.js';
import type { BitcoinRawTransaction, BitcoinReturnType } from '../bitcoin/bitcoin.js';
import type { IconRawTransaction, IconReturnType } from '../icon/icon.js';
import type { InjectiveRawTransaction, InjectiveReturnType } from '../injective/injective.js';
import type { NearRawTransaction, NearReturnType } from '../near/near.js';
import type { SolanaBase58PublicKey, SolanaRawTransaction, SolanaReturnType } from '../solana/solana.js';
import type { StacksRawTransaction, StacksReturnType } from '../stacks/stacks.js';
import type { StellarRawTransaction, StellarReturnType } from '../stellar/stellar.js';
import type { SuiRawTransaction, SuiReturnType } from '../sui/sui.js';
import type {
  TronDepositReturnType,
  TronRawTransaction,
  TronRawWithdraw,
  TronReturnType,
  TronSendMessageReturnType,
} from '../tron/tron.js';
import type {
  XrpDepositReturnType,
  XrpRawTransaction,
  XrpRawWithdraw,
  XrpReturnType,
  XrpSendMessageReturnType,
} from '../xrp/xrp.js';
import type { TonGasEstimate, TonRawTransaction, TonReturnType } from '../ton/ton.js';
import type { ZcashGasEstimate, ZcashRawTransaction, ZcashReturnType } from '../zcash/zcash.js';
import type { CardanoGasEstimate, CardanoRawTransaction, CardanoReturnType } from '../cardano/cardano.js';
import type { GetWalletProviderType } from '../wallet/providers.js';

export type Default = {
  default: boolean;
};

export type RelayerApiConfig = {
  relayerApiEndpoint: HttpUrl;
};

export type UnstakeSodaRequest = {
  amount: bigint;
  startTime: bigint;
  to: Address;
};

export type UserUnstakeInfo = {
  id: bigint;
  request: UnstakeSodaRequest;
};

export type VaultReserves = {
  tokens: readonly Address[];
  balances: readonly bigint[];
};

/** Fixed partner fee; `amount` in the token's smallest unit (wei). */
export type PartnerFeeAmount = {
  address: Address;
  amount: bigint;
};

/** `percentage` is in basis points (100 = 1%); maximum 100. */
export type PartnerFeePercentage = {
  address: Address;
  percentage: number;
};

/** Fixed `amount` (wei) or `percentage` (bps, max 100 = 1%); if both are provided, `amount` is used. */
export type PartnerFee = PartnerFeeAmount | PartnerFeePercentage;

export type PartnerFeeConfig = {
  partnerFee: PartnerFee | undefined;
};

export type FeeAmount = {
  feeAmount: bigint;
};

export type OptionalFee = { fee?: PartnerFee };

export type IconContractAddress = `cx${string}`;

export type Result<T, E = Error | unknown> = { ok: true; value: T } | { ok: false; error: E };

export type GetTokenAddressType<C extends SpokeChainKey | ChainType> = GetChainType<C> extends 'EVM' ? Address : string;

export type GetAddressType<C extends SpokeChainKey | ChainType> =
  GetChainType<C> extends 'EVM'
    ? Address
    : GetChainType<C> extends 'INJECTIVE'
      ? string
      : GetChainType<C> extends 'STELLAR'
        ? Hex
        : GetChainType<C> extends 'ICON'
          ? IconAddress
          : GetChainType<C> extends 'SUI'
            ? Hex
            : GetChainType<C> extends 'SOLANA'
              ? SolanaBase58PublicKey
              : GetChainType<C> extends 'STACKS'
                ? string
                : GetChainType<C> extends 'NEAR'
                  ? Address
                  : string;

export type QuoteType = 'exact_input';

export type SolverIntentQuoteRequest = {
  token_src: string;
  token_src_blockchain_id: SpokeChainKey;
  token_dst: string;
  token_dst_blockchain_id: SpokeChainKey;
  amount: bigint;
  quote_type: QuoteType;
};

export type SolverIntentQuoteResponseRaw = {
  quoted_amount: string;
};

export type SolverIntentQuoteResponse = {
  quoted_amount: bigint;
};

export type SolverErrorResponse = {
  detail: {
    code: SolverIntentErrorCode;
    message: string;
  };
};

export type SolverExecutionRequest = {
  intent_tx_hash: Hex; // hub (Sonic) tx hash
};

export type SolverExecutionResponse = {
  answer: 'OK';
  intent_hash: Hex;
};

export type SolverIntentStatusRequest = {
  intent_tx_hash: Hex;
};

export type SolverIntentStatusResponse = {
  status: SolverIntentStatusCode;
  fill_tx_hash?: string; // defined only if status is 3
};

export enum SolverIntentStatusCode {
  NOT_FOUND = -1,
  NOT_STARTED_YET = 1, // queued in the task pool
  STARTED_NOT_FINISHED = 2,
  SOLVED = 3,
  FAILED = 4,
}

export enum SolverIntentErrorCode {
  NO_PATH_FOUND = -4,
  NO_PRIVATE_LIQUIDITY = -5, // path found, no private liquidity on the dst chain
  NOT_ENOUGH_PRIVATE_LIQUIDITY = -8, // path found, insufficient private liquidity on the dst chain
  NO_EXECUTION_MODULE_FOUND = -7, // path and liquidity found, execution modules unavailable
  QUOTE_NOT_FOUND = -8, // on execute: quote_uuid does not exist
  QUOTE_NOT_MATCH = -9, // on execute: quote_uuid does not match the quote
  INTENT_DATA_NOT_MATCH_QUOTE = -10,
  NO_GAS_HANDLER_FOR_BLOCKCHAIN = -11,
  INTENT_NOT_FOUND = -12,
  QUOTE_EXPIRED = -13,
  MAX_INPUT_AMOUNT = -14,
  MAX_DIFF_OUTPUT = -15,
  STOPPED = -16,
  NO_ORACLE_MODULE_FOUND = -17,
  NEGATIVE_INPUT_AMOUNT = -18,
  INTENT_ALREADY_IN_ORDERBOOK = -19,
  CREATE_INTENT_ORDER_FAILED = -998,
  UNKNOWN = -999,
}

export type HashTxReturnType =
  | EvmReturnType<false>
  | SolanaReturnType<false>
  | IconReturnType<false>
  | SuiReturnType<false>
  | InjectiveReturnType<false>
  | StellarReturnType<false>
  | StacksReturnType<false>
  | NearReturnType<false>
  | TronReturnType<false>;

/** Fallback for {@link TxReturnType} and the backend APIs' unsigned `tx` field (chain known only at runtime). Bitcoin is
 * listed though structurally identical to Solana's raw tx, so its support stays explicit if Solana's types get branded. */
export type RawTxReturnType =
  | EvmRawTransaction
  | SolanaRawTransaction
  | InjectiveRawTransaction
  | IconRawTransaction
  | SuiRawTransaction
  | StellarRawTransaction
  | StacksRawTransaction
  | NearRawTransaction
  | BitcoinRawTransaction
  | TronRawTransaction
  | TronRawWithdraw
  | XrpRawTransaction
  | XrpRawWithdraw
  | TonRawTransaction
  | ZcashRawTransaction
  | CardanoRawTransaction;

export type GetDefaultTxReturnType<Raw extends boolean> = Raw extends true ? RawTxReturnType : HashTxReturnType;

export type TxReturnType<C extends SpokeChainKey | ChainType, Raw extends boolean> =
  GetChainType<C> extends 'EVM'
    ? EvmReturnType<Raw>
    : GetChainType<C> extends 'SOLANA'
      ? SolanaReturnType<Raw>
      : GetChainType<C> extends 'STELLAR'
        ? StellarReturnType<Raw>
        : GetChainType<C> extends 'ICON'
          ? IconReturnType<Raw>
          : GetChainType<C> extends 'SUI'
            ? SuiReturnType<Raw>
            : GetChainType<C> extends 'INJECTIVE'
              ? InjectiveReturnType<Raw>
              : GetChainType<C> extends 'STACKS'
                ? StacksReturnType<Raw>
                : GetChainType<C> extends 'NEAR'
                  ? NearReturnType<Raw>
                  : GetChainType<C> extends 'BITCOIN'
                    ? BitcoinReturnType<Raw>
                    : GetChainType<C> extends 'TRON'
                      ? TronReturnType<Raw>
                      : GetChainType<C> extends 'XRP'
                        ? XrpReturnType<Raw>
                        : GetChainType<C> extends 'TON'
                          ? TonReturnType<Raw>
                          : GetChainType<C> extends 'ZCASH'
                            ? ZcashReturnType<Raw>
                            : GetChainType<C> extends 'CARDANO'
                              ? CardanoReturnType<Raw>
                              : GetDefaultTxReturnType<Raw>;

/** What a deposit returns on `C`: {@link TxReturnType}, except that an MPC-relay deposit is only ever a transfer. */
export type DepositReturnType<C extends SpokeChainKey | ChainType, Raw extends boolean> =
  GetChainType<C> extends 'TRON'
    ? TronDepositReturnType<Raw>
    : GetChainType<C> extends 'XRP'
      ? XrpDepositReturnType<Raw>
      : TxReturnType<C, Raw>;

/** What a message to the hub (borrow, withdraw) returns on `C`: {@link TxReturnType}, but an MPC-relay withdraw-auth. */
export type SendMessageReturnType<C extends SpokeChainKey | ChainType, Raw extends boolean> =
  GetChainType<C> extends 'TRON'
    ? TronSendMessageReturnType<Raw>
    : GetChainType<C> extends 'XRP'
      ? XrpSendMessageReturnType<Raw>
      : TxReturnType<C, Raw>;

export type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};

export type Optional<T, K extends keyof T = keyof T> = Pick<Partial<T>, K> & Omit<T, K>;
type ExtractKeys<T> = T extends unknown ? keyof T : never;

export type SpokeTokenSymbols = ExtractKeys<(typeof spokeChainConfig)[SpokeChainKey]['supportedTokens']>;

export type SpokeTxHash = string;
export type HubTxHash = string;

export type SolanaGasEstimate = number | undefined;
export type EvmGasEstimate = bigint;
export type StellarGasEstimate = bigint;
export type IconGasEstimate = bigint;

export type SuiGasEstimate = {
  computationCost: string;
  nonRefundableStorageFee: string;
  storageCost: string;
  storageRebate: string;
};

export type InjectiveGasEstimate = {
  gasWanted: number;
  gasUsed: number;
};

export type BitcoinGasEstimate = bigint;

export type StacksFeeEstimation = {
  fee: number;
  fee_rate: number;
};
export type FeeEstimateTransaction = {
  low: StacksFeeEstimation;
  medium: StacksFeeEstimation;
  high: StacksFeeEstimation;
};

export type NearGasEstimate = bigint;

/** Tron prices a transaction in two staked resources rather than one gas number. */
export type TronGasEstimate = {
  /** Energy the contract call consumes. `0n` for a native TRX transfer, which uses none. */
  energy: bigint;
  /** Bandwidth points consumed: the byte length of the signed transaction plus 64 bytes of result space per contract. */
  bandwidth: bigint;
};

/** XRPL charges a flat per-transaction fee rather than metering execution, so there is no gas/limit pair. */
export type XrpGasEstimate = {
  /** Transaction fee in drops (1 XRP = 1_000_000 drops). */
  fee: bigint;
};

export type GasEstimateType =
  | XrpGasEstimate
  | EvmGasEstimate
  | SolanaGasEstimate
  | StellarGasEstimate
  | IconGasEstimate
  | SuiGasEstimate
  | InjectiveGasEstimate
  | TronGasEstimate
  | XrpGasEstimate
  | TonGasEstimate
  | ZcashGasEstimate
  | CardanoGasEstimate;

export type GetEstimateGasReturnTypeForSpokeChainId<C extends SpokeChainKey | ChainType> =
  GetChainType<C> extends 'EVM'
    ? EvmGasEstimate
    : GetChainType<C> extends 'SOLANA'
      ? SolanaGasEstimate
      : GetChainType<C> extends 'STELLAR'
        ? StellarGasEstimate
        : GetChainType<C> extends 'ICON'
          ? IconGasEstimate
          : GetChainType<C> extends 'SUI'
            ? SuiGasEstimate
            : GetChainType<C> extends 'INJECTIVE'
              ? InjectiveGasEstimate
              : GetChainType<C> extends 'NEAR'
                ? NearGasEstimate
                : GetChainType<C> extends 'BITCOIN'
                  ? BitcoinGasEstimate
                  : GetChainType<C> extends 'STACKS'
                    ? FeeEstimateTransaction
                    : GetChainType<C> extends 'TRON'
                      ? TronGasEstimate
                      : GetChainType<C> extends 'XRP'
                        ? XrpGasEstimate
                        : GetChainType<C> extends 'TON'
                          ? TonGasEstimate
                          : GetChainType<C> extends 'ZCASH'
                            ? ZcashGasEstimate
                            : GetChainType<C> extends 'CARDANO'
                              ? CardanoGasEstimate
                              : GasEstimateType;

export type GetEstimateGasReturnTypeForChainType<C extends ChainType> = C extends 'EVM'
  ? EvmGasEstimate
  : C extends 'SOLANA'
    ? SolanaGasEstimate
    : C extends 'STELLAR'
      ? StellarGasEstimate
      : C extends 'ICON'
        ? IconGasEstimate
        : C extends 'SUI'
          ? SuiGasEstimate
          : C extends 'INJECTIVE'
            ? InjectiveGasEstimate
            : C extends 'BITCOIN'
              ? BitcoinGasEstimate
              : C extends 'STACKS'
                ? FeeEstimateTransaction
                : C extends 'NEAR'
                  ? NearGasEstimate
                  : C extends 'TRON'
                    ? TronGasEstimate
                    : C extends 'XRP'
                      ? XrpGasEstimate
                      : C extends 'TON'
                        ? TonGasEstimate
                        : C extends 'ZCASH'
                          ? ZcashGasEstimate
                          : C extends 'CARDANO'
                            ? CardanoGasEstimate
                            : GasEstimateType;

export type GetEstimateGasReturnType<C extends SpokeChainKey | ChainType> = C extends SpokeChainKey
  ? GetEstimateGasReturnTypeForSpokeChainId<C>
  : C extends ChainType
    ? GetEstimateGasReturnTypeForChainType<C>
    : GasEstimateType;

export type StellarRpcConfig = {
  horizonRpcUrl?: string;
  sorobanRpcUrl?: string;
};

// Bound Exchange hosts do not belong here; they live on `chains[BITCOIN_MAINNET].radfi` in the SDK config.
export type BitcoinRpcConfig = {
  rpcUrl?: string;
};

// Unset fields fall back to mainnet defaults from @injectivelabs/networks.
export type InjectiveRpcConfig = {
  indexer?: string;
  grpc?: string;
};

// Local mirror of `StacksNetworkName` from @stacks/network (no external type imports in @sodax/types).
export type StacksNetworkName = 'mainnet' | 'testnet' | 'devnet' | 'mocknet';

/** Local structural mirror of `StacksNetwork` (@stacks/network@7.3.1), so `networkFrom(...)` output is assignable.
 * Keep in lockstep with the workspace catalog's `@stacks/network`. */
export type StacksNetworkLike = {
  chainId: number;
  transactionVersion: number;
  peerNetworkId: number;
  magicBytes: string;
  bootAddress: string;
  addressVersion: { singleSig: number; multiSig: number };
  client: { baseUrl: string };
};

export type RpcConfig = Partial<{
  [K in ChainKey]: K extends typeof ChainKeys.STELLAR_MAINNET
    ? StellarRpcConfig
    : K extends typeof ChainKeys.BITCOIN_MAINNET
      ? BitcoinRpcConfig
      : K extends typeof ChainKeys.INJECTIVE_MAINNET
        ? InjectiveRpcConfig
        : K extends typeof ChainKeys.STACKS_MAINNET
          ? StacksNetworkName | StacksNetworkLike
          : string;
}>;

export type AssetInfo = {
  chainId: bigint;
  spokeAddress: `0x${string}`;
};

export type MoneyMarketOptions = {
  partnerFee?: PartnerFee; // enables override of global partner fee
};

export type MoneyMarketDefaultConfig = {
  supportedTokens: Record<SpokeChainKey, readonly XToken[]>;
  supportedReserveAssets: readonly Address[];
  uiPoolDataProvider: Address;
  lendingPool: Address;
  poolAddressesProvider: Address;
  bnUSD: Address;
  bnUSDVault: Address;
  bnUSDAToken: Address;
};

export type MoneyMarketConfig = Prettify<MoneyMarketDefaultConfig & MoneyMarketOptions>;

export type TokenInfo = {
  decimals: number;
  depositFee: bigint;
  withdrawalFee: bigint;
  maxDeposit: bigint;
  isSupported: boolean;
};

export type BridgeLimit = {
  amount: bigint;
  decimals: number;
  type: 'DEPOSIT_LIMIT' | 'WITHDRAWAL_LIMIT';
};

export type SpokeChainConfigMap = Record<SpokeChainKey, SpokeChainConfig>;

export type WalletProviderSlot<K extends SpokeChainKey | ChainType, Raw extends boolean = false> = Raw extends true
  ? { raw: true; walletProvider?: never }
  : { raw?: false; walletProvider: GetWalletProviderType<K> };

/** Exec-mode wrapper for hub/spoke flows; `raw: true` returns unsigned payloads, else `walletProvider` is required.
 * Per-action data beyond `params` goes in `extras` (`E`, keyable off `K`); `E` defaults to `never`, i.e. absent. */
export type SpokeExecActionParams<K extends SpokeChainKey, Raw extends boolean, P, E = never> = {
  params: P;
  extras?: E;
  skipSimulation?: boolean;
  timeout?: number;
} & WalletProviderSlot<K, Raw>;

export type ExecuteAction<A> = Extract<A, { raw?: false }>;
export type RawAction<A> = Extract<A, { raw: true }>;

export type GetActionChainType<T extends { srcChainKey: SpokeChainKey }> = GetChainType<T['srcChainKey']>;
