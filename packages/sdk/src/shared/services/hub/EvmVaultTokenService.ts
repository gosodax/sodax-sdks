import { type Address, type Hash, type PublicClient, encodeFunctionData } from 'viem';
import { vaultTokenAbi } from '../../abis/index.js';
import {
  ChainKeys,
  type IEvmWalletProvider,
  type TokenInfo,
  type EvmContractCall,
  type VaultReserves,
} from '@sodax/types';
import { getEvmViemChain } from '../../utils/constant-utils.js';

export class EvmVaultTokenService {
  private constructor() {}

  public static async getTokenInfo(vault: Address, token: Address, publicClient: PublicClient): Promise<TokenInfo> {
    const [decimals, depositFee, withdrawalFee, maxDeposit, isSupported] = await publicClient.readContract({
      address: vault,
      abi: vaultTokenAbi,
      functionName: 'tokenInfo',
      args: [token],
    });

    return { decimals, depositFee, withdrawalFee, maxDeposit, isSupported };
  }

  public static async getTokenInfos(
    vault: Address,
    tokens: Address[],
    publicClient: PublicClient,
  ): Promise<TokenInfo[]> {
    const infos = await publicClient.multicall({
      contracts: tokens.map(
        token =>
          ({
            address: vault,
            abi: vaultTokenAbi,
            functionName: 'tokenInfo',
            args: [token],
          }) as const,
      ),
      allowFailure: false,
    });

    return infos.map(info => {
      const [decimals, depositFee, withdrawalFee, maxDeposit, isSupported] = info;
      return { decimals, depositFee, withdrawalFee, maxDeposit, isSupported };
    });
  }

  public static async getVaultReserves(vault: Address, publicClient: PublicClient): Promise<VaultReserves> {
    const [tokens, balances] = await publicClient.readContract({
      address: vault,
      abi: vaultTokenAbi,
      functionName: 'getVaultReserves',
      args: [],
    });

    return {
      tokens,
      balances,
    };
  }

  public static async getAllTokenInfo(
    vault: Address,
    publicClient: PublicClient,
  ): Promise<{
    tokens: readonly Address[];
    infos: readonly TokenInfo[];
    reserves: readonly bigint[];
  }> {
    const [tokens, infos, reserves] = await publicClient.readContract({
      address: vault,
      abi: vaultTokenAbi,
      functionName: 'getAllTokenInfo',
      args: [],
    });

    return {
      tokens,
      infos,
      reserves,
    };
  }

  public static async deposit(
    vault: Address,
    token: Address,
    amount: bigint,
    walletProvider: IEvmWalletProvider,
  ): Promise<Hash> {
    const from = (await walletProvider.getWalletAddress()) as `0x${string}`;
    return walletProvider.sendTransaction(
      {
        from,
        to: vault,
        value: 0n,
        data: encodeFunctionData({
          abi: vaultTokenAbi,
          functionName: 'deposit',
          args: [token, amount],
        }),
      },
      // Vaults live on the hub; refuse to broadcast from a wallet on another EVM network.
      { expectedChainId: getEvmViemChain(ChainKeys.SONIC_MAINNET).id },
    );
  }

  public static async withdraw(
    vault: Address,
    token: Address,
    amount: bigint,
    provider: IEvmWalletProvider,
  ): Promise<Hash> {
    const from = (await provider.getWalletAddress()) as `0x${string}`;
    return provider.sendTransaction(
      {
        from,
        to: vault,
        value: 0n,
        data: encodeFunctionData({
          abi: vaultTokenAbi,
          functionName: 'withdraw',
          args: [token, amount],
        }),
      },
      { expectedChainId: getEvmViemChain(ChainKeys.SONIC_MAINNET).id },
    );
  }

  static encodeDeposit(vault: Address, token: Address, amount: bigint): EvmContractCall {
    return {
      address: vault,
      value: 0n,
      data: encodeFunctionData({
        abi: vaultTokenAbi,
        functionName: 'deposit',
        args: [token, amount],
      }),
    };
  }

  static encodeWithdraw(vault: Address, token: Address, amount: bigint): EvmContractCall {
    return {
      address: vault,
      value: 0n,
      data: encodeFunctionData({
        abi: vaultTokenAbi,
        functionName: 'withdraw',
        args: [token, amount],
      }),
    };
  }

  /** Native token decimals → the vault's 18-decimal scale. */
  public static translateIncomingDecimals(decimals: number, amount: bigint): bigint {
    if (decimals <= 18) {
      return amount * BigInt(10 ** (18 - decimals));
    }
    return amount / BigInt(10 ** (decimals - 18));
  }

  /** The vault's 18-decimal scale → native token decimals. */
  public static translateOutgoingDecimals(decimals: number, amount: bigint): bigint {
    if (decimals <= 18) {
      return amount / BigInt(10 ** (18 - decimals));
    }
    return amount * BigInt(10 ** (decimals - 18));
  }
}
