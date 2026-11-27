import type {
  DestinationParamsType,
  IntentTxResult,
  OutboundSettlement,
  Settlement,
  TxHashPair,
} from '../shared/types/types.js';
import type { Address, Hex } from 'viem';
import {
  EvmAssetManagerService,
  type SpokeService,
  encodeRecipient,
  assertMpcPayoutAboveMinimum,
  Erc20Service,
  Erc4626Service,
  EvmVaultTokenService,
  encodeContractCalls,
  relayTxAndWaitPacket,
  type ConfigService,
  wrappedSonicAbi,
  type HubProvider,
  isStellarChainKeyType,
  type SpokeIsAllowanceValidParamsStellar,
  isHubChainKeyType,
  isOptionalStellarWalletProviderType,
  isEvmSpokeOnlyChainKeyType,
  isOptionalEvmWalletProviderType,
  type SendMessageParams,
  type SettleParams,
  type SettlementDirection,
} from '../shared/index.js';
import {
  isMpcRelayChainKey,
  SodaTokens,
  type ConcentratedLiquidityConfig,
  type EvmChainKey,
  type EvmContractCall,
  type EvmSpokeOnlyChainKey,
  type GetAddressType,
  type GetTokenAddressType,
  type GetWalletProviderType,
  type HttpUrl,
  type HubChainKey,
  type OriginalAssetAddress,
  type Result,
  type SpokeChainKey,
  type SpokeExecActionParams,
  type StellarChainKey,
  type TxReturnType,
  type DepositReturnType,
  type SendMessageReturnType,
} from '@sodax/types';
import { encodeFunctionData, erc20Abi, isAddress } from 'viem';
import { invariant } from '../shared/utils/tiny-invariant.js';
import { stataTokenFactoryAbi } from '../shared/abis/stataTokenFactory.abi.js';
import { mapRelayFailure } from '../errors/relay-error-mapping.js';
import { approveFailed, intentCreationFailed, lookupFailed } from '../errors/wrappers.js';
import { dexInvariant, isDexApproveError, isDexCreateIntentError } from './errors.js';

export type CreateAssetWithdrawParams<K extends SpokeChainKey> = {
  srcChainKey: K;
  srcAddress: GetAddressType<K>;
  poolToken: Address;
  asset: OriginalAssetAddress;
  amount: bigint;
  dst?: DestinationParamsType;
};

export type CreateAssetDepositParams<K extends SpokeChainKey> = {
  srcChainKey: K;
  srcAddress: GetAddressType<K>;
  asset: OriginalAssetAddress;
  amount: bigint;
  poolToken: Address;
  dst?: DestinationParamsType;
};

export type AssetWithdrawAction<K extends SpokeChainKey, Raw extends boolean> = SpokeExecActionParams<
  K,
  Raw,
  CreateAssetWithdrawParams<K>
>;

export type AssetDepositAction<K extends SpokeChainKey, Raw extends boolean> = SpokeExecActionParams<
  K,
  Raw,
  CreateAssetDepositParams<K>
>;

export type AssetServiceConstructorParams = {
  hubProvider: HubProvider;
  spoke: SpokeService;
  config: ConfigService;
};

/**
 * Wraps spoke tokens into the pools' StatATokens (spoke token → hub vault token → ERC-4626 StatAToken) and back.
 * @namespace SodaxFeatures
 */
export class AssetService {
  public readonly relayerApiEndpoint: HttpUrl;
  public readonly hubProvider: HubProvider;
  public readonly spoke: SpokeService;
  public readonly config: ConfigService;
  public readonly concentratedLiquidityConfig: ConcentratedLiquidityConfig;

  constructor({ config, hubProvider, spoke }: AssetServiceConstructorParams) {
    this.config = config;
    this.spoke = spoke;
    this.relayerApiEndpoint = config.relay.relayerApiEndpoint;
    this.hubProvider = hubProvider;
    this.concentratedLiquidityConfig = config.dex.concentratedLiquidityConfig;
  }

