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
  isMpcRelayChainKey,
} from '@sodax/types';
import {
  encodeRecipient,
  isEvmWalletProviderType,
  isHubChainKeyType,
  isOptionalEvmWalletProviderType,
  type SpokeApproveParams,
  type SpokeService,
} from '../shared/index.js';
import type { Intent } from '../shared/types/intent-types.js';
import { partnerInvariant } from './errors.js';

const MPC_RELAY_AUTO_SWAP_MESSAGE =
  "Auto-swap cannot pay out to an MPC-relay chain: its intents allow partial fills with no minimum output, so a payout could fall below the relay's release fee and be lost. Choose another destination chain.";

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
  /** In `dstChainKey`'s own format; resolved to the hub asset before it is stored. */
  outputToken: OriginalAssetAddress;
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
 * Partner fee claiming on the hub: fees accrue as wrapped hub ERC-20s and are swapped/bridged via ProtocolIntents.
 * Flow: fetchAssetsBalances → setSwapPreference → approveToken → swap.
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

  public getOriginalAssetAddress(chainId: SpokeChainKey, hubAsset: Address): OriginalAssetAddress | undefined {
    return this.config.getOriginalAssetAddress(chainId, hubAsset);
  }

  public getSpokeTokenFromOriginalAssetAddress(
    chainId: SpokeChainKey,
    originalAssetAddress: OriginalAssetAddress,
  ): XToken | undefined {
    return this.config.getSpokeTokenFromOriginalAssetAddress(chainId, originalAssetAddress);
  }

  /** Non-zero hub-asset fee balances of `queryAddress`, read in one multicall and keyed by wrapped asset address. */
  public async fetchAssetsBalances(
    queryAddress: string,
  ): Promise<Result<Map<string, PartnerFeeClaimAssetBalance>, Error>> {
    try {
      // The same wrapped token can appear on multiple spoke chains.
      const uniqueAssets = new Map<Address, AssetEntry>();
      for (const [chainId, chainConfig] of Object.entries(this.config.spokeChainConfig)) {
        for (const token of Object.values(chainConfig.supportedTokens)) {
          // Placeholder hubAsset values (e.g. '0x') mark not-yet-deployed tokens; keep them out of the multicall.
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

      const balanceResults = await this.hubProvider.publicClient.multicall({
        contracts: assetAddresses.map(assetAddress => ({
          address: assetAddress,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [queryAddress],
        })),
        allowFailure: false,
      });

      const balancesMap = new Map<string, PartnerFeeClaimAssetBalance>();
      let nonZeroCount = 0;

      uniqueAssetEntries.forEach((entry, index) => {
        const balanceResult = balanceResults[index];
        // With allowFailure: false viem returns unwrapped values, so balanceOf results are plain bigints.
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

  /** `dstChainKey` is `'not configured'` when the destination chain is unset on-chain. */
  public async getAutoSwapPreferences(queryAddress: string): Promise<Result<AutoSwapPreferences, Error>> {
    try {
      invariant(this.protocolIntentsContract, 'protocolIntentsContract is not configured in solver config');

      const autoSwapPreferences = await this.hubProvider.publicClient.readContract({
        address: this.protocolIntentsContract,
        abi: ProtocolIntentsAbi,
        functionName: 'getAutoSwapPreferences',
        args: [queryAddress as GetAddressType<SonicChainKey>],
      });

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
   * `outputToken` may be a spoke or hub address and is resolved to the hub asset.
   * An MPC-relay `dstChainKey` (Tron) is refused with `VALIDATION_FAILED`: see {@link createIntentAutoSwap}.
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
          partnerInvariant(!isMpcRelayChainKey(params.dstChainKey), MPC_RELAY_AUTO_SWAP_MESSAGE, {
            action: 'setSwapPreference',
            field: 'dstChainKey',
            dstChainKey: params.dstChainKey,
            reason: 'mpc-relay-auto-swap-destination',
          });

          const outputToken =
            params.dstChainKey !== this.hubProvider.chainConfig.chain.key
              ? this.hubProvider.config.getSpokeTokenFromOriginalAssetAddress(params.dstChainKey, params.outputToken)
                  ?.hubAsset
              : isAddress(params.outputToken)
                ? params.outputToken
                : undefined;

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
                encodeRecipient(params.dstChainKey, params.dstAddress),
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

  /** Native tokens count as approved; ERC-20 allowance must be at least `MaxUint256 - 1000`. */
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

  /** Approves `MaxUint256` for the ProtocolIntents contract; hub chain and EVM wallet only. */
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
   * Low-level intent creation (use `swap` for the full flow). Refuses same-token pairs and MPC-relay payouts,
   * since intents have no minimum output and an unfilled or underpaid one locks funds; fails closed on lookup error.
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

      // Same-token intents are unfillable and lock funds (deadline 0, no auto-refund); fail closed if the
      // preference lookup fails.
      const prefs = await this.getAutoSwapPreferences(params.srcAddress);
      if (!prefs.ok) return prefs;
      const { dstChainKey } = prefs.value;
      partnerInvariant(
        dstChainKey === 'not configured' || !isMpcRelayChainKey(dstChainKey),
        MPC_RELAY_AUTO_SWAP_MESSAGE,
        {
          action: 'createIntentAutoSwap',
          field: 'dstChainKey',
          dstChainKey,
          reason: 'mpc-relay-auto-swap-destination',
        },
      );
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

      // Only the SODAX solver fills at best price; if this changes, derive a slippage-based min output from a quote.
      const minOutputAmount = 0n;

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
   * Creates the auto-swap intent, waits for the receipt, then posts it to the solver for execution.
   * Requires prior approval (`approveToken`) and preferences (`setSwapPreference`).
   */
  public async swap(_params: PartnerFeeClaimSwapAction<HubChainKey, false>): Promise<Result<IntentAutoSwapResult>> {
    return this.config.analytics.trackResult(
      'partner',
      'swap',
      async () => {
        try {
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
   * Cancels via ProtocolIntents `cancelIntent(fromToken, toToken)` and refunds the partner; the intent's creator
   * is ProtocolIntents, so `SwapService.cancelIntent` reverts with `Unauthorized()`.
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

  /** Open auto-swap intent hash for the pair; zero hash means none. */
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

  public async getIntentDetails(intentHash: Hex): Promise<Result<Intent, Error>> {
    try {
      invariant(this.protocolIntentsContract, 'protocolIntentsContract is not configured in solver config');

      const intent = await this.hubProvider.publicClient.readContract({
        address: this.protocolIntentsContract,
        abi: ProtocolIntentsAbi,
        functionName: 'getIntentDetails',
        args: [intentHash],
      });

      // viem returns plain bigint chain ids; narrow them to the branded IntentRelayChainId union.
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
