import { describe, it, expect, vi, beforeEach } from 'vitest';

const networkFrom = vi.fn().mockReturnValue({ client: { baseUrl: 'https://stacks.example' } });
const broadcastTransaction = vi.fn().mockResolvedValue({ txid: 'tx-123' });
const makeContractCall = vi.fn().mockResolvedValue({ kind: 'tx' });
const fetchCallReadOnlyFunction = vi.fn();
const privateKeyToPublic = vi.fn().mockReturnValue('pub');
const publicKeyToHex = vi.fn().mockReturnValue('hex');
const stacksRequest = vi.fn().mockResolvedValue({ txid: 'browser-tx-123' });
const deserializePayload = vi.fn();
const addressToString = vi.fn().mockReturnValue('SP000');

// The SUT imports from `@sodax/libs/stacks/core` and `@sodax/libs/stacks/connect` — bundled
// re-exports added to work around a Turbopack scope-hoisting cycle in Next.js 16. Mock those
// re-export modules directly; mocking the underlying `@stacks/*` packages would not intercept
// the calls the SUT actually makes.
vi.mock('@sodax/libs/stacks/core', () => ({
  networkFrom,
  broadcastTransaction,
  fetchCallReadOnlyFunction,
  getAddressFromPrivateKey: vi.fn().mockReturnValue('SP1ADDR'),
  makeContractCall,
  PostConditionMode: { Allow: 0x01, Deny: 0x02 },
  deserializePayload,
  addressToString,
  PayloadType: { ContractCall: 2 },
  privateKeyToPublic,
  publicKeyToHex,
}));

vi.mock('@sodax/libs/stacks/connect', () => ({ request: stacksRequest }));

const { StacksWalletProvider } = await import('./StacksWalletProvider.js');

const PK = 'pk';
const BROWSER_ADDRESS = 'SP1ADDR';
const TX_PARAMS_BASE = {
  contractAddress: 'SP000',
  contractName: 'my-contract',
  functionName: 'do-thing',
  functionArgs: [],
};

