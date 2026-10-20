import { erc20Abi, isAddress, type Address } from 'viem';
import type { GetAddressType, Result, SpokeChainKey, SpokeExecActionParams, TxReturnType } from '@sodax/types';
import type { ConfigService } from '../shared/config/ConfigService.js';
import type { HubProvider } from '../shared/types/types.js';
import type { SpokeService } from '../shared/services/spoke/SpokeService.js';
import { EvmAssetManagerService } from '../shared/services/hub/EvmAssetManagerService.js';
import type { SendMessageParams } from '../shared/types/spoke-types.js';
import { encodeRecipient } from '../shared/index.js';
import { SodaxError, isSodaxError } from '../errors/SodaxError.js';
import { lookupFailed } from '../errors/wrappers.js';
import { recoveryInvariant } from './errors.js';

export type HubAssetBalance = {
  /** The original token address on the spoke chain (key for the SDK's spoke→hub asset map). */
  spokeTokenAddress: Address;
  /** The wrapped asset address on the hub chain. */
  hubAssetAddress: Address;
  symbol: string;
  name: string;
  decimal: number;
  /** Raw `balanceOf` of the hub-side asset for the user's hub wallet. */
  balance: bigint;
};

export type FetchHubAssetBalancesParams = {
  /** The spoke chain whose tokens we are reconciling on the hub side. */
  chainKey: SpokeChainKey;
  /** The user's address on the spoke chain. The service derives the hub wallet abstraction internally. */
  srcAddress: string;
};

export type WithdrawHubAssetParams<K extends SpokeChainKey> = {
  /** The spoke chain to withdraw the asset back to. The user's wallet is on this chain. */
  srcChainKey: K;
  /** The user's address on the spoke chain. The service derives the hub wallet abstraction internally. */
  srcAddress: GetAddressType<K>;
  /** The original spoke-side token address (drives the SDK's hub-asset lookup). */
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
 * Handles recovery of assets stranded in a user's hub wallet on the Sonic hub chain.
 *
 * Cross-chain operations (swaps, bridges, money market) occasionally fail mid-flight — after
 * the spoke-side deposit succeeds but before the hub-side execution completes — leaving tokens
 * locked in the user's wallet abstraction contract on Sonic. `RecoveryService` provides two
 * operations to resolve this:
 *   1. `fetchHubAssetBalances` — inspect which hub-side assets the user holds, and
 *   2. `withdrawHubAsset` — relay a withdrawal back to the user's spoke chain address.
 *
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

  /**
   * Returns all hub-side token balances held by the user's hub wallet for a given spoke chain.
   *
   * Iterates every entry in `config.spokeChainConfig[chainKey].supportedTokens`, skips tokens
   * whose `hubAsset` is not a valid address (e.g. placeholder `'0x'` for not-yet-deployed
   * tokens), derives the user's hub wallet abstraction address from `srcAddress` + `chainKey`,
   * then issues a single multicall (`allowFailure: true`) to read `balanceOf(hubWallet)` on the
   * hub chain for every candidate asset. Only entries with a non-zero balance are included in
   * the result.
   *
   * @param chainKey - The spoke chain whose token list is used to enumerate hub assets.
   * @param srcAddress - The user's address on the spoke chain; the service derives the
   *   corresponding hub wallet abstraction address internally.
   * @returns A `Result` wrapping an array of {@link HubAssetBalance} entries — one per hub-side
   *   token with a positive balance. Returns an empty array when no balances are found or when
   *   the chain has no supported tokens with valid hub-asset addresses.
   */
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

      // Leverage-yield vault share tokens (lsoda*) appear in `supportedTokens` (so they're
      // discoverable in swaps), and their `hubAsset` is the vault proxy itself — so a naive
      // `balanceOf(hubWallet)` would surface a deposited position here as if it were a stranded
      // asset. But they are NOT registered asset-manager assets: `withdrawHubAsset` encodes an
      // `assetManager.transfer`, which reverts for them (no spoke mapping) and shows up in the
      // wallet as a failed gas estimate / "undefined gas fee". They are exited via the
      // leverage-yield withdraw flow, not asset recovery — so omit them from recoverable assets.
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
   * Withdraws a stuck hub-side asset back to the user's spoke chain address.
   *
   * Derives the user's hub wallet abstraction address from `params.srcAddress` +
   * `params.srcChainKey`, encodes a `transfer` call on the asset manager contract via
   * `EvmAssetManagerService.withdrawAssetData` (encoding the spoke destination address in
   * chain-specific format via `encodeRecipient`), then relays the payload through the spoke chain
   * via `SpokeService.sendMessage` so the hub wallet executes the asset transfer on Sonic.
   *
   * When `raw: true` the method returns the unsigned spoke transaction (no `walletProvider`
   * required). When `raw: false` (or omitted) a `walletProvider` must be supplied and the
   * transaction is signed and broadcast, returning the chain-specific transaction hash.
   *
   * @param _params - Execution wrapper containing the action params, the `raw` flag, and —
   *   when `raw: false` — a `walletProvider` for signing.
   * @param _params.params.srcChainKey - The spoke chain the user is withdrawing back to.
   * @param _params.params.srcAddress - The user's address on the spoke chain; also the
   *   withdrawal destination after chain-specific encoding.
   * @param _params.params.token - The original spoke-side token address used to look up the
   *   corresponding hub asset in the SDK config.
   * @param _params.params.amount - Amount to withdraw, denominated in the hub-side asset's
   *   native precision (i.e. the same unit returned by {@link fetchHubAssetBalances}).
   * @returns A `Result` wrapping the chain-specific transaction return value: a raw unsigned
   *   transaction object when `raw: true`, or the broadcast transaction hash when `raw: false`.
   */
  public async withdrawHubAsset<K extends SpokeChainKey, Raw extends boolean>(
    _params: WithdrawHubAssetAction<K, Raw>,
  ): Promise<Result<TxReturnType<K, Raw>>> {
    return this.config.analytics.trackResult(
      'recovery',
      'withdrawHubAsset',
      async () => {
        const { params } = _params;
        try {
          const hubWallet = await this.hubProvider.getUserHubWalletAddress(params.srcAddress, params.srcChainKey);
          const payload = EvmAssetManagerService.withdrawAssetData(
            {
              token: params.token,
              to: encodeRecipient(params.srcChainKey, params.srcAddress),
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
          if (!txResult.ok) return txResult;

          return {
            ok: true,
            value: txResult.value satisfies TxReturnType<K, boolean> as TxReturnType<K, Raw>,
          };
        } catch (error) {
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
        success: value => ({ txHash: typeof value === 'string' ? value : undefined }),
        failure: error => ({ code: isSodaxError(error) ? error.code : undefined }),
      },
    );
  }
}
