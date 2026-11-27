import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const transactionCall = vi.fn();
const transactionLookup = vi.fn().mockReturnValue({ call: transactionCall });
const transactions = vi.fn().mockReturnValue({ transaction: transactionLookup });
const sorobanSendTransaction = vi.fn();
const fromXDR = vi.fn().mockReturnValue({ kind: 'parsed-tx' });
const sorobanServerUrls: string[] = [];

vi.mock('@stellar/stellar-sdk', () => ({
  Networks: { TESTNET: 'TESTNET_PASS', PUBLIC: 'PUBLIC_PASS' },
  Horizon: {
    Server: class {
      public readonly transactions = transactions;
    },
  },
  rpc: {
    Server: class {
      public readonly sendTransaction = sorobanSendTransaction;
      constructor(url: string) {
        sorobanServerUrls.push(url);
      }
    },
  },
  Transaction: class {
    sign() {}
    toXDR() {
      return 'signed-xdr';
    }
  },
  TransactionBuilder: {
    fromXDR,
  },
  Keypair: {
    fromSecret: vi.fn().mockReturnValue({ publicKey: () => 'GABC' }),
  },
}));

const { StellarWalletProvider, StellarWalletError } = await import('./StellarWalletProvider.js');

const PRIVATE_KEY = '0xS1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB' as `0x${string}`;
const TX_HASH = 'tx-hash-123';
const RECEIPT_RAW = { hash: TX_HASH, _links: { self: { href: 'https://h/tx' } } };

describe('StellarWalletProvider — signer selection', () => {
  it('forwards a requested address to the browser wallet, and omits it when none is named', async () => {
    // Browser wallets otherwise sign with the active account, producing valid XDR from the wrong signer.
    const signTransaction = vi.fn().mockResolvedValue({ signedTxXdr: 'signed' });
    const provider = new StellarWalletProvider({
      type: 'BROWSER_EXTENSION',
      walletsKit: { getAddress: vi.fn(), signTransaction },
      network: 'PUBLIC',
    });

    await provider.signTransaction('xdr', { address: 'GWANTED' });
    await provider.signTransaction('xdr');

    expect(signTransaction).toHaveBeenNthCalledWith(1, 'xdr', { networkPassphrase: 'PUBLIC_PASS', address: 'GWANTED' });
    expect(signTransaction).toHaveBeenNthCalledWith(2, 'xdr', { networkPassphrase: 'PUBLIC_PASS' });
  });

  it('signs with a private key only as the address that key owns', async () => {
    const provider = new StellarWalletProvider({ type: 'PRIVATE_KEY', privateKey: PRIVATE_KEY, network: 'PUBLIC' });

    await expect(provider.signTransaction('xdr', { address: 'GSOMEONEELSE' })).rejects.toThrow(StellarWalletError);
    await expect(provider.signTransaction('xdr', { address: 'GABC' })).resolves.toBeDefined();
  });
});