  /** Spender: asset manager on EVM spokes, user hub wallet on the hub; chains without approvals return `true`. */
  public async isAllowanceValid<K extends SpokeChainKey, Raw extends boolean>(
    _params: AssetDepositAction<K, Raw>,
  ): Promise<Result<boolean>> {
    const { params } = _params;
    try {
      invariant(params.amount > 0n, 'Amount must be greater than 0');
      invariant(params.asset.length > 0, 'Source asset is required');

      if (isStellarChainKeyType(params.srcChainKey)) {
        const result = await this.spoke.isAllowanceValid({
          srcChainKey: params.srcChainKey,
          token: params.asset,
          amount: params.amount,
          owner: params.srcAddress,
        } satisfies SpokeIsAllowanceValidParamsStellar);

        if (!result.ok) return result;

        return result;
      }

      if (isEvmSpokeOnlyChainKeyType(params.srcChainKey) || isHubChainKeyType(params.srcChainKey)) {
        const spender = isHubChainKeyType(params.srcChainKey)
          ? await this.hubProvider.getUserHubWalletAddress(params.srcAddress, params.srcChainKey)
          : this.config.sodaxConfig.chains[params.srcChainKey].addresses.assetManager;

        const result = await this.spoke.isAllowanceValid({
          srcChainKey: params.srcChainKey,
          token: params.asset,
          amount: params.amount,
          owner: params.srcAddress,
          spender: spender as GetAddressType<EvmChainKey | HubChainKey>,
        });

        if (!result.ok) return result;

        return result;
      }

      return {
        ok: true,
        value: true,
      };
    } catch (error) {
      return {
        ok: false,
        error,
      };
    }
  }

  public async approve<K extends SpokeChainKey, Raw extends boolean>(
    _params: AssetDepositAction<K, Raw>,
  ): Promise<Result<TxReturnType<K, Raw>>> {
    const { params } = _params;

    try {
      invariant(params.amount > 0n, 'Amount must be greater than 0');
      invariant(params.asset.length > 0, 'Source asset is required');

      if (isStellarChainKeyType(params.srcChainKey)) {
        invariant(
          isOptionalStellarWalletProviderType(_params.walletProvider),
          'Invalid wallet provider. Expected Stellar wallet provider.',
        );
        const coreParams = {
          srcChainKey: params.srcChainKey,
          token: params.asset,
          amount: params.amount,
          owner: params.srcAddress as GetAddressType<StellarChainKey>,
        } as const;

        const result = await this.spoke.approve<StellarChainKey, boolean>(
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

        if (!result.ok) return { ok: false, error: approveFailed('dex', result.error) };

        return {
          ok: true,
          value: result.value satisfies TxReturnType<StellarChainKey, boolean> as TxReturnType<K, Raw>,
        };
      }

      if (isEvmSpokeOnlyChainKeyType(params.srcChainKey) || isHubChainKeyType(params.srcChainKey)) {
        invariant(isAddress(params.asset), 'Invalid source asset address for EVM chain');
        invariant(
          isOptionalEvmWalletProviderType(_params.walletProvider),
          'Invalid wallet provider. Expected Evm wallet provider.',
        );

        const spender = isHubChainKeyType(params.srcChainKey)
          ? await this.hubProvider.getUserHubWalletAddress(params.srcAddress, params.srcChainKey)
          : this.config.sodaxConfig.chains[params.srcChainKey].addresses.assetManager;

        const coreParams = {
          srcChainKey: params.srcChainKey,
          token: params.asset,
          amount: params.amount,
          owner: params.srcAddress as GetAddressType<EvmChainKey | HubChainKey>,
          spender: spender as GetAddressType<EvmChainKey | HubChainKey>,
        } as const;

        const result = await this.spoke.approve<HubChainKey | EvmSpokeOnlyChainKey, Raw>({
          ...coreParams,
          raw: _params.raw,
          walletProvider: _params.walletProvider,
        });

        if (!result.ok) return { ok: false, error: approveFailed('dex', result.error) };

        return {
          ok: true,
          value: result.value satisfies TxReturnType<EvmSpokeOnlyChainKey, Raw> as TxReturnType<K, Raw>,
        };
      }

      dexInvariant(false, 'Approve only supported for EVM/Stellar spoke chains');
    } catch (error) {
      if (isDexApproveError(error)) return { ok: false, error };
      return { ok: false, error: approveFailed('dex', error) };
    }
  }

  /** Spoke deposit carrying the hub wrap calls; `dst` mints the StatATokens into another hub wallet. */
  public async executeDeposit<K extends SpokeChainKey, Raw extends boolean>(
    _params: AssetDepositAction<K, Raw>,
  ): Promise<Result<IntentTxResult<K, Raw, 'deposit'>>> {
    const { params, skipSimulation } = _params;
    try {
      invariant(params.amount > 0n, 'Amount must be greater than 0');
      invariant(params.asset.length > 0, 'Source asset is required');
      invariant(params.poolToken.length > 0, 'Pool token is required');

      const [fromHubWallet, recipient] = params.dst
        ? await Promise.all([
            this.hubProvider.getUserHubWalletAddress(params.srcAddress, params.srcChainKey),
            this.hubProvider.getUserHubWalletAddress(params.dst.dstAddress, params.dst.dstChainKey),
          ])
        : await this.hubProvider
            .getUserHubWalletAddress(params.srcAddress, params.srcChainKey)
            .then(w => [w, w] as const);

      const calls = await this.getTokenWrapAction(
        params.asset,
        params.srcChainKey,
        params.amount,
        params.poolToken,
        recipient,
      );
      const data: Hex = encodeContractCalls(calls);

      const coreParams = {
        srcAddress: params.srcAddress as GetAddressType<K>,
        srcChainKey: params.srcChainKey,
        to: recipient,
        token: params.asset as GetTokenAddressType<K>,
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
              walletProvider: _params.walletProvider as GetWalletProviderType<K>,
            },
      );

      if (!txResult.ok) return { ok: false, error: intentCreationFailed('dex', txResult.error) };

      return {
        ok: true,
        value: {
          tx: txResult.value satisfies DepositReturnType<K, Raw> as DepositReturnType<K, Raw>,
          relayData: { address: fromHubWallet, payload: data },
        },
      };
    } catch (error) {
      if (isDexCreateIntentError(error)) return { ok: false, error };
      return { ok: false, error: intentCreationFailed('dex', error) };
    }
  }

