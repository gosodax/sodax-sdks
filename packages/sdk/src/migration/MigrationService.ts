import { SodaxError } from '../errors/SodaxError.js';
import { mapRelayFailure } from '../errors/relay-error-mapping.js';
import {
  verifyFailed,
  intentCreationFailed,
  executionFailed,
  approveFailed,
  allowanceCheckFailed,
} from '../errors/wrappers.js';
import {
  type MigrateOrchestrationError,
  type MigrationAllowanceCheckError,
  type MigrationApproveError,
  type MigrationCreateIntentError,
  type RevertMigrationOrchestrationError,
  isMigrateOrchestrationError,
  isMigrationAllowanceCheckError,
  isMigrationApproveError,
  isMigrationCreateIntentError,
  isRevertMigrationOrchestrationError,
  migrationInvariant,
} from './errors.js';
import {
  IcxMigrationService,
  type IcxMigrateParams,
  type IcxCreateRevertMigrationParams,
  type IcxMigrateAction,
  type IcxRevertMigrationAction,
} from './IcxMigrationService.js';
import {
  BnUSDMigrationService,
  type UnifiedBnUSDMigrateParams,
  type UnifiedBnUSDMigrateAction,
} from './BnUSDMigrationService.js';
import { BalnSwapService, type BalnMigrateParams, type BalnMigrateAction } from './BalnSwapService.js';
import {
  isIcxMigrateParams,
  isBalnMigrateParams,
  isUnifiedBnUSDMigrateParams,
  isIcxCreateRevertMigrationParams,
} from './migration-guards.js';
import {
  type SpokeService,
  relayTxAndWaitPacket,
  encodeAddress,
  isIconAddress,
  waitUntilIntentExecuted,
  type HubProvider,
  isIconChainKeyType,
  isEvmChainKeyType,
  isHubChainKeyType,
  isStellarChainKeyType,
  type SpokeIsAllowanceValidParamsStellar,
  type SpokeIsAllowanceValidParams,
  type SpokeIsAllowanceValidParamsHub,
  type SpokeApproveParams,
  isEvmSpokeOnlyChainKeyType,
  isOptionalEvmWalletProviderType,
  isOptionalStellarWalletProviderType,
} from '../shared/index.js';
import {
  ChainKeys,
  type Address,
  getIntentRelayChainId,
  type Hex,
  type HttpUrl,
  type IconAddress,
  type Result,
  type TxReturnType,
  type IconChainKey,
  type SonicChainKey,
  isLegacybnUSDToken,
  isLegacybnUSDChainId,
  isNewbnUSDChainId,
  type SpokeChainKey,
  isNewbnUSDToken,
  type GetAddressType,
  type GetTokenAddressType,
  type EvmChainKey,
  type GetWalletProviderType,
  type StellarChainKey,
  type HubChainKey,
  type EvmSpokeOnlyChainKey,
  type IconContractAddress,
} from '@sodax/types';
import { isAddress } from 'viem';
import type { ConfigService } from '../shared/config/ConfigService.js';
import type { IntentTxResult, TxHashPair } from '../shared/types/types.js';

export type MigrationAction = 'migrate' | 'revert';

export type MigrationParams<K extends SpokeChainKey> =
  | IcxMigrateParams
  | UnifiedBnUSDMigrateParams<K>
  | BalnMigrateParams;
export type MigrationRevertParams<K extends SpokeChainKey> =
  | IcxCreateRevertMigrationParams
  | UnifiedBnUSDMigrateParams<K>;

export const SupportedMigrationTokens = ['ICX', 'bnUSD', 'BALN'] as const;
export type MigrationTokens = (typeof SupportedMigrationTokens)[number];

export type MigrationServiceConstructorParams = {
  hubProvider: HubProvider;
  config: ConfigService;
  spoke: SpokeService;
};

/**
 * Facade service for all legacy ICON ecosystem token migrations in the SODAX SDK.
 *
 * Delegates to three focused sub-services:
 * - `IcxMigrationService` — ICX/wICX ↔ SODA (hub chain) swaps
 * - `BnUSDMigrationService` — legacy bnUSD (ICON/Sui/Stellar) ↔ new bnUSD (EVM chains)
 * - `BalnSwapService` — BALN → SODA with optional lock-up periods
 *
 * All full-execution methods (`migrateIcxToSoda`, `migrateBaln`, `migratebnUSD`,
 * `revertMigrateSodaToIcx`) handle the complete flow: spoke deposit → cross-chain relay
 * → hub contract execution. The corresponding `createMigrate*Intent` methods only
 * perform the spoke-side deposit and return relay data for manual relay control.
 *
 * @namespace SodaxFeatures
 */
export class MigrationService {
  readonly icxMigration: IcxMigrationService;
  readonly bnUSDMigrationService: BnUSDMigrationService;
  readonly balnSwapService: BalnSwapService;
  readonly hubProvider: HubProvider;
  readonly relayerApiEndpoint: HttpUrl;
  readonly config: ConfigService;
  readonly spoke: SpokeService;

  constructor({ hubProvider, config, spoke }: MigrationServiceConstructorParams) {
    this.hubProvider = hubProvider;
    this.icxMigration = new IcxMigrationService({ hubProvider, config });
    this.bnUSDMigrationService = new BnUSDMigrationService({ hubProvider, config });
    this.balnSwapService = new BalnSwapService({ hubProvider });
    this.relayerApiEndpoint = config.relay.relayerApiEndpoint;
    this.config = config;
    this.spoke = spoke;
  }