describe('StellarWalletProvider', () => {
  describe('waitForTransactionReceipt', () => {
    beforeEach(() => {
      transactionCall.mockReset();
      transactionLookup.mockClear();
      transactions.mockClear();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('looks up the txHash on Horizon and resolves on first call when receipt is available', async () => {
      transactionCall.mockResolvedValue(RECEIPT_RAW);
      const provider = new StellarWalletProvider({
        type: 'PRIVATE_KEY',
        privateKey: PRIVATE_KEY,
        network: 'PUBLIC',
      });

      const receipt = await provider.waitForTransactionReceipt(TX_HASH);

      expect(transactionLookup).toHaveBeenCalledWith(TX_HASH);
      expect(receipt.hash).toBe(TX_HASH);
    });

    it('per-call options.pollInterval/pollTimeout override defaults', async () => {
      vi.useFakeTimers();
      transactionCall.mockRejectedValueOnce(new Error('not found')).mockResolvedValueOnce(RECEIPT_RAW);

      const provider = new StellarWalletProvider({
        type: 'PRIVATE_KEY',
        privateKey: PRIVATE_KEY,
        network: 'PUBLIC',
        defaults: { pollInterval: 5_000, pollTimeout: 60_000 },
      });

      const promise = provider.waitForTransactionReceipt(TX_HASH, { pollInterval: 50, pollTimeout: 1_000 });
      await vi.advanceTimersByTimeAsync(75);
      await promise;

      expect(transactionCall).toHaveBeenCalledTimes(2);
    });

    it('throws TX_RECEIPT_TIMEOUT once defaults.pollTimeout elapses before receipt is available', async () => {
      vi.useFakeTimers();
      transactionCall.mockRejectedValue(new Error('not found'));

      const provider = new StellarWalletProvider({
        type: 'PRIVATE_KEY',
        privateKey: PRIVATE_KEY,
        network: 'PUBLIC',
        defaults: { pollInterval: 50, pollTimeout: 200 },
      });

      const promise = provider.waitForTransactionReceipt(TX_HASH).catch(error => error);
      await vi.advanceTimersByTimeAsync(500);
      const error = await promise;

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/Transaction receipt not found/);
    });
  });

  describe('sendTransaction — Soroban broadcast (PK path)', () => {
    beforeEach(() => {
      sorobanSendTransaction.mockReset();
    });

    it('reports SEND_TX_ERROR for an ERROR status and wraps a thrown submission error', async () => {
      const provider = new StellarWalletProvider({
        type: 'PRIVATE_KEY',
        privateKey: PRIVATE_KEY,
        network: 'PUBLIC',
      });

      sorobanSendTransaction.mockResolvedValueOnce({ status: 'ERROR', errorResult: 'bad-seq' });
      const statusError = await provider.sendTransaction('signed-xdr').catch(e => e);
      sorobanSendTransaction.mockRejectedValueOnce(new Error('network down'));
      const thrownError = await provider.sendTransaction('signed-xdr').catch(e => e);

      for (const error of [statusError, thrownError]) {
        expect(error).toBeInstanceOf(StellarWalletError);
        expect((error as InstanceType<typeof StellarWalletError>).code).toBe('SEND_TX_ERROR');
      }
      expect((thrownError as Error).message).toBe('network down');
    });
  });

  describe('signAndSendTransaction — sign then Soroban broadcast (PK path)', () => {
    beforeEach(() => {
      sorobanSendTransaction.mockReset();
      fromXDR.mockClear();
    });

    it('signs the unsigned XDR and broadcasts the signed result, returning the tx hash', async () => {
      sorobanSendTransaction.mockResolvedValue({ status: 'PENDING', hash: TX_HASH });
      const provider = new StellarWalletProvider({
        type: 'PRIVATE_KEY',
        privateKey: PRIVATE_KEY,
        network: 'PUBLIC',
      });

      const hash = await provider.signAndSendTransaction({
        from: 'GABC',
        to: 'GXYZ',
        value: 0n,
        data: 'unsigned-xdr',
      });

      expect(fromXDR).toHaveBeenCalledWith('signed-xdr', 'PUBLIC_PASS');
      expect(sorobanSendTransaction).toHaveBeenCalledTimes(1);
      expect(hash).toBe(TX_HASH);
    });
  });

  describe('Soroban server URL resolution', () => {
    it('defaults the Soroban RPC URL per network and honors an explicit sorobanRpcUrl override', () => {
      sorobanServerUrls.length = 0;

      const defaultProvider = new StellarWalletProvider({
        type: 'PRIVATE_KEY',
        privateKey: PRIVATE_KEY,
        network: 'PUBLIC',
      });
      expect(defaultProvider.chainType).toBe('STELLAR');
      expect(sorobanServerUrls).toContain('https://rpc.ankr.com/stellar_soroban');

      const customProvider = new StellarWalletProvider({
        type: 'PRIVATE_KEY',
        privateKey: PRIVATE_KEY,
        network: 'PUBLIC',
        sorobanRpcUrl: 'https://custom-soroban.example',
      });
      expect(customProvider.chainType).toBe('STELLAR');
      expect(sorobanServerUrls).toContain('https://custom-soroban.example');
    });
  });
});
