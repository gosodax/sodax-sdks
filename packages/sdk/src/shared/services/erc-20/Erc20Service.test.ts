/**
 * Unit tests for the ERC-20 allowance read and the approval planner.
 *
 * `planApproval` is the behavioural detector for tokens of the 2017 TetherToken lineage, which
 * reject an allowance change from one non-zero value to another. Every row of its decision table is
 * covered, because the wrong branch either dead-ends a stuck wallet or charges an extra transaction
 * to everyone else. The probe details are asserted too — the wrong `account`, or `simulateContract`
 * instead of `call`, would make the detector silently useless against the one token it exists for.
 *
 * The public client is a plain object literal with `readContract` / `call` as `vi.fn()`, mirroring
 * the wallet-provider fixture pattern used across this package.
 */

import { describe, expect, it, vi } from 'vitest';
import { encodeFunctionData, erc20Abi, type Address, type PublicClient } from 'viem';
import { Erc20Service } from './Erc20Service.js';

const TOKEN = '0xdAC17F958D2ee523a2206206994597C13D831ec7' as Address;
const NATIVE = '0x0000000000000000000000000000000000000000' as Address;
const OWNER = '0x1111111111111111111111111111111111111111' as Address;
const SPENDER = '0x2222222222222222222222222222222222222222' as Address;
const AMOUNT = 1_550_566_800n;
const STALE_ALLOWANCE = 205_000_000n;

type FakeClient = {
  readContract: ReturnType<typeof vi.fn>;
  call: ReturnType<typeof vi.fn>;
};

function makeClient(): FakeClient {
  return { readContract: vi.fn(), call: vi.fn() };
}

function planParams(client: FakeClient, overrides: { token?: Address } = {}) {
  return {
    token: overrides.token ?? TOKEN,
    owner: OWNER,
    spender: SPENDER,
    amount: AMOUNT,
    nativeToken: NATIVE,
    publicClient: client as unknown as PublicClient,
  };
}

const approveCalldata = (amount: bigint): string =>
  encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [SPENDER, amount] });

/** The revert an ERC-20 with the race guard produces: no reason string, empty data. */
const guardRevert = (): Error => new Error('execution reverted');

describe('Erc20Service.getAllowance', () => {
  it('returns the raw allowance rather than a sufficiency verdict', async () => {
    const client = makeClient();
    client.readContract.mockResolvedValueOnce(STALE_ALLOWANCE);

    const allowance = await Erc20Service.getAllowance({
      token: TOKEN,
      owner: OWNER,
      spender: SPENDER,
      publicClient: client as unknown as PublicClient,
    });

    expect(allowance).toBe(STALE_ALLOWANCE);
    expect(client.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: TOKEN, functionName: 'allowance', args: [OWNER, SPENDER] }),
    );
  });
});

describe('Erc20Service.isAllowanceValid', () => {
  it('short-circuits the native token without reading', async () => {
    const client = makeClient();

    const result = await Erc20Service.isAllowanceValid({
      ...planParams(client, { token: NATIVE }),
      chainKey: '0xa4b1.arbitrum',
    });

    expect(result).toEqual({ ok: true, value: true });
    expect(client.readContract).not.toHaveBeenCalled();
  });

  it('compares the allowance against the amount', async () => {
    const client = makeClient();
    client.readContract.mockResolvedValueOnce(STALE_ALLOWANCE);

    const insufficient = await Erc20Service.isAllowanceValid({
      ...planParams(client),
      chainKey: '0xa4b1.arbitrum',
    });
    expect(insufficient).toEqual({ ok: true, value: false });

    client.readContract.mockResolvedValueOnce(AMOUNT);
    const sufficient = await Erc20Service.isAllowanceValid({
      ...planParams(client),
      chainKey: '0xa4b1.arbitrum',
    });
    expect(sufficient).toEqual({ ok: true, value: true });
  });

  it('surfaces a read failure as a failed Result', async () => {
    const client = makeClient();
    client.readContract.mockRejectedValueOnce(new Error('rpc down'));

    const result = await Erc20Service.isAllowanceValid({
      ...planParams(client),
      chainKey: '0xa4b1.arbitrum',
    });

    expect(result.ok).toBe(false);
  });
});

