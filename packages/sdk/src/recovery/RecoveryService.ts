import { erc20Abi, isAddress, type Address } from 'viem';
import type { GetAddressType, Result, SpokeChainKey, SpokeExecActionParams, SendMessageReturnType } from '@sodax/types';
import { isIndeterminateOutcomeError, isMpcRelayChainKey } from '@sodax/types';
import type { ConfigService } from '../shared/config/ConfigService.js';
import type { HubProvider } from '../shared/types/types.js';
import type { SpokeService } from '../shared/services/spoke/SpokeService.js';
import { EvmAssetManagerService } from '../shared/services/hub/EvmAssetManagerService.js';
import type { SendMessageParams } from '../shared/types/spoke-types.js';
import { assertMpcPayoutAboveMinimum, encodeRecipient } from '../shared/index.js';
import { SodaxError, isSodaxError } from '../errors/SodaxError.js';
import { intentCreationFailed, lookupFailed } from '../errors/wrappers.js';
import { recoveryInvariant } from './errors.js';

export type HubAssetBalance = {
  spokeTokenAddress: Address;
  hubAssetAddress: Address;
  symbol: string;
  name: string;
  decimal: number;
  /** Raw `balanceOf` of the hub-side asset for the user's hub wallet. */
  balance: bigint;
};

export type FetchHubAssetBalancesParams = {
  chainKey: SpokeChainKey;
  /** Spoke address; the hub wallet is derived from it. */
  srcAddress: string;
};

export type WithdrawHubAssetParams<K extends SpokeChainKey> = {
  srcChainKey: K;
  /** Spoke address and withdrawal destination; the hub wallet is derived from it. */
  srcAddress: GetAddressType<K>;
  token: Address;
  /** Amount to withdraw, denominated in the hub-side asset. */
  amount: bigint;
};

export type WithdrawHubAssetAction<K extends SpokeChainKey, Raw extends boolean> = SpokeExecActionParams<
  K,
  Raw,
  WithdrawHubAssetParams<K>
>;

export type RecoveryServiceConstructorParams = {
  config: ConfigService;
  hubProvider: HubProvider;
  spoke: SpokeService;
};

/**
 * Recovers assets stranded in a user's hub wallet when a cross-chain flow fails mid-flight.
 * @namespace SodaxFeatures
 */
export class RecoveryService {
  private readonly hubProvider: HubProvider;
  private readonly config: ConfigService;
  private readonly spoke: SpokeService;

  public constructor({ config, hubProvider, spoke }: RecoveryServiceConstructorParams) {
    this.config = config;
    this.hubProvider = hubProvider;
    this.spoke = spoke;
  }

  /** Non-zero hub balances for the chain's supported tokens (skipping placeholder hub assets), via one multicall. */
  public async fetchHubAssetBalances({
    chainKey,
    srcAddress,
  }: FetchHubAssetBalancesParams): Promise<Result<HubAssetBalance[]>> {
    try {
      const chainConfig = this.config.spokeChainConfig[chainKey];
      recoveryInvariant(chainConfig, `Unknown spoke chain key: ${chainKey}`, {
        srcChainKey: chainKey,
        field: 'chainKey',
      });

      // lsoda* vault shares hold a position, not stranded funds, and `assetManager.transfer` reverts
      // for them (no spoke mapping); they exit via the leverage-yield withdraw flow instead.
      const leverageVaultAddresses = new Set(
        this.config.sodaxConfig.leverageYield.vaults.map(vault => vault.vault.toLowerCase()),
      );

      const entries = Object.values(chainConfig.supportedTokens).filter(
        token => isAddress(token.hubAsset) && !leverageVaultAddresses.has(token.hubAsset.toLowerCase()),
      );

      if (entries.length === 0) {
        return { ok: true, value: [] };
      }

      const hubWallet = await this.hubProvider.getUserHubWalletAddress(srcAddress, chainKey);

      const balanceResults = await this.hubProvider.publicClient.multicall({
        contracts: entries.map(token => ({
          address: token.hubAsset as Address,
          abi: erc20Abi,
          functionName: 'balanceOf' as const,
          args: [hubWallet],
        })),
        allowFailure: true,
      });

      const balances: HubAssetBalance[] = [];
      entries.forEach((token, index) => {
        const result = balanceResults[index];
        if (!result || result.status !== 'success') return;
        const balance = result.result as bigint;
        if (balance <= 0n) return;
        balances.push({
          spokeTokenAddress: token.address.toLowerCase() as Address,
          hubAssetAddress: (token.hubAsset as string).toLowerCase() as Address,
          symbol: token.symbol,
          name: token.name,
          decimal: token.decimals,
          balance,
        });
      });

      return { ok: true, value: balances };
    } catch (error) {
      return {
        ok: false,
        error: lookupFailed('recovery', 'fetchHubAssetBalances', error),
      };
    }
  }