describe('StacksWalletProvider', () => {
  describe('constructor', () => {
    beforeEach(() => {
      networkFrom.mockClear();
    });

    it("binds the network from defaults.network, falling back to 'mainnet'", () => {
      expect(new StacksWalletProvider({ privateKey: PK }).chainType).toBe('STACKS');
      expect(networkFrom).toHaveBeenLastCalledWith('mainnet');

      new StacksWalletProvider({ address: BROWSER_ADDRESS, defaults: { network: 'testnet' } });
      expect(networkFrom).toHaveBeenLastCalledWith('testnet');
    });

    it('throws on invalid config', () => {
      expect(() => new StacksWalletProvider({} as never)).toThrow('Invalid Stacks wallet configuration');
    });
  });

  describe('sendTransaction — PK path', () => {
    beforeEach(() => {
      makeContractCall.mockClear();
      broadcastTransaction.mockClear();
    });

    it('resolves postConditionMode with tx > per-call options > defaults precedence', async () => {
      const withDefaults = new StacksWalletProvider({ privateKey: PK, defaults: { postConditionMode: 0x01 } });

      await withDefaults.sendTransaction(TX_PARAMS_BASE);
      await withDefaults.sendTransaction(TX_PARAMS_BASE, { postConditionMode: 0x02 });
      await withDefaults.sendTransaction({ ...TX_PARAMS_BASE, postConditionMode: 0x02 }, { postConditionMode: 0x01 });
      await new StacksWalletProvider({ privateKey: PK }).sendTransaction(TX_PARAMS_BASE);

      const modes = makeContractCall.mock.calls.map(([call]) => call.postConditionMode);
      expect(modes).toEqual([0x01, 0x02, 0x02, undefined]);
    });
  });

  describe('sendTransaction — browser-extension path', () => {
    beforeEach(() => {
      stacksRequest.mockClear();
      stacksRequest.mockResolvedValue({ txid: 'browser-tx-123' });
    });

    it('builds stx_callContract params from defaults, translating postConditionMode and defaulting network', async () => {
      await new StacksWalletProvider({
        address: BROWSER_ADDRESS,
        defaults: { postConditionMode: 0x01, network: 'testnet' },
      }).sendTransaction(TX_PARAMS_BASE);
      await new StacksWalletProvider({ address: BROWSER_ADDRESS }).sendTransaction(TX_PARAMS_BASE);

      const [configured, bare] = stacksRequest.mock.calls.map(([, params]) => params);
      expect(configured.postConditionMode).toBe('allow');
      expect(configured.network).toBe('testnet');
      expect(bare.network).toBe('mainnet');
    });
  });

  describe('signAndSendTransaction', () => {
    const CONTRACT_CALL_PAYLOAD = {
      payloadType: 2, // PayloadType.ContractCall
      contractAddress: { type: 'address', version: 22, hash160: 'deadbeef' },
      contractName: { content: 'my-contract' },
      functionName: { content: 'do-thing' },
      functionArgs: [],
    };

    beforeEach(() => {
      deserializePayload.mockReset().mockReturnValue(CONTRACT_CALL_PAYLOAD);
      addressToString.mockClear().mockReturnValue('SP000');
      makeContractCall.mockClear();
      broadcastTransaction.mockClear();
      stacksRequest.mockClear().mockResolvedValue({ txid: 'browser-tx-123' });
    });

    it('PK path: deserializes the payload, reconstructs the contract call, signs + broadcasts', async () => {
      const provider = new StacksWalletProvider({ privateKey: PK });

      const result = await provider.signAndSendTransaction({ payload: '0xabc' });

      expect(result).toBe('tx-123');
      expect(deserializePayload).toHaveBeenCalledWith('0xabc');
      expect(addressToString).toHaveBeenCalledWith(CONTRACT_CALL_PAYLOAD.contractAddress);
      const call = makeContractCall.mock.calls[0]?.[0];
      expect(call.contractAddress).toBe('SP000');
      expect(call.contractName).toBe('my-contract');
      expect(call.functionName).toBe('do-thing');
      expect(call.functionArgs).toEqual([]);
      expect(call.postConditionMode).toBe(0x01); // PostConditionMode.Allow
    });

    it('browser path: routes the reconstructed call through stx_callContract', async () => {
      const provider = new StacksWalletProvider({ address: BROWSER_ADDRESS });

      const result = await provider.signAndSendTransaction({ payload: '0xabc' });

      expect(result).toBe('browser-tx-123');
      const params = stacksRequest.mock.calls[0]?.[1];
      expect(params.contract).toBe('SP000.my-contract');
      expect(params.functionName).toBe('do-thing');
      expect(params.postConditionMode).toBe('allow');
    });

    it('throws when the payload is not a contract-call payload', async () => {
      deserializePayload.mockReturnValue({ payloadType: 0 }); // PayloadType.TokenTransfer
      const provider = new StacksWalletProvider({ privateKey: PK });

      await expect(provider.signAndSendTransaction({ payload: '0xabc' })).rejects.toThrow(
        'expected a contract-call payload',
      );
      expect(makeContractCall).not.toHaveBeenCalled();
    });
  });

  describe('readContract', () => {
    beforeEach(() => {
      fetchCallReadOnlyFunction.mockClear();
    });

    it('forwards txParams, the bound network and the wallet address as sender', async () => {
      fetchCallReadOnlyFunction.mockResolvedValue({ type: 'uint', value: 42n });
      const txParams = { contractAddress: 'SP1', contractName: 'token', functionName: 'get-balance', functionArgs: [] };

      const result = await new StacksWalletProvider({ privateKey: PK }).readContract(txParams);
      await new StacksWalletProvider({ address: 'SP2BROWSER' }).readContract(txParams);

      expect(result).toEqual({ type: 'uint', value: 42n });
      const [pkCall, browserCall] = fetchCallReadOnlyFunction.mock.calls.map(([call]) => call);
      expect(pkCall.contractAddress).toBe('SP1');
      expect(pkCall.contractName).toBe('token');
      expect(pkCall.functionName).toBe('get-balance');
      expect(pkCall.senderAddress).toBe('SP1ADDR');
      expect(pkCall.network).toEqual({ client: { baseUrl: 'https://stacks.example' } });
      expect(browserCall.senderAddress).toBe('SP2BROWSER');
    });
  });

  describe('getPublicKey', () => {
    beforeEach(() => {
      privateKeyToPublic.mockClear();
      publicKeyToHex.mockClear();
    });

    it('derives the hex public key from the private key, and refuses in browser-extension mode', async () => {
      expect(await new StacksWalletProvider({ privateKey: PK }).getPublicKey()).toBe('hex');
      expect(privateKeyToPublic).toHaveBeenCalledWith(PK);
      expect(publicKeyToHex).toHaveBeenCalledWith('pub');

      await expect(new StacksWalletProvider({ address: BROWSER_ADDRESS }).getPublicKey()).rejects.toThrow(
        'getPublicKey is only supported for private key wallet configuration',
      );
    });
  });

  describe('getBalance', () => {
    beforeEach(() => {
      vi.unstubAllGlobals();
    });

    it('returns the parsed micro-STX balance, or swallows a non-OK response as 0n', async () => {
      // Hush the expected `console.error` so vitest output stays clean.
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, statusText: 'OK', json: async () => ({ stx: { balance: '12345' } }) })
        .mockResolvedValueOnce({ ok: false, statusText: 'Service Unavailable', json: async () => ({}) });
      vi.stubGlobal('fetch', fetchMock);
      const provider = new StacksWalletProvider({ privateKey: PK });

      expect(await provider.getBalance('SP1ADDR')).toBe(12345n);
      expect(errSpy).not.toHaveBeenCalled();
      expect(await provider.getBalance('SP1ADDR')).toBe(0n);
      expect(errSpy).toHaveBeenCalled();
      errSpy.mockRestore();
    });
  });
});
