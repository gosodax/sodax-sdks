import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Network } from '@injectivelabs/networks';
import type { ChainId } from '@injectivelabs/ts-types';

const msgExecuteContractFromJSON = vi.fn().mockReturnValue({ kind: 'MsgExecuteContract' });
const msgExecuteContractCompatFromJSON = vi.fn().mockReturnValue({ kind: 'MsgExecuteContractCompat' });
const createTransaction = vi
  .fn()
  .mockReturnValue({ txRaw: { bodyBytes: new Uint8Array([1]), authInfoBytes: new Uint8Array([2]) } });
const broadcastWithPk = vi.fn().mockResolvedValue({ txHash: 'pk-tx-hash', height: '100' });
const pkSign = vi.fn().mockReturnValue(new Uint8Array([7, 7]));
const grpcBroadcast = vi.fn().mockResolvedValue({ txHash: 'grpc-tx-hash', code: 0, rawLog: '' });
const txRawEncodeFinish = vi.fn().mockReturnValue(new Uint8Array([9, 9]));
const broadcastWithFeeDelegation = vi.fn().mockResolvedValue({ txHash: 'fee-deleg-tx-hash', height: '200' });
const txBodyDecode = vi.fn();
const cosmwasmMsgDecode = vi.fn();

vi.mock('@injectivelabs/sdk-ts', () => {
  class MsgBroadcasterWithPk {
    public readonly broadcast = broadcastWithPk;
    public privateKey: unknown;
    constructor({ privateKey }: { privateKey: unknown }) {
      this.privateKey = privateKey;
    }
  }
  class TxGrpcApi {
    public readonly broadcast = grpcBroadcast;
    constructor(public readonly endpoint: string) {}
  }
  return {
    MsgExecuteContract: { fromJSON: msgExecuteContractFromJSON },
    MsgExecuteContractCompat: { fromJSON: msgExecuteContractCompatFromJSON },
    createTransaction,
    PrivateKey: {
      fromPrivateKey: vi.fn().mockReturnValue({
        toAddress: () => ({ toBech32: () => 'inj1abc' }),
        toPublicKey: () => ({ toString: () => 'pubkey' }),
        sign: pkSign,
      }),
      fromMnemonic: vi.fn(),
    },
    getInjectiveSignerAddress: (s: string) => s,
    MsgBroadcasterWithPk,
    TxGrpcApi,
    fromBase64: (_s: string) => new Uint8Array([0xab]),
  };
});

// TxRaw/SignDoc/TxBody are imported directly from cosmjs-types now (not the @injectivelabs namespace re-export).
vi.mock('cosmjs-types/cosmos/tx/v1beta1/tx.js', () => ({
  TxRaw: {
    fromPartial: (x: Record<string, unknown>) => ({ __txRaw: true, ...x }),
    encode: () => ({ finish: txRawEncodeFinish }),
    decode: (bytes: Uint8Array) => ({ __decodedTxRaw: true, bytes }),
  },
  SignDoc: {
    fromPartial: (x: Record<string, unknown>) => ({ __signDoc: true, ...x }),
    encode: () => ({ finish: () => new Uint8Array([1, 2, 3]) }),
  },
  TxBody: { decode: txBodyDecode },
}));

// Decoder for the execute message embedded in the raw tx body (browser re-sign path).
vi.mock('cosmjs-types/cosmwasm/wasm/v1/tx.js', () => ({
  MsgExecuteContract: { decode: cosmwasmMsgDecode },
}));

vi.mock('@injectivelabs/networks', () => ({
  Network: { Mainnet: 'mainnet' },
  getNetworkEndpoints: () => ({ grpc: 'https://grpc.mock' }),
}));
vi.mock('@injectivelabs/wallet-core', () => ({}));
vi.mock('@injectivelabs/ts-types', () => ({}));

const { InjectiveWalletProvider } = await import('./InjectiveWalletProvider.js');

const SENDER = 'inj1abc';
const CONTRACT = 'inj1contract';
const CHAIN_ID: ChainId = 'injective-1';
const NETWORK: Network = 'mainnet';
const MSG = { foo: 'bar' };

function makeProvider(defaults?: ConstructorParameters<typeof InjectiveWalletProvider>[0]['defaults']) {
  return new InjectiveWalletProvider({
    secret: { privateKey: 'pk' },
    network: NETWORK,
    chainId: CHAIN_ID,
    defaults,
  });
}