describe('Erc20Service.planApproval', () => {
  it('plans a single approve for the native token without touching the chain', async () => {
    const client = makeClient();

    const plan = await Erc20Service.planApproval(planParams(client, { token: NATIVE }));

    expect(plan).toEqual({ approveAmount: AMOUNT, reason: 'native-token' });
    expect(client.readContract).not.toHaveBeenCalled();
    expect(client.call).not.toHaveBeenCalled();
  });

  it('plans a single approve when nothing is approved yet, and never probes', async () => {
    const client = makeClient();
    client.readContract.mockResolvedValueOnce(0n);

    const plan = await Erc20Service.planApproval(planParams(client));

    expect(plan).toEqual({ approveAmount: AMOUNT, reason: 'zero-allowance' });
    // The common path must stay at one read — probing every approval would tax every caller.
    expect(client.call).not.toHaveBeenCalled();
  });

  it('keeps the single approve when the allowance cannot be read', async () => {
    const client = makeClient();
    client.readContract.mockRejectedValueOnce(new Error('rpc down'));

    const plan = await Erc20Service.planApproval(planParams(client));

    // No basis for a reset, so behaviour stays as it is today rather than costing everyone an
    // extra transaction on a transport blip.
    expect(plan).toEqual({ approveAmount: AMOUNT, reason: 'allowance-read-failed' });
    expect(client.call).not.toHaveBeenCalled();
  });

  it('plans a single approve when a stale allowance exists but the token accepts the write', async () => {
    const client = makeClient();
    client.readContract.mockResolvedValueOnce(STALE_ALLOWANCE);
    client.call.mockResolvedValueOnce({ data: '0x' });

    const plan = await Erc20Service.planApproval(planParams(client));

    expect(plan).toEqual({ approveAmount: AMOUNT, reason: 'probe-passed' });
    expect(client.call).toHaveBeenCalledTimes(1);
  });

  it('plans reset-then-approve when the token rejects a non-zero to non-zero change', async () => {
    const client = makeClient();
    client.readContract.mockResolvedValueOnce(STALE_ALLOWANCE);
    client.call.mockRejectedValueOnce(guardRevert()).mockResolvedValueOnce({ data: '0x' });

    const plan = await Erc20Service.planApproval(planParams(client));

    expect(plan).toEqual({ resetAmount: 0n, approveAmount: AMOUNT, reason: 'reset-required' });
    expect(client.call).toHaveBeenCalledTimes(2);
    expect(client.call).toHaveBeenNthCalledWith(2, expect.objectContaining({ data: approveCalldata(0n) }));
  });

  it('falls back to the single approve when approve(0) also reverts', async () => {
    const client = makeClient();
    client.readContract.mockResolvedValueOnce(STALE_ALLOWANCE);
    client.call.mockRejectedValueOnce(guardRevert()).mockRejectedValueOnce(guardRevert());

    const plan = await Erc20Service.planApproval(planParams(client));

    // A paused token or a blacklisted owner reverts on both. A reset transaction there is gas spent
    // on a certain failure, so let the real error surface from the single approve instead.
    expect(plan).toEqual({ approveAmount: AMOUNT, reason: 'reset-not-viable' });
  });

  it('probes as the owner, against the token, with the requested amount', async () => {
    const client = makeClient();
    client.readContract.mockResolvedValueOnce(STALE_ALLOWANCE);
    client.call.mockResolvedValueOnce({ data: '0x' });

    await Erc20Service.planApproval(planParams(client));

    // `account` is load-bearing: the guard reads `allowed[msg.sender][spender]`, so a probe without
    // it would never reproduce the revert.
    expect(client.call).toHaveBeenCalledWith({
      account: OWNER,
      to: TOKEN,
      data: approveCalldata(AMOUNT),
    });
  });
});

describe('Erc20Service.approve — chain binding', () => {
  // An approval must not broadcast on whatever chain the wallet happens to be on (BOT-R4/F2):
  // the option must reach the provider, whose guard refuses on mismatch.
  it('forwards expectedChainId to the wallet provider on the signed path', async () => {
    const sendTransaction = vi.fn().mockResolvedValue('0xhash');
    await Erc20Service.approve<false>({
      token: TOKEN,
      amount: AMOUNT,
      from: OWNER,
      spender: SPENDER,
      raw: false,
      walletProvider: { sendTransaction } as never,
      expectedChainId: 146,
    });

    expect(sendTransaction).toHaveBeenCalledWith(
      { from: OWNER, to: TOKEN, value: 0n, data: approveCalldata(AMOUNT) },
      { expectedChainId: 146 },
    );
  });
});
