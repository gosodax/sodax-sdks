import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChainKeys, spokeChainConfig } from '@sodax/types';
import { TronXService } from './TronXService.js';

const { TRX, USDT } = spokeChainConfig[ChainKeys.TRON_MAINNET].supportedTokens;
const RPC = 'https://tron.example';
// Hex forms decoded independently of the service.
const OWNER = 'TYQvjFWzc2Cnt91LXnk7UJVii3JVfSm69d';
const OWNER_HEX = '41f62fffa4d92bcdfc310dccbe943747fe8302e871';
const USDT_HEX = '41a614f803b6fd780986a42c78ec9c7f77e6ded13c';

const BALANCE_WORD = '00000000000000000000000000000000000000000000000000000000017cfb67';
// Captured from TronGrid, which hex-encodes `message` under `visible: false`: "REVERT opcode executed",
// "Smart contract is not exist." and an Error(string) revert reason ("src balance not enough").
const REVERT_MESSAGE = '524556455254206f70636f6465206578656375746564';
const NOT_A_CONTRACT = '536d61727420636f6e7472616374206973206e6f742065786973742e';
const REVERT_REASON =
  '08c379a0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000167372632062616c616e6365206e6f7420656e6f75676800000000000000000000';

type Call = { url: string; body: Record<string, unknown> };

/** Stands in for TronGrid: records each call and answers every one with `answer`. */
function stubFetch(answer: unknown): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
      return new Response(JSON.stringify(answer));
    }),
  );
  return calls;
}

const service = TronXService.getInstance({ rpcUrl: RPC });

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TronXService.getBalance — native TRX', () => {
  it('returns 0n without a network call when no address is connected', async () => {
    const calls = stubFetch({});

    expect(await service.getBalance(undefined, USDT)).toBe(0n);
    expect(calls).toHaveLength(0);
  });

  it('reads the account balance in sun', async () => {
    const calls = stubFetch({ balance: 1_500_000 });

    expect(await service.getBalance(OWNER, TRX)).toBe(1_500_000n);
    expect(calls).toEqual([{ url: `${RPC}/wallet/getaccount`, body: { address: OWNER, visible: true } }]);
  });
});

describe('TronXService.getBalance — TRC-20 owner address', () => {
  it.each([
    ['base58', OWNER],
    ['41-prefixed hex', OWNER_HEX],
    ['0x41-prefixed hex', `0x${OWNER_HEX}`],
  ])('sends a %s owner, and the contract, as 41-prefixed hex', async (_form, owner) => {
    const calls = stubFetch({ result: { result: true }, constant_result: [BALANCE_WORD] });

    expect(await service.getBalance(owner, USDT)).toBe(0x17cfb67n);
    expect(calls).toEqual([
      {
        url: `${RPC}/wallet/triggerconstantcontract`,
        body: {
          owner_address: OWNER_HEX,
          contract_address: USDT_HEX,
          function_selector: 'balanceOf(address)',
          parameter: OWNER_HEX.slice(2).padStart(64, '0'),
          visible: false,
        },
      },
    ]);
  });

  // The version and length vectors carry a valid checksum, so only that check can refuse them.
  it.each([
    ['an invalid base58 char', 'TYQvjFWzc2Cnt91LXnk7UJVii3JVfSm690', /invalid base58 char/],
    ['a typo the checksum catches', 'TYQvjFWzc2Cnt91LYnk7UJVii3JVfSm69d', /checksum/],
    ['a 0xa0 version byte', '27mXEGZqN4AE2aKFZrePPYDMTVxn79xUBir', /expected 25 bytes with 0x41 version/],
    ['26 bytes', '329ec9V5PFaK3WiLVCtuHZWDm69ADCkCuxms', /expected 25 bytes with 0x41 version/],
    ['24 bytes', '71mqsonmKMfUAKacEmoUJ4WcjNpW3VHXo', /expected 25 bytes with 0x41 version/],
    ['20-byte hex and no 41 prefix', `0x${OWNER_HEX.slice(2)}`, /invalid Tron hex address/],
  ])('refuses an owner with %s before querying the node', async (_label, owner, reason) => {
    const calls = stubFetch({ result: { result: true }, constant_result: [BALANCE_WORD] });

    expect(await service.getBalance(owner, USDT)).toBe(0n);
    expect(calls).toHaveLength(0);
    expect(console.error).toHaveBeenCalledWith(
      'Error fetching Tron balance:',
      expect.objectContaining({ message: expect.stringMatching(reason) }),
    );
  });
});

describe('TronXService.getBalance — TRC-20 read', () => {
  it.each([
    ['a balance', BALANCE_WORD, 0x17cfb67n],
    ['a zero balance', '0'.repeat(64), 0n],
  ])('parses %s from the 32-byte word and logs nothing', async (_label, word, balance) => {
    stubFetch({ result: { result: true }, constant_result: [word] });

    expect(await service.getBalance(OWNER, USDT)).toBe(balance);
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each([
    ['result.result false beside a word', { result: { result: false }, constant_result: [BALANCE_WORD] }],
    ['a validate error', { result: { code: 'CONTRACT_VALIDATE_ERROR', message: NOT_A_CONTRACT } }],
    [
      'a revert with a message',
      { result: { result: true, message: REVERT_MESSAGE }, constant_result: [REVERT_REASON] },
    ],
    ['a bare revert', { result: { result: true, message: REVERT_MESSAGE }, constant_result: [''] }],
    [
      'a revert whose data is one word',
      { result: { result: true, message: REVERT_MESSAGE }, constant_result: [BALANCE_WORD] },
    ],
    ['an empty constant_result', { result: { result: true }, constant_result: [] }],
  ])('reports %s as a failed read (0n, logged), never a parsed balance', async (_label, answer) => {
    stubFetch(answer);

    expect(await service.getBalance(OWNER, USDT)).toBe(0n);
    expect(console.error).toHaveBeenCalledWith('Error fetching Tron balance:', expect.any(Error));
  });
});
