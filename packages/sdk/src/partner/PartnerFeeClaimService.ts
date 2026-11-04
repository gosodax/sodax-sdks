// packages/sdk/src/partner/PartnerFeeClaimService.ts
import { invariant } from '../shared/utils/tiny-invariant.js';
import { getEvmViemChain } from '../shared/utils/constant-utils.js';
import { erc20Abi, encodeFunctionData, isAddress, type Address } from 'viem';
import type { ConfigService } from '../shared/config/ConfigService.js';
import type { HubProvider } from '../shared/types/types.js';
import { SodaxError, isSodaxError } from '../errors/SodaxError.js';
import { lookupFailed, approveFailed } from '../errors/wrappers.js';
import { SolverApiService } from '../swap/SolverApiService.js';
import { ProtocolIntentsAbi } from '../shared/abis/protocolIntents.abi.js';
import {
  ChainKeys,
  type SpokeChainKey,
  getIntentRelayChainId,
  type Hex,
  type OriginalAssetAddress,
  type XToken,
  type IntentRelayChainId,
  type SolverExecutionResponse,
  type Result,
  type GetAddressType,
  type SonicChainKey,
  type TxReturnType,
  type HubChainKey,
  type SpokeExecActionParams,
} from '@sodax/types';
import {
  encodeAddress,
  isEvmWalletProviderType,
  isHubChainKeyType,
  isOptionalEvmWalletProviderType,
  type SpokeApproveParams,
  type SpokeService,
} from '../shared/index.js';
import type { Intent } from '../shared/types/intent-types.js';

export type PartnerFeeClaimAssetBalance = {
  symbol: string;
  name: string;
  address: Address; // The wrapped asset address on Sonic (hub chain)
  originalChain: SpokeChainKey; // The original chain where this token comes from
  originalAddress: Address; // The original token address on the spoke chain
  decimal: number;
  balance: bigint;
};

export type AutoSwapPreferences = {
  outputToken: Address;
  dstChainKey: SpokeChainKey | 'not configured';
  dstAddress: Hex;
};

export type SetSwapPreferenceParams = {
  srcChainKey: HubChainKey;
  srcAddress: Address;
  outputToken: Address;
  dstChainKey: SpokeChainKey;
  dstAddress: string;
};

export type SetSwapPreferenceAction<K extends SpokeChainKey, Raw extends boolean> = SpokeExecActionParams<
  K,
  Raw,
  SetSwapPreferenceParams
>;

export type FeeTokenApproveParams = {
  srcChainKey: HubChainKey;
  srcAddress: Address;
  token: Address;
};

export type FeeTokenApproveAction<K extends HubChainKey, Raw extends boolean> = SpokeExecActionParams<
  K,
  Raw,
  FeeTokenApproveParams
>;

export type AssetEntry = {
  assetAddress: Address; // The wrapped asset address on Sonic
  originalChain: SpokeChainKey;
  originalAddress: Address; // The original token address on the spoke chain
  hubAsset: { symbol: string; name: string; decimal: number };
};

export type PartnerFeeClaimSwapParams = {
  srcChainKey: HubChainKey;
  srcAddress: Address;
  fromToken: Address;
  amount: bigint;
  timeout?: number;
};

export type PartnerFeeClaimSwapAction<K extends SpokeChainKey, Raw extends boolean> = SpokeExecActionParams<
  K,
  Raw,
  PartnerFeeClaimSwapParams
>;

export type PartnerFeeClaimCancelParams = {
  srcChainKey: HubChainKey;
  srcAddress: Address;
  fromToken: Address; // input (fee) token of the stuck intent — hub-chain address
  toToken: Address; // output token of the stuck intent — hub-chain address
};

export type PartnerFeeClaimCancelAction<K extends SpokeChainKey, Raw extends boolean> = SpokeExecActionParams<
  K,
  Raw,
  PartnerFeeClaimCancelParams
>;

export type GetUserIntentParams = {
  user: Address;
  fromToken: Address;
  toToken: Address;
};

export type PartnerFeeClaimServiceConstructorParams = {
  config: ConfigService;
  hubProvider: HubProvider;
  spoke: SpokeService;
};

export type IntentAutoSwapResult = {
  srcTxHash: Hex; // The transaction hash of the source transaction on the source chain (Sonic chain)
  solverExecutionResponse: SolverExecutionResponse; // The solver execution response
  intentTxHash: Hex; // The transaction hash of the intent on the hub chain (Sonic chain)
};