  /** Spoke message carrying the hub unwrap calls; `amount` is in StatAToken shares. */
  public async executeWithdraw<K extends SpokeChainKey, Raw extends boolean>(
    _params: AssetWithdrawAction<K, Raw>,
  ): Promise<Result<IntentTxResult<K, Raw, 'sendMessage'>>> {
    const { params, skipSimulation } = _params;
    try {
      invariant(params.amount > 0n, 'Amount must be greater than 0');
      invariant(params.asset.length > 0, 'Source asset is required');
      invariant(params.poolToken.length > 0, 'Pool token is required');

      const fromHubWallet = await this.hubProvider.getUserHubWalletAddress(params.srcAddress, params.srcChainKey);
      const recipient = params.dst?.dstAddress ?? params.srcAddress;
      const dstChainKey: SpokeChainKey = params.dst?.dstChainKey ?? params.srcChainKey;

      const calls = await this.getTokenUnwrapAction(
        dstChainKey,
        params.asset,
        params.amount,
        fromHubWallet,
        encodeRecipient(dstChainKey, recipient),
      );

      const data = encodeContractCalls(calls);
      const coreParams = {
        srcAddress: params.srcAddress,
        srcChainKey: params.srcChainKey,
        dstChainKey: this.hubProvider.chainConfig.chain.key,
        dstAddress: fromHubWallet,
        payload: data,
        skipSimulation,
      };

      const sendMessageParams = _params.raw
        ? ({
            ...coreParams,
            raw: true,
          } satisfies SendMessageParams<K, true>)
        : ({
            ...coreParams,
            raw: false,
            walletProvider: _params.walletProvider,
          } satisfies SendMessageParams<K, false>);

      const txResult = await this.spoke.sendMessage(sendMessageParams);

      if (!txResult.ok) {
        return {
          ok: false,
          error: intentCreationFailed('dex', txResult.error, {
            action: 'withdraw',
            srcChainKey: params.srcChainKey,
            dstChainKey: params.dst?.dstChainKey ?? params.srcChainKey,
            relayData: { address: fromHubWallet, payload: data },
          }),
        };
      }

      return {
        ok: true,
        value: {
          tx: txResult.value satisfies SendMessageReturnType<K, boolean> as SendMessageReturnType<K, Raw>,
          relayData: { address: fromHubWallet, payload: data },
        },
      };
    } catch (error) {
      if (isDexCreateIntentError(error)) return { ok: false, error };
      return { ok: false, error: intentCreationFailed('dex', error) };
    }
  }

