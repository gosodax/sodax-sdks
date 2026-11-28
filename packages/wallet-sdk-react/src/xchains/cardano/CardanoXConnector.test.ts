import { afterEach, describe, expect, it, vi } from 'vitest';
import { CardanoXConnector } from './CardanoXConnector.js';
import { CardanoXService } from './CardanoXService.js';
import { readCardanoUtxo } from './cardano-utxo.js';

/**
 * Lace injects `window.cardano.lace`, a CIP-30 wallet: `enable()` resolves to the API. These tests pin the CIP-30
 * calls and argument shapes the connector makes, and the checks on what Lace returns.
 */

// The relay's vector key hash as a mainnet enterprise address, and the same key as a testnet address.
const ADDRESS_HEX = '618b218424ad74df25d35c2ea8e094a4c5c5aeb2cbb442419331569313';
const ADDRESS = 'addr1vx9jrppy446d7fwntsh23cy55nzutt4jew6yysvnx9tfxychfqm3y';
const TESTNET_HEX = '608b218424ad74df25d35c2ea8e094a4c5c5aeb2cbb442419331569313';
const SCRIPT_HEX = '7155555555555555555555555555555555555555555555555555555555';
const SIGNED = { signature: '84a0', key: 'a401' };

function stubLace(overrides: Record<string, unknown> = {}, wallet: Record<string, unknown> = {}) {
  const api = {
    getNetworkId: vi.fn(async () => 1),
    getUsedAddresses: vi.fn(async () => [ADDRESS_HEX]),
    getChangeAddress: vi.fn(async () => ADDRESS_HEX),
    getUtxos: vi.fn(async () => [`82825820${'ab'.repeat(32)}0082581d${ADDRESS_HEX}1a02faf080`]),
    signTx: vi.fn(async (_tx: string, _partial?: boolean) => 'a100'),
    signData: vi.fn(async (_address: string, _payload: string): Promise<unknown> => SIGNED),
    submitTx: vi.fn(async (_tx: string) => 'ab'.repeat(32)),
    ...overrides,
  };
  const enable = vi.fn(async () => api);
  vi.stubGlobal('window', { cardano: { lace: { enable, isEnabled: vi.fn(async () => true), ...wallet } } });
  return { api, enable };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('CardanoXConnector — identity and detection', () => {
  it('registers as the Lace connector for the CARDANO chain type', () => {
    const c = new CardanoXConnector();

    expect(c.xChainType).toBe('CARDANO');
    expect(c.name).toBe('Lace');
    expect(c.icon).toMatch(/^data:image\/svg\+xml,/);
    expect(c.installUrl).toBe('https://www.lace.io/');
  });

  it('is installed only when Lace is injected with an enable function', () => {
    stubLace();
    expect(new CardanoXConnector().isInstalled).toBe(true);

    vi.stubGlobal('window', { cardano: { lace: {} } });
    expect(new CardanoXConnector().isInstalled).toBe(false);

    vi.stubGlobal('window', { cardano: {} });
    expect(new CardanoXConnector().isInstalled).toBe(false);

    vi.stubGlobal('window', undefined);
    expect(new CardanoXConnector().isInstalled).toBe(false);
  });
});

describe('CardanoXConnector.connect', () => {
  it("connects Lace's first used address as the bech32 account, or its change address before any is used", async () => {
    stubLace();
    expect(await new CardanoXConnector().connect()).toEqual({ address: ADDRESS, xChainType: 'CARDANO' });

    stubLace({ getUsedAddresses: vi.fn(async () => []) });
    expect((await new CardanoXConnector().connect())?.address).toBe(ADDRESS);
  });

  it('refuses a wallet on a test network, which would pay a different chain', async () => {
    stubLace({ getNetworkId: vi.fn(async () => 0) });

    await expect(new CardanoXConnector().connect()).rejects.toThrow(/switch Lace to mainnet/);
  });

  it('refuses an account that is not a mainnet key-hash payment address', async () => {
    stubLace({ getUsedAddresses: vi.fn(async () => [TESTNET_HEX]) });
    await expect(new CardanoXConnector().connect()).rejects.toThrow(/network id 0/);

    stubLace({ getUsedAddresses: vi.fn(async () => [SCRIPT_HEX]) });
    await expect(new CardanoXConnector().connect()).rejects.toThrow(/cannot sign data/);
  });

  it('explains how to install Lace when it is absent, and refuses an API missing CIP-30 methods', async () => {
    vi.stubGlobal('window', {});
    await expect(new CardanoXConnector().connect()).rejects.toThrow(/Lace is not installed/);

    vi.stubGlobal('window', { cardano: { lace: { enable: async () => ({ getNetworkId: async () => 1 }) } } });
    await expect(new CardanoXConnector().connect()).rejects.toThrow(/did not return a CIP-30 API/);
  });
});

describe('CardanoXConnector.getWallet', () => {
  it('has Lace sign a transaction in full (partialSign false) and submit it', async () => {
    const { api } = stubLace();
    const wallet = new CardanoXConnector().getWallet();

    expect(await wallet.signTx('84a5')).toBe('a100');
    expect(api.signTx).toHaveBeenCalledWith('84a5', false);
    expect(await wallet.submitTx('84a5')).toBe('ab'.repeat(32));
    expect(api.submitTx).toHaveBeenCalledWith('84a5');
  });

  it("signs data with the account's raw address bytes as hex, which is the form CIP-30 takes", async () => {
    const { api } = stubLace();
    const wallet = new CardanoXConnector().getWallet();

    expect(await wallet.signData('3078')).toEqual(SIGNED);
    expect(api.signData).toHaveBeenCalledWith(ADDRESS_HEX, '3078');
  });

  it('refuses a signData result that is not a COSE_Sign1 and COSE_Key pair', async () => {
    stubLace({ signData: vi.fn(async () => ({ signature: 'x' })) });

    await expect(new CardanoXConnector().getWallet().signData('3078')).rejects.toThrow(/malformed signData result/);
  });

  it('enables Lace only when it holds no session: after a page reload, or after disconnect', async () => {
    const { enable } = stubLace();
    const connector = new CardanoXConnector();
    const wallet = connector.getWallet();

    expect(await wallet.getAddress()).toBe(ADDRESS);
    await wallet.signTx('84a5');
    expect(enable).toHaveBeenCalledOnce();

    await connector.disconnect();
    await wallet.getAddress();
    expect(enable).toHaveBeenCalledTimes(2);
  });
});

describe('CardanoXService.getBalance', () => {
  const token = {} as never;

  it('reads the configured Koios endpoint in lovelace, and zero for an address it has never seen', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([{ balance: '42000000' }])));
    vi.stubGlobal('fetch', fetchMock);
    const service = CardanoXService.getInstance({ rpcUrl: 'https://koios.example/api/v1/' });

    expect(await service.getBalance(ADDRESS, token)).toBe(42_000_000n);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://koios.example/api/v1/address_info',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ _addresses: [ADDRESS] }) }),
    );

    fetchMock.mockResolvedValueOnce(new Response('[]'));
    expect(await service.getBalance(ADDRESS, token)).toBe(0n);
  });

  it('reads the approved Lace wallet when no endpoint is configured, and nothing when Lace has not approved the site', async () => {
    const service = CardanoXService.getInstance();
    service.rpcUrl = undefined;
    stubLace();
    // The fixture contains a single UTXO holding 50,000,000 lovelace.
    expect(await service.getBalance(ADDRESS, token)).toBe(50_000_000n);

    stubLace({}, { isEnabled: vi.fn(async () => false) });
    expect(await service.getBalance(ADDRESS, token)).toBe(0n);
  });

  it('sums only the connected address across legacy and map outputs, without reading UTXOs for any other', async () => {
    const service = CardanoXService.getInstance();
    service.rpcUrl = undefined;
    const other = `61${'12'.repeat(28)}`;
    const input = `82825820${'ab'.repeat(32)}`;
    const { api } = stubLace({
      getUsedAddresses: vi.fn(async () => [ADDRESS_HEX, other]),
      getUtxos: vi.fn(async () => [
        `${input}0082581d${ADDRESS_HEX}1903e8`,
        `${input}01bf019f1907d0a0ff00581d${ADDRESS_HEX}ff`,
        `${input}0282581d${other}190bb8`,
      ]),
    });

    expect(await service.getBalance(ADDRESS, token)).toBe(3_000n);
    expect(await service.getBalance(`0x${ADDRESS_HEX.toUpperCase()}`, token)).toBe(3_000n);

    api.getUtxos.mockClear();
    expect(await service.getBalance(other, token)).toBe(0n);
    expect(await service.getBalance(SCRIPT_HEX, token)).toBe(0n);
    expect(api.getUtxos).not.toHaveBeenCalled();
  });

  it('returns zero, not an error, when the read fails or there is no address', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500 })),
    );
    const service = CardanoXService.getInstance({ rpcUrl: 'https://koios.example/api/v1' });

    expect(await service.getBalance(ADDRESS, token)).toBe(0n);
    expect(await service.getBalance(undefined, token)).toBe(0n);
  });
});

describe('readCardanoUtxo', () => {
  const prefix = `82825820${'ab'.repeat(32)}0082581d${ADDRESS_HEX}`;

  it('reads lovelace encoded inline, as an 8-byte integer, and inside a multiasset value', () => {
    expect(readCardanoUtxo(`${prefix}0a`)).toEqual({ address: ADDRESS_HEX, lovelace: 10n });
    expect(readCardanoUtxo(`${prefix}1b0000000100000000`)).toEqual({ address: ADDRESS_HEX, lovelace: 4_294_967_296n });
    // `[lovelace, multiasset]`: a wallet holding native tokens.
    expect(readCardanoUtxo(`${prefix}821a02faf080a0`)).toEqual({ address: ADDRESS_HEX, lovelace: 50_000_000n });
  });

  it('refuses non-hex, a non-integer coin and a truncated integer rather than guess', () => {
    expect(() => readCardanoUtxo(`${prefix}not hex`)).toThrow('Invalid CIP-30 UTXO hex');
    expect(() => readCardanoUtxo(`${prefix}20`)).toThrow('Invalid CIP-30 lovelace value');
    expect(() => readCardanoUtxo(`${prefix}19ff`)).toThrow('Truncated CIP-30 CBOR');
  });
});
