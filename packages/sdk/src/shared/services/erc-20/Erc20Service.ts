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
   * Present only when the token rejects an allowance change from one non-zero value to another and
   * a stale allowance exists. Approve this first and wait for it to be mined — {@link approveAmount}
   * is not valid until it has landed. Always `0n`; it is carried as an amount so that no caller has
   * to hardcode the constant.
   */
  readonly resetAmount?: bigint;
  /** The approval the caller actually asked for. */
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
    /**
     * Fetches the ERC20 token name, symbol, and decimals using a single multicall via viem.
     * @param token - Token contract address
     * @param publicClient - Viem PublicClient instance
     * @returns Erc20Token object containing name, symbol, and decimals
     */
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

  /**
   * Read the current on-chain allowance of `spender` over `owner`'s balance.
   * @param params - Token, owner, spender, and publicClient for the chain.
   * @returns The raw allowance.
   */
  public static async getAllowance(params: Erc20GetAllowanceParams): Promise<bigint> {
    return params.publicClient.readContract({
      address: params.token,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [params.owner, params.spender],
    });
  }

  /**
   * Check if spender has enough ERC20 allowance for given amount.
   * @param params - Token, amount, owner, spender, chainKey, and publicClient for the chain.
   * @returns Whether allowance is sufficient for the amount.
   */
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
   * Decide how many approve transactions this token needs for `amount`.
   *
   * Tokens of the 2017 TetherToken lineage reject an allowance change from one non-zero value to
   * another, so a wallet holding a stale allowance can never approve — every retry reverts the same
   * way. Such a token needs `approve(0)` first.
   *
   * Detection is behavioural: a simulated approve either reverts or it does not. That answers the
   * question that actually matters ("will this approve revert?") instead of "is this token USDT?",
   * so a token listed later, or upgraded later behind the same address, is covered without a code
   * change — and no token list is hardcoded.
   *
   * The probes only run once an allowance is already set. The common path (nothing approved yet)
   * costs a single read.
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
      // Without the current allowance there is no basis for a reset. Keep today's single-approve
      // behaviour rather than charging every caller an extra transaction on a transport blip.
      return single('allowance-read-failed');
    }

    if (allowance === 0n) {
      return single('zero-allowance');
    }

    if (await Erc20Service.canApprove(params, params.amount)) {
      return single('probe-passed');
    }

    // The approve reverted, but a reset only helps when the token accepts `approve(0)`. A paused
    // token or a blacklisted owner reverts on both, and the reset would be gas spent on a certain
    // failure — fall through to the single approve so the real error surfaces to the caller.
    if (!(await Erc20Service.canApprove(params, 0n))) {
      return single('reset-not-viable');
    }

    return { resetAmount: 0n, approveAmount: params.amount, reason: 'reset-required' };
  }

  /**
   * Simulate `approve(spender, amount)` as `owner`.
   *
   * `call` rather than `simulateContract`, because a TetherToken-lineage `approve` returns no value
   * and ABI decoding would fail even on a successful call. `account` is required: the guard reads
   * `allowed[msg.sender][spender]`.
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

  /**
   * Approve ERC20 amount spending
   * @param token - ERC20 token address
   * @param amount - Amount to approve
   * @param spender - Spender address
   * @param provider - EVM Provider
   */
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

  /**
   * Encodes a transfer transaction for a token.
   * @param token - The address of the token.
   * @param to - The address to transfer the token to.
   * @param amount - The amount of the token to transfer.
   * @returns The encoded contract call.
   */
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

  /**
   * Encodes a transferFrom transaction for a token.
   * @param token - The address of the token.
   * @param from - The address to transfer the token from.
   * @param to - The address to transfer the token to.
   * @param amount - The amount of the token to transfer.
   * @returns The encoded contract call.
   */
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

  /**
   * Encodes an approval transaction for a token.
   * @param token - The address of the token.
   * @param to - The address to approve the token to.
   * @param amount - The amount of the token to approve.
   * @returns The encoded contract call.
   */
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