  /** SODA into an xSoda pool must go through staking (SODA → xSoda), not the standard wrap path. */
  public isSodaAsXSodaInPool({
    chainId,
    asset,
    poolToken,
  }: {
    chainId: SpokeChainKey;
    asset: OriginalAssetAddress;
    poolToken: Address;
  }): boolean {
    const spokeToken = this.config.getSpokeTokenFromOriginalAssetAddress(chainId, asset);

    if (!spokeToken) {
      throw new Error(`[isSodaDepositToXSoda] Spoke token not found for asset ${asset}`);
    }

    return (
      spokeToken.symbol.toLowerCase() === 'soda' &&
      poolToken.toLowerCase() === this.hubProvider.chainConfig.addresses.xSoda.toLowerCase()
    );
  }

  public async deposit<K extends SpokeChainKey>(_params: AssetDepositAction<K, false>): Promise<Result<TxHashPair>> {
    const { params, timeout } = _params;
    try {
      const txResult = await this.executeDeposit(_params);
      if (!txResult.ok) return txResult;
      if (isMpcRelayChainKey(params.srcChainKey)) {
        const { tx, relayData } = txResult.value;
        return await this.settleOnMpcRelay({
          chainKey: params.srcChainKey,
          tx,
          relayData,
          direction: 'inbound',
          timeout,
        });
      }

      let hubTxHash: string;
      if (!isHubChainKeyType(params.srcChainKey)) {
        const packetResult = await relayTxAndWaitPacket({
          srcTxHash: txResult.value.tx,
          data: txResult.value.relayData,
          chainKey: params.srcChainKey,
          relayerApiEndpoint: this.relayerApiEndpoint,
          timeout: timeout,
        });
        if (!packetResult.ok) return packetResult;

        hubTxHash = packetResult.value.dst_tx_hash;
      } else {
        hubTxHash = txResult.value.tx;
      }

      return { ok: true, value: { srcChainTxHash: txResult.value.tx, dstChainTxHash: hubTxHash } };
    } catch (error) {
      if (isDexCreateIntentError(error)) return { ok: false, error };
      return { ok: false, error: intentCreationFailed('dex', error) };
    }
  }

  /** From an MPC-relay chain the result carries the relay's `trackingId` in place of a source tx. */
  public async withdraw<K extends SpokeChainKey>(
    _params: AssetWithdrawAction<K, false>,
  ): Promise<Result<OutboundSettlement<K>>> {
    const { params, timeout } = _params;
    try {
      const txResult = await this.executeWithdraw(_params);
      if (!txResult.ok) return txResult;
      const { tx, relayData } = txResult.value;
      const dstChainKey: SpokeChainKey = params.dst?.dstChainKey ?? params.srcChainKey;
      if (isMpcRelayChainKey(params.srcChainKey)) {
        return await this.settleOnMpcRelay({
          chainKey: params.srcChainKey,
          tx,
          relayData,
          direction: 'outbound',
          timeout,
          dstChainKey,
        });
      }
      // Past an MPC-relay source, the source chain has a tx, so the result is a pair.
      const settled = (dstChainTxHash: string): OutboundSettlement<K> =>
        ({ srcChainTxHash: tx, dstChainTxHash }) satisfies TxHashPair as OutboundSettlement<K>;

      let hubTxHash: string;
      if (!isHubChainKeyType(params.srcChainKey)) {
        const packetResult = await relayTxAndWaitPacket({
          srcTxHash: txResult.value.tx,
          data: txResult.value.relayData,
          chainKey: params.srcChainKey,
          relayerApiEndpoint: this.relayerApiEndpoint,
          timeout: timeout,
        });
        if (!packetResult.ok) {
          if (!isMpcRelayChainKey(dstChainKey)) return packetResult;
          return {
            ok: false,
            error: mapRelayFailure(packetResult.error, {
              feature: 'dex',
              action: 'withdraw',
              srcChainKey: params.srcChainKey,
              dstChainKey,
              srcTxHash: tx,
              relayData,
            }),
          };
        }

        hubTxHash = packetResult.value.dst_tx_hash;
      } else {
        hubTxHash = txResult.value.tx;
      }

      // No relay watches the hub for an MPC-relay chain, so its release is driven from here.
      if (isMpcRelayChainKey(dstChainKey)) {
        const released = await this.spoke.settleHubRelease(hubTxHash, dstChainKey, timeout);
        if (!released.ok) {
          return {
            ok: false,
            error: mapRelayFailure(released.error.cause, {
              feature: 'dex',
              action: 'withdraw',
              srcChainKey: params.srcChainKey,
              dstChainKey,
              srcTxHash: tx,
              hubTxHash,
              relayData,
            }),
          };
        }
        return { ok: true, value: settled(released.value.dstChainTxHash) };
      }
      return { ok: true, value: settled(hubTxHash) };
    } catch (error) {
      if (isDexCreateIntentError(error)) return { ok: false, error };
      return { ok: false, error: intentCreationFailed('dex', error) };
    }
  }