/**
 * Handles on-chain fee claiming for SODAX partners on the hub chain (Sonic).
 *
 * Partners accrue fee balances as wrapped hub-chain ERC-20 tokens whenever they
 * facilitate swap or bridge operations. This service provides the full lifecycle
 * for retrieving and converting those balances:
 *
 * 1. Query accrued balances across all supported tokens (`fetchAssetsBalances`).
 * 2. Inspect or configure automatic swap-and-bridge preferences (`getAutoSwapPreferences`,
 *    `setSwapPreference`) so that claimed fees are forwarded to a destination chain.
 * 3. Approve a hub-chain token for spending by the ProtocolIntents contract (`approveToken`,
 *    `isTokenApproved`).
 * 4. Trigger the swap on-chain and optionally wait for solver execution (`createIntentAutoSwap`,
 *    `swap`).
 *
 * All write operations target the `protocolIntentsContract` on the Sonic hub chain and require
 * an EVM-compatible wallet provider scoped to that chain.
 */
export class PartnerFeeClaimService {
  private readonly hubProvider: HubProvider;
  private readonly config: ConfigService;
  private readonly spoke: SpokeService;
  private readonly protocolIntentsContract: Address;

  public constructor({ config, hubProvider, spoke }: PartnerFeeClaimServiceConstructorParams) {
    this.config = config;
    this.hubProvider = hubProvider;
    this.spoke = spoke;
    this.protocolIntentsContract = config.solver.protocolIntentsContract;
  }

  /**
   * Returns the original spoke-chain address of a wrapped hub asset, if known.
   *
   * @param chainId - The spoke chain whose token mapping to look up.
   * @param hubAsset - The wrapped ERC-20 address on the Sonic hub chain.
   * @returns The original token address on the spoke chain, or `undefined` if the mapping is not found.
   */
  public getOriginalAssetAddress(chainId: SpokeChainKey, hubAsset: Address): OriginalAssetAddress | undefined {
    return this.config.getOriginalAssetAddress(chainId, hubAsset);
  }

  /**
   * Returns the spoke-chain token descriptor for a given original asset address.
   *
   * @param chainId - The spoke chain to search.
   * @param originalAssetAddress - The token's native address on the spoke chain.
   * @returns The `XToken` descriptor (symbol, decimals, hub asset address, etc.), or `undefined` if not found.
   */
  public getSpokeTokenFromOriginalAssetAddress(
    chainId: SpokeChainKey,
    originalAssetAddress: OriginalAssetAddress,
  ): XToken | undefined {
    return this.config.getSpokeTokenFromOriginalAssetAddress(chainId, originalAssetAddress);
  }