  /**
   * Checks whether the caller has sufficient token allowance for a migration or revert-migration transaction.
   *
   * ICX and BALN migrations originate on ICON and do not require a pre-approval step — this
   * method returns `true` immediately for those cases. For EVM-spoke bnUSD migrations the
   * spender is the chain's `assetManager`. For hub-chain bnUSD reverts the spender is the
   * user's router contract. For hub-chain ICX reverts the spender is the user's hub wallet.
   *
   * @param params - Migration or revert-migration parameters (ICX, bnUSD, or BALN).
   * @param action - Either `'migrate'` (legacy → new) or `'revert'` (new → legacy).
   * @returns `true` if the current allowance covers `params.amount`; `false` otherwise.
   */
  public async isAllowanceValid<K extends SpokeChainKey>(
    params: MigrationParams<K> | MigrationRevertParams<K>,
    action: MigrationAction,
  ): Promise<Result<boolean, MigrationAllowanceCheckError>> {
    const baseCtx = { srcChainKey: params.srcChainKey };
    try {
      migrationInvariant(action === 'migrate' || action === 'revert', 'Invalid action', {
        ...baseCtx,
        field: 'action',
      });
      migrationInvariant(params.amount > 0n, 'Amount must be greater than 0', { ...baseCtx, field: 'amount' });

      // Compute the underlying Result<boolean> across action × chain-type branches, then wrap any
      // spoke-layer failure as MIGRATION_ALLOWANCE_CHECK_FAILED at the single return point below.
      let inner: Result<boolean> = { ok: true, value: true };

      if (action === 'migrate') {
        migrationInvariant(isAddress(params.dstAddress) || isIconAddress(params.dstAddress), 'To address is required', {
          ...baseCtx,
          field: 'dstAddress',
        });
        migrationInvariant(
          isIcxMigrateParams(params) || isBalnMigrateParams(params) || isUnifiedBnUSDMigrateParams(params),
          'Invalid params',
          { ...baseCtx, field: 'params' },
        );

        if (isIconChainKeyType(params.srcChainKey) && (isIcxMigrateParams(params) || isBalnMigrateParams(params))) {
          // ICX and BALN migrations originate on ICON and do not require an allowance check.
          return { ok: true, value: true };
        }

        if (isUnifiedBnUSDMigrateParams(params) && isEvmChainKeyType(params.srcChainKey)) {
          const bnUSDTokenAddress = this.config.getChainConfig(params.srcChainKey).supportedTokens.bnUSD?.address ?? '';
          migrationInvariant(
            isAddress(bnUSDTokenAddress),
            `bnUSD token not found for chain key: ${params.srcChainKey}`,
            {
              ...baseCtx,
              field: 'bnUSDTokenAddress',
            },
          );

          inner = await this.spoke.isAllowanceValid({
            srcChainKey: params.srcChainKey,
            token: params.srcbnUSD,
            amount: params.amount,
            owner: params.srcAddress,
            spender: isHubChainKeyType(params.srcChainKey)
              ? bnUSDTokenAddress
              : this.config.getChainConfig(params.srcChainKey).addresses.assetManager,
          });
        } else if (isUnifiedBnUSDMigrateParams(params) && isStellarChainKeyType(params.srcChainKey)) {
          inner = await this.spoke.isAllowanceValid({
            srcChainKey: params.srcChainKey,
            token: params.srcbnUSD,
            amount: params.amount,
            owner: params.srcAddress,
          } satisfies SpokeIsAllowanceValidParamsStellar);
        }
        // Other action='migrate' chain types fall through with the default `inner = { ok: true, value: true }`.
      } else {
        // action === 'revert'
        migrationInvariant(params.dstAddress.length > 0, 'To address is required', { ...baseCtx, field: 'dstAddress' });
        migrationInvariant(
          isIcxCreateRevertMigrationParams(params) || isUnifiedBnUSDMigrateParams(params),
          'Invalid params',
          { ...baseCtx, field: 'params' },
        );

        if (isUnifiedBnUSDMigrateParams(params) && isEvmChainKeyType(params.srcChainKey)) {
          const spender: Address = isHubChainKeyType(params.srcChainKey)
            ? await this.hubProvider.getUserRouter(params.srcAddress as Address)
            : this.config.getChainConfig(params.srcChainKey).addresses.assetManager;

          inner = await this.spoke.isAllowanceValid({
            srcChainKey: params.srcChainKey,
            token: params.srcbnUSD,
            amount: params.amount,
            owner: params.srcAddress,
            spender,
          } satisfies SpokeIsAllowanceValidParams<EvmChainKey>);
        } else if (isUnifiedBnUSDMigrateParams(params) && isStellarChainKeyType(params.srcChainKey)) {
          inner = await this.spoke.isAllowanceValid({
            srcChainKey: params.srcChainKey,
            token: params.srcbnUSD,
            amount: params.amount,
            owner: params.srcAddress,
          } satisfies SpokeIsAllowanceValidParamsStellar);
        } else if (isHubChainKeyType(params.srcChainKey) && isIcxCreateRevertMigrationParams(params)) {
          const userRouter = await this.hubProvider.getUserHubWalletAddress(params.srcAddress, params.srcChainKey);
          inner = await this.spoke.isAllowanceValid({
            srcChainKey: params.srcChainKey,
            token: this.hubProvider.chainConfig.addresses.sodaToken,
            amount: params.amount,
            owner: params.srcAddress,
            spender: userRouter,
          } satisfies SpokeIsAllowanceValidParamsHub);
        }
      }

      if (inner.ok) return inner;
      return {
        ok: false,
        error: allowanceCheckFailed('migration', inner.error, baseCtx),
      };
    } catch (error) {
      if (isMigrationAllowanceCheckError(error)) return { ok: false, error };
      return {
        ok: false,
        error: allowanceCheckFailed('migration', error, baseCtx),
      };
    }
  }

