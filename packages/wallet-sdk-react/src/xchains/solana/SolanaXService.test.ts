import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { XToken } from '@sodax/types';
import { type Connection, PublicKey } from '@solana/web3.js';

// Real token-program ids so the two candidate ATAs are derived against distinct programs.
const LEGACY_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

const getAssociatedTokenAddressSync = vi.fn();
const unpackAccount = vi.fn();
const isNativeToken = vi.fn();

vi.mock('@solana/spl-token', () => ({
  TOKEN_PROGRAM_ID: LEGACY_PROGRAM,
  TOKEN_2022_PROGRAM_ID: TOKEN_2022_PROGRAM,
  getAssociatedTokenAddressSync: (...args: unknown[]) => getAssociatedTokenAddressSync(...args),
  unpackAccount: (...args: unknown[]) => unpackAccount(...args),
}));

vi.mock('@/utils/index.js', () => ({
  isNativeToken: (...args: unknown[]) => isNativeToken(...args),
}));

const { SolanaXService } = await import('./SolanaXService.js');

const OWNER = 'So11111111111111111111111111111111111111112';
const MINT = 'XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1'; // CRCLx — a real Token-2022 mint

const TOKEN: XToken = {
  symbol: 'CRCLx',
  address: MINT,
  decimals: 8,
  chainKey: 'solana',
  name: 'Circle xStock',
} as unknown as XToken;

// getBalance only forwards the AccountInfo to the mocked unpackAccount, so a tagged stub is enough.
const accountInfo = (tag: string) => ({ tag });

const token = (index: number): XToken => ({
  ...TOKEN,
  symbol: `TOKEN_${index}`,
  address: new PublicKey(Uint8Array.from({ length: 32 }, (_, byte) => (byte === 0 ? index + 1 : byte))).toBase58(),
});

// The XService singleton is module-level state — reset it between tests so a connection set in one
// test doesn't leak into the next.
function resetSingleton() {
  (SolanaXService as unknown as { instance?: unknown }).instance = undefined;
}

function makeService(connection: unknown) {
  const service = SolanaXService.getInstance();
  service.connection = connection as Connection | undefined;
  return service;
}

beforeEach(() => {
  resetSingleton();
  getAssociatedTokenAddressSync.mockReset();
  unpackAccount.mockReset();
  isNativeToken.mockReset();
  // Derive a distinct ATA per program (its 4th arg) so legacy vs Token-2022 candidates differ.
  getAssociatedTokenAddressSync.mockImplementation((_mint, _owner, _allow, programId) => programId);
});

afterEach(() => {
  resetSingleton();
});

