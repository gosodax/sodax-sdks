import { encodeFunctionData, type Address, type PublicClient } from 'viem';
import { permit2Abi } from '../abis/permit2.abi.js';
import {
  ChainKeys,
  type EvmChainKey,
  type EvmContractCall,
  type IEvmWalletProvider,
  type Result,
  type TxReturnType,
} from '@sodax/types';
import { getEvmViemChain } from '../utils/constant-utils.js';

// Permit2 lives on the hub; refuse to broadcast from a wallet on another EVM network.
const HUB_CHAIN_ID = getEvmViemChain(ChainKeys.SONIC_MAINNET).id;

export interface PermitDetails {
  token: Address;
  amount: bigint;
  expiration: number;
  nonce: number;
}

export interface PermitSingle {
  details: PermitDetails;
  spender: Address;
  sigDeadline: bigint;
}

export interface PermitBatch {
  details: PermitDetails[];
  spender: Address;
  sigDeadline: bigint;
}

export interface AllowanceTransferDetails {
  from: Address;
  to: Address;
  amount: bigint;
  token: Address;
}

export interface TokenSpenderPair {
  token: Address;
  spender: Address;
}

export interface AllowanceInfo {
  amount: bigint;
  expiration: number;
  nonce: number;
}

export class Permit2Service {
  private constructor() {}

  static async getAllowance(
    permit2: Address,
    user: Address,
    token: Address,
    spender: Address,
    publicClient: PublicClient,
  ): Promise<Result<AllowanceInfo>> {
    try {
      const result = await publicClient.readContract({
        address: permit2,
        abi: permit2Abi,
        functionName: 'allowance',
        args: [user, token, spender],
      });

      return {
        ok: true,
        value: {
          amount: BigInt(result[0]),
          expiration: Number(result[1]),
          nonce: Number(result[2]),
        },
      };
    } catch (e) {
      return {
        ok: false,
        error: e,
      };
    }
  }

  static async isAllowanceValid(
    permit2: Address,
    user: Address,
    token: Address,
    spender: Address,
    amount: bigint,
    publicClient: PublicClient,
  ): Promise<Result<boolean>> {
    try {
      const allowanceResult = await Permit2Service.getAllowance(permit2, user, token, spender, publicClient);

      if (!allowanceResult.ok) {
        return allowanceResult;
      }

      const { amount: allowedAmount, expiration } = allowanceResult.value;
      const currentTime = Math.floor(Date.now() / 1000);

      return {
        ok: true,
        value: allowedAmount >= amount && expiration > currentTime,
      };
    } catch (e) {
      return {
        ok: false,
        error: e,
      };
    }
  }

  static async approve<R extends boolean = false>(
    srcAddress: Address,
    permit2: Address,
    token: Address,
    spender: Address,
    amount: bigint,
    expiration: number,
    walletProvider: IEvmWalletProvider,
    raw?: R,
  ): Promise<TxReturnType<EvmChainKey, R>> {
    const rawTx = {
      from: srcAddress,
      to: permit2,
      value: 0n,
      data: encodeFunctionData({
        abi: permit2Abi,
        functionName: 'approve',
        args: [token, spender, amount, expiration],
      }),
    } satisfies TxReturnType<EvmChainKey, true>;

    if (raw) {
      return rawTx as TxReturnType<EvmChainKey, R>;
    }

    return walletProvider.sendTransaction(rawTx, { expectedChainId: HUB_CHAIN_ID }) as Promise<
      TxReturnType<EvmChainKey, R>
    >;
  }

  static async permit<R extends boolean = false>(
    srcAddress: Address,
    permit2: Address,
    owner: Address,
    permitSingle: PermitSingle,
    signature: `0x${string}`,
    walletProvider: IEvmWalletProvider,
    raw?: R,
  ): Promise<TxReturnType<EvmChainKey, R>> {
    const rawTx = {
      from: srcAddress,
      to: permit2,
      value: 0n,
      data: encodeFunctionData({
        abi: permit2Abi,
        functionName: 'permit',
        args: [owner, permitSingle, signature],
      }),
    } satisfies TxReturnType<EvmChainKey, true>;

    if (raw) {
      return rawTx as TxReturnType<EvmChainKey, R>;
    }

    return walletProvider.sendTransaction(rawTx, { expectedChainId: HUB_CHAIN_ID }) as Promise<
      TxReturnType<EvmChainKey, R>
    >;
  }

  static async permitBatch<R extends boolean = false>(
    srcAddress: Address,
    permit2: Address,
    owner: Address,
    permitBatch: PermitBatch,
    signature: `0x${string}`,
    walletProvider: IEvmWalletProvider,
    raw?: R,
  ): Promise<TxReturnType<EvmChainKey, R>> {
    const rawTx = {
      from: srcAddress,
      to: permit2,
      value: 0n,
      data: encodeFunctionData({
        abi: permit2Abi,
        functionName: 'permitBatch',
        args: [owner, permitBatch, signature],
      }),
    } satisfies TxReturnType<EvmChainKey, true>;

    if (raw) {
      return rawTx as TxReturnType<EvmChainKey, R>;
    }

    return walletProvider.sendTransaction(rawTx, { expectedChainId: HUB_CHAIN_ID }) as Promise<
      TxReturnType<EvmChainKey, R>
    >;
  }

