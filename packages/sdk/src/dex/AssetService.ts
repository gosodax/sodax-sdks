import type { DestinationParamsType, IntentTxResult, TxHashPair } from '../shared/types/types.js';
import type { Address, Hex } from 'viem';
import {
  EvmAssetManagerService,
  type SpokeService,
  encodeAddress,
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
  isEvmChainKeyType,
  isOptionalStellarWalletProviderType,
  isEvmSpokeOnlyChainKeyType,
  isOptionalEvmWalletProviderType,
  type SendMessageParams,
} from '../shared/index.js';
import {
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
} from '@sodax/types';
import { encodeFunctionData, erc20Abi, isAddress } from 'viem';
import { invariant } from '../shared/utils/tiny-invariant.js';
import { stataTokenFactoryAbi } from '../shared/abis/stataTokenFactory.abi.js';
import { approveFailed, intentCreationFailed, lookupFailed } from '../errors/wrappers.js';
import { dexInvariant, isDexApproveError, isDexCreateIntentError } from './errors.js';

export type CreateAssetWithdrawParams<K extends SpokeChainKey> = {
  srcChainKey: K;
  srcAddress: GetAddressType<K>;
  poolToken: Address;
  asset: OriginalAssetAddress; // asset address
  amount: bigint; // amount of asset to withdraw
  dst?: DestinationParamsType;
};