  /**
   * Fetches non-zero fee balances for all supported hub assets held by a partner address on Sonic.
   *
   * Iterates every spoke chain's token list, deduplicates by wrapped hub-asset address, then
   * issues a single multicall to the hub chain to read all ERC-20 balances in one round-trip.
   * Only tokens with a balance greater than zero are included in the result map.
   *
   * @param queryAddress - The EVM address (on the Sonic hub chain) to query balances for.
   * @returns A `Result` containing a `Map<wrappedAssetAddress, PartnerFeeClaimAssetBalance>` on
   *   success, or an `Error` tagged `FETCH_ASSETS_BALANCES_FAILED` on failure.
   */
  public async fetchAssetsBalances(
    queryAddress: string,
  ): Promise<Result<Map<string, PartnerFeeClaimAssetBalance>, Error>> {
    try {
      // Deduplicate by hubAsset address (same wrapped token can appear on multiple spoke chains).
      const uniqueAssets = new Map<Address, AssetEntry>();
      for (const [chainId, chainConfig] of Object.entries(this.config.spokeChainConfig)) {
        for (const token of Object.values(chainConfig.supportedTokens)) {
          // Some chain configs use placeholder hubAsset values (e.g. '0x') for not-yet-deployed
          // tokens; skip them so they're not fed into the multicall below.
          if (!isAddress(token.hubAsset)) continue;

          const assetAddress = token.hubAsset.toLowerCase() as Address;
          if (uniqueAssets.has(assetAddress)) continue;
          uniqueAssets.set(assetAddress, {
            assetAddress,
            originalChain: chainId as SpokeChainKey,
            originalAddress: token.address.toLowerCase() as Address,
            hubAsset: { symbol: token.symbol, name: token.name, decimal: token.decimals },
          });
        }
      }

      const uniqueAssetEntries = Array.from(uniqueAssets.values());
      const assetAddresses = uniqueAssetEntries.map(entry => entry.assetAddress);

      // Batch query balances using multicall for all wrapped assets on Sonic
      const balanceResults = await this.hubProvider.publicClient.multicall({
        contracts: assetAddresses.map(assetAddress => ({
          address: assetAddress,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [queryAddress],
        })),
        allowFailure: false,
      });

      // Build result map keyed by asset address (wrapped token on Sonic)
      const balancesMap = new Map<string, PartnerFeeClaimAssetBalance>();
      let nonZeroCount = 0;

      uniqueAssetEntries.forEach((entry, index) => {
        const balanceResult = balanceResults[index];
        // With allowFailure: false (used above), Viem returns raw result values directly —
        // not wrapped in { status, result } objects. Each entry is the unwrapped return
        // value of the ABI call, so balanceOf results are plain bigints.
        let balance: bigint;
        if (typeof balanceResult === 'bigint') {
          balance = balanceResult;
        } else {
          this.config.logger.warn(
            `[PartnerFeeClaimService] Unexpected balance result format for ${entry.hubAsset.symbol} (${entry.assetAddress})`,
            { balanceResult },
          );
          balance = 0n;
        }

        // Only add to map if balance is greater than zero
        if (balance > 0n) {
          nonZeroCount++;
          balancesMap.set(entry.assetAddress, {
            symbol: entry.hubAsset.symbol,
            name: entry.hubAsset.name,
            address: entry.assetAddress, // Wrapped asset address on Sonic
            originalChain: entry.originalChain,
            originalAddress: entry.originalAddress,
            decimal: entry.hubAsset.decimal,
            balance,
          });
        }
      });

      return {
        ok: true,
        value: balancesMap,
      };
    } catch (error) {
      return {
        ok: false,
        error: lookupFailed('partner', 'fetchAssetsBalances', error),
      };
    }
  }

