import type {
  Address,
  GetTokenAddressType,
  XToken,
  Hex,
  HubAddress,
  HubChainKey,
  SpokeChainKey,
  TxReturnType,
  GetChainType,
  EvmRawTransactionReceipt,
  SolanaRawTransactionReceipt,
  StellarSorobanTransactionReceipt,
  IconTransactionResult,
  SuiRawTransactionReceipt,
  InjectiveRawTransactionReceipt,
  NearRawTransactionReceipt,
  StacksRawTransactionReceipt,
  BitcoinRawTransactionReceipt,
  TronRawTransactionReceipt,
  XrpRawTransactionReceipt,
  TonRawTransactionReceipt,
  ZcashRawTransactionReceipt,
  CardanoRawTransactionReceipt,
  ChainType,
  GetAddressType,
  EvmSpokeOnlyChainKey,
  StellarChainKey,
  EvmChainKey,
  MonadChainKey,
  WalletProviderSlot,
} from '@sodax/types';
import type { RelayExtraData } from './relay-types.js';

type OptionalSkipSimulation = { skipSimulation?: boolean };

export type DepositParams<C extends SpokeChainKey, Raw extends boolean = boolean> = {
  srcAddress: GetAddressType<C>; // The address of the user on the spoke (origin) chain
  srcPublicKey?: string; // Signer public key, for chains whose address can't yield it (e.g. Stacks raw txs). Ignored elsewhere.
  accessToken?: string; // Bound Exchange (Radfi) access token, for Bitcoin TRADING-mode deposits. Ignored elsewhere.
  srcChainKey: C; // The chain key of the spoke (origin) chain
  to: HubAddress; // The address of the user on the hub chain (wallet abstraction address)
  token: GetTokenAddressType<C>; // The original spoke chain address of the token to deposit
  amount: bigint; // The amount of tokens to deposit
  data: Hex; // The data to send with the deposit
} & WalletProviderSlot<C, Raw> &
  OptionalSkipSimulation;

export type EstimateGasParams<C extends SpokeChainKey> = {
  tx: TxReturnType<C, true>;
  chainKey: C;
};

export type GetDepositParams<ChainKey extends SpokeChainKey = SpokeChainKey> = {
  srcChainKey: ChainKey; // The chain key of the spoke (origin) chain
  srcAddress: GetAddressType<ChainKey>; // The address of the user on the spoke (origin) chain
  token: GetTokenAddressType<ChainKey>;
  /** TON only: the wallet account to read (e.g. from ITonWalletProvider.getAccountAddress()); defaults to the public key's wallet-v4R2 address */
  accountAddress?: string;
};

/**
 * Reads the wallet balance held by `srcAddress` itself (not the asset-manager holding). The RPC comes from `srcChainKey`,
 * never `token.chainKey`, so a mismatched token reads the wrong chain (EVM: `0n`). Rejects on any read failure.
 */
export type GetBalanceParams<ChainKey extends SpokeChainKey = SpokeChainKey> = {
  srcChainKey: ChainKey; // The chain key of the spoke (origin) chain
  srcAddress: GetAddressType<ChainKey>; // The address of the user whose balance is read
  token: XToken; // The token to read the balance of
  /** TON only: the wallet account to read (e.g. from ITonWalletProvider.getAccountAddress()); defaults to the public key's wallet-v4R2 address */
  accountAddress?: string;
};

/**
 * Batched balances in smallest units; an unreadable token is logged and reported as `0n` (under-reporting blocks a
 * spend, never permits one). Fails only when the whole batch is unusable, including when no token could be read.
 */
export type GetBalancesParams<ChainKey extends SpokeChainKey = SpokeChainKey> = {
  srcChainKey: ChainKey; // The chain key of the spoke (origin) chain
  srcAddress: GetAddressType<ChainKey>; // The address of the user whose balances are read
  tokens: readonly XToken[]; // The tokens to read the balances of
  /** TON only: the wallet account to read (e.g. from ITonWalletProvider.getAccountAddress()); defaults to the public key's wallet-v4R2 address */
  accountAddress?: string;
};