describe('InjectiveWalletProvider', () => {
  describe('constructor', () => {
    it('initializes with secret (private key) and browser-extension configs', () => {
      const pkProvider = makeProvider();
      expect(pkProvider.chainType).toBe('INJECTIVE');
      expect(pkProvider.wallet.msgBroadcaster).toBeDefined();

      // biome-ignore lint/suspicious/noExplicitAny: mocked broadcaster
      const msgBroadcaster: any = { walletStrategy: { getAddresses: vi.fn() } };
      expect(new InjectiveWalletProvider({ msgBroadcaster }).chainType).toBe('INJECTIVE');
    });

    it('throws on invalid config', () => {
      expect(() => new InjectiveWalletProvider({} as never)).toThrow('Invalid Injective wallet config');
    });
  });

  describe('getRawTransaction — option merge', () => {
    beforeEach(() => {
      msgExecuteContractFromJSON.mockClear();
      createTransaction.mockClear();
    });

    it('resolves funds/memo/sequence/accountNumber: per-call args > defaults > empty/zero', async () => {
      await makeProvider().getRawTransaction(CHAIN_ID, '', SENDER, CONTRACT, MSG);
      const provider = makeProvider({
        defaultFunds: [{ amount: '100', denom: 'inj' }],
        defaultMemo: 'sodax-memo',
        sequence: 7,
        accountNumber: 13,
      });

      await provider.getRawTransaction(CHAIN_ID, '', SENDER, CONTRACT, MSG);
      await provider.getRawTransaction(CHAIN_ID, '', SENDER, CONTRACT, MSG, 'explicit-memo', {
        defaultFunds: [{ amount: '999', denom: 'usdt' }],
        sequence: 99,
        accountNumber: 42,
      });

      const [fallbackMsg, defaultMsg, overrideMsg] = msgExecuteContractFromJSON.mock.calls.map(([args]) => args);
      const [fallbackTx, defaultTx, overrideTx] = createTransaction.mock.calls.map(([args]) => args);
      expect(fallbackMsg.funds).toEqual([]);
      expect(fallbackTx).toMatchObject({ memo: '', sequence: 0, accountNumber: 0 });
      expect(defaultMsg.funds).toEqual([{ amount: '100', denom: 'inj' }]);
      expect(defaultTx).toMatchObject({ memo: 'sodax-memo', sequence: 7, accountNumber: 13 });
      expect(overrideMsg.funds).toEqual([{ amount: '999', denom: 'usdt' }]);
      expect(overrideTx).toMatchObject({ memo: 'explicit-memo', sequence: 99, accountNumber: 42 });
    });
  });

  describe('execute — option merge', () => {
    beforeEach(() => {
      msgExecuteContractCompatFromJSON.mockClear();
      broadcastWithPk.mockClear();
      broadcastWithPk.mockResolvedValue({ txHash: 'pk-tx-hash', height: '100' });
    });

    it('uses defaults.defaultFunds unless an explicit funds arg is passed', async () => {
      const provider = makeProvider({ defaultFunds: [{ amount: '50', denom: 'inj' }] });

      await provider.execute(SENDER, CONTRACT, MSG);
      await provider.execute(SENDER, CONTRACT, MSG, [{ amount: '999', denom: 'usdt' }]);

      const [defaulted, explicit] = msgExecuteContractCompatFromJSON.mock.calls.map(([args]) => args);
      expect(defaulted.funds).toEqual([{ amount: '50', denom: 'inj' }]);
      expect(explicit.funds).toEqual([{ amount: '999', denom: 'usdt' }]);
    });

    it('forwards memo only when defaults.defaultMemo is set, including an empty string', async () => {
      await makeProvider().execute(SENDER, CONTRACT, MSG);
      await makeProvider({ defaultMemo: '' }).execute(SENDER, CONTRACT, MSG);
      await makeProvider({ defaultMemo: 'sodax-memo' }).execute(SENDER, CONTRACT, MSG);

      const [unset, empty, set] = broadcastWithPk.mock.calls.map(([args]) => args);
      expect(unset).not.toHaveProperty('memo');
      expect(empty).toHaveProperty('memo', '');
      expect(set).toHaveProperty('memo', 'sodax-memo');
    });
  });

  const RAW_TX = {
    from: SENDER as `0x${string}`,
    to: '0xto' as `0x${string}`,
    signedDoc: {
      bodyBytes: new Uint8Array([1]),
      authInfoBytes: new Uint8Array([2]),
      chainId: CHAIN_ID,
      accountNumber: 42n,
    },
  };

  describe('sendTransaction — Soroban-style raw broadcast', () => {
    beforeEach(() => {
      grpcBroadcast.mockReset();
      grpcBroadcast.mockResolvedValue({ txHash: 'grpc-tx-hash', code: 0, rawLog: '' });
    });

    it('throws when the node rejects the transaction (non-zero code)', async () => {
      grpcBroadcast.mockResolvedValue({ txHash: 'x', code: 11, rawLog: 'out of gas' });
      const provider = makeProvider();

      await expect(provider.sendTransaction(new Uint8Array([9, 9]))).rejects.toThrow(/out of gas/);
    });
  });

  describe('signAndSendTransaction — PK (secret) mode', () => {
    beforeEach(() => {
      pkSign.mockClear();
      grpcBroadcast.mockReset();
      grpcBroadcast.mockResolvedValue({ txHash: 'grpc-tx-hash', code: 0, rawLog: '' });
    });

    it('signs the SignDoc with the private key and broadcasts, returning the tx hash', async () => {
      const provider = makeProvider();

      const hash = await provider.signAndSendTransaction(RAW_TX);

      expect(pkSign).toHaveBeenCalledTimes(1);
      expect(grpcBroadcast).toHaveBeenCalledTimes(1);
      expect(hash).toBe('grpc-tx-hash');
    });

    it('throws before signing when the raw tx sender does not match the connected wallet', async () => {
      const provider = makeProvider();

      await expect(
        provider.signAndSendTransaction({ ...RAW_TX, from: 'inj1different' as `0x${string}` }),
      ).rejects.toThrow(/cannot sign transaction for inj1different with wallet inj1abc/);
      expect(pkSign).not.toHaveBeenCalled();
      expect(grpcBroadcast).not.toHaveBeenCalled();
    });
  });

  describe('signAndSendTransaction — browser mode', () => {
    beforeEach(() => {
      msgExecuteContractCompatFromJSON.mockClear();
      broadcastWithFeeDelegation.mockClear();
      broadcastWithFeeDelegation.mockResolvedValue({ txHash: 'fee-deleg-tx-hash', height: '200' });
      // Default: bodyBytes decodes to a single cosmwasm execute message (token transfer to asset manager).
      txBodyDecode.mockReturnValue({
        messages: [{ typeUrl: '/cosmwasm.wasm.v1.MsgExecuteContract', value: new Uint8Array([5]) }],
      });
      cosmwasmMsgDecode.mockReturnValue({
        sender: 'inj1abc',
        contract: 'inj1contract',
        msg: new TextEncoder().encode(JSON.stringify(MSG)),
        funds: [{ denom: 'inj', amount: '1' }],
      });
    });

    function makeBrowserProvider() {
      const msgBroadcaster: any = {
        endpoints: { grpc: 'https://grpc.mock' },
        walletStrategy: { getAddresses: vi.fn().mockResolvedValue(['inj1abc']) },
        broadcastWithFeeDelegation,
      };
      return new InjectiveWalletProvider({ msgBroadcaster });
    }

    it('decodes the raw tx messages and broadcasts via fee delegation (Cosmos + Metamask), returning the hash', async () => {
      const provider = makeBrowserProvider();

      const hash = await provider.signAndSendTransaction(RAW_TX);

      // Messages are recovered from bodyBytes and rebuilt as the EIP-712-friendly compat message.
      expect(msgExecuteContractCompatFromJSON).toHaveBeenCalledWith({
        contractAddress: 'inj1contract',
        sender: 'inj1abc',
        msg: MSG,
        funds: [{ denom: 'inj', amount: '1' }],
      });
      // Broadcast goes through the fee-delegation path with the connected address as the signer.
      const broadcastArgs = broadcastWithFeeDelegation.mock.calls[0]?.[0];
      expect(broadcastArgs.injectiveAddress).toBe('inj1abc');
      expect(broadcastArgs.msgs).toEqual([{ kind: 'MsgExecuteContractCompat' }]);
      expect(hash).toBe('fee-deleg-tx-hash');
    });

    it('throws when the raw tx carries a message type other than MsgExecuteContract', async () => {
      txBodyDecode.mockReturnValue({
        messages: [{ typeUrl: '/cosmos.bank.v1beta1.MsgSend', value: new Uint8Array([5]) }],
      });
      const provider = makeBrowserProvider();

      await expect(provider.signAndSendTransaction(RAW_TX)).rejects.toThrow(/cannot rebuild message type/);
      expect(broadcastWithFeeDelegation).not.toHaveBeenCalled();
    });
  });
});
