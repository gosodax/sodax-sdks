import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Transaction } from '@mysten/sui/transactions';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { SuiWalletProvider } from './SuiWalletProvider.js';
import type { BrowserExtensionSuiWalletConfig } from './types.js';

const TX_BYTES = new Uint8Array([1, 2, 3, 4]);
const TEST_ADDRESS = '0xabc';
const TEST_DIGEST = '0xdeadbeef';
const TEST_TOJSON = '{"version":2,"sender":"0xabc"}';
// base64 of TX_BYTES — what a wallet-standard signer returns.
const SIGNED_BYTES_B64 = 'AQIDBA==';

const simulateTransaction = vi.fn();
const signAndExecuteTransaction = vi.fn();
const executeTransaction = vi.fn();
const listCoins = vi.fn();

vi.mock('@mysten/sui/grpc', () => {
  // vitest 4 builds the instance with Reflect.construct, so a `new`-ed mock needs a class impl.
  class MockSuiGrpcClient {
    core = { simulateTransaction, signAndExecuteTransaction, executeTransaction, listCoins };
  }
  return { SuiGrpcClient: vi.fn(MockSuiGrpcClient) };
});

vi.mock('@mysten/sui/keypairs/ed25519', () => ({
  Ed25519Keypair: {
    deriveKeypair: vi.fn().mockReturnValue({ toSuiAddress: () => TEST_ADDRESS }),
  },
}));

vi.mock('@mysten/sui/transactions', () => {
  class MockTransaction {
    setSenderIfNotSet = vi.fn();
    build = vi.fn().mockResolvedValue(TX_BYTES);
    toJSON = vi.fn().mockResolvedValue(TEST_TOJSON);
    static from = vi.fn();
  }
  return { Transaction: MockTransaction };
});

const ok = (digest = TEST_DIGEST) => ({
  $kind: 'Transaction',
  Transaction: { digest, status: { success: true, error: null } },
});

const failed = (message: string) => ({
  $kind: 'FailedTransaction',
  FailedTransaction: { digest: TEST_DIGEST, status: { success: false, error: { message } } },
});

function makeProvider(defaults?: ConstructorParameters<typeof SuiWalletProvider>[0]['defaults']) {
  return new SuiWalletProvider({
    grpcUrl: 'https://fullnode.mainnet.sui.io',
    mnemonics: 'test test test test test test test test test test test junk',
    defaults,
  });
}

function makeBrowserProvider(signTransaction: BrowserExtensionSuiWalletConfig['signTransaction']) {
  return new SuiWalletProvider({
    grpcUrl: 'https://fullnode.mainnet.sui.io',
    address: TEST_ADDRESS,
    signTransaction,
  });
}

function makeTransaction(): Transaction {
  return new Transaction();
}

beforeEach(() => {
  simulateTransaction.mockReset();
  signAndExecuteTransaction.mockReset();
  executeTransaction.mockReset();
  listCoins.mockReset();
  // Default behavior: dry-run + submit succeed
  simulateTransaction.mockResolvedValue(ok());
  signAndExecuteTransaction.mockResolvedValue(ok());
  executeTransaction.mockResolvedValue(ok());
});

describe('SuiWalletProvider.signAndExecuteTxn — dry-run + submit (private-key path)', () => {
  it('builds the transaction once and submits the dry-run bytes', async () => {
    const tx = makeTransaction();
    const provider = makeProvider();

    const digest = await provider.signAndExecuteTxn(tx);

    expect(tx.setSenderIfNotSet).toHaveBeenCalledWith(TEST_ADDRESS);
    expect(tx.build).toHaveBeenCalledTimes(1);
    expect(simulateTransaction).toHaveBeenCalledWith({ transaction: TX_BYTES });
    expect(signAndExecuteTransaction).toHaveBeenCalledTimes(1);

    const submitArgs = signAndExecuteTransaction.mock.calls[0]?.[0];
    expect(submitArgs.transaction).toBe(TX_BYTES);
    expect(digest).toBe(TEST_DIGEST);
  });

  it('throws on dry-run failure without submitting', async () => {
    simulateTransaction.mockResolvedValue(failed('InsufficientGas'));
    const provider = makeProvider();

    await expect(provider.signAndExecuteTxn(makeTransaction())).rejects.toThrow(/InsufficientGas/);
    expect(signAndExecuteTransaction).not.toHaveBeenCalled();
  });

  it('throws on post-submit on-chain failure', async () => {
    signAndExecuteTransaction.mockResolvedValue(failed('MoveAbort'));
    const provider = makeProvider();

    await expect(provider.signAndExecuteTxn(makeTransaction())).rejects.toThrow(/MoveAbort/);
  });
});

describe('SuiWalletProvider — endpoint config', () => {
  it('honors the pre-gRPC `rpcUrl` name so existing private-key config keeps working', () => {
    new SuiWalletProvider({ rpcUrl: 'https://my-node.example', mnemonics: 'a b c' });

    expect(vi.mocked(SuiGrpcClient)).toHaveBeenCalledWith({
      network: 'mainnet',
      baseUrl: 'https://my-node.example',
    });
  });

  // The config union already rejects both of these at compile time; the casts stand in for an
  // untyped JS caller, where a silent wrong endpoint would be far worse than a throw.
  it('rejects passing both endpoint names instead of picking a winner', () => {
    expect(
      () =>
        new SuiWalletProvider({
          grpcUrl: 'https://a.example',
          rpcUrl: 'https://b.example',
          mnemonics: 'a b c',
          // Cast stands in for an untyped JS caller; the config union rejects this at compile time.
        } as unknown as ConstructorParameters<typeof SuiWalletProvider>[0]),
    ).toThrow(/`grpcUrl` or `rpcUrl`, not both/);
  });

  it('throws when neither endpoint field is supplied', () => {
    expect(
      // Cast stands in for an untyped JS caller; the config union rejects this at compile time.
      () =>
        new SuiWalletProvider({ mnemonics: 'a b c' } as unknown as ConstructorParameters<typeof SuiWalletProvider>[0]),
    ).toThrow(/requires a gRPC endpoint/);
  });
});

