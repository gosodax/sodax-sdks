/**
 * Tests for `SpokeService`: ERC-20 approval execution, and the chain-agnostic balance router
 * (`getWalletBalance` / `getWalletBalances`).
 *
 * Approval tests: a token of the 2017 TetherToken lineage rejects an allowance change from one
 * non-zero value to another, so a stale allowance has to be zeroed first. The two transactions
 * cannot be batched: the second is only valid once the first has been mined. What matters here is
 * the ordering and the abort — sending the second approve after an unconfirmed reset produces a
 * revert the user pays for. Follows the fixture pattern used by the feature-service tests: one real
 * `Sodax` instance, with the static `Erc20Service` collaborators and the receipt wait stubbed per
 * test.
 *
 * Balance router tests: these mirror the `getDeposit` router: they dispatch by chain type to the
 * per-chain spoke service and translate a thrown error into an unsuccessful `Result` instead of
 * propagating it. Per-chain read behaviour is covered by each `*SpokeService.test.ts`; here we only
 * assert routing, the chain-key guard, and the Result contract, so the target service method is
 * spied. Both routers hand-duplicate the same 10-arm switch, so the dispatch table below asserts not
 * just that the right service was called but that no OTHER service was — a copy-paste slip between
 * two arms is otherwise invisible.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ChainKeys,
  spokeChainConfig,
  type Address,
  type Hex,
  type IconAddress,
  type IEvmWalletProvider,
  type SpokeChainKey,
  type XToken,
} from '@sodax/types';
import { Sodax } from '../../entities/Sodax.js';
import { Erc20Service } from '../erc-20/Erc20Service.js';
import type { WalletBalanceMap } from './balance-utils.js';

const sodax = new Sodax();
const spoke = sodax.spoke;

afterEach(() => {
  vi.restoreAllMocks();
});

// =========================================================================
// 1. SpokeService.approve / buildApproveTxs — sequential plan execution
// =========================================================================

const ARBITRUM = '0xa4b1.arbitrum' satisfies SpokeChainKey;
const TOKEN = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9' as Address;
const OWNER = '0x1111111111111111111111111111111111111111' as Address;
const SPENDER = '0x2222222222222222222222222222222222222222' as Address;
const AMOUNT = 1_000n;

const RESET_HASH = '0xaaaa000000000000000000000000000000000000000000000000000000000001' as Hex;
const APPROVE_HASH = '0xbbbb000000000000000000000000000000000000000000000000000000000002' as Hex;

const walletProvider = {
  chainType: 'EVM',
  sendTransaction: vi.fn(),
  getWalletAddress: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
} as unknown as IEvmWalletProvider;

const approveInput = {
  srcChainKey: ARBITRUM,
  token: TOKEN,
  amount: AMOUNT,
  owner: OWNER,
  spender: SPENDER,
} as const;

/** `waitForTxReceipt` never throws — it reports the outcome in `value.status`. */
function receipt(status: 'success' | 'failure' | 'timeout') {
  return status === 'success'
    ? { ok: true as const, value: { status, receipt: {} } }
    : { ok: true as const, value: { status, error: new Error(status) } };
}

// Test files are outside `checkTs` (tsconfig excludes `**/*.test.ts`), so the plan shape is spelled
// out here: `resetAmount` present means the token needs its stale allowance zeroed first.
const stubPlan = (plan: { resetAmount?: bigint; approveAmount: bigint }, reason = 'reset-required') =>
  vi.spyOn(Erc20Service, 'planApproval').mockResolvedValue({
    ...plan,
    reason: reason as Awaited<ReturnType<typeof Erc20Service.planApproval>>['reason'],
  });