  /** An MPC-relay source has no intent-relay packet, so it settles on its own relay (hub mint / release). */
  private async settleOnMpcRelay<K extends SpokeChainKey, D extends SettlementDirection>(
    params: SettleParams<K, D>,
  ): Promise<Result<Settlement<K, D>>> {
    const settled = await this.spoke.settle(params);
    if (settled.ok) return settled;
    const { cause } = settled.error;
    return {
      ok: false,
      error: mapRelayFailure(cause, {
        feature: 'dex',
        srcChainKey: params.chainKey,
        dstChainKey: params.dstChainKey,
        relayData: params.relayData,
        ...(params.direction === 'outbound'
          ? { action: 'withdraw', trackingId: params.tx }
          : { action: 'deposit', srcTxHash: params.tx }),
      }),
    };
  }

  /** Hub wrap calls; stops after the vault deposit when the pool token is the vault itself (e.g. bnUSD). */
  public async getTokenWrapAction(
    address: OriginalAssetAddress,
    spokeChainId: SpokeChainKey,
    amount: bigint,
    poolToken: Address,
    recipient: Address,
  ): Promise<EvmContractCall[]> {
    const assetConfig = this.config.getSpokeTokenFromOriginalAssetAddress(spokeChainId, address);
    if (!assetConfig) {
      throw new Error('[withdrawData] Hub asset not found');
    }

    const calls: EvmContractCall[] = [];
    if (!this.config.isSodaVaultHubAsset(assetConfig.hubAsset)) {
      calls.push(Erc20Service.encodeApprove(assetConfig.hubAsset, assetConfig.vault, amount));
      calls.push(EvmVaultTokenService.encodeDeposit(assetConfig.vault, assetConfig.hubAsset, amount));
    }
    const translatedAmount = EvmVaultTokenService.translateIncomingDecimals(assetConfig.decimals, amount);

    if (poolToken.toLowerCase() === assetConfig.vault.toLowerCase()) {
      return calls;
    }

    const dexToken: Address = await this.hubProvider.publicClient.readContract({
      address: this.config.sodaxConfig.dex.concentratedLiquidityConfig.stataTokenFactory,
      abi: stataTokenFactoryAbi,
      functionName: 'getStataToken',
      args: [assetConfig.vault],
    });

    invariant(dexToken === poolToken, 'Dex token does not match pool token');

    calls.push(Erc20Service.encodeApprove(assetConfig.vault, dexToken, translatedAmount));
    calls.push(Erc4626Service.encodeDeposit(dexToken, translatedAmount, recipient));

    return calls;
  }

