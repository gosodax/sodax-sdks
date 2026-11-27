import { encodeFunctionData, type Address, type PublicClient } from 'viem';
import { erc4626Abi } from '../abis/erc4626.abi.js';
import {
  ChainKeys,
  type EvmChainKey,
  type EvmContractCall,
  type EvmReturnType,
  type IEvmWalletProvider,
  type Result,
  type TxReturnType,
} from '@sodax/types';
import { getEvmViemChain } from '../utils/constant-utils.js';

// The vaults live on the hub; refuse to broadcast from a wallet on another EVM network.
const HUB_CHAIN_ID = getEvmViemChain(ChainKeys.SONIC_MAINNET).id;

export class Erc4626Service {
  private constructor() {}

  static async getAsset(vault: Address, publicClient: PublicClient): Promise<Result<Address>> {
    try {
      const asset = await publicClient.readContract({
        address: vault,
        abi: erc4626Abi,
        functionName: 'asset',
      });

      return {
        ok: true,
        value: asset,
      };
    } catch (e) {
      return {
        ok: false,
        error: e,
      };
    }
  }

  static async getTotalAssets(vault: Address, publicClient: PublicClient): Promise<Result<bigint>> {
    try {
      const totalAssets = await publicClient.readContract({
        address: vault,
        abi: erc4626Abi,
        functionName: 'totalAssets',
      });

      return {
        ok: true,
        value: totalAssets,
      };
    } catch (e) {
      return {
        ok: false,
        error: e,
      };
    }
  }

  static async convertToShares(vault: Address, assets: bigint, publicClient: PublicClient): Promise<Result<bigint>> {
    try {
      const shares = await publicClient.readContract({
        address: vault,
        abi: erc4626Abi,
        functionName: 'convertToShares',
        args: [assets],
      });

      return {
        ok: true,
        value: shares,
      };
    } catch (e) {
      return {
        ok: false,
        error: e,
      };
    }
  }

  static async convertToAssets(vault: Address, shares: bigint, publicClient: PublicClient): Promise<Result<bigint>> {
    try {
      const assets = await publicClient.readContract({
        address: vault,
        abi: erc4626Abi,
        functionName: 'convertToAssets',
        args: [shares],
      });

      return {
        ok: true,
        value: assets,
      };
    } catch (e) {
      return {
        ok: false,
        error: e,
      };
    }
  }

  static async getMaxDeposit(vault: Address, receiver: Address, publicClient: PublicClient): Promise<Result<bigint>> {
    try {
      const maxDeposit = await publicClient.readContract({
        address: vault,
        abi: erc4626Abi,
        functionName: 'maxDeposit',
        args: [receiver],
      });

      return {
        ok: true,
        value: maxDeposit,
      };
    } catch (e) {
      return {
        ok: false,
        error: e,
      };
    }
  }

  static async previewDeposit(vault: Address, assets: bigint, publicClient: PublicClient): Promise<Result<bigint>> {
    try {
      const shares = await publicClient.readContract({
        address: vault,
        abi: erc4626Abi,
        functionName: 'previewDeposit',
        args: [assets],
      });

      return {
        ok: true,
        value: shares,
      };
    } catch (e) {
      return {
        ok: false,
        error: e,
      };
    }
  }

  static async deposit<R extends boolean = false>(
    vault: Address,
    assets: bigint,
    receiver: Address,
    walletProvider: IEvmWalletProvider,
    raw?: R,
  ): Promise<TxReturnType<EvmChainKey, R>> {
    const walletAddress = await walletProvider.getWalletAddress();

    const rawTx = {
      from: walletAddress,
      to: vault,
      value: 0n,
      data: encodeFunctionData({
        abi: erc4626Abi,
        functionName: 'deposit',
        args: [assets, receiver],
      }),
    } satisfies EvmReturnType<true>;

    if (raw) {
      return rawTx as EvmReturnType<R>;
    }

    return walletProvider.sendTransaction(rawTx, { expectedChainId: HUB_CHAIN_ID }) as Promise<
      TxReturnType<EvmChainKey, R>
    >;
  }

  static async getMaxMint(vault: Address, receiver: Address, publicClient: PublicClient): Promise<Result<bigint>> {
    try {
      const maxMint = await publicClient.readContract({
        address: vault,
        abi: erc4626Abi,
        functionName: 'maxMint',
        args: [receiver],
      });

      return {
        ok: true,
        value: maxMint,
      };
    } catch (e) {
      return {
        ok: false,
        error: e,
      };
    }
  }

  static async previewMint(vault: Address, shares: bigint, publicClient: PublicClient): Promise<Result<bigint>> {
    try {
      const assets = await publicClient.readContract({
        address: vault,
        abi: erc4626Abi,
        functionName: 'previewMint',
        args: [shares],
      });

      return {
        ok: true,
        value: assets,
      };
    } catch (e) {
      return {
        ok: false,
        error: e,
      };
    }
  }