export type CreateAssetDepositParams<K extends SpokeChainKey> = {
  srcChainKey: K;
  srcAddress: GetAddressType<K>;
  asset: OriginalAssetAddress; // asset address
  amount: bigint; // amount of token to deposit
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
 * Service for wrapping and unwrapping assets in preparation for DEX liquidity provision.
 *
 * The SODAX DEX pools hold StatATokens (ERC-4626 interest-bearing wrappers produced by
 * the `StataTokenFactory`). Before a user can supply liquidity they must convert their
 * spoke-chain tokens into the vault-token representation that lives on the hub chain.
 * `AssetService` encapsulates that two-step conversion:
 *
 * - **Deposit** (wrap): spoke token → hub vault token → StatAToken  (`executeDeposit` / `deposit`)
 * - **Withdraw** (unwrap): StatAToken → hub vault token → spoke token  (`executeWithdraw` / `withdraw`)
 *
 * It also handles allowance checks and ERC-20 approvals for the above flows, and
 * provides helpers to query a user's current DEX deposit balance and to convert
 * between share and asset amounts for any ERC-4626 token.
 *
 * Cross-chain users go through the hub-and-spoke relay; hub-chain (Sonic) users
 * execute directly without a relay step.
 *
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

  /**
   * Check whether sufficient allowance exists for a DEX deposit action.
   *
   * The required spender differs by chain type:
   * - **EVM spoke chains**: the chain's `assetManager` contract.
   * - **Hub chain (Sonic)**: the user's hub wallet address (contract wallet abstraction).
   * - **Stellar**: verifies the sender's trustline via `SpokeService.isAllowanceValid`.
   * - **All other non-EVM chains**: always returns `true` (no on-chain approval needed).
   *
   * @param _params - Deposit action parameters including the asset address, amount,
   *   source chain key, and source address.
   * @returns `Result<boolean>` — `true` if the spender already has sufficient allowance
   *   (or approval is not required for the chain), `false` if an approval transaction
   *   is needed before depositing.
   */
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

      if (isEvmChainKeyType(params.srcChainKey) || isHubChainKeyType(params.srcChainKey)) {
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

      // For non-EVM/non-Sonic chains, no approval is required
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

  /**
   * Submit an ERC-20 approval (or Stellar trustline operation) required before depositing.
   *
   * Supported chain types:
   * - **Stellar**: calls `SpokeService.approve` for the trustline.
   * - **EVM spoke & hub chains**: calls `SpokeService.approve` with the appropriate
   *   spender (asset manager for EVM spokes, hub wallet for Sonic).
   * - **Other chains**: returns an error — approval is not supported or not needed.
   *
   * @param _params - Deposit action parameters including the asset address and amount to approve.
   * @returns `Result<TxReturnType<K, Raw>>` — the transaction hash (when `raw` is `false`)
   *   or the unsigned transaction bytes (when `raw` is `true`).
   */
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

  /**
   * Build and submit the spoke-side transaction that wraps tokens into the pool's StatAToken.
   *
   * On the hub the following calls are batched into a single payload:
   * 1. If the asset is not already a vault token: `ERC20.approve` + `VaultToken.deposit`
   *    to convert the spoke-chain asset into the hub vault token.
   * 2. `ERC20.approve(vault → stataToken)` + `ERC4626.deposit(stataToken)` to wrap the
   *    vault token into the StatAToken used by the CL pool.
   *
   * The payload is delivered to the hub via `SpokeService.deposit`. If a `dst` override
   * is provided, the StatATokens are minted into a different hub wallet (cross-account
   * liquidity provision).
   *
   * @param _params - Deposit action parameters including the original asset address,
   *   amount, target pool token (StatAToken), and optional destination override.
   * @returns `Result<IntentTxResult<K, Raw>>` — on success, contains the spoke-chain tx
   *   and relay data for cross-chain packet tracking.
   */
  public async executeDeposit<K extends SpokeChainKey, Raw extends boolean>(
    _params: AssetDepositAction<K, Raw>,
  ): Promise<Result<IntentTxResult<K, Raw>>> {
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
          tx: txResult.value satisfies TxReturnType<K, Raw> as TxReturnType<K, Raw>,
          relayData: { address: fromHubWallet, payload: data },
        },
      };
    } catch (error) {
      if (isDexCreateIntentError(error)) return { ok: false, error };
      return { ok: false, error: intentCreationFailed('dex', error) };
    }
  }

  /**
   * Build and submit the spoke-side transaction that unwraps StatATokens back to the original asset.
   *
   * On the hub the following calls are batched into a single payload:
   * 1. `ERC4626.redeem(stataToken)` to convert StatAToken shares back to vault tokens.
   * 2. `VaultToken.withdraw` to convert vault tokens back to the hub asset.
   * 3. Transfer the unwrapped asset to the recipient:
   *    - Hub chain + native Sonic (wS): `wrappedSonic.withdrawTo(recipient, amount)`
   *    - Hub chain + other ERC-20: `ERC20.transfer(recipient, amount)`
   *    - Cross-chain: `AssetManager.transfer(...)` which initiates the spoke delivery.
   *
   * Special case: bnUSD vault tokens skip the StatAToken redeem step and go directly
   * to `VaultToken.withdraw`.
   *
   * @param _params - Withdraw action parameters including the asset address, amount
   *   (in StatAToken shares), pool token address, and optional destination override.
   * @returns `Result<IntentTxResult<K, Raw>>` — on success, contains the spoke-chain tx
   *   and relay data for cross-chain packet tracking.
   */
  public async executeWithdraw<K extends SpokeChainKey, Raw extends boolean>(
    _params: AssetWithdrawAction<K, Raw>,
  ): Promise<Result<IntentTxResult<K, Raw>>> {
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
        : [await this.hubProvider.getUserHubWalletAddress(params.srcAddress, params.srcChainKey), params.srcAddress];
      const dstChainKey: SpokeChainKey = params.dst?.dstChainKey ?? params.srcChainKey;

      const calls = await this.getTokenUnwrapAction(
        dstChainKey,
        params.asset,
        params.amount,
        fromHubWallet,
        encodeAddress(dstChainKey, recipient),
      );

      const data = encodeContractCalls(calls);
      const coreParams = {
        srcAddress: recipient as GetAddressType<K>,
        srcChainKey: dstChainKey as K,
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

      if (!txResult.ok) return { ok: false, error: intentCreationFailed('dex', txResult.error) };

      return {
        ok: true,
        value: {
          tx: txResult.value satisfies TxReturnType<K, boolean> as TxReturnType<K, Raw>,
          relayData: { address: fromHubWallet, payload: data },
        },
      };
    } catch (error) {
      if (isDexCreateIntentError(error)) return { ok: false, error };
      return { ok: false, error: intentCreationFailed('dex', error) };
    }
  }

  /**
   * Return whether the user is depositing SODA into an xSoda pool position.
   *
   * xSoda (the ERC-4626 staking vault) is a valid DEX pool token. When the original
   * asset is SODA and the pool token is xSoda, the deposit flow must go through the
   * staking contract (stake SODA → receive xSoda) rather than the standard wrap path.
   * Callers should check this before calling `executeDeposit` so they can route the
   * transaction appropriately.
   *
   * @param chainId - The spoke chain the asset originates from.
   * @param asset - The original asset address on the spoke chain.
   * @param poolToken - The hub-chain pool token address (the StatAToken or vault token).
   * @returns `true` if the asset maps to SODA and the pool token is the hub's xSoda address.
   * @throws If the spoke token config cannot be found for `asset` on `chainId`.
   */
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

  /**
   * Wrap tokens into the pool's StatAToken and wait for the cross-chain relay to complete.
   *
   * Calls `executeDeposit` to broadcast on the spoke chain, then blocks until the
   * relayer delivers the packet to the hub (or the optional timeout elapses).
   * When the source is the hub chain itself the relay step is skipped.
   *
   * @param _params - Deposit action parameters including the asset address, amount,
   *   target pool token, and an optional `timeout` (ms) for the relay wait.
   * @returns `Result<TxHashPair>` — on success, contains `srcChainTxHash` (spoke) and
   *   `dstChainTxHash` (hub) once the relay packet has been confirmed.
   */
  public async deposit<K extends SpokeChainKey>(_params: AssetDepositAction<K, false>): Promise<Result<TxHashPair>> {
    const { params, timeout } = _params;
    try {
      const txResult = await this.executeDeposit(_params);
      if (!txResult.ok) return txResult;

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

  /**
   * Unwrap StatATokens back to the original asset and wait for the cross-chain relay to complete.
   *
   * Calls `executeWithdraw` to broadcast on the spoke chain, then blocks until the
   * relayer delivers the packet to the hub (or the optional timeout elapses).
   * When the source is the hub chain itself the relay step is skipped.
   *
   * @param _params - Withdraw action parameters including the asset address, amount
   *   (in StatAToken shares), pool token address, and an optional `timeout` (ms).
   * @returns `Result<TxHashPair>` — on success, contains `srcChainTxHash` (spoke) and
   *   `dstChainTxHash` (hub) once the relay packet has been confirmed.
   */
  public async withdraw<K extends SpokeChainKey>(_params: AssetWithdrawAction<K, false>): Promise<Result<TxHashPair>> {
    const { params, timeout } = _params;
    try {
      const txResult = await this.executeWithdraw(_params);
      if (!txResult.ok) return txResult;

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

  /**
   * Build the hub-side contract calls that wrap a spoke asset into the DEX pool token.
   *
   * The sequence depends on what the pool token is:
   * - If the pool token is the vault token itself (e.g. bnUSD), only the vault deposit
   *   calls are emitted (ERC-20 approve + `VaultToken.deposit`).
   * - Otherwise the vault token is further wrapped into a StatAToken via the
   *   `StataTokenFactory`: ERC-20 approve + `ERC4626.deposit(stataToken)`.
   *
   * The resulting array of `EvmContractCall` objects is intended to be batched with
   * `encodeContractCalls` inside `executeDeposit`.
   *
   * @param address - The original asset address on the spoke chain.
   * @param spokeChainId - The spoke chain the asset originates from (used for config lookup).
   * @param amount - The amount of the original asset to wrap (in original asset decimals).
   * @param poolToken - The target pool token address (StatAToken or vault token).
   * @param recipient - The hub wallet address that will receive the wrapped tokens.
   * @returns An array of `EvmContractCall` objects encoding the wrap sequence.
   * @throws If the asset is not found in config, or if the resolved DEX token does not
   *   match `poolToken`.
   */
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

    // deposit non-vault token into the vault
    calls.push(Erc20Service.encodeApprove(assetConfig.vault, dexToken, translatedAmount));
    calls.push(Erc4626Service.encodeDeposit(dexToken, translatedAmount, recipient));

    return calls;
  }

  /**
   * Build the hub-side contract calls that unwrap a DEX pool token back to the original asset.
   *
   * The sequence depends on the token type and destination chain:
   * 1. If the pool token is a StatAToken (non-bnUSD): `ERC4626.redeem` to get vault tokens.
   * 2. `VaultToken.withdraw` to convert vault tokens to the hub asset.
   * 3. Transfer to recipient:
   *    - Hub chain + native Sonic (wS): `wrappedSonic.withdrawTo`
   *    - Hub chain + other ERC-20: `ERC20.transfer`
   *    - Cross-chain: `AssetManager.transfer` (initiates spoke delivery)
   *
   * @param dstChainKey - The destination spoke chain (determines transfer encoding).
   * @param address - The original asset address on the destination spoke chain.
   * @param amount - The amount of StatAToken shares to redeem.
   * @param userAddress - The hub wallet address of the user (used as ERC-4626 redeem owner).
   * @param recipient - The encoded recipient address on the destination chain.
   * @returns An array of `EvmContractCall` objects encoding the unwrap sequence.
   * @throws If the asset is not found in config, or if an ERC-4626 conversion fails.
   */
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

  /**
   * Convert an underlying asset amount to the equivalent number of ERC-4626 shares.
   *
   * For example: given an amount of the hub vault token, returns how many StatAToken
   * shares that amount buys at the current exchange rate.
   *
   * @param dexToken - The ERC-4626 token (StatAToken) address on the hub chain.
   * @param assetAmount - The amount of underlying assets to convert.
   * @returns `Result<bigint>` — the equivalent share amount.
   */
  public async getWrappedAmount(dexToken: Address, assetAmount: bigint): Promise<Result<bigint>> {
    try {
      const shares = await Erc4626Service.convertToShares(dexToken, assetAmount, this.hubProvider.publicClient);
      if (!shares.ok) return { ok: false, error: lookupFailed('dex', 'getWrappedAmount', shares.error) };
      return { ok: true, value: shares.value };
    } catch (error) {
      return { ok: false, error: lookupFailed('dex', 'getWrappedAmount', error) };
    }
  }

  /**
   * Convert a number of ERC-4626 shares to the equivalent underlying asset amount.
   *
   * For example: given a StatAToken share amount, returns how many vault tokens
   * those shares redeem for at the current exchange rate.
   *
   * @param dexToken - The ERC-4626 token (StatAToken) address on the hub chain.
   * @param shareAmount - The number of shares to convert.
   * @returns `Result<bigint>` — the equivalent underlying asset amount.
   */
  public async getUnwrappedAmount(dexToken: Address, shareAmount: bigint): Promise<Result<bigint>> {
    try {
      const assetAmount = await Erc4626Service.convertToAssets(dexToken, shareAmount, this.hubProvider.publicClient);
      if (!assetAmount.ok) return { ok: false, error: lookupFailed('dex', 'getUnwrappedAmount', assetAmount.error) };
      return { ok: true, value: assetAmount.value };
    } catch (error) {
      return { ok: false, error: lookupFailed('dex', 'getUnwrappedAmount', error) };
    }
  }

  /**
   * Fetch the user's current DEX deposit balance for a given pool token.
   *
   * Resolves the user's hub wallet address from their spoke-chain address, then
   * reads the ERC-20 balance of the pool token (StatAToken) held by that hub wallet.
   * The returned amount is in StatAToken shares (not underlying asset units).
   *
   * @param poolToken - The pool token (StatAToken) address on the hub chain.
   * @param walletAddress - The user's address on their spoke chain.
   * @param chainKey - The spoke chain key used to derive the hub wallet address.
   * @returns `Result<bigint>` — the StatAToken share balance of the user's hub wallet.
   */
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
