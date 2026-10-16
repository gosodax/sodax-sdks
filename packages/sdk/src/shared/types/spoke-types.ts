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
  ChainType,
  GetAddressType,
  EvmSpokeOnlyChainKey,
  StellarChainKey,
  EvmChainKey,
  WalletProviderSlot,
} from '@sodax/types';
import type { RelayExtraData } from './relay-types.js';

type OptionalSkipSimulation = { skipSimulation?: boolean };

/*
 * Deposit parameters type for depositing tokens into spoke chain asset manager.
 * @param {C} C - The chain ID of the spoke chain.
 * @param {Raw} Raw - The return type raw transaction or just transaction hash.
 * @returns {DepositParams<C, Raw>} The deposit parameters type.
 */
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
};

/**
 * Parameters for reading a user's own wallet balance of a single token on a spoke chain.
 *
 * Unlike {@link GetDepositParams} (which reads the protocol asset-manager holding and keys
 * the token by raw address), this reads the balance held by `srcAddress` itself. `token` is
 * the full {@link XToken} so the reader can detect the native coin and resolve chain-specific
 * token identifiers (EVM erc20 address, Solana mint, Sui coinType, Soroban contract, …).
 *
 * The reader picks its RPC provider from `srcChainKey` and the on-chain identifier from
 * `token.address`; it never consults `token.chainKey`. Passing a token that does not live on
 * `srcChainKey` therefore reads the wrong chain and — on an EVM target — resolves to `0n` rather
 * than an error, so keep the chain key and the token list in step. This is NOT enforced: a few
 * config entries carry a `chainKey` that disagrees with where the address actually lives, so the
 * field is not reliable enough to validate against.
 *
 * Failure contract: this single-token read REJECTS on a network, RPC, or contract-read failure, and
 * the router turns that into an unsuccessful `Result`. The batch variant is deliberately more
 * forgiving — see {@link GetBalancesParams}.
 */
export type GetBalanceParams<ChainKey extends SpokeChainKey = SpokeChainKey> = {
  srcChainKey: ChainKey; // The chain key of the spoke (origin) chain
  srcAddress: GetAddressType<ChainKey>; // The address of the user whose balance is read
  token: XToken; // The token to read the balance of
};

/**
 * Parameters for reading a user's own wallet balances of multiple tokens on a spoke chain.
 * Per-chain implementations batch the reads where the chain supports it (EVM multicall3, ICON
 * `tryAggregate`, Injective portfolio).
 *
 * Returns `Record<tokenAddress, bigint>` in smallest units. A token that could not be read is logged
 * through the SDK logger and reported as `0n`, so one flaky token never discards the balances that
 * did resolve. Callers therefore cannot tell a failed read from an empty wallet; the direction is
 * deliberately conservative — under-reporting blocks a spend, it never permits one.
 *
 * The `Result` fails when the whole batch is unusable: an invalid chain key, a shared round-trip
 * every token depends on (ICON `tryAggregate`, Injective's portfolio fetch), or a batch in which NO
 * token could be read — a dead or rate-limited RPC would otherwise render as "this wallet is empty
 * on every asset".
 */
export type GetBalancesParams<ChainKey extends SpokeChainKey = SpokeChainKey> = {
  srcChainKey: ChainKey; // The chain key of the spoke (origin) chain
  srcAddress: GetAddressType<ChainKey>; // The address of the user whose balances are read
  tokens: readonly XToken[]; // The tokens to read the balances of
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

/**
 * Unified read-only params for spoke-level ERC-20 allowance or Stellar trustline checks.
 * Feature services map action-specific payloads into this shape before calling SpokeService.isAllowanceValid.
 *
 * Each variant is generic over its `srcChainKey` range so that callers who have already narrowed
 * `K` (via {@link isHubChainKeyType}, {@link isEvmSpokeOnlyChainKeyType}, {@link isStellarChainKeyType})
 * get the matching variant inferred without casts. Mirrors the {@link SpokeApproveParams} pattern.
 */
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
export type SpokeIsAllowanceValidParams<K extends SpokeChainKey = SpokeChainKey> = K extends EvmChainKey
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
 * The unsigned transactions an approval needs, named rather than ordered.
 *
 * `resetTx` is present only for a token that rejects an allowance change from one non-zero value to
 * another while a stale allowance exists. When it is, **broadcast it first and wait for it to be
 * mined** — `approveTx` is not valid until the reset has landed.
 *
 * Deliberately not an array: the only consumers map these onto named fields anyway
 * (`ApproveResponseV2.tx` / `resetTx`), and a positional contract crossing a package boundary
 * invites a reader to guess which end is which.
 */
export type ApprovalTxs<K extends SpokeChainKey> = {
  readonly resetTx?: TxReturnType<K, true>;
  readonly approveTx: TxReturnType<K, true>;
};

/**
 * Plain union of approve-capable variants. Callers who want narrow-`K` typing should instantiate
 * the specific variant (e.g. `SpokeApproveParamsHub<R>`) directly.
 */
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

export type SettleParams = {
  chainKey: SpokeChainKey;
  /** What `create*Intent` returned: the spoke tx hash, or an MPC tracking id for a Tron withdrawal. */
  tx: string;
  direction: SettlementDirection;
  relayData: RelayExtraData;
  timeout?: number;
};

/** Why a settlement failed. `phase` lets a feature map it onto its own errors. */
export type SettlementFailure = { phase: 'verification' | 'relay'; cause: unknown };
