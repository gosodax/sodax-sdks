import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChainNotConfiguredError } from 'wagmi';
import { TEST_ADDRESS, instantiateConnector, mainnet } from '../shared/testkit.js';

// `vi.mock` is hoisted above top-level consts — keep mock data in `vi.hoisted`.
const trezor = vi.hoisted(() => ({
  init: vi.fn(async () => ({ success: true })),
  ethereumGetAddress: vi.fn(async () => ({
    success: true,
    payload: { address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' },
  })),
}));
vi.mock('@trezor/connect-web', () => ({ default: trezor }));

import { TrezorEvmProvider } from './TrezorEvmProvider.js';
import { trezorConnector, trezorEvmConnectors } from './trezorConnector.js';

const instantiate = () => instantiateConnector(trezorConnector());

describe('trezorConnector', () => {
  afterEach(() => vi.clearAllMocks());

  it('exposes identity metadata', () => {
    const { connector } = instantiate();
    expect(connector.id).toBe('sodaxTrezor');
    expect(connector.name).toBe('Trezor');
    expect(connector.type).toBe('trezor');
    expect(connector.icon).toContain('data:image/svg+xml');
  });

  it('initializes Trezor Connect once and connects, returning the device account', async () => {
    const { connector, emit } = instantiate();
    const result = await connector.connect({ chainId: mainnet.id });
    expect(trezor.init).toHaveBeenCalledTimes(1);
    expect(trezor.ethereumGetAddress).toHaveBeenCalledWith({ path: "m/44'/60'/0'/0/0", showOnTrezor: false });
    expect(result).toEqual({ accounts: [TEST_ADDRESS], chainId: mainnet.id });
    expect(emit).toHaveBeenCalledWith('connect', { accounts: [TEST_ADDRESS], chainId: mainnet.id });
    expect(await connector.getProvider()).toBeInstanceOf(TrezorEvmProvider);
  });

  it('never auto-reconnects (isAuthorized is false)', async () => {
    expect(await instantiate().connector.isAuthorized()).toBe(false);
  });

  it('switchChain emits change for a configured chain and rejects unknown chains', async () => {
    const { connector, emit } = instantiate();
    expect((await connector.switchChain?.({ chainId: mainnet.id }))?.id).toBe(mainnet.id);
    expect(emit).toHaveBeenCalledWith('change', { chainId: mainnet.id });
    await expect(connector.switchChain?.({ chainId: 999_999 })).rejects.toBeInstanceOf(ChainNotConfiguredError);
  });

  it('disconnect clears local state', async () => {
    const { connector } = instantiate();
    await connector.connect();
    await connector.disconnect();
    expect(await connector.getAccounts()).toEqual([]);
  });

  it('trezorEvmConnectors returns a single connector factory', () => {
    expect(trezorEvmConnectors()).toHaveLength(1);
    expect(typeof trezorEvmConnectors()[0]).toBe('function');
  });
});