describe('SpokeService.approve — sequential plan execution', () => {
  it('zeroes the allowance, waits for it, then approves and returns the last hash', async () => {
    stubPlan({ resetAmount: 0n, approveAmount: AMOUNT });
    const approve = vi
      .spyOn(Erc20Service, 'approve')
      .mockResolvedValueOnce(RESET_HASH)
      .mockResolvedValueOnce(APPROVE_HASH);
    const wait = vi.spyOn(sodax.spoke, 'waitForTxReceipt').mockResolvedValue(receipt('success'));

    const result = await sodax.spoke.approve({ ...approveInput, raw: false, walletProvider });

    expect(result).toEqual({ ok: true, value: APPROVE_HASH });
    expect(approve).toHaveBeenCalledTimes(2);
    expect(approve.mock.calls[0]?.[0]).toMatchObject({ amount: 0n, spender: SPENDER, from: OWNER });
    expect(approve.mock.calls[1]?.[0]).toMatchObject({ amount: AMOUNT });
    // The reset has to be on-chain before the second approve is even valid.
    expect(wait).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledWith({ txHash: RESET_HASH, chainKey: ARBITRUM });
  });

  it.each([
    'failure',
    'timeout',
  ] as const)('does not send the second approve when the reset ends in %s', async status => {
    stubPlan({ resetAmount: 0n, approveAmount: AMOUNT });
    const approve = vi.spyOn(Erc20Service, 'approve').mockResolvedValueOnce(RESET_HASH);
    vi.spyOn(sodax.spoke, 'waitForTxReceipt').mockResolvedValue(receipt(status));

    const result = await sodax.spoke.approve({ ...approveInput, raw: false, walletProvider });

    expect(result.ok).toBe(false);
    expect(approve).toHaveBeenCalledTimes(1);
    if (!result.ok) {
      // The message has to name the hash and say a retry is cheap: once the reset lands the next
      // plan is a single transaction, so the flow self-heals.
      expect(String((result.error as Error).message)).toContain(RESET_HASH);
    }
  });

  it('sends one transaction and never waits when no reset is needed', async () => {
    stubPlan({ approveAmount: AMOUNT }, 'zero-allowance');
    const approve = vi.spyOn(Erc20Service, 'approve').mockResolvedValueOnce(APPROVE_HASH);
    const wait = vi.spyOn(sodax.spoke, 'waitForTxReceipt');

    const result = await sodax.spoke.approve({ ...approveInput, raw: false, walletProvider });

    expect(result).toEqual({ ok: true, value: APPROVE_HASH });
    expect(approve).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it('leaves the unsigned path alone — one transaction, no planning', async () => {
    const plan = vi.spyOn(Erc20Service, 'planApproval');
    const rawTx = { from: OWNER, to: TOKEN, value: 0n, data: '0x' as Hex };
    vi.spyOn(Erc20Service, 'approve').mockResolvedValueOnce(rawTx);

    const result = await sodax.spoke.approve({ ...approveInput, raw: true });

    expect(result).toEqual({ ok: true, value: rawTx });
    expect(plan).not.toHaveBeenCalled();
  });
});

describe('SpokeService.buildApproveTxs', () => {
  it('names the reset separately from the approve when the token needs one', async () => {
    stubPlan({ resetAmount: 0n, approveAmount: AMOUNT });
    const resetTx = { from: OWNER, to: TOKEN, value: 0n, data: '0xreset' as Hex };
    const approveTx = { from: OWNER, to: TOKEN, value: 0n, data: '0xapprove' as Hex };
    vi.spyOn(Erc20Service, 'approve').mockResolvedValueOnce(resetTx).mockResolvedValueOnce(approveTx);

    const result = await sodax.spoke.buildApproveTxs({ ...approveInput, raw: true });

    expect(result).toEqual({ ok: true, value: { resetTx, approveTx } });
  });

  it('omits resetTx entirely when the token does not need one', async () => {
    stubPlan({ approveAmount: AMOUNT }, 'zero-allowance');
    const approveTx = { from: OWNER, to: TOKEN, value: 0n, data: '0xapprove' as Hex };
    vi.spyOn(Erc20Service, 'approve').mockResolvedValueOnce(approveTx);

    const result = await sodax.spoke.buildApproveTxs({ ...approveInput, raw: true });

    expect(result).toEqual({ ok: true, value: { approveTx } });
  });

  it('returns the Stellar trustline as the approve, with no reset', async () => {
    const plan = vi.spyOn(Erc20Service, 'planApproval');
    const trustlineTx = { unsignedTx: 'AAAA...' };
    const requestTrustline = vi.spyOn(sodax.spoke.stellar, 'requestTrustline').mockResolvedValue(trustlineTx as never);

    const result = await sodax.spoke.buildApproveTxs({
      srcChainKey: 'stellar' satisfies SpokeChainKey,
      token: 'CBIELTK6...' as unknown as Address,
      amount: AMOUNT,
      owner: 'GBIELTK6...' as unknown as Address,
      raw: true,
    });

    // Stellar approves by adding a trustline, which is always one transaction — the ERC-20 planner
    // must not run for it.
    expect(result).toEqual({ ok: true, value: { approveTx: trustlineTx } });
    expect(requestTrustline).toHaveBeenCalledTimes(1);
    expect(plan).not.toHaveBeenCalled();
  });

  it('forces raw even when the caller says otherwise', async () => {
    const requestTrustline = vi
      .spyOn(sodax.spoke.stellar, 'requestTrustline')
      .mockResolvedValue({ unsignedTx: 'AAAA...' } as never);

    // TypeScript rejects `raw: false` here, so this is the JavaScript caller the cast stands in for.
    // It matters because `requestTrustline` reads `raw` at runtime: were the value passed through,
    // a method named "build" would sign and broadcast a real transaction.
    await sodax.spoke.buildApproveTxs({
      srcChainKey: 'stellar' satisfies SpokeChainKey,
      token: 'CBIELTK6...' as unknown as Address,
      amount: AMOUNT,
      owner: 'GBIELTK6...' as unknown as Address,
      raw: false,
      walletProvider: {},
    } as never);

    expect(requestTrustline).toHaveBeenCalledWith(expect.objectContaining({ raw: true }));
  });
});

// =========================================================================
// 2. Balance router — every chain-type arm of both routers
// =========================================================================

const ARB = ChainKeys.ARBITRUM_MAINNET;
const SRC: Address = '0x1111111111111111111111111111111111111111';

const xtoken = (address: Address): XToken => ({
  symbol: 'TKN',
  name: 'TKN',
  decimals: 18,
  address,
  chainKey: ARB,
  hubAsset: address,
  vault: address,
});

/** First real token of a chain, so the router's `token.chainKey === srcChainKey` guard passes. */
const firstToken = (chainKey: keyof typeof spokeChainConfig): XToken => {
  const token = Object.values(spokeChainConfig[chainKey].supportedTokens)[0];
  if (!token) throw new Error(`no supported tokens configured for ${chainKey}`);
  return token;
};

/**
 * One spy pair per chain service, so a route can assert the other nine stayed untouched. Every spy
 * is stubbed: an un-stubbed `spyOn` calls through, and these methods open real RPC connections.
 */
const stub = <S extends { getWalletBalance: unknown; getWalletBalances: unknown }>(service: S) =>
  [
    vi.spyOn(service as { getWalletBalance: () => Promise<bigint> }, 'getWalletBalance').mockResolvedValue(0n),
    vi
      .spyOn(service as { getWalletBalances: () => Promise<WalletBalanceMap> }, 'getWalletBalances')
      .mockResolvedValue({}),
  ] as const;

const spyEveryService = () => ({
  evm: stub(spoke.evm),
  sonic: stub(spoke.sonic),
  injective: stub(spoke.injective),
  icon: stub(spoke.icon),
  sui: stub(spoke.sui),
  solana: stub(spoke.solana),
  stellar: stub(spoke.stellar),
  bitcoin: stub(spoke.bitcoin),
  near: stub(spoke.near),
  stacks: stub(spoke.stacks),
});

type ServiceName = keyof ReturnType<typeof spyEveryService>;

// `srcAddress` is typed per chain family by `GetAddressType`; each row supplies a value of the
// declared type. (Solana, Stellar, Sui and NEAR declare `Hex`/`Address` even though their real
// addresses are not 0x-prefixed — a pre-existing type wart, harmless here because the per-chain
// service is spied and never parses the value.)
const ROUTES: readonly {
  service: ServiceName;
  callOne: () => Promise<unknown>;
  callMany: () => Promise<unknown>;
}[] = [
  {
    // Sonic is also an EVM chain, so the hub short-circuit must win over the EVM arm.
    service: 'sonic',
    callOne: () =>
      spoke.getWalletBalance({
        srcChainKey: ChainKeys.SONIC_MAINNET,
        srcAddress: SRC,
        token: firstToken(ChainKeys.SONIC_MAINNET),
      }),
    callMany: () =>
      spoke.getWalletBalances({
        srcChainKey: ChainKeys.SONIC_MAINNET,
        srcAddress: SRC,
        tokens: [firstToken(ChainKeys.SONIC_MAINNET)],
      }),
  },
  {
    service: 'evm',
    callOne: () => spoke.getWalletBalance({ srcChainKey: ARB, srcAddress: SRC, token: firstToken(ARB) }),
    callMany: () => spoke.getWalletBalances({ srcChainKey: ARB, srcAddress: SRC, tokens: [firstToken(ARB)] }),
  },
  {
    service: 'injective',
    callOne: () =>
      spoke.getWalletBalance({
        srcChainKey: ChainKeys.INJECTIVE_MAINNET,
        srcAddress: 'inj1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
        token: firstToken(ChainKeys.INJECTIVE_MAINNET),
      }),
    callMany: () =>
      spoke.getWalletBalances({
        srcChainKey: ChainKeys.INJECTIVE_MAINNET,
        srcAddress: 'inj1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
        tokens: [firstToken(ChainKeys.INJECTIVE_MAINNET)],
      }),
  },
  {
    service: 'stellar',
    callOne: () =>
      spoke.getWalletBalance({
        srcChainKey: ChainKeys.STELLAR_MAINNET,
        srcAddress: SRC as Hex,
        token: firstToken(ChainKeys.STELLAR_MAINNET),
      }),
    callMany: () =>
      spoke.getWalletBalances({
        srcChainKey: ChainKeys.STELLAR_MAINNET,
        srcAddress: SRC as Hex,
        tokens: [firstToken(ChainKeys.STELLAR_MAINNET)],
      }),
  },
  {
    service: 'sui',
    callOne: () =>
      spoke.getWalletBalance({
        srcChainKey: ChainKeys.SUI_MAINNET,
        srcAddress: SRC as Hex,
        token: firstToken(ChainKeys.SUI_MAINNET),
      }),
    callMany: () =>
      spoke.getWalletBalances({
        srcChainKey: ChainKeys.SUI_MAINNET,
        srcAddress: SRC as Hex,
        tokens: [firstToken(ChainKeys.SUI_MAINNET)],
      }),
  },
  {
    service: 'icon',
    callOne: () =>
      spoke.getWalletBalance({
        srcChainKey: ChainKeys.ICON_MAINNET,
        srcAddress: 'hx0000000000000000000000000000000000000001' as IconAddress,
        token: firstToken(ChainKeys.ICON_MAINNET),
      }),
    callMany: () =>
      spoke.getWalletBalances({
        srcChainKey: ChainKeys.ICON_MAINNET,
        srcAddress: 'hx0000000000000000000000000000000000000001' as IconAddress,
        tokens: [firstToken(ChainKeys.ICON_MAINNET)],
      }),
  },
  {
    service: 'solana',
    callOne: () =>
      spoke.getWalletBalance({
        srcChainKey: ChainKeys.SOLANA_MAINNET,
        srcAddress: SRC as Hex,
        token: firstToken(ChainKeys.SOLANA_MAINNET),
      }),
    callMany: () =>
      spoke.getWalletBalances({
        srcChainKey: ChainKeys.SOLANA_MAINNET,
        srcAddress: SRC as Hex,
        tokens: [firstToken(ChainKeys.SOLANA_MAINNET)],
      }),
  },
  {
    service: 'stacks',
    callOne: () =>
      spoke.getWalletBalance({
        srcChainKey: ChainKeys.STACKS_MAINNET,
        srcAddress: 'SP000000000000000000002Q6VF78',
        token: firstToken(ChainKeys.STACKS_MAINNET),
      }),
    callMany: () =>
      spoke.getWalletBalances({
        srcChainKey: ChainKeys.STACKS_MAINNET,
        srcAddress: 'SP000000000000000000002Q6VF78',
        tokens: [firstToken(ChainKeys.STACKS_MAINNET)],
      }),
  },
  {
    service: 'bitcoin',
    callOne: () =>
      spoke.getWalletBalance({
        srcChainKey: ChainKeys.BITCOIN_MAINNET,
        srcAddress: 'bc1q5q3xczsl9zlt0gjys5khjknfp40zfdmkme9ene',
        token: firstToken(ChainKeys.BITCOIN_MAINNET),
      }),
    callMany: () =>
      spoke.getWalletBalances({
        srcChainKey: ChainKeys.BITCOIN_MAINNET,
        srcAddress: 'bc1q5q3xczsl9zlt0gjys5khjknfp40zfdmkme9ene',
        tokens: [firstToken(ChainKeys.BITCOIN_MAINNET)],
      }),
  },
  {
    service: 'near',
    callOne: () =>
      spoke.getWalletBalance({
        srcChainKey: ChainKeys.NEAR_MAINNET,
        srcAddress: SRC,
        token: firstToken(ChainKeys.NEAR_MAINNET),
      }),
    callMany: () =>
      spoke.getWalletBalances({
        srcChainKey: ChainKeys.NEAR_MAINNET,
        srcAddress: SRC,
        tokens: [firstToken(ChainKeys.NEAR_MAINNET)],
      }),
  },
];

describe.each(ROUTES)('SpokeService balance router → spoke.$service', ({ service, callOne, callMany }) => {
  it('getWalletBalance dispatches to that service and no other', async () => {
    const spies = spyEveryService();

    await callOne();

    for (const [name, [one]] of Object.entries(spies) as [ServiceName, (typeof spies)[ServiceName]][]) {
      expect(one, `spoke.${name}.getWalletBalance`).toHaveBeenCalledTimes(name === service ? 1 : 0);
    }
  });

  it('getWalletBalances dispatches to that service and no other', async () => {
    const spies = spyEveryService();

    await callMany();

    for (const [name, [, many]] of Object.entries(spies) as [ServiceName, (typeof spies)[ServiceName]][]) {
      expect(many, `spoke.${name}.getWalletBalances`).toHaveBeenCalledTimes(name === service ? 1 : 0);
    }
  });
});

describe('SpokeService.getWalletBalance (chain-agnostic router)', () => {
  it("routes to the chain-type's spoke service and wraps the value in a Result", async () => {
    const spy = vi.spyOn(spoke.evm, 'getWalletBalance').mockResolvedValueOnce(4_200n);
    const params = { srcChainKey: ARB, srcAddress: SRC, token: xtoken(SRC) };

    const result = await spoke.getWalletBalance(params);

    expect(result).toEqual({ ok: true, value: 4_200n });
    expect(spy).toHaveBeenCalledWith(params);
  });

  it('wraps a thrown error in an unsuccessful Result instead of throwing', async () => {
    const boom = new Error('rpc down');
    vi.spyOn(spoke.evm, 'getWalletBalance').mockRejectedValueOnce(boom);

    const result = await spoke.getWalletBalance({ srcChainKey: ARB, srcAddress: SRC, token: xtoken(SRC) });

    expect(result).toEqual({ ok: false, error: boom });
  });
});

describe('SpokeService.getWalletBalances (chain-agnostic router)', () => {
  it("routes to the chain-type's spoke service and wraps the record in a Result", async () => {
    const record = { [SRC]: 1n };
    const spy = vi.spyOn(spoke.evm, 'getWalletBalances').mockResolvedValueOnce(record);
    const params = { srcChainKey: ARB, srcAddress: SRC, tokens: [xtoken(SRC)] };

    const result = await spoke.getWalletBalances(params);

    expect(result).toEqual({ ok: true, value: record });
    expect(spy).toHaveBeenCalledWith(params);
  });

  it('wraps a thrown error in an unsuccessful Result instead of throwing', async () => {
    const boom = new Error('rpc down');
    vi.spyOn(spoke.evm, 'getWalletBalances').mockRejectedValueOnce(boom);

    const result = await spoke.getWalletBalances({ srcChainKey: ARB, srcAddress: SRC, tokens: [xtoken(SRC)] });

    expect(result).toEqual({ ok: false, error: boom });
  });
});
