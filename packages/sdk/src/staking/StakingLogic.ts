import { type Address, type Hex, type PublicClient, encodeFunctionData } from 'viem';
import { stakedSodaAbi } from '../shared/abis/stakedSoda.abi.js';
import { stakingRouterAbi } from '../shared/abis/stakingRouter.abi.js';
import type { EvmContractCall, UserUnstakeInfo } from '@sodax/types';

export class StakingLogic {
  private constructor() {}

  public static async getUnstakeSodaRequests(
    stakedSoda: Address,
    user: Address,
    publicClient: PublicClient,
  ): Promise<readonly UserUnstakeInfo[]> {
    const requests = await publicClient.readContract({
      address: stakedSoda,
      abi: stakedSodaAbi,
      functionName: 'getUnstakeRequests',
      args: [user],
    });

    return requests;
  }

  static encodeDepositFor(stakedSoda: Address, account: Address, amount: bigint): EvmContractCall {
    return {
      address: stakedSoda,
      value: 0n,
      data: encodeFunctionData({
        abi: stakedSodaAbi,
        functionName: 'depositFor',
        args: [account, amount],
      }),
    };
  }

  static encodeWithdrawTo(stakedSoda: Address, account: Address, value: bigint): EvmContractCall {
    return {
      address: stakedSoda,
      value: 0n,
      data: encodeFunctionData({
        abi: stakedSodaAbi,
        functionName: 'withdrawTo',
        args: [account, value],
      }),
    };
  }

  static encodeUnstake(stakedSoda: Address, account: Address, value: bigint): EvmContractCall {
    return {
      address: stakedSoda,
      value: 0n,
      data: encodeFunctionData({
        abi: stakedSodaAbi,
        functionName: 'unstake',
        args: [account, value],
      }),
    };
  }

  static encodeCancelUnstakeSodaRequest(stakedSoda: Address, requestId: bigint): EvmContractCall {
    return {
      address: stakedSoda,
      value: 0n,
      data: encodeFunctionData({
        abi: stakedSodaAbi,
        functionName: 'cancelUnstakeRequest',
        args: [requestId],
      }),
    };
  }

  static encodeCancelUnstakeRequest(stakedSoda: Address, requestId: bigint): EvmContractCall {
    return StakingLogic.encodeCancelUnstakeSodaRequest(stakedSoda, requestId);
  }

  static encodeClaim(stakedSoda: Address, requestId: bigint): EvmContractCall {
    return {
      address: stakedSoda,
      value: 0n,
      data: encodeFunctionData({
        abi: stakedSodaAbi,
        functionName: 'claim',
        args: [requestId],
      }),
    };
  }

  public static async getXSodaTotalAssets(xSoda: Address, publicClient: PublicClient): Promise<bigint> {
    return publicClient.readContract({
      address: xSoda,
      abi: stakedSodaAbi,
      functionName: 'totalAssets',
      args: [],
    });
  }

  public static async convertSodaToXSodaShares(
    xSoda: Address,
    assets: bigint,
    publicClient: PublicClient,
  ): Promise<bigint> {
    return publicClient.readContract({
      address: xSoda,
      abi: stakedSodaAbi,
      functionName: 'convertToShares',
      args: [assets],
    });
  }

  public static async convertXSodaSharesToSoda(
    xSoda: Address,
    shares: bigint,
    publicClient: PublicClient,
  ): Promise<bigint> {
    return publicClient.readContract({
      address: xSoda,
      abi: stakedSodaAbi,
      functionName: 'convertToAssets',
      args: [shares],
    });
  }

  public static async previewXSodaDeposit(xSoda: Address, assets: bigint, publicClient: PublicClient): Promise<bigint> {
    return publicClient.readContract({
      address: xSoda,
      abi: stakedSodaAbi,
      functionName: 'previewDeposit',
      args: [assets],
    });
  }

  public static async previewXSodaMint(xSoda: Address, shares: bigint, publicClient: PublicClient): Promise<bigint> {
    return publicClient.readContract({
      address: xSoda,
      abi: stakedSodaAbi,
      functionName: 'previewMint',
      args: [shares],
    });
  }

  public static async previewXSodaWithdraw(
    xSoda: Address,
    assets: bigint,
    publicClient: PublicClient,
  ): Promise<bigint> {
    return publicClient.readContract({
      address: xSoda,
      abi: stakedSodaAbi,
      functionName: 'previewWithdraw',
      args: [assets],
    });
  }

  public static async previewXSodaRedeem(xSoda: Address, shares: bigint, publicClient: PublicClient): Promise<bigint> {
    return publicClient.readContract({
      address: xSoda,
      abi: stakedSodaAbi,
      functionName: 'previewRedeem',
      args: [shares],
    });
  }

  static encodeXSodaDeposit(xSoda: Address, assets: bigint, receiver: Address): EvmContractCall {
    return {
      address: xSoda,
      value: 0n,
      data: encodeFunctionData({
        abi: stakedSodaAbi,
        functionName: 'deposit',
        args: [assets, receiver],
      }),
    };
  }

  static encodeXSodaMint(xSoda: Address, shares: bigint, receiver: Address): EvmContractCall {
    return {
      address: xSoda,
      value: 0n,
      data: encodeFunctionData({
        abi: stakedSodaAbi,
        functionName: 'mint',
        args: [shares, receiver],
      }),
    };
  }

  static encodeXSodaWithdraw(xSoda: Address, assets: bigint, receiver: Address, owner: Address): EvmContractCall {
    return {
      address: xSoda,
      value: 0n,
      data: encodeFunctionData({
        abi: stakedSodaAbi,
        functionName: 'withdraw',
        args: [assets, receiver, owner],
      }),
    };
  }

  static encodeXSodaRedeem(xSoda: Address, shares: bigint, receiver: Address, owner: Address): EvmContractCall {
    return {
      address: xSoda,
      value: 0n,
      data: encodeFunctionData({
        abi: stakedSodaAbi,
        functionName: 'redeem',
        args: [shares, receiver, owner],
      }),
    };
  }

  /** @param amount - xSoda vault token amount, translated to 18 decimals */
  static encodeStakingRouterStake(
    stakingRouter: Address,
    amount: bigint,
    to: Address,
    minReceive: bigint,
  ): EvmContractCall {
    return {
      address: stakingRouter,
      value: 0n,
      data: encodeFunctionData({
        abi: stakingRouterAbi,
        functionName: 'stake',
        args: [amount, to, minReceive],
      }),
    };
  }

  static encodeStakingRouterUnstake(
    stakingRouter: Address,
    amount: bigint,
    minAmount: bigint,
    asset: Address,
    chainID: bigint,
    to: Hex,
  ): EvmContractCall {
    return {
      address: stakingRouter,
      value: 0n,
      data: encodeFunctionData({
        abi: stakingRouterAbi,
        functionName: 'unstake',
        args: [amount, minAmount, asset, chainID, to],
      }),
    };
  }

  public static async estimateXSodaAmount(
    stakingRouter: Address,
    amount: bigint,
    publicClient: PublicClient,
  ): Promise<readonly [bigint, bigint]> {
    return publicClient.readContract({
      address: stakingRouter,
      abi: stakingRouterAbi,
      functionName: 'estimateXSodaAmount',
      args: [amount],
    });
  }

  public static async estimateInstantUnstake(
    stakingRouter: Address,
    amount: bigint,
    publicClient: PublicClient,
  ): Promise<bigint> {
    return publicClient.readContract({
      address: stakingRouter,
      abi: stakingRouterAbi,
      functionName: 'estimateInstantUnstake',
      args: [amount],
    });
  }
}
