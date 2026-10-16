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
    it('initializes with secret (private key) config', () => {
      const provider = makeProvider();
      expect(provider.chainType).toBe('INJECTIVE');
      expect(provider.wallet.msgBroadcaster).toBeDefined();
    });

    it('initializes with browser-extension config', () => {
      // biome-ignore lint/suspicious/noExplicitAny: mocked broadcaster
      const msgBroadcaster: any = { walletStrategy: { getAddresses: vi.fn() } };
      const provider = new InjectiveWalletProvider({ msgBroadcaster });
      expect(provider.chainType).toBe('INJECTIVE');
    });

    it('throws on invalid config', () => {
      expect(() => new InjectiveWalletProvider({} as never)).toThrow('Invalid Injective wallet config');
    });

    it('accepts defaults without throwing', () => {
      const provider = makeProvider({
        defaultMemo: 'sodax',
        defaultFunds: [{ amount: '100', denom: 'inj' }],
        sequence: 5,
        accountNumber: 10,
      });
      expect(provider.chainType).toBe('INJECTIVE');
    });
  });

  describe('getRawTransaction — option merge', () => {
    beforeEach(() => {
      msgExecuteContractFromJSON.mockClear();
      createTransaction.mockClear();
    });

    it('uses defaults: empty funds, empty memo, sequence=0, accountNumber=0 when nothing set', async () => {
      const provider = makeProvider();

      await provider.getRawTransaction(CHAIN_ID, '', SENDER, CONTRACT, MSG);

      const msgArgs = msgExecuteContractFromJSON.mock.calls[0]?.[0];
      expect(msgArgs.funds).toEqual([]);
      const txArgs = createTransaction.mock.calls[0]?.[0];
      expect(txArgs.memo).toBe('');
      expect(txArgs.sequence).toBe(0);
      expect(txArgs.accountNumber).toBe(0);
    });

    it('applies defaults.{defaultFunds, defaultMemo, sequence, accountNumber}', async () => {
      const provider = makeProvider({
        defaultFunds: [{ amount: '100', denom: 'inj' }],
        defaultMemo: 'sodax-memo',
        sequence: 7,
        accountNumber: 13,
      });

      await provider.getRawTransaction(CHAIN_ID, '', SENDER, CONTRACT, MSG);

      const msgArgs = msgExecuteContractFromJSON.mock.calls[0]?.[0];
      expect(msgArgs.funds).toEqual([{ amount: '100', denom: 'inj' }]);
      const txArgs = createTransaction.mock.calls[0]?.[0];
      expect(txArgs.memo).toBe('sodax-memo');
      expect(txArgs.sequence).toBe(7);
      expect(txArgs.accountNumber).toBe(13);
    });

    it('per-call options override defaults', async () => {
      const provider = makeProvider({
        defaultFunds: [{ amount: '100', denom: 'inj' }],
        defaultMemo: 'sodax-memo',
        sequence: 7,
        accountNumber: 13,
      });

      await provider.getRawTransaction(CHAIN_ID, '', SENDER, CONTRACT, MSG, undefined, {
        defaultFunds: [{ amount: '999', denom: 'usdt' }],
        sequence: 99,
        accountNumber: 42,
      });

      const msgArgs = msgExecuteContractFromJSON.mock.calls[0]?.[0];
      expect(msgArgs.funds).toEqual([{ amount: '999', denom: 'usdt' }]);
      const txArgs = createTransaction.mock.calls[0]?.[0];
      expect(txArgs.sequence).toBe(99);
      expect(txArgs.accountNumber).toBe(42);
    });

    it('memo argument wins over defaults.defaultMemo', async () => {
      const provider = makeProvider({ defaultMemo: 'sodax-memo' });

      await provider.getRawTransaction(CHAIN_ID, '', SENDER, CONTRACT, MSG, 'explicit-memo');

      const txArgs = createTransaction.mock.calls[0]?.[0];
      expect(txArgs.memo).toBe('explicit-memo');
    });
  });

  describe('execute — option merge', () => {
    beforeEach(() => {
      msgExecuteContractCompatFromJSON.mockClear();
      broadcastWithPk.mockClear();
      broadcastWithPk.mockResolvedValue({ txHash: 'pk-tx-hash', height: '100' });
    });

    it('applies defaults.defaultFunds when funds arg omitted', async () => {
      const provider = makeProvider({ defaultFunds: [{ amount: '50', denom: 'inj' }] });

      await provider.execute(SENDER, CONTRACT, MSG);

      const msgArgs = msgExecuteContractCompatFromJSON.mock.calls[0]?.[0];
      expect(msgArgs.funds).toEqual([{ amount: '50', denom: 'inj' }]);
    });

    it('explicit funds arg overrides defaults.defaultFunds', async () => {
      const provider = makeProvider({ defaultFunds: [{ amount: '50', denom: 'inj' }] });

      await provider.execute(SENDER, CONTRACT, MSG, [{ amount: '999', denom: 'usdt' }]);

      const msgArgs = msgExecuteContractCompatFromJSON.mock.calls[0]?.[0];
      expect(msgArgs.funds).toEqual([{ amount: '999', denom: 'usdt' }]);
    });

    it('memo absent (no key in broadcast args) when defaults.defaultMemo is undefined', async () => {
      const provider = makeProvider();

      await provider.execute(SENDER, CONTRACT, MSG);

      const broadcastArgs = broadcastWithPk.mock.calls[0]?.[0];
      expect(broadcastArgs).not.toHaveProperty('memo');
    });

    it('memo forwarded as empty string when defaults.defaultMemo is set to empty string', async () => {
      const provider = makeProvider({ defaultMemo: '' });

      await provider.execute(SENDER, CONTRACT, MSG);

      const broadcastArgs = broadcastWithPk.mock.calls[0]?.[0];
      expect(broadcastArgs).toHaveProperty('memo', '');
    });

    it('memo forwarded when defaults.defaultMemo is set to a non-empty value', async () => {
      const provider = makeProvider({ defaultMemo: 'sodax-memo' });

      await provider.execute(SENDER, CONTRACT, MSG);

      const broadcastArgs = broadcastWithPk.mock.calls[0]?.[0];
      expect(broadcastArgs).toHaveProperty('memo', 'sodax-memo');
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

    it('decodes the signed TxRaw and broadcasts it via gRPC, returning the tx hash', async () => {
      const provider = makeProvider();

      const hash = await provider.sendTransaction(new Uint8Array([9, 9]));

      expect(grpcBroadcast).toHaveBeenCalledTimes(1);
      expect(hash).toBe('grpc-tx-hash');
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

    it('throws before decoding when the raw tx sender does not match the connected wallet', async () => {
      const provider = makeBrowserProvider();

      await expect(
        provider.signAndSendTransaction({ ...RAW_TX, from: 'inj1different' as `0x${string}` }),
      ).rejects.toThrow(/cannot sign transaction for inj1different with wallet inj1abc/);
      expect(broadcastWithFeeDelegation).not.toHaveBeenCalled();
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