  static async mint<R extends boolean = false>(
    vault: Address,
    shares: bigint,
    receiver: Address,
    walletProvider: IEvmWalletProvider,
    raw?: R,
  ): Promise<TxReturnType<EvmChainKey, R>> {
    const walletAddress = await walletProvider.getWalletAddress();

    const rawTx = {
      from: walletAddress,
      to: vault,
      value: 0n,
      data: encodeFunctionData({
        abi: erc4626Abi,
        functionName: 'mint',
        args: [shares, receiver],
      }),
    } satisfies EvmReturnType<true>;

    if (raw) {
      return rawTx as EvmReturnType<R>;
    }

    return walletProvider.sendTransaction(rawTx, { expectedChainId: HUB_CHAIN_ID }) as Promise<
      TxReturnType<EvmChainKey, R>
    >;
  }

  static async getMaxWithdraw(vault: Address, owner: Address, publicClient: PublicClient): Promise<Result<bigint>> {
    try {
      const maxWithdraw = await publicClient.readContract({
        address: vault,
        abi: erc4626Abi,
        functionName: 'maxWithdraw',
        args: [owner],
      });

      return {
        ok: true,
        value: maxWithdraw,
      };
    } catch (e) {
      return {
        ok: false,
        error: e,
      };
    }
  }

  static async previewWithdraw(vault: Address, assets: bigint, publicClient: PublicClient): Promise<Result<bigint>> {
    try {
      const shares = await publicClient.readContract({
        address: vault,
        abi: erc4626Abi,
        functionName: 'previewWithdraw',
        args: [assets],
      });

      return {
        ok: true,
        value: shares,
      };
    } catch (e) {
      return {
        ok: false,
        error: e,
      };
    }
  }

  static async withdraw<R extends boolean = false>(
    vault: Address,
    assets: bigint,
    receiver: Address,
    owner: Address,
    walletProvider: IEvmWalletProvider,
    raw?: R,
  ): Promise<TxReturnType<EvmChainKey, R>> {
    const walletAddress = await walletProvider.getWalletAddress();

    const rawTx = {
      from: walletAddress,
      to: vault,
      value: 0n,
      data: encodeFunctionData({
        abi: erc4626Abi,
        functionName: 'withdraw',
        args: [assets, receiver, owner],
      }),
    } satisfies EvmReturnType<true>;

    if (raw) {
      return rawTx as EvmReturnType<R>;
    }

    return walletProvider.sendTransaction(rawTx, { expectedChainId: HUB_CHAIN_ID }) as Promise<
      TxReturnType<EvmChainKey, R>
    >;
  }

  static async getMaxRedeem(vault: Address, owner: Address, publicClient: PublicClient): Promise<Result<bigint>> {
    try {
      const maxRedeem = await publicClient.readContract({
        address: vault,
        abi: erc4626Abi,
        functionName: 'maxRedeem',
        args: [owner],
      });

      return {
        ok: true,
        value: maxRedeem,
      };
    } catch (e) {
      return {
        ok: false,
        error: e,
      };
    }
  }

  static async previewRedeem(vault: Address, shares: bigint, publicClient: PublicClient): Promise<Result<bigint>> {
    try {
      const assets = await publicClient.readContract({
        address: vault,
        abi: erc4626Abi,
        functionName: 'previewRedeem',
        args: [shares],
      });

      return {
        ok: true,
        value: assets,
      };
    } catch (e) {
      return {
        ok: false,
        error: e,
      };
    }
  }

  static async redeem<R extends boolean = false>(
    vault: Address,
    shares: bigint,
    receiver: Address,
    owner: Address,
    walletProvider: IEvmWalletProvider,
    raw?: R,
  ): Promise<TxReturnType<EvmChainKey, R>> {
    const walletAddress = await walletProvider.getWalletAddress();

    const rawTx = {
      from: walletAddress,
      to: vault,
      value: 0n,
      data: encodeFunctionData({
        abi: erc4626Abi,
        functionName: 'redeem',
        args: [shares, receiver, owner],
      }),
    } satisfies EvmReturnType<true>;

    if (raw) {
      return rawTx as EvmReturnType<R>;
    }

    return walletProvider.sendTransaction(rawTx, { expectedChainId: HUB_CHAIN_ID }) as Promise<
      TxReturnType<EvmChainKey, R>
    >;
  }

  public static encodeDeposit(vault: Address, assets: bigint, receiver: Address): EvmContractCall {
    return {
      address: vault,
      value: 0n,
      data: encodeFunctionData({
        abi: erc4626Abi,
        functionName: 'deposit',
        args: [assets, receiver],
      }),
    };
  }

  public static encodeMint(vault: Address, shares: bigint, receiver: Address): EvmContractCall {
    return {
      address: vault,
      value: 0n,
      data: encodeFunctionData({
        abi: erc4626Abi,
        functionName: 'mint',
        args: [shares, receiver],
      }),
    };
  }

  public static encodeWithdraw(vault: Address, assets: bigint, receiver: Address, owner: Address): EvmContractCall {
    return {
      address: vault,
      value: 0n,
      data: encodeFunctionData({
        abi: erc4626Abi,
        functionName: 'withdraw',
        args: [assets, receiver, owner],
      }),
    };
  }

  public static encodeRedeem(vault: Address, shares: bigint, receiver: Address, owner: Address): EvmContractCall {
    return {
      address: vault,
      value: 0n,
      data: encodeFunctionData({
        abi: erc4626Abi,
        functionName: 'redeem',
        args: [shares, receiver, owner],
      }),
    };
  }
}