describe('SolanaXService.getBalance', () => {
  it('returns 0n when the address is missing', async () => {
    const service = makeService({ getMultipleAccountsInfo: vi.fn() });
    expect(await service.getBalance(undefined, TOKEN)).toBe(0n);
  });

  it('returns 0n when the connection is not set', async () => {
    const service = makeService(undefined);
    expect(await service.getBalance(OWNER, TOKEN)).toBe(0n);
  });

  it('reads native SOL via connection.getBalance', async () => {
    isNativeToken.mockReturnValue(true);
    const getBalance = vi.fn().mockResolvedValue(1_500_000);
    const service = makeService({ getBalance });

    expect(await service.getBalance(OWNER, TOKEN)).toBe(1_500_000n);
    expect(getBalance).toHaveBeenCalledTimes(1);
  });

  it('reads a legacy SPL token from its legacy ATA and probes both programs', async () => {
    isNativeToken.mockReturnValue(false);
    const getMultipleAccountsInfo = vi.fn().mockResolvedValue([accountInfo('legacy'), null]);
    unpackAccount.mockReturnValueOnce({ amount: 500n });
    const service = makeService({ getMultipleAccountsInfo });

    expect(await service.getBalance(OWNER, TOKEN)).toBe(500n);
    // Both candidate ATAs are derived — legacy first, then Token-2022.
    const programs = getAssociatedTokenAddressSync.mock.calls.map(c => c[3]);
    expect(programs).toEqual([LEGACY_PROGRAM, TOKEN_2022_PROGRAM]);
  });

  it('reads a Token-2022 token from its Token-2022 ATA', async () => {
    isNativeToken.mockReturnValue(false);
    const getMultipleAccountsInfo = vi.fn().mockResolvedValue([null, accountInfo('t22')]);
    unpackAccount.mockReturnValueOnce({ amount: 229_976n });
    const service = makeService({ getMultipleAccountsInfo });

    expect(await service.getBalance(OWNER, TOKEN)).toBe(229_976n);
  });

  it('returns 0n when neither candidate ATA exists', async () => {
    isNativeToken.mockReturnValue(false);
    const getMultipleAccountsInfo = vi.fn().mockResolvedValue([null, null]);
    const service = makeService({ getMultipleAccountsInfo });

    expect(await service.getBalance(OWNER, TOKEN)).toBe(0n);
    expect(unpackAccount).not.toHaveBeenCalled();
  });

  it('skips a stray non-token account and still returns the real balance', async () => {
    isNativeToken.mockReturnValue(false);
    // A stray account sits at the legacy ATA address; the real balance lives in the Token-2022 ATA.
    const getMultipleAccountsInfo = vi.fn().mockResolvedValue([accountInfo('stray'), accountInfo('t22')]);
    unpackAccount
      .mockImplementationOnce(() => {
        throw new Error('not a token account for this program');
      })
      .mockReturnValueOnce({ amount: 100n });
    const service = makeService({ getMultipleAccountsInfo });

    expect(await service.getBalance(OWNER, TOKEN)).toBe(100n);
  });

  it('returns 0n when the RPC call throws', async () => {
    isNativeToken.mockReturnValue(false);
    const getMultipleAccountsInfo = vi.fn().mockRejectedValue(new Error('rpc down'));
    const service = makeService({ getMultipleAccountsInfo });

    expect(await service.getBalance(OWNER, TOKEN)).toBe(0n);
  });
});