describe('SuiWalletProvider.signAndExecuteTxn — browser-extension path', () => {
  it('signs through the injected signer and broadcasts the returned bytes', async () => {
    const signTransaction = vi.fn().mockResolvedValue({ bytes: SIGNED_BYTES_B64, signature: 'sig' });
    const provider = makeBrowserProvider(signTransaction);
    const tx = makeTransaction();

    const digest = await provider.signAndExecuteTxn(tx);

    expect(signTransaction).toHaveBeenCalledWith(tx);
    expect(executeTransaction).toHaveBeenCalledWith({ transaction: TX_BYTES, signatures: ['sig'] });
    expect(digest).toBe(TEST_DIGEST);
  });

  it('reports the connected account address', async () => {
    const provider = makeBrowserProvider(vi.fn());

    await expect(provider.getWalletAddress()).resolves.toBe(TEST_ADDRESS);
  });

  it('throws on post-submit on-chain failure', async () => {
    executeTransaction.mockResolvedValue(failed('MoveAbort'));
    const provider = makeBrowserProvider(vi.fn().mockResolvedValue({ bytes: SIGNED_BYTES_B64, signature: 'sig' }));

    await expect(provider.signAndExecuteTxn(makeTransaction())).rejects.toThrow(/MoveAbort/);
  });
});

describe('SuiWalletProvider.signAndExecuteTxn — dry-run toggle (multi-step config, AC#3)', () => {
  it('skips dry-run when defaults.signAndExecuteTxn.dryRun.enabled is false', async () => {
    const provider = makeProvider({ signAndExecuteTxn: { dryRun: { enabled: false } } });

    await provider.signAndExecuteTxn(makeTransaction());

    expect(simulateTransaction).not.toHaveBeenCalled();
    expect(signAndExecuteTransaction).toHaveBeenCalledTimes(1);
  });

  it('skips dry-run when per-call options disable it', async () => {
    const provider = makeProvider();

    await provider.signAndExecuteTxn(makeTransaction(), { dryRun: { enabled: false } });

    expect(simulateTransaction).not.toHaveBeenCalled();
    expect(signAndExecuteTransaction).toHaveBeenCalledTimes(1);
  });

  it('per-call dryRun.enabled=true overrides defaults.dryRun.enabled=false', async () => {
    const provider = makeProvider({ signAndExecuteTxn: { dryRun: { enabled: false } } });

    await provider.signAndExecuteTxn(makeTransaction(), { dryRun: { enabled: true } });

    expect(simulateTransaction).toHaveBeenCalledTimes(1);
  });
});

describe('SuiWalletProvider.signAndExecuteTxn — toJSON-shape input (no unknown-as cast)', () => {
  it('reconstructs Transaction from toJSON when input is not a Transaction instance', async () => {
    const reconstructed = new Transaction();
    vi.mocked(Transaction.from).mockReturnValue(reconstructed);

    const provider = makeProvider();
    const lightTxn = { toJSON: vi.fn().mockResolvedValue(TEST_TOJSON) };

    await provider.signAndExecuteTxn(lightTxn);

    expect(lightTxn.toJSON).toHaveBeenCalledTimes(1);
    expect(Transaction.from).toHaveBeenCalledWith(TEST_TOJSON);
    expect(reconstructed.build).toHaveBeenCalledTimes(1);
  });
});

describe('SuiWalletProvider.getCoins — limit policy', () => {
  beforeEach(() => {
    listCoins.mockResolvedValue({ objects: [], hasNextPage: false, cursor: null });
  });

  it('uses default limit 10 when no defaults and no per-call options', async () => {
    const provider = makeProvider();
    await provider.getCoins(TEST_ADDRESS, '0x2::sui::SUI');

    expect(listCoins).toHaveBeenCalledWith({ owner: TEST_ADDRESS, coinType: '0x2::sui::SUI', limit: 10 });
  });

  it('applies defaults.getCoins.limit when no per-call options', async () => {
    const provider = makeProvider({ getCoins: { limit: 50 } });
    await provider.getCoins(TEST_ADDRESS, '0x2::sui::SUI');

    expect(listCoins).toHaveBeenCalledWith({ owner: TEST_ADDRESS, coinType: '0x2::sui::SUI', limit: 50 });
  });

  it('per-call limit overrides defaults', async () => {
    const provider = makeProvider({ getCoins: { limit: 50 } });
    await provider.getCoins(TEST_ADDRESS, '0x2::sui::SUI', { limit: 5 });

    expect(listCoins).toHaveBeenCalledWith({ owner: TEST_ADDRESS, coinType: '0x2::sui::SUI', limit: 5 });
  });

  it('maps the gRPC coin page onto SuiPaginatedCoins', async () => {
    listCoins.mockResolvedValue({
      objects: [{ objectId: '0xc1', version: '7', digest: 'd', balance: '100' }],
      hasNextPage: false,
      cursor: null,
    });
    const provider = makeProvider();

    await expect(provider.getCoins(TEST_ADDRESS, '0x2::sui::SUI')).resolves.toEqual({
      data: [{ balance: '100', coinObjectId: '0xc1', coinType: '0x2::sui::SUI', digest: 'd', version: '7' }],
      hasNextPage: false,
      nextCursor: null,
    });
  });
});
