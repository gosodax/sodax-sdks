import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChainNotConfiguredError } from 'wagmi';
import { TEST_ADDRESS, instantiateConnector, mainnet } from '../shared/testkit.js';
import { LedgerEvmProvider } from './LedgerEvmProvider.js';
import { ledgerConnector, ledgerEvmConnectors } from './ledgerConnector.js';

const closeMock = vi.fn();
vi.mock('./transport.js', () => ({
  createLedgerTransport: vi.fn(async () => ({ close: closeMock })),
  getEthApp: vi.fn(() => ({ getAddress: vi.fn(async () => ({ address: TEST_ADDRESS })) })),
}));

const instantiate = () => instantiateConnector(ledgerConnector());

describe('ledgerConnector', () => {
  afterEach(() => vi.clearAllMocks());

  it('exposes identity metadata', () => {
    const { connector } = instantiate();
    expect(connector.id).toBe('sodaxLedger');
    expect(connector.name).toBe('Ledger');
    expect(connector.type).toBe('ledger');
    expect(connector.icon).toContain('data:image/svg+xml');
  });

  it('connects, returning the device account and the provider', async () => {
    const { connector, emit } = instantiate();
    const result = await connector.connect({ chainId: mainnet.id });
    expect(result).toEqual({ accounts: [TEST_ADDRESS], chainId: mainnet.id });
    expect(emit).toHaveBeenCalledWith('connect', { accounts: [TEST_ADDRESS], chainId: mainnet.id });
    expect(await connector.getAccounts()).toEqual([TEST_ADDRESS]);
    expect(await connector.getProvider()).toBeInstanceOf(LedgerEvmProvider);
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

  it('disconnect closes the transport and clears state', async () => {
    const { connector } = instantiate();
    await connector.connect();
    await connector.disconnect();
    expect(closeMock).toHaveBeenCalled();
    expect(await connector.getAccounts()).toEqual([]);
  });

  it('ledgerEvmConnectors returns a single connector factory', () => {
    expect(ledgerEvmConnectors()).toHaveLength(1);
    expect(typeof ledgerEvmConnectors()[0]).toBe('function');
  });
});