export type DepositSimulationParams = {
  spokeChainID: SpokeChainKey;
  token: Hex;
  from: Hex;
  to: Hex;
  amount: bigint;
  data: Hex;
  srcAddress: Hex;
};

export type SendMessageParams<K extends SpokeChainKey, Raw extends boolean> = {
  srcChainKey: K; // The chain key of the spoke (origin) chain
  srcAddress: GetAddressType<K>; // The address of the user on the spoke (origin) chain
  dstChainKey: HubChainKey; // hub chain key to which the message is sent
  dstAddress: HubAddress; // The wallet abstraction address on the hub chain.
  payload: Hex; // encoded contract call data
} & OptionalSkipSimulation &
  WalletProviderSlot<K, Raw>;

export type WalletSimulationParams = {
  target: Address;
  srcChainId: bigint;
  srcAddress: Hex;
  payload: Hex;
};

export type VerifySimulationParams<ChainKey extends SpokeChainKey, Raw extends boolean> = SendMessageParams<
  ChainKey,
  Raw
>;

export type GetTxReceiptType<C extends SpokeChainKey | ChainType> =
  GetChainType<C> extends 'EVM'
    ? EvmRawTransactionReceipt
    : GetChainType<C> extends 'SOLANA'
      ? SolanaRawTransactionReceipt
      : GetChainType<C> extends 'STELLAR'
        ? StellarSorobanTransactionReceipt
        : GetChainType<C> extends 'ICON'
          ? IconTransactionResult
          : GetChainType<C> extends 'SUI'
            ? SuiRawTransactionReceipt
            : GetChainType<C> extends 'INJECTIVE'
              ? InjectiveRawTransactionReceipt
              : GetChainType<C> extends 'NEAR'
                ? NearRawTransactionReceipt
                : GetChainType<C> extends 'STACKS'
                  ? StacksRawTransactionReceipt
                  : GetChainType<C> extends 'BITCOIN'
                    ? BitcoinRawTransactionReceipt
                    : GetChainType<C> extends 'TRON'
                      ? TronRawTransactionReceipt
                      : GetChainType<C> extends 'XRP'
                        ? XrpRawTransactionReceipt
                        : GetChainType<C> extends 'TON'
                          ? TonRawTransactionReceipt
                          : GetChainType<C> extends 'CARDANO'
                            ? CardanoRawTransactionReceipt
                            : GetChainType<C> extends 'ZCASH'
                              ? ZcashRawTransactionReceipt
                              : unknown;

export type TxStatus = 'success' | 'failure' | 'timeout';
export type WaitForTxReceiptParams<C extends SpokeChainKey> = {
  txHash: string;
  chainKey: C;
  pollingIntervalMs?: number;
  maxTimeoutMs?: number;
};

export type WaitForTxReceiptReturnType<C extends SpokeChainKey> =
  | {
      status: 'success';
      receipt: GetTxReceiptType<C>;
    }
  | {
      error: Error;
      status: Exclude<TxStatus, 'success'>;
    };

export type VerifyTxHashParams = {
  txHash: string;
  chainKey: SpokeChainKey;
};

// Variants are generic over their `srcChainKey` range so a caller that narrowed `K` gets the matching one without casts.
type SpokeIsAllowanceValidParamsCommon = {
  token: string;
  amount: bigint;
  owner: string;
};

export type SpokeIsAllowanceValidParamsHub<K extends HubChainKey = HubChainKey> = SpokeIsAllowanceValidParamsCommon & {
  srcChainKey: K;
  spender: Address;
};

export type SpokeIsAllowanceValidParamsEvmSpoke<K extends EvmSpokeOnlyChainKey = EvmSpokeOnlyChainKey> =
  SpokeIsAllowanceValidParamsCommon & {
    srcChainKey: K;
    spender: Address;
  };

export type SpokeIsAllowanceValidParamsStellar<K extends StellarChainKey = StellarChainKey> =
  SpokeIsAllowanceValidParamsCommon & {
    srcChainKey: K;
  };

type OtherSpokeChainKey = Exclude<SpokeChainKey, HubChainKey | EvmSpokeOnlyChainKey | StellarChainKey>;