  static async transferFrom<R extends boolean = false>(
    srcAddress: Address,
    permit2: Address,
    from: Address,
    to: Address,
    amount: bigint,
    token: Address,
    walletProvider: IEvmWalletProvider,
    raw?: R,
  ): Promise<TxReturnType<EvmChainKey, R>> {
    const rawTx = {
      from: srcAddress,
      to: permit2,
      value: 0n,
      data: encodeFunctionData({
        abi: permit2Abi,
        functionName: 'transferFrom',
        args: [from, to, amount, token],
      }),
    } satisfies TxReturnType<EvmChainKey, true>;

    if (raw) {
      return rawTx as TxReturnType<EvmChainKey, R>;
    }

    return walletProvider.sendTransaction(rawTx, { expectedChainId: HUB_CHAIN_ID }) as Promise<
      TxReturnType<EvmChainKey, R>
    >;
  }

  static async transferFromBatch<R extends boolean = false>(
    srcAddress: Address,
    permit2: Address,
    transferDetails: AllowanceTransferDetails[],
    walletProvider: IEvmWalletProvider,
    raw?: R,
  ): Promise<TxReturnType<EvmChainKey, R>> {
    const rawTx = {
      from: srcAddress,
      to: permit2,
      value: 0n,
      data: encodeFunctionData({
        abi: permit2Abi,
        functionName: 'transferFromBatch',
        args: [transferDetails],
      }),
    } satisfies TxReturnType<EvmChainKey, true>;

    if (raw) {
      return rawTx as TxReturnType<EvmChainKey, R>;
    }

    return walletProvider.sendTransaction(rawTx, { expectedChainId: HUB_CHAIN_ID }) as Promise<
      TxReturnType<EvmChainKey, R>
    >;
  }

  static async lockdown<R extends boolean = false>(
    srcAddress: Address,
    permit2: Address,
    approvals: TokenSpenderPair[],
    walletProvider: IEvmWalletProvider,
    raw?: R,
  ): Promise<TxReturnType<EvmChainKey, R>> {
    const rawTx = {
      from: srcAddress,
      to: permit2,
      value: 0n,
      data: encodeFunctionData({
        abi: permit2Abi,
        functionName: 'lockdown',
        args: [approvals],
      }),
    } satisfies TxReturnType<EvmChainKey, true>;

    if (raw) {
      return rawTx as TxReturnType<EvmChainKey, R>;
    }

    return walletProvider.sendTransaction(rawTx, { expectedChainId: HUB_CHAIN_ID }) as Promise<
      TxReturnType<EvmChainKey, R>
    >;
  }

  static async invalidateNonces<R extends boolean = false>(
    srcAddress: Address,
    permit2: Address,
    token: Address,
    spender: Address,
    newNonce: number,
    walletProvider: IEvmWalletProvider,
    raw?: R,
  ): Promise<TxReturnType<EvmChainKey, R>> {
    const rawTx = {
      from: srcAddress,
      to: permit2,
      value: 0n,
      data: encodeFunctionData({
        abi: permit2Abi,
        functionName: 'invalidateNonces',
        args: [token, spender, newNonce],
      }),
    } satisfies TxReturnType<EvmChainKey, true>;

    if (raw) {
      return rawTx as TxReturnType<EvmChainKey, R>;
    }

    return walletProvider.sendTransaction(rawTx, { expectedChainId: HUB_CHAIN_ID }) as Promise<
      TxReturnType<EvmChainKey, R>
    >;
  }

  public static encodeApprove(
    permit2: Address,
    token: Address,
    spender: Address,
    amount: bigint,
    expiration: number,
  ): EvmContractCall {
    return {
      address: permit2,
      value: 0n,
      data: encodeFunctionData({
        abi: permit2Abi,
        functionName: 'approve',
        args: [token, spender, amount, expiration],
      }),
    };
  }

  public static encodePermit(
    permit2: Address,
    owner: Address,
    permitSingle: PermitSingle,
    signature: `0x${string}`,
  ): EvmContractCall {
    return {
      address: permit2,
      value: 0n,
      data: encodeFunctionData({
        abi: permit2Abi,
        functionName: 'permit',
        args: [owner, permitSingle, signature],
      }),
    };
  }

  public static encodeTransferFrom(
    permit2: Address,
    from: Address,
    to: Address,
    amount: bigint,
    token: Address,
  ): EvmContractCall {
    return {
      address: permit2,
      value: 0n,
      data: encodeFunctionData({
        abi: permit2Abi,
        functionName: 'transferFrom',
        args: [from, to, amount, token],
      }),
    };
  }

  public static encodeTransferFromBatch(
    permit2: Address,
    transferDetails: AllowanceTransferDetails[],
  ): EvmContractCall {
    return {
      address: permit2,
      value: 0n,
      data: encodeFunctionData({
        abi: permit2Abi,
        functionName: 'transferFromBatch',
        args: [transferDetails],
      }),
    };
  }
}
