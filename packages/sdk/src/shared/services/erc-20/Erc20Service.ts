import { encodeFunctionData, erc20Abi, type Address, type PublicClient } from 'viem';
import type {
  EvmChainKey,
  EvmContractCall,
  EvmReturnType,
  Result,
  TxReturnType,
  WalletProviderSlot,
} from '@sodax/types';

export type Erc20ApproveParams<Raw extends boolean> = {
  token: Address;
  amount: bigint;
  from: Address;
  spender: Address;
  // Refuse to broadcast when the wallet's active chain differs (see EvmSendTransactionOptions).
  expectedChainId?: number;
} & WalletProviderSlot<EvmChainKey, Raw>;

export type Erc20IsAllowanceParams<ChainKey extends EvmChainKey> = {
  token: Address;
  amount: bigint;
  owner: Address;
  spender: Address;
  chainKey: ChainKey;
  nativeToken: Address;
  publicClient: PublicClient;
};

export type Erc20GetAllowanceParams = {
  token: Address;
  owner: Address;
  spender: Address;
  publicClient: PublicClient;
};

export type Erc20PlanApprovalParams = Erc20GetAllowanceParams & {
  amount: bigint;
  nativeToken: Address;
};

/** Why {@link Erc20Service.planApproval} chose the plan it did. Diagnostic only. */
export type Erc20ApprovalPlanReason =
  | 'native-token'
  | 'zero-allowance'
  | 'probe-passed'
  | 'reset-required'
  | 'reset-not-viable'
  | 'allowance-read-failed';

export type Erc20ApprovalPlan = {
  /**
   * Set only when the token rejects a non-zero → non-zero allowance change and a stale allowance exists.
   * Always `0n`; approve it and wait for it to be mined before {@link approveAmount}.
   */
  readonly resetAmount?: bigint;
  readonly approveAmount: bigint;
  readonly reason: Erc20ApprovalPlanReason;
};

export type Erc20Token = {
  name: string;
  symbol: string;
  decimals: number;
  address: Address;
};

export class Erc20Service {
  private constructor() {}

  public static async getErc20Token(token: Address, publicClient: PublicClient): Promise<Erc20Token> {
    const [name, symbol, decimals] = await publicClient.multicall({
      contracts: [
        {
          address: token,
          abi: erc20Abi,
          functionName: 'name',
        },
        {
          address: token,
          abi: erc20Abi,
          functionName: 'symbol',
        },
        {
          address: token,
          abi: erc20Abi,
          functionName: 'decimals',
        },
      ],
      allowFailure: false,
    });

    return { name, symbol, decimals, address: token };
  }

  public static async getAllowance(params: Erc20GetAllowanceParams): Promise<bigint> {
    return params.publicClient.readContract({
      address: params.token,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [params.owner, params.spender],
    });
  }

  static async isAllowanceValid<ChainKey extends EvmChainKey>(
    params: Erc20IsAllowanceParams<ChainKey>,
  ): Promise<Result<boolean>> {
    try {
      if (params.token.toLowerCase() === params.nativeToken.toLowerCase()) {
        return {
          ok: true,
          value: true,
        };
      }

      const allowedAmount = await Erc20Service.getAllowance(params);

      return {
        ok: true,
        value: allowedAmount >= params.amount,
      };
    } catch (e) {
      return {
        ok: false,
        error: e,
      };
    }
  }

  /**
   * TetherToken-lineage tokens reject a non-zero → non-zero allowance change and need `approve(0)` first.
   * Detected behaviourally by simulating the approve (no token list); probes only run when an allowance is set.
   */
  public static async planApproval(params: Erc20PlanApprovalParams): Promise<Erc20ApprovalPlan> {
    const single = (reason: Erc20ApprovalPlanReason): Erc20ApprovalPlan => ({ approveAmount: params.amount, reason });

    if (params.token.toLowerCase() === params.nativeToken.toLowerCase()) {
      return single('native-token');
    }

    let allowance: bigint;
    try {
      allowance = await Erc20Service.getAllowance(params);
    } catch {
      // No basis for a reset: keep the single approve rather than charge an extra tx on a transport blip.
      return single('allowance-read-failed');
    }

    if (allowance === 0n) {
      return single('zero-allowance');
    }

    if (await Erc20Service.canApprove(params, params.amount)) {
      return single('probe-passed');
    }

    // A paused token or blacklisted owner reverts on `approve(0)` too; let the real error surface instead.
    if (!(await Erc20Service.canApprove(params, 0n))) {
      return single('reset-not-viable');
    }

    return { resetAmount: 0n, approveAmount: params.amount, reason: 'reset-required' };
  }

  /**
   * `call`, not `simulateContract`: TetherToken-lineage `approve` returns no value, so ABI decoding would fail.
   * `account` is required because the guard reads `allowed[msg.sender][spender]`.
   */
  private static async canApprove(params: Erc20PlanApprovalParams, amount: bigint): Promise<boolean> {
    const { data } = Erc20Service.encodeApprove(params.token, params.spender, amount);

    try {
      await params.publicClient.call({ account: params.owner, to: params.token, data });
      return true;
    } catch {
      return false;
    }
  }

  static async approve<Raw extends boolean>(params: Erc20ApproveParams<Raw>): Promise<TxReturnType<EvmChainKey, Raw>> {
    const rawTx = {
      from: params.from,
      to: params.token,
      value: 0n,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [params.spender, params.amount],
      }),
    } satisfies EvmReturnType<true>;

    if (params.raw) {
      return rawTx satisfies TxReturnType<EvmChainKey, true> as TxReturnType<EvmChainKey, Raw>;
    }

    return (await params.walletProvider.sendTransaction(rawTx, {
      expectedChainId: params.expectedChainId,
    })) satisfies TxReturnType<EvmChainKey, false> as TxReturnType<EvmChainKey, Raw>;
  }

  public static encodeTransfer(token: Address, to: Address, amount: bigint): EvmContractCall {
    return {
      address: token,
      value: 0n,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'transfer',
        args: [to, amount],
      }),
    };
  }

  public static encodeTransferFrom(token: Address, from: Address, to: Address, amount: bigint): EvmContractCall {
    return {
      address: token,
      value: 0n,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'transferFrom',
        args: [from, to, amount],
      }),
    };
  }

  public static encodeApprove(token: Address, to: Address, amount: bigint): EvmContractCall {
    return {
      address: token,
      value: 0n,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [to, amount],
      }),
    };
  }
}