describe('SolanaXService.getBalances', () => {
  it('reconstructs mixed native, legacy, and Token-2022 balances with matching programs', async () => {
    const native = { ...TOKEN, symbol: 'SOL', address: 'native' };
    const legacy = token(0);
    const token2022 = token(1);
    isNativeToken.mockImplementation(xToken => xToken === native);
    const getBalance = vi.fn().mockResolvedValue(123);
    const getMultipleAccountsInfo = vi
      .fn()
      .mockResolvedValue([accountInfo('legacy'), null, accountInfo('stray'), accountInfo('token-2022')]);
    unpackAccount.mockImplementation((_ata, info: { tag: string }, programId) => {
      if (info.tag === 'stray') throw new Error('wrong program');
      return { amount: info.tag === 'legacy' ? 10n : 20n, programId };
    });
    const service = makeService({ getBalance, getMultipleAccountsInfo });

    expect(await service.getBalances(OWNER, [native, legacy, token2022])).toEqual({
      native: 123n,
      [legacy.address]: 10n,
      [token2022.address]: 20n,
    });
    expect(getBalance).toHaveBeenCalledTimes(1);
    expect(getMultipleAccountsInfo).toHaveBeenCalledTimes(1);
    expect(getMultipleAccountsInfo.mock.calls[0]?.[0]).toHaveLength(4);
    expect(unpackAccount.mock.calls.map(call => call[2])).toEqual([LEGACY_PROGRAM, LEGACY_PROGRAM, TOKEN_2022_PROGRAM]);
  });

  it('uses exactly two RPC calls for one native plus 20 non-native tokens', async () => {
    const native = { ...TOKEN, symbol: 'SOL', address: 'native' };
    const tokens = Array.from({ length: 20 }, (_, index) => token(index));
    isNativeToken.mockImplementation(xToken => xToken === native);
    const getBalance = vi.fn().mockResolvedValue(55);
    const getMultipleAccountsInfo = vi
      .fn()
      .mockImplementation(async keys =>
        keys.map((_key: unknown, index: number) => (index % 2 === 0 ? accountInfo('legacy') : null)),
      );
    unpackAccount.mockReturnValue({ amount: 7n });
    const service = makeService({ getBalance, getMultipleAccountsInfo });

    const result = await service.getBalances(OWNER, [native, ...tokens]);

    expect(result.native).toBe(55n);
    expect(tokens.every(xToken => result[xToken.address] === 7n)).toBe(true);
    expect(getBalance).toHaveBeenCalledTimes(1);
    expect(getMultipleAccountsInfo).toHaveBeenCalledTimes(1);
    expect(getMultipleAccountsInfo.mock.calls[0]?.[0]).toHaveLength(40);
  });

  it.each([
    [50, [100]],
    [51, [100, 2]],
  ])('keeps complete token pairs within the 100-account limit for %i tokens', async (count, keyCounts) => {
    const tokens = Array.from({ length: count }, (_, index) => token(index));
    isNativeToken.mockReturnValue(false);
    const getMultipleAccountsInfo = vi
      .fn()
      .mockImplementation(async keys =>
        keys.map((_key: unknown, index: number) => (index % 2 === 0 ? accountInfo('legacy') : null)),
      );
    unpackAccount.mockReturnValue({ amount: 1n });
    const service = makeService({ getMultipleAccountsInfo, getBalance: vi.fn() });

    const result = await service.getBalances(OWNER, tokens);

    expect(getMultipleAccountsInfo.mock.calls.map(call => call[0].length)).toEqual(keyCounts);
    expect(tokens.every(xToken => result[xToken.address] === 1n)).toBe(true);
  });

  it('preserves zero fallbacks, malformed-token isolation, and input-order duplicate semantics', async () => {
    const valid = token(0);
    const malformed = { ...TOKEN, address: 'not a public key' };
    isNativeToken.mockReturnValue(false);
    const getMultipleAccountsInfo = vi
      .fn()
      .mockResolvedValue([accountInfo('first-legacy'), null, accountInfo('second-legacy'), null]);
    unpackAccount.mockReturnValueOnce({ amount: 4n }).mockReturnValueOnce({ amount: 9n });
    const service = makeService({ getMultipleAccountsInfo });

    expect(await service.getBalances(OWNER, [valid, malformed, valid])).toEqual({
      [valid.address]: 9n,
      [malformed.address]: 0n,
    });
    expect(getMultipleAccountsInfo.mock.calls[0]?.[0]).toHaveLength(4);
    expect(await makeService(undefined).getBalances(OWNER, [valid])).toEqual({ [valid.address]: 0n });
    expect(await makeService({}).getBalances(undefined, [valid])).toEqual({});
  });

  it('rejects when an account batch fails, without per-token fallback calls', async () => {
    const tokens = Array.from({ length: 51 }, (_, index) => token(index));
    isNativeToken.mockReturnValue(false);
    const getBalance = vi.fn();
    const getMultipleAccountsInfo = vi
      .fn()
      .mockRejectedValueOnce(new Error('batch RPC failed'))
      .mockResolvedValueOnce([accountInfo('legacy'), accountInfo('token-2022')]);
    unpackAccount.mockReturnValue({ amount: 3n });
    const service = makeService({ getBalance, getMultipleAccountsInfo });

    await expect(service.getBalances(OWNER, tokens)).rejects.toThrow('batch RPC failed');
    expect(getBalance).not.toHaveBeenCalled();
    expect(getMultipleAccountsInfo).toHaveBeenCalledTimes(2);
  });

  it('rejects when the native balance request fails', async () => {
    const native = { ...TOKEN, symbol: 'SOL', address: 'native' };
    const tokens = [token(0)];
    isNativeToken.mockImplementation(xToken => xToken === native);
    const getBalance = vi.fn().mockRejectedValue(new Error('native RPC failed'));
    const getMultipleAccountsInfo = vi.fn().mockResolvedValue([accountInfo('legacy'), null]);
    unpackAccount.mockReturnValue({ amount: 3n });
    const service = makeService({ getBalance, getMultipleAccountsInfo });

    await expect(service.getBalances(OWNER, [native, ...tokens])).rejects.toThrow('native RPC failed');
    expect(getBalance).toHaveBeenCalledTimes(1);
  });
});
