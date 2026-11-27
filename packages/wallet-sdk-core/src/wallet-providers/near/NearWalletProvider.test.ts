import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NearRawTransaction, TransferArgs } from '@sodax/types';

const signAndSendTransaction = vi.fn().mockResolvedValue({ transaction_outcome: { id: 'near-tx-id' } });
const functionCall = vi.fn().mockReturnValue({ kind: 'functionCall' });

const TRANSFER_ARGS: TransferArgs = { token: 't', to: [], amount: '0', data: [] };

vi.mock('near-api-js', () => ({
  Account: class {
    public readonly signAndSendTransaction = signAndSendTransaction;
    constructor(
      public readonly accountId: string,
      _provider: unknown,
      _signer: unknown,
    ) {}
  },
  JsonRpcProvider: class {},
  KeyPairSigner: { fromSecretKey: vi.fn().mockReturnValue({}) },
  actions: { functionCall },
}));

const { NearWalletProvider } = await import('./NearWalletProvider.js');

const RPC_URL = 'https://rpc.mainnet.near.org';
const ACCOUNT_ID = 'alice.near';
const PRIVATE_KEY = 'ed25519:abc';
const CONTRACT_ID = 'contract.near';

function makeTransaction(overrides?: Partial<{ gas: bigint; deposit: bigint }>): NearRawTransaction {
  return {
    signerId: ACCOUNT_ID,
    params: {
      contractId: CONTRACT_ID,
      method: 'do_thing',
      args: TRANSFER_ARGS,
      gas: overrides?.gas,
      deposit: overrides?.deposit,
    },
  };
}

function makeProvider(defaults?: ConstructorParameters<typeof NearWalletProvider>[0]['defaults']) {
  return new NearWalletProvider({
    rpcUrl: RPC_URL,
    accountId: ACCOUNT_ID,
    privateKey: PRIVATE_KEY,
    defaults,
  });
}

describe('NearWalletProvider', () => {
  describe('constructor', () => {
    it('initializes with private-key and browser-extension configs', () => {
      const pkProvider = makeProvider();
      expect(pkProvider.chainType).toBe('NEAR');
      expect(pkProvider.account).toBeDefined();

      // biome-ignore lint/suspicious/noExplicitAny: mocked NearConnector
      const wallet: any = { getConnectedWallet: vi.fn() };
      expect(new NearWalletProvider({ wallet }).chainType).toBe('NEAR');
    });

    it('throws on invalid config', () => {
      expect(() => new NearWalletProvider({} as never)).toThrow('Invalid Near wallet config');
    });
  });

  describe('signAndSubmitTxn — option merge (PK path)', () => {
    beforeEach(() => {
      signAndSendTransaction.mockClear();
      functionCall.mockClear();
    });

    it('resolves throwOnFailure/waitUntil: per-call options > defaults > true/FINAL', async () => {
      await makeProvider().signAndSubmitTxn(makeTransaction());
      const withDefaults = makeProvider({ throwOnFailure: false, waitUntil: 'INCLUDED' });
      await withDefaults.signAndSubmitTxn(makeTransaction());
      await withDefaults.signAndSubmitTxn(makeTransaction(), { throwOnFailure: true, waitUntil: 'EXECUTED' });

      const calls = signAndSendTransaction.mock.calls.map(([call]) => [call.throwOnFailure, call.waitUntil]);
      expect(calls).toEqual([
        [true, 'FINAL'],
        [false, 'INCLUDED'],
        [true, 'EXECUTED'],
      ]);
    });

    it('resolves functionCall gas/deposit: transaction params > defaults > undefined', async () => {
      await makeProvider().signAndSubmitTxn(makeTransaction());
      const withDefaults = makeProvider({ gasDefault: 100_000_000_000_000n, depositDefault: 7n });
      await withDefaults.signAndSubmitTxn(makeTransaction());
      await withDefaults.signAndSubmitTxn(makeTransaction({ gas: 1n, deposit: 2n }));

      // functionCall(method, args, gas, deposit)
      const gasAndDeposit = functionCall.mock.calls.map(args => [args[2], args[3]]);
      expect(gasAndDeposit).toEqual([
        [undefined, undefined],
        [100_000_000_000_000n, 7n],
        [1n, 2n],
      ]);
    });
  });
});
