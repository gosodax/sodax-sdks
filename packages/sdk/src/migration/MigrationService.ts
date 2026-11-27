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
  type DepositReturnType,
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
 * Facade over ICX/wICX ↔ SODA, legacy ↔ new bnUSD and BALN → SODA migrations.
 * `migrate*` methods relay to the hub and wait; `createMigrate*Intent` only submit the spoke deposit.
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

  /** ICX and BALN migrations from ICON need no approval and always resolve `true`. */
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
          return { ok: true, value: true };
        }

        if (
          isUnifiedBnUSDMigrateParams(params) &&
          (isEvmSpokeOnlyChainKeyType(params.srcChainKey) || isHubChainKeyType(params.srcChainKey))
        ) {
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
      } else {
        migrationInvariant(params.dstAddress.length > 0, 'To address is required', { ...baseCtx, field: 'dstAddress' });
        migrationInvariant(
          isIcxCreateRevertMigrationParams(params) || isUnifiedBnUSDMigrateParams(params),
          'Invalid params',
          { ...baseCtx, field: 'params' },
        );

        if (
          isUnifiedBnUSDMigrateParams(params) &&
          (isEvmSpokeOnlyChainKeyType(params.srcChainKey) || isHubChainKeyType(params.srcChainKey))
        ) {
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

  /** ICX/BALN migrations from ICON need no approval; reverts and bnUSD migrations do. */
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

        migrationInvariant(false, 'Invalid params for migrate action', { ...baseCtx, field: 'srcChainKey' });
      }

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

      migrationInvariant(false, 'Invalid params or chain type for revert action', { ...baseCtx, field: 'srcChainKey' });
    } catch (error) {
      if (isMigrationApproveError(error)) return { ok: false, error };
      return { ok: false, error: wrapApproveFailure(error) };
    }
  }

  /**
   * Migrates bnUSD in either direction (inferred from which token is legacy), relaying via the hub.
   * When neither endpoint is Sonic it also waits for the hub → destination-spoke intent to execute.
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
          if (!intentResult.ok) return { ok: false, error: intentResult.error };

          const { tx: spokeTxHash, relayData: extraData } = intentResult.value;

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

          // Hub leg bridges out to another spoke; failures here use phase='destinationExecution'.
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

  /** Fails before submitting when the migration contract lacks enough SODA liquidity. */
  async migrateIcxToSoda(_params: IcxMigrateAction<false>): Promise<Result<TxHashPair, MigrateOrchestrationError>> {
    return this.config.analytics.trackResult(
      'migration',
      'migrateIcxToSoda',
      async () => {
        const { timeout } = _params;
        const baseCtx = { srcChainKey: _params.params.srcChainKey, action: 'migrateIcxToSoda' as const };
        try {
          const txResult = await this.createMigrateIcxToSodaIntent(_params);
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

  /** Deposits SODA from Sonic, reverse-swaps it to wICX on the hub and bridges it to the ICON EOA. */
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

  /** BALN → SODA at a rate set by `lockupPeriod` (0–24 months, 0.5×–1.5× multiplier). */
  async migrateBaln(_params: BalnMigrateAction<false>): Promise<Result<TxHashPair, MigrateOrchestrationError>> {
    return this.config.analytics.trackResult(
      'migration',
      'migrateBaln',
      async () => {
        const { timeout } = _params;
        const baseCtx = { srcChainKey: ChainKeys.ICON_MAINNET, action: 'migrateBaln' as const };
        try {
          const txResult = await this.createMigrateBalnIntent(_params);
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
          tx: txResult.value satisfies DepositReturnType<K, Raw> as DepositReturnType<K, Raw>,
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
        // Lookup ⊄ Create, so wrap as INTENT_CREATION_FAILED with the lookup error as `cause`.
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

  /** Requires a prior SODA approval from the caller to their hub wallet (see `isAllowanceValid` / `approve`). */
  async createRevertSodaToIcxMigrationIntent<Raw extends boolean>(
    _params: IcxRevertMigrationAction<Raw>,
  ): Promise<Result<IntentTxResult<SonicChainKey, Raw>, MigrationCreateIntentError>> {
    const { params, skipSimulation } = _params;
    const baseCtx = { srcChainKey: ChainKeys.SONIC_MAINNET, action: 'revertMigrateSodaToIcx' as const };
    try {
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
}