  /**
   * Submits a token approval transaction required before executing a migration or revert-migration.
   *
   * For `'migrate'` action the approved spender is the chain's `assetManager` (EVM spokes)
   * or the Stellar trustline mechanism. For `'revert'` action the approved spender is either
   * the user's router (hub EVM), the chain's `assetManager` (EVM spokes), or the Stellar
   * trustline. ICX and BALN migrations do not require approval and are not handled here.
   *
   * @param _params - Action params wrapping the migration parameters, wallet provider, and raw flag.
   * @param action - Either `'migrate'` (legacy → new) or `'revert'` (new → legacy).
   * @returns The submitted transaction hash (`Raw extends false`) or the unsigned transaction
   *   object (`Raw extends true`) for the approval call, wrapped in a `Result`.
   */
  public async approve<K extends SpokeChainKey, Raw extends boolean>(
    _params: IcxRevertMigrationAction<Raw> | UnifiedBnUSDMigrateAction<K, Raw>,
    action: MigrationAction,
  ): Promise<Result<TxReturnType<K, Raw>, MigrationApproveError>> {
    const { params } = _params;
    const baseCtx = { srcChainKey: params.srcChainKey };

    const wrapApproveFailure = (cause: unknown) => approveFailed('migration', cause, baseCtx);

    try {
      migrationInvariant(action === 'migrate' || action === 'revert', 'Invalid action', {
        ...baseCtx,
        field: 'action',
      });
      migrationInvariant(params.amount > 0n, 'Amount must be greater than 0', { ...baseCtx, field: 'amount' });
      migrationInvariant(params.dstAddress.length > 0, 'To address is required', { ...baseCtx, field: 'dstAddress' });

      if (action === 'migrate') {
        migrationInvariant(isUnifiedBnUSDMigrateParams(params), 'Invalid params', { ...baseCtx, field: 'params' });

        if (isEvmSpokeOnlyChainKeyType(params.srcChainKey)) {
          migrationInvariant(
            isOptionalEvmWalletProviderType(_params.walletProvider),
            'Invalid wallet provider. Expected Evm wallet provider.',
            { ...baseCtx, field: 'walletProvider' },
          );

          const srcChainKey = params.srcChainKey as EvmSpokeOnlyChainKey;
          const coreParams = {
            srcChainKey: srcChainKey,
            token: params.srcbnUSD as GetTokenAddressType<EvmSpokeOnlyChainKey>,
            amount: params.amount,
            owner: params.srcAddress as GetAddressType<EvmSpokeOnlyChainKey>,
            spender: this.config.getChainConfig(srcChainKey).addresses.assetManager,
          } as const;

          const approveParams = _params.raw
            ? ({
                ...coreParams,
                raw: true,
              } as SpokeApproveParams<EvmSpokeOnlyChainKey, true>)
            : ({
                ...coreParams,
                raw: false,
                walletProvider: _params.walletProvider,
              } as SpokeApproveParams<EvmSpokeOnlyChainKey, false>);

          const result = await this.spoke.approve<EvmSpokeOnlyChainKey, boolean>(approveParams);

          if (!result.ok) return { ok: false, error: wrapApproveFailure(result.error) };

          return {
            ok: true,
            value: result.value satisfies TxReturnType<EvmSpokeOnlyChainKey, boolean> as TxReturnType<K, Raw>,
          };
        }

        if (isStellarChainKeyType(params.srcChainKey)) {
          migrationInvariant(
            isOptionalStellarWalletProviderType(_params.walletProvider),
            'Invalid wallet provider. Expected Stellar wallet provider.',
            { ...baseCtx, field: 'walletProvider' },
          );

          const coreParams = {
            srcChainKey: params.srcChainKey,
            token: params.srcbnUSD,
            amount: params.amount,
            owner: params.srcAddress as GetAddressType<StellarChainKey>,
          } as const;

          const result = await this.spoke.approve<StellarChainKey, boolean>(
            _params.raw
              ? { ...coreParams, raw: true }
              : { ...coreParams, raw: false, walletProvider: _params.walletProvider },
          );

          if (!result.ok) return { ok: false, error: wrapApproveFailure(result.error) };

          return {
            ok: true,
            value: result.value satisfies TxReturnType<StellarChainKey, boolean> as TxReturnType<K, Raw>,
          };
        }

        // Reached when params is bnUSD-shaped but srcChainKey is neither EVM-spoke nor Stellar.
        migrationInvariant(false, 'Invalid params for migrate action', { ...baseCtx, field: 'srcChainKey' });
      }

      // action === 'revert'
      migrationInvariant(
        isIcxCreateRevertMigrationParams(params) || isUnifiedBnUSDMigrateParams(params),
        'Invalid params',
        { ...baseCtx, field: 'params' },
      );

      if (isUnifiedBnUSDMigrateParams(params) && isEvmSpokeOnlyChainKeyType(params.srcChainKey)) {
        migrationInvariant(
          isOptionalEvmWalletProviderType(_params.walletProvider),
          'Invalid wallet provider. Expected Evm wallet provider.',
          { ...baseCtx, field: 'walletProvider' },
        );

        const spender: Address = isHubChainKeyType(params.srcChainKey)
          ? await this.hubProvider.getUserRouter(params.srcAddress as Address)
          : this.config.getChainConfig(params.srcChainKey).addresses.assetManager;

        const srcChainKey = params.srcChainKey as EvmSpokeOnlyChainKey;
        const coreParams = {
          srcChainKey: srcChainKey,
          token: params.srcbnUSD as GetTokenAddressType<EvmChainKey>,
          amount: params.amount,
          owner: params.srcAddress as GetAddressType<EvmChainKey>,
          spender,
        } as const;

        const approveParams = _params.raw
          ? ({
              ...coreParams,
              raw: true,
            } satisfies SpokeApproveParams<EvmSpokeOnlyChainKey, true>)
          : ({
              ...coreParams,
              raw: false,
              walletProvider: _params.walletProvider,
            } satisfies SpokeApproveParams<EvmSpokeOnlyChainKey, false>);

        const result = await this.spoke.approve<EvmSpokeOnlyChainKey, boolean>(approveParams);

        if (!result.ok) return { ok: false, error: wrapApproveFailure(result.error) };

        return {
          ok: true,
          value: result.value satisfies TxReturnType<EvmSpokeOnlyChainKey, boolean> as TxReturnType<K, Raw>,
        };
      }

      if (isUnifiedBnUSDMigrateParams(params) && isStellarChainKeyType(params.srcChainKey)) {
        migrationInvariant(
          isOptionalStellarWalletProviderType(_params.walletProvider),
          'Invalid wallet provider. Expected Stellar wallet provider.',
          { ...baseCtx, field: 'walletProvider' },
        );

        const coreParams = {
          srcChainKey: params.srcChainKey,
          token: params.srcbnUSD,
          amount: params.amount,
          owner: params.srcAddress as GetAddressType<StellarChainKey>,
        } as const;

        const result = await this.spoke.approve<StellarChainKey, boolean>(
          _params.raw
            ? { ...coreParams, raw: true }
            : { ...coreParams, raw: false, walletProvider: _params.walletProvider },
        );

        if (!result.ok) return { ok: false, error: wrapApproveFailure(result.error) };

        return {
          ok: true,
          value: result.value satisfies TxReturnType<StellarChainKey, boolean> as TxReturnType<K, Raw>,
        };
      }

      if (isHubChainKeyType(params.srcChainKey) && isIcxCreateRevertMigrationParams(params)) {
        migrationInvariant(
          isOptionalEvmWalletProviderType(_params.walletProvider),
          'Invalid wallet provider. Expected Evm wallet provider.',
          { ...baseCtx, field: 'walletProvider' },
        );
        await this.assertIcxReverseMigrationEnabled(baseCtx);
        const userRouter = await this.hubProvider.getUserHubWalletAddress(params.srcAddress, params.srcChainKey);

        const coreParams = {
          srcChainKey: params.srcChainKey,
          token: this.hubProvider.chainConfig.addresses.sodaToken,
          amount: params.amount,
          owner: params.srcAddress,
          spender: userRouter,
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

        if (!result.ok) return { ok: false, error: wrapApproveFailure(result.error) };

        return {
          ok: true,
          value: result.value satisfies TxReturnType<EvmSpokeOnlyChainKey, boolean> as TxReturnType<K, Raw>,
        };
      }

      // No matching revert path.
      migrationInvariant(false, 'Invalid params or chain type for revert action', { ...baseCtx, field: 'srcChainKey' });
    } catch (error) {
      if (isMigrationApproveError(error)) return { ok: false, error };
      return { ok: false, error: wrapApproveFailure(error) };
    }
  }

  /**
   * Executes a full bnUSD migration (legacy ↔ new) including cross-chain relay.
   *
   * Supports both directions:
   * - Legacy bnUSD (ICON/Sui/Stellar) → new bnUSD (any EVM spoke) when `srcbnUSD` is a legacy token.
   * - New bnUSD (any EVM spoke) → legacy bnUSD (ICON/Sui/Stellar) when `dstbnUSD` is a legacy token.
   *
   * The method deposits on the source spoke, relays to the hub via the intent relay API, and
   * waits for the hub packet to land. When neither endpoint is Sonic mainnet it also waits for
   * the secondary cross-chain intent to execute.
   *
   * @param _params - Action params including `UnifiedBnUSDMigrateParams`, wallet provider,
   *   optional `timeout` (ms, default 60 s), and optional `unchecked` flag to skip validation.
   * @returns `{ srcChainTxHash, dstChainTxHash }` on success, where `srcChainTxHash` is the
   *   spoke deposit transaction and `dstChainTxHash` is the hub-side receipt.
   *
   * @example
   * // Migrate legacy bnUSD (ICON) to new bnUSD (Sonic)
   * const result = await sodax.migration.migratebnUSD({
   *   params: {
   *     srcChainKey: '0x1.icon',
   *     dstChainKey: 'sonic',
   *     srcbnUSD: 'cx...',
   *     dstbnUSD: '0x...',
   *     amount: 1000n,
   *     srcAddress: 'hx...',
   *     dstAddress: '0x...',
   *   },
   *   raw: false,
   *   walletProvider: iconWalletProvider,
   * });
   *
   * if (result.ok) {
   *   const { srcChainTxHash, dstChainTxHash } = result.value;
   * }
   */
  async migratebnUSD<K extends SpokeChainKey>(
    _params: UnifiedBnUSDMigrateAction<K, false>,
  ): Promise<Result<TxHashPair, MigrateOrchestrationError>> {
    return this.config.analytics.trackResult(
      'migration',
      'migratebnUSD',
      async () => {
        const { params, timeout } = _params;
        const baseCtx = {
          srcChainKey: params.srcChainKey,
          dstChainKey: params.dstChainKey,
          action: 'migratebnUSD' as const,
        };
        try {
          const intentResult = await this.createMigratebnUSDIntent(_params);
          // CreateMigrateIntentErrorCode ⊂ MigrateOrchestrationErrorCode (subset narrowing).
          if (!intentResult.ok) return { ok: false, error: intentResult.error };

          const { tx: spokeTxHash, relayData: extraData } = intentResult.value;

          // verify the spoke tx hash exists on chain
          const verifyTxHashResult = await this.spoke.verifyTxHash({
            txHash: spokeTxHash,
            chainKey: params.srcChainKey,
          });

          if (!verifyTxHashResult.ok) {
            return {
              ok: false,
              error: verifyFailed('migration', verifyTxHashResult.error, baseCtx),
            };
          }

          const packetResult = await relayTxAndWaitPacket({
            srcTxHash: spokeTxHash,
            data: extraData,
            chainKey: params.srcChainKey,
            relayerApiEndpoint: this.relayerApiEndpoint,
            timeout,
          });

          if (!packetResult.ok) {
            return {
              ok: false,
              error: mapRelayFailure(packetResult.error, {
                feature: 'migration',
                action: baseCtx.action,
                srcChainKey: baseCtx.srcChainKey,
                dstChainKey: baseCtx.dstChainKey,
              }),
            };
          }

          // Secondary destination-spoke watcher — fires when bnUSD's destination is not Sonic
          // (i.e. when the hub leg additionally bridges out to another spoke). Failures here are
          // wrapped with phase='destinationExecution' to distinguish from primary-relay failures.
          if (!(params.srcChainKey === ChainKeys.SONIC_MAINNET || params.dstChainKey === ChainKeys.SONIC_MAINNET)) {
            const execResult = await waitUntilIntentExecuted({
              intentRelayChainId: getIntentRelayChainId(ChainKeys.SONIC_MAINNET).toString(),
              srcTxHash: packetResult.value.dst_tx_hash,
              timeout: timeout,
              apiUrl: this.relayerApiEndpoint,
            });
            if (!execResult.ok) {
              return {
                ok: false,
                error: mapRelayFailure(execResult.error, {
                  feature: 'migration',
                  action: baseCtx.action,
                  srcChainKey: baseCtx.srcChainKey,
                  dstChainKey: baseCtx.dstChainKey,
                  phase: 'destinationExecution',
                }),
              };
            }
          }

          return { ok: true, value: { srcChainTxHash: spokeTxHash, dstChainTxHash: packetResult.value.dst_tx_hash } };
        } catch (error) {
          if (isMigrateOrchestrationError(error)) return { ok: false, error };
          return {
            ok: false,
            error: executionFailed('migration', error, baseCtx),
          };
        }
      },
      {
        start: () => ({
          srcChainKey: _params.params.srcChainKey,
          dstChainKey: _params.params.dstChainKey,
          srcAddress: _params.params.srcAddress,
          dstAddress: _params.params.dstAddress,
          srcbnUSD: _params.params.srcbnUSD,
          dstbnUSD: _params.params.dstbnUSD,
          amount: _params.params.amount,
        }),
        success: value => ({
          srcChainTxHash: value.srcChainTxHash,
          dstChainTxHash: value.dstChainTxHash,
        }),
        failure: error => ({ code: error.code }),
      },
    );
  }

  /**
   * Migrates ICX or wICX tokens from ICON to SODA on the hub chain (Sonic), including relay.
   *
   * Validates the requested amount against available SODA liquidity in the migration contract
   * before submitting. After the spoke deposit succeeds the transaction is relayed to the hub
   * and the method waits for the hub packet confirmation before returning.
   *
   * @param _params - Action params including `IcxMigrateParams` (source ICON address, token
   *   address, amount, and EVM destination address), wallet provider, and optional `timeout` (ms).
   * @returns `{ srcChainTxHash, dstChainTxHash }` on success; an error result if the liquidity
   *   check fails, the deposit reverts, or the relay times out.
   */
  async migrateIcxToSoda(_params: IcxMigrateAction<false>): Promise<Result<TxHashPair, MigrateOrchestrationError>> {
    return this.config.analytics.trackResult(
      'migration',
      'migrateIcxToSoda',
      async () => {
        const { timeout } = _params;
        const baseCtx = { srcChainKey: _params.params.srcChainKey, action: 'migrateIcxToSoda' as const };
        try {
          const txResult = await this.createMigrateIcxToSodaIntent(_params);
          // CreateMigrateIntentErrorCode ⊂ MigrateOrchestrationErrorCode.
          if (!txResult.ok) return { ok: false, error: txResult.error };

          const { tx, relayData } = txResult.value;

          const packetResult = await relayTxAndWaitPacket({
            srcTxHash: tx,
            data: relayData,
            chainKey: _params.params.srcChainKey,
            relayerApiEndpoint: this.relayerApiEndpoint,
            timeout: timeout,
          });

          if (!packetResult.ok) {
            return {
              ok: false,
              error: mapRelayFailure(packetResult.error, {
                feature: 'migration',
                action: baseCtx.action,
                srcChainKey: baseCtx.srcChainKey,
              }),
            };
          }

          return { ok: true, value: { srcChainTxHash: tx, dstChainTxHash: packetResult.value.dst_tx_hash } };
        } catch (error) {
          if (isMigrateOrchestrationError(error)) return { ok: false, error };
          return {
            ok: false,
            error: executionFailed('migration', error, baseCtx),
          };
        }
      },
      {
        start: () => ({
          srcChainKey: _params.params.srcChainKey,
          srcAddress: _params.params.srcAddress,
          dstAddress: _params.params.dstAddress,
          address: _params.params.address,
          amount: _params.params.amount,
        }),
        success: value => ({
          srcChainTxHash: value.srcChainTxHash,
          dstChainTxHash: value.dstChainTxHash,
        }),
        failure: error => ({ code: error.code }),
      },
    );
  }

  /**
   * Reverts a previous ICX→SODA migration by swapping SODA back to wICX on the hub and
   * bridging it to the ICON destination address, including cross-chain relay.
   *
   * The SODA tokens are deposited into the user's hub wallet via the Sonic spoke, then the
   * hub executes a reverse swap through the ICX migration contract and transfers the resulting
   * wICX back to the specified ICON EOA address. The method waits for relay confirmation
   * before returning.
   *
   * @param _params - Action params including `IcxCreateRevertMigrationParams` (Sonic source
   *   address, amount of SODA, and ICON destination EOA address), wallet provider, and optional
   *   `timeout` (ms).
   * @returns `{ srcChainTxHash, dstChainTxHash }` on success, where `srcChainTxHash` is the
   *   Sonic deposit transaction and `dstChainTxHash` is the hub-side packet receipt.
   */
  async revertMigrateSodaToIcx(
    _params: IcxRevertMigrationAction<false>,
  ): Promise<Result<TxHashPair, RevertMigrationOrchestrationError>> {
    return this.config.analytics.trackResult(
      'migration',
      'revertMigrateSodaToIcx',
      async () => {
        const { timeout } = _params;
        const baseCtx = { srcChainKey: ChainKeys.SONIC_MAINNET, action: 'revertMigrateSodaToIcx' as const };
        try {
          const txResult = await this.createRevertSodaToIcxMigrationIntent(_params);
          // CreateRevertMigrationIntentErrorCode ⊂ RevertMigrationOrchestrationErrorCode.
          if (!txResult.ok) return { ok: false, error: txResult.error };

          const { tx, relayData } = txResult.value;

          const packetResult = await relayTxAndWaitPacket({
            srcTxHash: tx,
            data: relayData,
            chainKey: ChainKeys.SONIC_MAINNET,
            relayerApiEndpoint: this.relayerApiEndpoint,
            timeout: timeout,
          });

          if (!packetResult.ok) {
            return {
              ok: false,
              error: mapRelayFailure(packetResult.error, {
                feature: 'migration',
                action: baseCtx.action,
                srcChainKey: baseCtx.srcChainKey,
              }),
            };
          }

          return { ok: true, value: { srcChainTxHash: tx, dstChainTxHash: packetResult.value.dst_tx_hash } };
        } catch (error) {
          if (isRevertMigrationOrchestrationError(error)) return { ok: false, error };
          return {
            ok: false,
            error: executionFailed('migration', error, baseCtx),
          };
        }
      },
      {
        start: () => ({
          srcChainKey: _params.params.srcChainKey,
          srcAddress: _params.params.srcAddress,
          dstAddress: _params.params.dstAddress,
          amount: _params.params.amount,
        }),
        success: value => ({
          srcChainTxHash: value.srcChainTxHash,
          dstChainTxHash: value.dstChainTxHash,
        }),
        failure: error => ({ code: error.code }),
      },
    );
  }

  /**
   * Migrates BALN tokens from ICON to SODA on the hub chain (Sonic), including relay.
   *
   * BALN tokens are deposited into the user's hub wallet via the ICON spoke. On the hub, the
   * BALN swap contract swaps them to SODA at a rate determined by the chosen `lockupPeriod`
   * (0–24 months). Longer lock-ups yield higher multipliers (0.5×–1.5×). The method waits
   * for relay confirmation before returning.
   *
   * @param _params - Action params including `BalnMigrateParams` (ICON source address, amount,
   *   `lockupPeriod`, EVM destination address, and `stake` flag), wallet provider, and optional
   *   `timeout` (ms).
   * @returns `{ srcChainTxHash, dstChainTxHash }` on success, where `srcChainTxHash` is the
   *   ICON deposit transaction and `dstChainTxHash` is the hub-side packet receipt.
   */
  async migrateBaln(_params: BalnMigrateAction<false>): Promise<Result<TxHashPair, MigrateOrchestrationError>> {
    return this.config.analytics.trackResult(
      'migration',
      'migrateBaln',
      async () => {
        const { timeout } = _params;
        const baseCtx = { srcChainKey: ChainKeys.ICON_MAINNET, action: 'migrateBaln' as const };
        try {
          const txResult = await this.createMigrateBalnIntent(_params);
          // CreateMigrateIntentErrorCode ⊂ MigrateOrchestrationErrorCode.
          if (!txResult.ok) return { ok: false, error: txResult.error };

          const { tx, relayData } = txResult.value;

          const packetResult = await relayTxAndWaitPacket({
            srcTxHash: tx,
            data: relayData,
            chainKey: ChainKeys.ICON_MAINNET,
            relayerApiEndpoint: this.relayerApiEndpoint,
            timeout: timeout,
          });

          if (!packetResult.ok) {
            return {
              ok: false,
              error: mapRelayFailure(packetResult.error, {
                feature: 'migration',
                action: baseCtx.action,
                srcChainKey: baseCtx.srcChainKey,
              }),
            };
          }

          return { ok: true, value: { srcChainTxHash: tx, dstChainTxHash: packetResult.value.dst_tx_hash } };
        } catch (error) {
          if (isMigrateOrchestrationError(error)) return { ok: false, error };
          return {
            ok: false,
            error: executionFailed('migration', error, baseCtx),
          };
        }
      },
      {
        start: () => ({
          srcChainKey: _params.params.srcChainKey,
          srcAddress: _params.params.srcAddress,
          dstAddress: _params.params.dstAddress,
          amount: _params.params.amount,
          lockupPeriod: _params.params.lockupPeriod,
          stake: _params.params.stake,
        }),
        success: value => ({
          srcChainTxHash: value.srcChainTxHash,
          dstChainTxHash: value.dstChainTxHash,
        }),
        failure: error => ({ code: error.code }),
      },
    );
  }

  /**
   * Builds and submits the spoke-side deposit for a BALN→SODA migration without relaying.
   *
   * Encodes the BALN swap calldata (approve + swap with lock-up) and deposits the BALN tokens
   * into the user's hub wallet on the ICON spoke. Returns both the ICON transaction result and
   * the relay data needed to complete the cross-chain relay separately.
   *
   * @param _params - Action params including `BalnMigrateParams`, optional wallet provider
   *   (`raw: false` only), `raw` flag, and optional `skipSimulation`.
   * @returns `{ tx, relayData }` where `tx` is the ICON transaction hash or unsigned tx object
   *   (depending on `raw`), and `relayData` contains the hub wallet address and encoded payload
   *   for relay.
   */
  async createMigrateBalnIntent<Raw extends boolean>(
    _params: BalnMigrateAction<Raw>,
  ): Promise<Result<IntentTxResult<IconChainKey, Raw>, MigrationCreateIntentError>> {
    const { params, skipSimulation } = _params;
    const baseCtx = { srcChainKey: params.srcChainKey, action: 'migrateBaln' as const };

    try {
      const balnXToken = this.config.getChainConfig(params.srcChainKey).supportedTokens['BALN'];
      migrationInvariant(balnXToken, 'BALN token not found', { ...baseCtx, field: 'balnXToken' });
      const balnToken = balnXToken.address as IconContractAddress;

      const migrationData = this.balnSwapService.swapData(balnToken, params, this.config);

      const hubWalletAddress = await this.hubProvider.getUserHubWalletAddress(params.srcAddress, params.srcChainKey);

      const coreParams = {
        srcChainKey: params.srcChainKey,
        srcAddress: params.srcAddress,
        to: hubWalletAddress,
        token: balnToken,
        amount: params.amount,
        data: migrationData,
        skipSimulation,
      } as const;

      const txResult = await this.spoke.deposit(
        _params.raw
          ? {
              ...coreParams,
              raw: true,
            }
          : {
              ...coreParams,
              raw: false,
              walletProvider: _params.walletProvider,
            },
      );

      if (!txResult.ok) {
        if (isMigrationCreateIntentError(txResult.error)) return { ok: false, error: txResult.error };
        return {
          ok: false,
          error: intentCreationFailed('migration', txResult.error, baseCtx),
        };
      }

      return {
        ok: true,
        value: {
          tx: txResult.value satisfies TxReturnType<IconChainKey, boolean> as TxReturnType<IconChainKey, Raw>,
          relayData: { address: hubWalletAddress, payload: migrationData },
        },
      };
    } catch (error) {
      if (isMigrationCreateIntentError(error)) return { ok: false, error };
      return {
        ok: false,
        error: intentCreationFailed('migration', error, baseCtx),
      };
    }
  }

  /**
   * Builds and submits the spoke-side deposit for a bnUSD migration (legacy ↔ new) without relaying.
   *
   * Determines the migration direction from the token addresses:
   * - `srcbnUSD` is a legacy token → encode a forward migration (legacy → new).
   * - `dstbnUSD` is a legacy token → encode a reverse migration (new → legacy).
   *
   * Validates chain keys and token addresses unless `unchecked` is set to `true`. Returns both
   * the spoke transaction result and relay data for manual relay control.
   *
   * @param _params - Action params including `UnifiedBnUSDMigrateParams`, optional wallet
   *   provider (`raw: false` only), `raw` flag, optional `unchecked` flag to bypass validation,
   *   and optional `skipSimulation`.
   * @returns `{ tx, relayData }` where `tx` is the source-chain transaction hash or unsigned tx
   *   object (depending on `raw`), and `relayData` contains the hub wallet address and encoded
   *   payload for relay.
   */
  async createMigratebnUSDIntent<K extends SpokeChainKey, Raw extends boolean>(
    _params: UnifiedBnUSDMigrateAction<K, Raw>,
  ): Promise<Result<IntentTxResult<K, Raw>, MigrationCreateIntentError>> {
    const { params, unchecked, skipSimulation } = _params;
    const baseCtx = {
      srcChainKey: params.srcChainKey,
      dstChainKey: params.dstChainKey,
      action: 'migratebnUSD' as const,
    };
    try {
      if (!unchecked) {
        migrationInvariant(this.config.isValidSpokeChainKey(params.srcChainKey), 'Invalid spoke source chain key', {
          ...baseCtx,
          field: 'srcChainKey',
        });
        migrationInvariant(
          this.config.isValidSpokeChainKey(params.dstChainKey),
          'Invalid spoke destination chain key',
          {
            ...baseCtx,
            field: 'dstChainKey',
          },
        );
        migrationInvariant(params.srcbnUSD.length > 0, 'Legacy bnUSD token address is required', {
          ...baseCtx,
          field: 'srcbnUSD',
        });
        migrationInvariant(params.dstbnUSD.length > 0, 'New bnUSD token address is required', {
          ...baseCtx,
          field: 'dstbnUSD',
        });
        migrationInvariant(params.amount > 0, 'Amount must be greater than 0', { ...baseCtx, field: 'amount' });
        migrationInvariant(params.dstAddress.length > 0, 'Recipient address is required', {
          ...baseCtx,
          field: 'dstAddress',
        });
        migrationInvariant(
          !(isLegacybnUSDToken(params.srcbnUSD) && isLegacybnUSDToken(params.dstbnUSD)),
          'srcbnUSD and dstbnUSD cannot both be legacy bnUSD tokens',
          { ...baseCtx, field: 'tokens' },
        );
      }

      let migrationData: Hex;
      let direction: 'forward' | 'reverse';
      if (isLegacybnUSDToken(params.srcbnUSD)) {
        // migration from legacy bnUSD to new bnUSD
        direction = 'forward';
        if (!unchecked) {
          migrationInvariant(
            isLegacybnUSDChainId(params.srcChainKey),
            'srcChainKey must be a legacy bnUSD chain (icon, sui, stellar) if srcbnUSD is a legacy bnUSD token',
            { ...baseCtx, direction, field: 'srcChainKey' },
          );
          migrationInvariant(
            isNewbnUSDChainId(params.dstChainKey),
            'dstChainKey must be a new bnUSD chain (all spoke chains besides Icon) if dstbnUSD is a legacy bnUSD token',
            { ...baseCtx, direction, field: 'dstChainKey' },
          );
        }

        migrationData = this.bnUSDMigrationService.migrateData({
          srcChainKey: params.srcChainKey,
          legacybnUSD: params.srcbnUSD,
          newbnUSD: params.dstbnUSD,
          dstChainKey: params.dstChainKey,
          amount: params.amount,
          dstAddress: encodeAddress(params.dstChainKey, params.dstAddress),
        });
      } else if (isLegacybnUSDToken(params.dstbnUSD)) {
        // reverse migration from new bnUSD to legacy bnUSD
        direction = 'reverse';
        if (!unchecked) {
          migrationInvariant(
            isLegacybnUSDChainId(params.dstChainKey),
            'dstChainKey must be a legacy bnUSD chain (sui, stellar, icon) if dstbnUSD is a legacy bnUSD token',
            { ...baseCtx, direction, field: 'dstChainKey' },
          );
          migrationInvariant(
            isNewbnUSDToken(params.srcbnUSD),
            'srcbnUSD must be a new bnUSD token if dstbnUSD is a legacy bnUSD token',
            { ...baseCtx, direction, field: 'srcbnUSD' },
          );
          migrationInvariant(
            isNewbnUSDChainId(params.srcChainKey),
            'srcChainKey must be a new bnUSD chain (all spoke chains besides Icon) if srcbnUSD is a new bnUSD token',
            { ...baseCtx, direction, field: 'srcChainKey' },
          );
        }

        migrationData = this.bnUSDMigrationService.revertMigrationData({
          srcChainKey: params.srcChainKey,
          legacybnUSD: params.dstbnUSD,
          newbnUSD: params.srcbnUSD,
          dstChainKey: params.dstChainKey,
          amount: params.amount,
          dstAddress: encodeAddress(params.dstChainKey, params.dstAddress),
        });
      } else {
        // Neither token is legacy — surface as a typed validation failure (mirrors the other
        // precondition-style checks above).
        migrationInvariant(false, 'srcbnUSD or dstbnUSD must be a legacy bnUSD token', {
          ...baseCtx,
          field: 'tokens',
        });
      }

      const hubWalletAddress = await this.hubProvider.getUserHubWalletAddress(params.srcAddress, params.srcChainKey);

      const coreParams = {
        srcChainKey: params.srcChainKey,
        srcAddress: params.srcAddress as GetAddressType<K>,
        to: hubWalletAddress,
        token: params.srcbnUSD as GetTokenAddressType<K>,
        amount: params.amount,
        data: migrationData,
        skipSimulation,
      } as const;

      const txResult = await this.spoke.deposit(
        _params.raw
          ? {
              ...coreParams,
              raw: true,
            }
          : {
              ...coreParams,
              raw: false,
              walletProvider: _params.walletProvider as GetWalletProviderType<K>,
            },
      );

      if (!txResult.ok) {
        if (isMigrationCreateIntentError(txResult.error)) return { ok: false, error: txResult.error };
        return {
          ok: false,
          error: intentCreationFailed('migration', txResult.error, { ...baseCtx, direction }),
        };
      }

      return {
        ok: true,
        value: {
          tx: txResult.value satisfies TxReturnType<K, Raw> as TxReturnType<K, Raw>,
          relayData: { address: hubWalletAddress, payload: migrationData },
        },
      };
    } catch (error) {
      if (isMigrationCreateIntentError(error)) return { ok: false, error };
      return {
        ok: false,
        error: intentCreationFailed('migration', error, baseCtx),
      };
    }
  }

  /**
   * Builds and submits the spoke-side deposit for an ICX/wICX → SODA migration without relaying.
   *
   * Validates that the token is either native ICX or wICX for ICON mainnet, then checks
   * available SODA liquidity in the migration contract before depositing. Returns relay data
   * so the caller can invoke `relayTxAndWaitPacket` independently.
   *
   * Note: ICX migrations do not require a prior approval step (`isAllowanceValid` returns
   * `true` immediately for ICON chains).
   *
   * @param _params - Action params including `IcxMigrateParams` (ICON source address, ICX/wICX
   *   token address, amount, and EVM destination address), optional wallet provider (`raw: false`
   *   only), `raw` flag, and optional `skipSimulation`.
   * @returns `{ tx, relayData }` where `tx` is the ICON transaction hash or unsigned tx object
   *   (depending on `raw`), and `relayData` contains the hub wallet address and encoded payload
   *   for relay.
   */
  async createMigrateIcxToSodaIntent<Raw extends boolean>(
    _params: IcxMigrateAction<Raw>,
  ): Promise<Result<IntentTxResult<IconChainKey, Raw>, MigrationCreateIntentError>> {
    const { params, skipSimulation } = _params;
    const baseCtx = { srcChainKey: params.srcChainKey, action: 'migrateIcxToSoda' as const };
    try {
      migrationInvariant(params.amount > 0, 'Amount must be greater than 0', { ...baseCtx, field: 'amount' });
      migrationInvariant(isAddress(params.dstAddress), 'Recipient address is required', {
        ...baseCtx,
        field: 'dstAddress',
      });
      migrationInvariant(
        params.address.toLowerCase() ===
          this.config.sodaxConfig.chains[ChainKeys.ICON_MAINNET].addresses.wICX.toLowerCase() ||
          params.address.toLowerCase() ===
            this.config.sodaxConfig.chains[ChainKeys.ICON_MAINNET].nativeToken.toLowerCase(),
        'Token must be wICX or native ICX token',
        { ...baseCtx, field: 'address' },
      );
      migrationInvariant(isIconChainKeyType(params.srcChainKey), 'Source chain key must be an Icon chain', {
        ...baseCtx,
        field: 'srcChainKey',
      });

      const availableAmount = await this.icxMigration.getAvailableAmount();
      if (!availableAmount.ok) {
        // Forward the typed lookup error as MIGRATION_INTENT_CREATION_FAILED with the original
        // MigrationLookupError on `cause` (subset narrowing doesn't apply — Lookup ⊄ Create).
        return {
          ok: false,
          error: new SodaxError('INTENT_CREATION_FAILED', 'Failed to read ICX migration liquidity', {
            feature: 'migration',
            cause: availableAmount.error,
            context: { ...baseCtx, phase: 'intentCreation' },
          }),
        };
      }

      migrationInvariant(
        availableAmount.value >= params.amount,
        `Insufficient liquidity. Available: ${availableAmount.value.toString()}, Requested: ${params.amount.toString()}`,
        { ...baseCtx, field: 'amount', reason: 'insufficient liquidity' },
      );

      const hubWalletAddress = await this.hubProvider.getUserHubWalletAddress(
        params.srcAddress,
        ChainKeys.ICON_MAINNET,
      );

      const coreParams = {
        srcChainKey: ChainKeys.ICON_MAINNET,
        srcAddress: params.srcAddress,
        to: hubWalletAddress,
        token: params.address,
        amount: params.amount,
        data: this.icxMigration.migrateData(params),
        skipSimulation,
      } as const;

      const txResult = await this.spoke.deposit(
        _params.raw
          ? {
              ...coreParams,
              raw: true,
            }
          : {
              ...coreParams,
              raw: false,
              walletProvider: _params.walletProvider,
            },
      );

      if (!txResult.ok) {
        if (isMigrationCreateIntentError(txResult.error)) return { ok: false, error: txResult.error };
        return {
          ok: false,
          error: intentCreationFailed('migration', txResult.error, baseCtx),
        };
      }

      return {
        ok: true,
        value: {
          tx: txResult.value satisfies TxReturnType<IconChainKey, boolean> as TxReturnType<IconChainKey, Raw>,
          relayData: { address: hubWalletAddress, payload: coreParams.data },
        },
      };
    } catch (error) {
      if (isMigrationCreateIntentError(error)) return { ok: false, error };
      return {
        ok: false,
        error: intentCreationFailed('migration', error, baseCtx),
      };
    }
  }

  /**
   * Builds and submits the hub-side deposit for a SODA → wICX (ICX revert) migration without relaying.
   *
   * Encodes the full hub execution sequence: approve SODA to the ICX migration contract,
   * reverse-swap SODA → wICX, and transfer wICX back to the ICON destination address via
   * the asset manager. Deposits SODA from the Sonic spoke into the user's hub wallet, which
   * then executes the encoded calls.
   *
   * Note: A SODA approval from the caller to their hub wallet must be set before calling this
   * method. Use `isAllowanceValid` to check and `approve` to set it.
   *
   * Fails with `VALIDATION_FAILED` before building the transaction when the migration contract's
   * reverse-swap switch is off (`icxMigration.isReverseMigrationEnabled()`).
   *
   * @param _params - Action params including `IcxCreateRevertMigrationParams` (Sonic source
   *   address, SODA amount, and ICON EOA destination address), optional wallet provider
   *   (`raw: false` only), `raw` flag, and optional `skipSimulation`.
   * @returns `{ tx, relayData }` where `tx` is the Sonic transaction hash or unsigned tx object
   *   (depending on `raw`), and `relayData` contains the hub wallet address and encoded payload
   *   for relay.
   */
  async createRevertSodaToIcxMigrationIntent<Raw extends boolean>(
    _params: IcxRevertMigrationAction<Raw>,
  ): Promise<Result<IntentTxResult<SonicChainKey, Raw>, MigrationCreateIntentError>> {
    const { params, skipSimulation } = _params;
    const baseCtx = { srcChainKey: ChainKeys.SONIC_MAINNET, action: 'revertMigrateSodaToIcx' as const };
    try {
      await this.assertIcxReverseMigrationEnabled(baseCtx);
      const userRouter = await this.hubProvider.getUserHubWalletAddress(params.srcAddress, ChainKeys.SONIC_MAINNET);
      const wICX = this.config.sodaxConfig.chains[ChainKeys.ICON_MAINNET].addresses.wICX;
      migrationInvariant(wICX, 'wICX token not found', { ...baseCtx, field: 'wICX' });
      const data = this.icxMigration.revertMigration({
        wICX: wICX as IconAddress,
        amount: params.amount,
        dstAddress: encodeAddress(ChainKeys.ICON_MAINNET, params.dstAddress),
        userWallet: userRouter,
      });

      const coreParams = {
        srcChainKey: ChainKeys.SONIC_MAINNET,
        srcAddress: params.srcAddress,
        to: userRouter,
        token: this.hubProvider.chainConfig.addresses.sodaToken,
        amount: params.amount,
        data,
        skipSimulation,
      } as const;

      const txResult = await this.spoke.deposit(
        _params.raw
          ? {
              ...coreParams,
              raw: true,
            }
          : {
              ...coreParams,
              raw: false,
              walletProvider: _params.walletProvider,
            },
      );

      if (!txResult.ok) {
        if (isMigrationCreateIntentError(txResult.error)) return { ok: false, error: txResult.error };
        return {
          ok: false,
          error: intentCreationFailed('migration', txResult.error, baseCtx),
        };
      }

      return {
        ok: true,
        value: {
          tx: txResult.value satisfies TxReturnType<SonicChainKey, boolean> as TxReturnType<SonicChainKey, Raw>,
          relayData: { address: userRouter, payload: data },
        },
      };
    } catch (error) {
      if (isMigrationCreateIntentError(error)) return { ok: false, error };
      return {
        ok: false,
        error: intentCreationFailed('migration', error, baseCtx),
      };
    }
  }

  /**
   * Throws `VALIDATION_FAILED` when the ICX migration contract has reverse swaps switched off,
   * or the underlying `LOOKUP_FAILED` error when the switch cannot be read.
   */
  private async assertIcxReverseMigrationEnabled(context: { srcChainKey: string; action?: string }): Promise<void> {
    const enabled = await this.icxMigration.isReverseMigrationEnabled();
    if (!enabled.ok) throw enabled.error;
    migrationInvariant(enabled.value, 'ICX reverse migration is disabled', {
      ...context,
      reason: 'reverse migration disabled',
    });
  }
}