  /** Hub unwrap calls: StatAToken redeem (skipped for bnUSD) → vault withdraw → payout. `amount` is in shares. */
  public async getTokenUnwrapAction(
    dstChainKey: SpokeChainKey,
    address: OriginalAssetAddress,
    amount: bigint,
    userAddress: Address,
    recipient: Hex,
  ): Promise<EvmContractCall[]> {
    const assetConfig = this.config.getSpokeTokenFromOriginalAssetAddress(dstChainKey, address);
    if (!assetConfig) {
      throw new Error('[withdrawData] Hub asset not found');
    }

    let dexToken: Address = await this.hubProvider.publicClient.readContract({
      address: this.config.sodaxConfig.dex.concentratedLiquidityConfig.stataTokenFactory,
      abi: stataTokenFactoryAbi,
      functionName: 'getStataToken',
      args: [assetConfig.vault],
    });

    if (SodaTokens.bnUSD.address.toLowerCase() === assetConfig.vault.toLowerCase()) {
      dexToken = assetConfig.vault;
    }

    const calls: EvmContractCall[] = [];
    let vaultAmount = amount;
    if (
      SodaTokens.bnUSD.address.toLowerCase() !== assetConfig.vault.toLowerCase() &&
      dexToken.toLowerCase() !== '0x0000000000000000000000000000000000000000'
    ) {
      const unwrapped = await this.getUnwrappedAmount(dexToken, amount);
      if (!unwrapped.ok) throw unwrapped.error;
      vaultAmount = unwrapped.value;
      calls.push(Erc4626Service.encodeRedeem(dexToken, amount, userAddress, userAddress));
    }

    calls.push(EvmVaultTokenService.encodeWithdraw(assetConfig.vault, assetConfig.hubAsset, vaultAmount));
    const translatedAmount = EvmVaultTokenService.translateOutgoingDecimals(assetConfig.decimals, vaultAmount);

    if (dstChainKey === this.hubProvider.chainConfig.chain.key) {
      if (
        assetConfig.hubAsset.toLowerCase() ===
        this.config.spokeChainConfig[dstChainKey].addresses.wrappedSonic.toLowerCase()
      ) {
        const withdrawToCall = {
          address: assetConfig.hubAsset,
          value: 0n,
          data: encodeFunctionData({
            abi: wrappedSonicAbi,
            functionName: 'withdrawTo',
            args: [recipient, translatedAmount],
          }),
        };

        calls.push(withdrawToCall);
      } else {
        calls.push(Erc20Service.encodeTransfer(assetConfig.hubAsset, recipient, translatedAmount));
      }
    } else {
      assertMpcPayoutAboveMinimum({
        feature: 'dex',
        dstChainKey: dstChainKey,
        token: assetConfig,
        amount: translatedAmount,
        context: { dstChainKey, field: 'amount' },
      });
      await this.spoke.assertReleaseRecipientReady({
        feature: 'dex',
        chainKey: dstChainKey,
        recipient,
        token: assetConfig.address,
        amount: translatedAmount,
        context: { dstChainKey, field: 'recipient' },
      });
      calls.push(
        EvmAssetManagerService.encodeTransfer(
          assetConfig.hubAsset,
          recipient,
          translatedAmount,
          this.hubProvider.chainConfig.addresses.assetManager,
        ),
      );
    }

    return calls;
  }

  /** Underlying asset amount → ERC-4626 shares at the current rate. */
  public async getWrappedAmount(dexToken: Address, assetAmount: bigint): Promise<Result<bigint>> {
    try {
      const shares = await Erc4626Service.convertToShares(dexToken, assetAmount, this.hubProvider.publicClient);
      if (!shares.ok) return { ok: false, error: lookupFailed('dex', 'getWrappedAmount', shares.error) };
      return { ok: true, value: shares.value };
    } catch (error) {
      return { ok: false, error: lookupFailed('dex', 'getWrappedAmount', error) };
    }
  }

  /** ERC-4626 shares → underlying asset amount at the current rate. */
  public async getUnwrappedAmount(dexToken: Address, shareAmount: bigint): Promise<Result<bigint>> {
    try {
      const assetAmount = await Erc4626Service.convertToAssets(dexToken, shareAmount, this.hubProvider.publicClient);
      if (!assetAmount.ok) return { ok: false, error: lookupFailed('dex', 'getUnwrappedAmount', assetAmount.error) };
      return { ok: true, value: assetAmount.value };
    } catch (error) {
      return { ok: false, error: lookupFailed('dex', 'getUnwrappedAmount', error) };
    }
  }

  /** Pool-token balance of the user's hub wallet, in StatAToken shares (not underlying units). */
  public async getDeposit(
    poolToken: Address,
    walletAddress: Address,
    chainKey: SpokeChainKey,
  ): Promise<Result<bigint>> {
    try {
      const hubwallet = await this.hubProvider.getUserHubWalletAddress(walletAddress, chainKey);
      const value = await this.hubProvider.publicClient.readContract({
        address: poolToken,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [hubwallet],
      });
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error: lookupFailed('dex', 'getDeposit', error) };
    }
  }
}