export type SpokeIsAllowanceValidParamsOther<K extends OtherSpokeChainKey = OtherSpokeChainKey> =
  SpokeIsAllowanceValidParamsCommon & {
    srcChainKey: K;
  };

/** @internal Distributive: picks the variant based on `K`. Defaults to the full union. */
export type SpokeIsAllowanceValidParams<K extends SpokeChainKey = SpokeChainKey> = K extends MonadChainKey
  ? SpokeIsAllowanceValidParamsOther<K>
  : K extends EvmChainKey
    ? K extends HubChainKey // handle case when EvmChainKey type is passed
      ? SpokeIsAllowanceValidParamsHub<K>
      : SpokeIsAllowanceValidParamsEvmSpoke<EvmSpokeOnlyChainKey>
    : K extends HubChainKey
      ? SpokeIsAllowanceValidParamsHub<K>
      : K extends EvmSpokeOnlyChainKey
        ? SpokeIsAllowanceValidParamsEvmSpoke<K>
        : K extends StellarChainKey
          ? SpokeIsAllowanceValidParamsStellar<K>
          : K extends OtherSpokeChainKey
            ? SpokeIsAllowanceValidParamsOther<K>
            : never;

type SpokeApproveParamsCommon<K extends SpokeChainKey, Raw extends boolean> = {
  token: GetTokenAddressType<K>;
  amount: bigint;
  owner: GetAddressType<K>;
} & WalletProviderSlot<K, Raw>;

export type SpokeApproveParamsHub<K extends HubChainKey, Raw extends boolean> = SpokeApproveParamsCommon<K, Raw> & {
  srcChainKey: K;
  spender: Address;
};

export type SpokeApproveParamsEvmSpoke<K extends EvmSpokeOnlyChainKey, Raw extends boolean> = SpokeApproveParamsCommon<
  K,
  Raw
> & {
  srcChainKey: K;
  spender: Address;
};

export type SpokeApproveParamsStellar<K extends StellarChainKey, Raw extends boolean> = SpokeApproveParamsCommon<
  K,
  Raw
> & {
  srcChainKey: K;
};

/**
 * Named, not an array. `resetTx` exists only for a token that rejects a non-zero → non-zero allowance change while a
 * stale allowance exists: broadcast it first and wait for it to be mined before `approveTx`.
 */
export type ApprovalTxs<K extends SpokeChainKey> = {
  readonly resetTx?: TxReturnType<K, true>;
  readonly approveTx: TxReturnType<K, true>;
};

/** For narrow-`K` typing, instantiate the specific variant (e.g. `SpokeApproveParamsHub`) directly. */
export type SpokeApproveParams<K extends SpokeChainKey, Raw extends boolean> = K extends HubChainKey
  ? SpokeApproveParamsHub<K, Raw>
  : K extends EvmSpokeOnlyChainKey
    ? SpokeApproveParamsEvmSpoke<K, Raw>
    : K extends StellarChainKey
      ? SpokeApproveParamsStellar<K, Raw>
      : never;

export type RawDestinationParams = {
  dstChainKey: SpokeChainKey;
  dstAddress: string;
};

/**
 * Direction of the settlement a feature waits on: `inbound` is spoke→hub, `outbound` hub→spoke. The
 * two are not symmetric per chain family; {@link SpokeService.settle} owns that behaviour.
 */
export type SettlementDirection = 'inbound' | 'outbound';

export type SettleParams<
  K extends SpokeChainKey = SpokeChainKey,
  D extends SettlementDirection = SettlementDirection,
> = {
  chainKey: K;
  /** What `create*Intent` returned: the spoke tx hash, or an MPC tracking id for a Tron withdrawal. */
  tx: string;
  direction: D;
  relayData: RelayExtraData;
  timeout?: number;
  /**
   * Payout chain. For outbound settlement from an MPC-relay chain, always pass the original payout chain, including Sonic.
   * Drives the destination leg, which an MPC-relay chain or an MPC-produced hub tx needs driven here.
   */
  dstChainKey?: SpokeChainKey;
};

/** Why a settlement failed. `phase` lets a feature map it onto its own errors. */
export type SettlementFailure = { phase: 'verification' | 'relay'; cause: unknown };
