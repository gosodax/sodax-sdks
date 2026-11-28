import { ChainKeys } from '@sodax/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RadfiSession } from './useRadfiAuth.js';
import { loadRadfiSession } from './useRadfiAuth.js';
import { resolveBtcReadAddress } from './resolveBtcReadAddress.js';

// The test env is `node` (no localStorage), so mock the session lookup to drive each branch.
vi.mock('./useRadfiAuth.js', () => ({
  loadRadfiSession: vi.fn(),
}));

const mockLoadRadfiSession = vi.mocked(loadRadfiSession);

const PERSONAL_ADDRESS = 'bc1qpersonal00000000000000000000000000000';
const TRADING_ADDRESS = 'bc1qtrading000000000000000000000000000000';

const session = (tradingAddress: string): RadfiSession => ({
  accessToken: 'access',
  refreshToken: 'refresh',
  tradingAddress,
  publicKey: 'pub',
});

describe('resolveBtcReadAddress', () => {
  beforeEach(() => {
    mockLoadRadfiSession.mockReset();
  });

  it('passes the address through unchanged for non-Bitcoin chains (no session lookup)', () => {
    const result = resolveBtcReadAddress(ChainKeys.ARBITRUM_MAINNET, PERSONAL_ADDRESS);

    expect(result).toBe(PERSONAL_ADDRESS);
    expect(mockLoadRadfiSession).not.toHaveBeenCalled();
  });

  it('returns the trading address from the local session for Bitcoin', () => {
    mockLoadRadfiSession.mockReturnValue(session(TRADING_ADDRESS));

    const result = resolveBtcReadAddress(ChainKeys.BITCOIN_MAINNET, PERSONAL_ADDRESS);

    expect(result).toBe(TRADING_ADDRESS);
    expect(mockLoadRadfiSession).toHaveBeenCalledWith(PERSONAL_ADDRESS);
  });

  it('falls back to the personal address for Bitcoin when there is no session', () => {
    mockLoadRadfiSession.mockReturnValue(null);

    const result = resolveBtcReadAddress(ChainKeys.BITCOIN_MAINNET, PERSONAL_ADDRESS);

    expect(result).toBe(PERSONAL_ADDRESS);
  });
});