  /**
   * Relays an asset-manager transfer back to `srcAddress`. From an MPC-relay chain (Tron) a signed
   * withdraw returns the relay's `trackingId`, not a tx hash.
   */
  public async withdrawHubAsset<K extends SpokeChainKey, Raw extends boolean>(
    _params: WithdrawHubAssetAction<K, Raw>,
  ): Promise<Result<SendMessageReturnType<K, Raw>>> {
    return this.config.analytics.trackResult(
      'recovery',
      'withdrawHubAsset',
      async () => {
        const { params } = _params;
        try {
          const token = this.config.getSpokeTokenFromOriginalAssetAddress(params.srcChainKey, params.token);
          const recipient = encodeRecipient(params.srcChainKey, params.srcAddress);
          if (token) {
            const context = { action: 'withdrawHubAsset', srcChainKey: params.srcChainKey } as const;
            assertMpcPayoutAboveMinimum({
              feature: 'recovery',
              dstChainKey: params.srcChainKey,
              token,
              amount: params.amount,
              context: { ...context, field: 'amount' },
            });
            await this.spoke.assertReleaseRecipientReady({
              feature: 'recovery',
              chainKey: params.srcChainKey,
              recipient,
              token: token.address,
              amount: params.amount,
              context: { ...context, field: 'srcAddress' },
            });
          }
          const hubWallet = await this.hubProvider.getUserHubWalletAddress(params.srcAddress, params.srcChainKey);
          const payload = EvmAssetManagerService.withdrawAssetData(
            {
              token: params.token,
              to: recipient,
              amount: params.amount,
            },
            this.hubProvider,
            params.srcChainKey,
          );

          const coreParams = {
            srcChainKey: params.srcChainKey,
            srcAddress: params.srcAddress,
            dstChainKey: this.hubProvider.chainConfig.chain.key,
            dstAddress: hubWallet,
            payload,
          };

          const sendMessageParams = _params.raw
            ? ({ ...coreParams, raw: true } satisfies SendMessageParams<K, true>)
            : ({
                ...coreParams,
                raw: false,
                walletProvider: _params.walletProvider,
              } satisfies SendMessageParams<K, false>);

          const txResult = await this.spoke.sendMessage(sendMessageParams);
          if (!txResult.ok) {
            if (isIndeterminateOutcomeError(txResult.error)) {
              return {
                ok: false,
                error: intentCreationFailed('recovery', txResult.error, {
                  action: 'withdrawHubAsset',
                  srcChainKey: params.srcChainKey,
                  dstChainKey: params.srcChainKey,
                  relayData: { address: hubWallet, payload },
                }),
              };
            }
            return txResult;
          }

          return {
            ok: true,
            value: txResult.value satisfies SendMessageReturnType<K, boolean> as SendMessageReturnType<K, Raw>,
          };
        } catch (error) {
          if (isSodaxError(error) && error.code === 'VALIDATION_FAILED') return { ok: false, error };
          return {
            ok: false,
            error: new SodaxError(
              'EXECUTION_FAILED',
              error instanceof Error ? error.message : 'withdrawHubAsset failed',
              { feature: 'recovery', cause: error, context: { action: 'withdrawHubAsset', phase: 'execution' } },
            ),
          };
        }
      },
      {
        start: () => ({
          srcChainKey: _params.params.srcChainKey,
          srcAddress: _params.params.srcAddress,
          token: _params.params.token,
          amount: _params.params.amount,
        }),
        success: value => {
          if (typeof value !== 'string') return { txHash: undefined };
          // From an MPC-relay chain the value is the relay's trackingId, not a tx hash.
          return isMpcRelayChainKey(_params.params.srcChainKey) ? { trackingId: value } : { txHash: value };
        },
        failure: error => ({ code: isSodaxError(error) ? error.code : undefined }),
      },
    );
  }
}