  /**
   * Reads the on-chain auto-swap preferences configured for a partner address.
   *
   * Auto-swap preferences tell the ProtocolIntents contract where to send claimed fee tokens
   * after they have been swapped: which output token to target, which destination chain to
   * bridge to, and which address to deliver the proceeds to.
   *
   * @param queryAddress - The EVM address (on the Sonic hub chain) whose preferences to read.
   * @returns A `Result` containing `AutoSwapPreferences` on success — including `outputToken`
   *   (hub-chain address), `dstChainKey` (`'not configured'` when the destination chain is unset),
   *   and `dstAddress`. Returns an `Error` tagged `GET_AUTO_SWAP_PREFERENCES_FAILED` on failure.
   */
  public async getAutoSwapPreferences(queryAddress: string): Promise<Result<AutoSwapPreferences, Error>> {
    try {
      invariant(this.protocolIntentsContract, 'protocolIntentsContract is not configured in solver config');

      const autoSwapPreferences = await this.hubProvider.publicClient.readContract({
        address: this.protocolIntentsContract,
        abi: ProtocolIntentsAbi,
        functionName: 'getAutoSwapPreferences',
        args: [queryAddress as GetAddressType<SonicChainKey>],
      });

      // If dstChain is 0 (not configured), return "not configured" without conversion
      const dstChainKey =
        autoSwapPreferences.dstChain === 0n
          ? ('not configured' as const)
          : this.config.getSpokeChainKeyFromIntentRelayChainId(autoSwapPreferences.dstChain as IntentRelayChainId);

      return {
        ok: true,
        value: {
          outputToken: autoSwapPreferences.outputToken,
          dstChainKey,
          dstAddress: autoSwapPreferences.dstAddress,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: lookupFailed('partner', 'getAutoSwapPreferences', error),
      };
    }
  }

  /**
   * Writes auto-swap preferences to the ProtocolIntents contract on the Sonic hub chain.
   *
   * Preferences determine how future `createIntentAutoSwap` calls route claimed fees:
   * the desired output token, the destination chain, and the recipient address on that chain.
   * The `outputToken` parameter is resolved to its hub-chain (wrapped) address automatically
   * when a spoke-chain address is supplied.
   *
   * @param _params - Action descriptor containing:
   *   - `params.srcChainKey` — must be the hub chain key (Sonic).
   *   - `params.srcAddress` — partner's EVM address on Sonic.
   *   - `params.outputToken` — desired output token address (spoke-chain or hub-chain).
   *   - `params.dstChainKey` — spoke chain to receive the swapped proceeds.
   *   - `params.dstAddress` — recipient address on `dstChainKey`.
   *   - `raw` — when `true`, returns the unsigned transaction object instead of submitting it.
   *   - `walletProvider` — required when `raw` is `false`; must be an EVM wallet provider.
   * @returns A `Result` containing either the submitted transaction hash (`raw: false`) or the
   *   unsigned raw transaction (`raw: true`). Returns an error on failure.
   */
  public async setSwapPreference<K extends SpokeChainKey, Raw extends boolean>(
    _params: SetSwapPreferenceAction<K, Raw>,
  ): Promise<Result<TxReturnType<K, Raw>>> {
    return this.config.analytics.trackResult(
      'partner',
      'setSwapPreference',
      async () => {
        const { params, walletProvider, raw } = _params;
        try {
          invariant(isHubChainKeyType(params.srcChainKey), 'PartnerFeeClaimService only supports Sonic spoke provider');
          invariant(this.protocolIntentsContract, 'protocolIntentsContract is not configured in solver config');

          const outputToken =
            params.dstChainKey !== this.hubProvider.chainConfig.chain.key
              ? this.hubProvider.config.getSpokeTokenFromOriginalAssetAddress(params.dstChainKey, params.outputToken)
                  ?.hubAsset
              : params.outputToken;

          invariant(
            outputToken,
            `hub asset not found for spoke chain token (params.outputToken): ${params.outputToken} with chain key: ${params.dstChainKey}`,
          );

          const rawTx = {
            from: params.srcAddress,
            to: this.protocolIntentsContract,
            value: 0n,
            data: encodeFunctionData({
              abi: ProtocolIntentsAbi,
              functionName: 'setAutoSwapPreferences',
              args: [
                outputToken,
                BigInt(getIntentRelayChainId(params.dstChainKey)),
                encodeAddress(params.dstChainKey, params.dstAddress),
              ],
            }),
          } satisfies TxReturnType<HubChainKey, true>;

          if (raw) {
            return {
              ok: true,
              value: rawTx satisfies TxReturnType<HubChainKey, true> as TxReturnType<K, Raw>,
            };
          }

          invariant(
            isEvmWalletProviderType(walletProvider),
            'PartnerFeeClaimService only supports Evm (sonic) wallet provider',
          );

          const txHash = await walletProvider.sendTransaction(rawTx, {
            expectedChainId: getEvmViemChain(ChainKeys.SONIC_MAINNET).id,
          });

          return {
            ok: true,
            value: txHash satisfies TxReturnType<HubChainKey, false> as TxReturnType<K, Raw>,
          };
        } catch (error) {
          return {
            ok: false,
            error,
          };
        }
      },
      {
        start: () => ({
          srcChainKey: _params.params.srcChainKey,
          srcAddress: _params.params.srcAddress,
          outputToken: _params.params.outputToken,
          dstChainKey: _params.params.dstChainKey,
          dstAddress: _params.params.dstAddress,
        }),
        success: value => ({ txHash: value }),
        failure: error => ({ code: isSodaxError(error) ? error.code : undefined }),
      },
    );
  }

  /**
   * Checks whether a hub-chain ERC-20 token is already approved for the ProtocolIntents contract.
   *
   * Native tokens are considered pre-approved and always return `true`. For ERC-20 tokens,
   * the allowance is compared against `MaxUint256 - 1000` to account for minor rounding
   * differences from contracts that decrement exact allowances.
   *
   * @param token - Hub-chain ERC-20 address to check (or the chain's native token address).
   * @param srcAddress - The token owner whose allowance is queried.
   * @returns A `Result` where `value` is `true` if the allowance is effectively max, `false`
   *   if approval is needed. Returns an `Error` tagged `IS_TOKEN_APPROVED_FAILED` on failure.
   */
  public async isTokenApproved({ token, srcAddress }: FeeTokenApproveParams): Promise<Result<boolean, Error>> {
    try {
      invariant(this.protocolIntentsContract, 'protocolIntentsContract is not configured in solver config');

      if (token.toLowerCase() === this.hubProvider.chainConfig.nativeToken.toLowerCase()) {
        return {
          ok: true,
          value: true,
        };
      }

      const allowedAmount = await this.hubProvider.publicClient.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [srcAddress, this.protocolIntentsContract],
      });

      // Check if allowance is max (2^256 - 1) or a very large number (essentially max)
      const maxUint256 = 2n ** 256n - 1n;
      const isMaxApproved = allowedAmount >= maxUint256 - 1000n; // Allow for small rounding differences

      return {
        ok: true,
        value: isMaxApproved,
      };
    } catch (error) {
      return {
        ok: false,
        error: lookupFailed('partner', 'isTokenApproved', error),
      };
    }
  }

  /**
   * Approves a hub-chain ERC-20 token for the ProtocolIntents contract with maximum (`MaxUint256`) allowance.
   *
   * Must be called before `createIntentAutoSwap` or `swap` if `isTokenApproved` returns `false`.
   * Only hub chain keys (`srcChainKey`) and EVM wallet providers are accepted.
   *
   * @param _params - Action descriptor containing:
   *   - `params.srcChainKey` — must be the hub chain key (Sonic).
   *   - `params.srcAddress` — token owner address on Sonic.
   *   - `params.token` — ERC-20 contract address to approve.
   *   - `raw` — when `true`, returns the unsigned transaction object instead of submitting it.
   *   - `walletProvider` — required when `raw` is `false`; must be an EVM wallet provider.
   * @returns A `Result` containing the submitted transaction hash (`raw: false`) or the unsigned
   *   raw transaction (`raw: true`). Returns an `Error` tagged `APPROVE_TOKEN_FAILED` on failure.
   */
  public async approveToken<Raw extends boolean>(
    _params: FeeTokenApproveAction<HubChainKey, Raw>,
  ): Promise<Result<TxReturnType<HubChainKey, Raw>>> {
    const { params } = _params;
    try {
      invariant(isHubChainKeyType(params.srcChainKey), 'PartnerFeeClaimService only supports Hub srcChainKey');
      invariant(
        isOptionalEvmWalletProviderType(_params.walletProvider),
        'PartnerFeeClaimService only supports Evm wallet provider',
      );
      invariant(
        this.config.solver.protocolIntentsContract,
        'protocolIntentsContract is not configured in solver config',
      );

      // Always approve max (2^256 - 1)
      const maxUint256 = 2n ** 256n - 1n;

      const coreParams = {
        srcChainKey: params.srcChainKey,
        token: params.token,
        amount: maxUint256,
        spender: this.config.solver.protocolIntentsContract,
        owner: params.srcAddress,
      } as const;

      const approveParams = _params.raw
        ? ({
            ...coreParams,
            raw: true,
          } satisfies SpokeApproveParams<HubChainKey, true>)
        : ({
            ...coreParams,
            raw: false,
            walletProvider: _params.walletProvider,
          } satisfies SpokeApproveParams<HubChainKey, false>);

      const result = await this.spoke.approve<HubChainKey, boolean>(approveParams);

      if (!result.ok) return result;

      return {
        ok: true,
        value: result.value satisfies TxReturnType<HubChainKey, boolean> as TxReturnType<HubChainKey, Raw>,
      };
    } catch (error) {
      return {
        ok: false,
        error: approveFailed('partner', error),
      };
    }
  }

  /**
   * Submits a `createIntentAutoSwap` transaction to the ProtocolIntents contract on Sonic.
   *
   * This encodes an on-chain intent for the SODAX solver to swap the specified fee token into
   * the partner's preferred output token (as configured via `setSwapPreference`). The solver
   * fills the swap at best price with no minimum output enforced (`minOutputAmount = 0`).
   *
   * This is the low-level building block. Use `swap` for the full flow that also waits for
   * the solver to execute the intent.
   *
   * Guards against same-token intents: if the configured output token equals `fromToken` the solver
   * cannot fill the swap, so the call is rejected with `VALIDATION_FAILED` before any transaction is
   * built. The guard fails closed — if the preference lookup fails the call returns that error rather
   * than submitting an intent that may become unfillable.
   *
   * @param _params - Action descriptor containing:
   *   - `params.srcChainKey` — must be the hub chain key (Sonic).
   *   - `params.srcAddress` — partner's EVM address; also used as the intent creator.
   *   - `params.fromToken` — hub-chain ERC-20 address of the token to swap.
   *   - `params.amount` — token amount to swap (in the token's native decimals, as `bigint`).
   *   - `params.timeout` — optional timeout in milliseconds for transaction confirmation.
   *   - `raw` — when `true`, returns the unsigned transaction object instead of submitting it.
   *   - `walletProvider` — required when `raw` is `false`; must be an EVM wallet provider.
   * @returns A `Result` containing the submitted transaction hash (`raw: false`) or the unsigned
   *   raw transaction (`raw: true`). Returns an error on failure.
   */
  public async createIntentAutoSwap<Raw extends boolean>(
    _params: PartnerFeeClaimSwapAction<HubChainKey, Raw>,
  ): Promise<Result<TxReturnType<HubChainKey, Raw>>> {
    const { params } = _params;
    try {
      invariant(isHubChainKeyType(params.srcChainKey), 'PartnerFeeClaimService only supports Hub srcChainKey');
      invariant(
        isOptionalEvmWalletProviderType(_params.walletProvider),
        'PartnerFeeClaimService only supports Evm wallet provider',
      );
      invariant(
        this.config.solver.protocolIntentsContract,
        'protocolIntentsContract is not configured in solver config',
      );

      // Same-token guard: the solver cannot fill a swap whose output token equals its input token.
      // Creating the intent anyway pulls the partner's funds into an unfillable intent (deadline 0,
      // no auto-refund). This is enforced here — the method that actually encodes and submits the
      // ProtocolIntents call — so direct callers are protected, not only the `swap` flow.
      // Fail closed: if the preference lookup fails we cannot prove the pair is safe, so block rather
      // than risk recreating the stuck-funds scenario this guard exists to prevent.
      const prefs = await this.getAutoSwapPreferences(params.srcAddress);
      if (!prefs.ok) return prefs;
      if (prefs.value.outputToken.toLowerCase() === params.fromToken.toLowerCase()) {
        return {
          ok: false,
          error: new SodaxError(
            'VALIDATION_FAILED',
            'Auto-swap output token equals the fee token; the solver cannot swap a token into itself. Withdraw the fee token directly (bridge/transfer) or change the swap preference before claiming.',
            {
              feature: 'partner',
              context: {
                action: 'createIntentAutoSwap',
                fromToken: params.fromToken,
                outputToken: prefs.value.outputToken,
              },
            },
          ),
        };
      }

      // currently we only allow Sodax solver to fille the intent using best price
      // IMPORTANT: if this is changed, quote needs to be used to create slippage based min output amount
      const minOutputAmount = 0n;

      // Call createIntentAutoSwap
      const rawTx = {
        from: params.srcAddress,
        to: this.config.solver.protocolIntentsContract,
        value: 0n,
        data: encodeFunctionData({
          abi: ProtocolIntentsAbi,
          functionName: 'createIntentAutoSwap',
          args: [params.srcAddress, params.fromToken, params.amount, minOutputAmount],
        }),
      };

      if (_params.raw) {
        return {
          ok: true,
          value: rawTx satisfies TxReturnType<HubChainKey, true> as TxReturnType<HubChainKey, Raw>,
        };
      }

      const txHash = await _params.walletProvider.sendTransaction(rawTx, {
        expectedChainId: getEvmViemChain(ChainKeys.SONIC_MAINNET).id,
      });

      return {
        ok: true,
        value: txHash satisfies TxReturnType<HubChainKey, false> as TxReturnType<HubChainKey, Raw>,
      };
    } catch (error) {
      return {
        ok: false,
        error,
      };
    }
  }

  /**
   * End-to-end fee claim: submits the auto-swap intent on-chain and notifies the solver to execute it.
   *
   * Internally calls `createIntentAutoSwap`, waits for the transaction receipt, then posts the
   * intent transaction hash to the solver API (`SolverApiService.postExecution`) so the solver
   * fills the swap and bridges the output to the configured destination chain.
   *
   * Prerequisite: the `fromToken` must already be approved (`isTokenApproved` → `approveToken`)
   * and auto-swap preferences must be configured (`setSwapPreference`).
   *
   * @param _params - Action descriptor (same shape as `createIntentAutoSwap`, `raw` must be `false`).
   * @returns A `Result` containing `IntentAutoSwapResult` on success:
   *   - `srcTxHash` — transaction hash of the submitted intent on Sonic.
   *   - `intentTxHash` — confirmed transaction hash from the receipt.
   *   - `solverExecutionResponse` — the solver's acknowledgement response.
   *
   *   On failure the `error` is tagged:
   *   - `WAIT_INTENT_AUTO_SWAP_FAILED` — transaction was submitted but receipt polling failed.
   *   - Error from `createIntentAutoSwap` — if the initial submission failed, including
   *     `VALIDATION_FAILED` when the output token equals the fee token (same-token guard) or the
   *     preference lookup that backs the guard fails.
   *   - Error from `SolverApiService.postExecution` — if the solver notification failed.
   */
  public async swap(_params: PartnerFeeClaimSwapAction<HubChainKey, false>): Promise<Result<IntentAutoSwapResult>> {
    return this.config.analytics.trackResult(
      'partner',
      'swap',
      async () => {
        try {
          // The same-token guard (output token === fee token) is enforced inside `createIntentAutoSwap`,
          // which this flow delegates to, so it applies here too without duplication.
          const txHash = await this.createIntentAutoSwap(_params);

          if (!txHash.ok) {
            return txHash;
          }

          let intentTxHash: Hex;
          try {
            const receipt = await this.hubProvider.publicClient.waitForTransactionReceipt({ hash: txHash.value });
            intentTxHash = receipt.transactionHash;
          } catch (error) {
            return {
              ok: false,
              error: new SodaxError(
                'EXECUTION_FAILED',
                error instanceof Error ? error.message : 'waitIntentAutoSwap failed',
                { feature: 'partner', cause: error, context: { action: 'waitAutoSwap', phase: 'execution' } },
              ),
            };
          }

          const solverExecutionResponse = await SolverApiService.postExecution(
            { intent_tx_hash: intentTxHash },
            this.config.solver,
            this.config.logger,
            this.config.apiKey,
          );

          if (!solverExecutionResponse.ok) {
            return solverExecutionResponse;
          }

          return {
            ok: true,
            value: {
              srcTxHash: txHash.value,
              solverExecutionResponse: solverExecutionResponse.value,
              intentTxHash,
            },
          };
        } catch (error) {
          return { ok: false, error };
        }
      },
      {
        start: () => ({
          srcChainKey: _params.params.srcChainKey,
          srcAddress: _params.params.srcAddress,
          fromToken: _params.params.fromToken,
          amount: _params.params.amount,
        }),
        success: value => ({
          srcTxHash: value.srcTxHash,
          intentTxHash: value.intentTxHash,
        }),
        failure: error => ({ code: isSodaxError(error) ? error.code : undefined }),
      },
    );
  }

  /**
   * Cancels a partner fee-claim auto-swap intent and refunds the input token to the partner.
   *
   * This targets the ProtocolIntents contract's own `cancelIntent(fromToken, toToken)`, which is
   * the only authorized cancel path for partner auto-swap intents: the intent's `creator` is the
   * ProtocolIntents contract (not the partner), so the generic `SwapService.cancelIntent` reverts
   * with `Unauthorized()`. ProtocolIntents looks up the caller's intent for the token pair, cancels
   * it in the main intents contract (as the creator), and transfers the locked `inputAmount` back
   * to the partner (`msg.sender`).
   *
   * Use this to recover funds stuck in an unfillable intent — most commonly a same-token claim
   * (`fromToken === toToken`) the solver refused to fill (see the guard in {@link swap}).
   *
   * @param _params - Action descriptor containing:
   *   - `params.srcChainKey` — must be the hub chain key (Sonic).
   *   - `params.srcAddress` — the partner's EVM address; must match the intent's owner.
   *   - `params.fromToken` — the stuck intent's input (fee) token, hub-chain address.
   *   - `params.toToken` — the stuck intent's output token, hub-chain address.
   *   - `raw` — when `true`, returns the unsigned transaction object instead of submitting it.
   *   - `walletProvider` — required when `raw` is `false`; must be an EVM wallet provider.
   * @returns A `Result` containing the submitted transaction hash (`raw: false`) or the unsigned
   *   raw transaction (`raw: true`).
   */
  public async cancelIntent<Raw extends boolean>(
    _params: PartnerFeeClaimCancelAction<HubChainKey, Raw>,
  ): Promise<Result<TxReturnType<HubChainKey, Raw>>> {
    return this.config.analytics.trackResult(
      'partner',
      'cancelIntent',
      async () => {
        const { params } = _params;
        try {
          invariant(isHubChainKeyType(params.srcChainKey), 'PartnerFeeClaimService only supports Hub srcChainKey');
          invariant(
            isOptionalEvmWalletProviderType(_params.walletProvider),
            'PartnerFeeClaimService only supports Evm wallet provider',
          );
          invariant(this.protocolIntentsContract, 'protocolIntentsContract is not configured in solver config');

          const rawTx = {
            from: params.srcAddress,
            to: this.protocolIntentsContract,
            value: 0n,
            data: encodeFunctionData({
              abi: ProtocolIntentsAbi,
              functionName: 'cancelIntent',
              args: [params.fromToken, params.toToken],
            }),
          };

          if (_params.raw) {
            return {
              ok: true,
              value: rawTx satisfies TxReturnType<HubChainKey, true> as TxReturnType<HubChainKey, Raw>,
            };
          }

          const txHash = await _params.walletProvider.sendTransaction(rawTx, {
            expectedChainId: getEvmViemChain(ChainKeys.SONIC_MAINNET).id,
          });

          return {
            ok: true,
            value: txHash satisfies TxReturnType<HubChainKey, false> as TxReturnType<HubChainKey, Raw>,
          };
        } catch (error) {
          return { ok: false, error };
        }
      },
      {
        start: () => ({
          srcChainKey: _params.params.srcChainKey,
          srcAddress: _params.params.srcAddress,
          fromToken: _params.params.fromToken,
          toToken: _params.params.toToken,
        }),
        success: value => ({ txHash: value }),
        failure: error => ({ code: isSodaxError(error) ? error.code : undefined }),
      },
    );
  }

  /**
   * Returns the stored intent hash for a partner's `(user, fromToken, toToken)` token pair.
   *
   * A non-zero hash means an auto-swap intent currently exists for that pair (e.g. an unfilled
   * same-token claim) and can be cancelled via {@link cancelIntent}. A zero hash
   * (`0x000…0`) means there is no open intent for the pair.
   *
   * @param params.user - The partner's EVM address on Sonic.
   * @param params.fromToken - Input (fee) token, hub-chain address.
   * @param params.toToken - Output token, hub-chain address.
   * @returns A `Result` containing the intent hash, or an `Error` tagged `LOOKUP_FAILED`.
   */
  public async getUserIntent({ user, fromToken, toToken }: GetUserIntentParams): Promise<Result<Hex, Error>> {
    try {
      invariant(this.protocolIntentsContract, 'protocolIntentsContract is not configured in solver config');

      const intentHash = await this.hubProvider.publicClient.readContract({
        address: this.protocolIntentsContract,
        abi: ProtocolIntentsAbi,
        functionName: 'getUserIntent',
        args: [user, fromToken, toToken],
      });

      return { ok: true, value: intentHash };
    } catch (error) {
      return { ok: false, error: lookupFailed('partner', 'getUserIntent', error) };
    }
  }

  /**
   * Reads the full {@link Intent} details for a stored intent hash from the ProtocolIntents contract.
   *
   * Useful for displaying a stuck intent before cancelling it — e.g. the locked `inputAmount` and
   * `inputToken`. Pair with {@link getUserIntent} to resolve the hash from a token pair.
   *
   * @param intentHash - The intent hash (from {@link getUserIntent}).
   * @returns A `Result` containing the `Intent`, or an `Error` tagged `LOOKUP_FAILED`.
   */
  public async getIntentDetails(intentHash: Hex): Promise<Result<Intent, Error>> {
    try {
      invariant(this.protocolIntentsContract, 'protocolIntentsContract is not configured in solver config');

      const intent = await this.hubProvider.publicClient.readContract({
        address: this.protocolIntentsContract,
        abi: ProtocolIntentsAbi,
        functionName: 'getIntentDetails',
        args: [intentHash],
      });

      // Narrow the on-chain uint256 chain ids (viem returns plain bigint) to the branded
      // IntentRelayChainId union so the result satisfies the public Intent type.
      if (
        !this.config.isValidIntentRelayChainId(intent.srcChain) ||
        !this.config.isValidIntentRelayChainId(intent.dstChain)
      ) {
        return {
          ok: false,
          error: lookupFailed(
            'partner',
            'getIntentDetails',
            new Error(`Invalid intent relay chain id: ${intent.srcChain} or ${intent.dstChain}`),
          ),
        };
      }

      return {
        ok: true,
        value: {
          intentId: intent.intentId,
          creator: intent.creator,
          inputToken: intent.inputToken,
          outputToken: intent.outputToken,
          inputAmount: intent.inputAmount,
          minOutputAmount: intent.minOutputAmount,
          deadline: intent.deadline,
          allowPartialFill: intent.allowPartialFill,
          srcChain: intent.srcChain,
          dstChain: intent.dstChain,
          srcAddress: intent.srcAddress,
          dstAddress: intent.dstAddress,
          solver: intent.solver,
          data: intent.data,
        } satisfies Intent,
      };
    } catch (error) {
      return { ok: false, error: lookupFailed('partner', 'getIntentDetails', error) };
    }
  }
}
