import { describe, it, expect, vi } from 'vitest';
import { EvmWalletProvider, getEvmViemChain } from './EvmWalletProvider.js';
import type { BrowserExtensionEvmWalletConfig, EvmWalletConfig } from './types.js';
import type { EvmRawTransaction } from '@sodax/types';
import { ChainKeys } from '@sodax/types';
import {
  createWalletClient,
  createPublicClient,
  http,
  keccak256,
  recoverMessageAddress,
  WaitForCallsStatusTimeoutError,
  type GetCallsStatusReturnType,
  type TransactionReceipt,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sonic } from 'viem/chains';

const PRIVATE_KEY = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as const;
const RPC_URL = sonic.rpcUrls.default.http[0];

function makeBrowserExtensionConfig(): BrowserExtensionEvmWalletConfig {
  const account = privateKeyToAccount(PRIVATE_KEY);
  const walletClient = createWalletClient({ chain: sonic, transport: http(RPC_URL), account });
  const publicClient = createPublicClient({ chain: sonic, transport: http(RPC_URL) });
  return { walletClient, publicClient };
}

// An address-only account is a json-rpc account: the wallet behind the transport signs, as with wagmi.
function makeConnectedWalletConfig(): BrowserExtensionEvmWalletConfig {
  const walletClient = createWalletClient({
    chain: sonic,
    transport: http(RPC_URL),
    account: '0x0000000000000000000000000000000000000001',
  });
  const publicClient = createPublicClient({ chain: sonic, transport: http(RPC_URL) });
  return { walletClient, publicClient };
}

function makeCallsStatus(overrides: Partial<GetCallsStatusReturnType> = {}): GetCallsStatusReturnType {
  return {
    atomic: true,
    chainId: sonic.id,
    id: 'batch-1',
    receipts: [
      {
        logs: [],
        status: 'success',
        blockHash: '0xb1ock',
        blockNumber: 100n,
        gasUsed: 21_000n,
        transactionHash: '0xbatchtx',
      },
    ],
    status: 'success',
    statusCode: 200,
    version: '2.0.0',
    ...overrides,
  };
}

function makeFakeReceipt(): TransactionReceipt {
  return {
    blockHash: '0xb1ock',
    blockNumber: 100n,
    contractAddress: null,
    cumulativeGasUsed: 21_000n,
    effectiveGasPrice: 1_000_000_000n,
    from: '0x0000000000000000000000000000000000000001',
    gasUsed: 21_000n,
    logs: [],
    logsBloom: '0x',
    status: 'success',
    to: '0x0000000000000000000000000000000000000002',
    transactionHash: '0xtxhash',
    transactionIndex: 0,
    type: 'eip1559',
  };
}

describe('EvmWalletProvider', () => {
  describe('constructor', () => {
    it('throws on invalid wallet config', () => {
      expect(() => new EvmWalletProvider({} as EvmWalletConfig)).toThrow('Invalid EVM wallet config');
    });

    it('browser-extension mode keeps the supplied clients and warns only about ignored construction-time defaults', () => {
      const config = makeBrowserExtensionConfig();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      const methodOnly = new EvmWalletProvider({
        ...config,
        defaults: { waitForTransactionReceipt: { confirmations: 1 } },
      });
      expect(methodOnly.chainType).toBe('EVM');
      expect(warnSpy).not.toHaveBeenCalled();

      const withTransport = new EvmWalletProvider({ ...config, defaults: { transport: { timeout: 99_999 } } });
      expect(withTransport.publicClient).toBe(config.publicClient);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]?.[0]).toMatch(/ignored in browser-extension mode/);
      warnSpy.mockRestore();
    });
  });

  describe('waitForTransactionReceipt', () => {
    it('shallow-merges per-call options over defaults and serialises the receipt', async () => {
      const config = makeBrowserExtensionConfig();
      const provider = new EvmWalletProvider({
        ...config,
        defaults: { waitForTransactionReceipt: { confirmations: 1, timeout: 5_000 } },
      });
      const spy = vi.spyOn(config.publicClient, 'waitForTransactionReceipt').mockResolvedValue(makeFakeReceipt());

      const receipt = await provider.waitForTransactionReceipt('0xabc', { confirmations: 5 });

      expect(spy).toHaveBeenCalledWith({ hash: '0xabc', confirmations: 5, timeout: 5_000 });
      expect(receipt).toMatchObject({ blockNumber: '100', gasUsed: '21000', transactionIndex: '0' });
    });

    it('private-key mode builds its own public client and applies flat defaults', async () => {
      const provider = new EvmWalletProvider({
        privateKey: PRIVATE_KEY,
        chainId: ChainKeys.SONIC_MAINNET,
        rpcUrl: RPC_URL,
        defaults: {
          transport: { timeout: 10_000, retryCount: 5 },
          publicClient: { pollingInterval: 4_000 },
          waitForTransactionReceipt: { confirmations: 4, timeout: 12_345 },
        },
      });
      expect(provider.chainType).toBe('EVM');
      const spy = vi.spyOn(provider.publicClient, 'waitForTransactionReceipt').mockResolvedValue(makeFakeReceipt());

      await provider.waitForTransactionReceipt('0xabc');

      expect(spy).toHaveBeenCalledWith({ hash: '0xabc', confirmations: 4, timeout: 12_345 });
      spy.mockRestore();
    });
  });

  describe('sendTransaction', () => {
    const RAW_TX: EvmRawTransaction = {
      from: '0x0000000000000000000000000000000000000001',
      to: '0x0000000000000000000000000000000000000002',
      value: 1_000n,
      data: '0x',
    };

    it('passes the raw tx through without checking the chain when no options are given', async () => {
      const config = makeBrowserExtensionConfig();
      const provider = new EvmWalletProvider(config);
      const chainIdSpy = vi.spyOn(config.walletClient, 'getChainId').mockResolvedValue(8453);
      const spy = vi.spyOn(config.walletClient, 'sendTransaction').mockResolvedValue('0xtxhash');

      await provider.sendTransaction(RAW_TX);

      expect(chainIdSpy).not.toHaveBeenCalled();
      expect(spy).toHaveBeenCalledWith(expect.objectContaining(RAW_TX));
    });

    it('merges defaults.sendTransaction with per-call policy, leaving tx data untouched', async () => {
      const config = makeBrowserExtensionConfig();
      const provider = new EvmWalletProvider({
        ...config,
        defaults: { sendTransaction: { gas: 100_000n, nonce: 5 } },
      });
      const spy = vi.spyOn(config.walletClient, 'sendTransaction').mockResolvedValue('0xtxhash');

      await provider.sendTransaction(RAW_TX, { gas: 500_000n, maxFeePerGas: 2_000_000_000n });

      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ ...RAW_TX, gas: 500_000n, nonce: 5, maxFeePerGas: 2_000_000_000n }),
      );

      // @ts-expect-error — `from` belongs to EvmRawTransaction, must not appear in EvmSendTransactionPolicy
      void provider.sendTransaction(RAW_TX, { from: '0xOther' });
      // @ts-expect-error — `value` belongs to EvmRawTransaction
      void provider.sendTransaction(RAW_TX, { value: 999n });
      // @ts-expect-error — `to` belongs to EvmRawTransaction
      void provider.sendTransaction(RAW_TX, { to: '0xOther' });
      // @ts-expect-error — `data` belongs to EvmRawTransaction
      void provider.sendTransaction(RAW_TX, { data: '0xdead' });
    });

    // The guard must refuse a wallet sitting on a different chain than the calldata targets.
    it('sends only when the wallet chain matches expectedChainId, without leaking the option into the tx', async () => {
      const config = makeBrowserExtensionConfig();
      const provider = new EvmWalletProvider(config);
      const chainIdSpy = vi.spyOn(config.walletClient, 'getChainId').mockResolvedValue(8453); // wallet moved to Base
      const spy = vi.spyOn(config.walletClient, 'sendTransaction').mockResolvedValue('0xtxhash');

      await expect(provider.sendTransaction(RAW_TX, { expectedChainId: sonic.id })).rejects.toThrow(
        /connected to chain 8453 but the transaction targets chain 146/,
      );
      expect(spy).not.toHaveBeenCalled();

      chainIdSpy.mockResolvedValue(sonic.id);
      await provider.sendTransaction(RAW_TX, { expectedChainId: sonic.id });

      expect(spy).toHaveBeenCalledWith(expect.objectContaining(RAW_TX));
      expect(spy).toHaveBeenCalledWith(expect.not.objectContaining({ expectedChainId: sonic.id }));
    });

    it('retains the signed EVM deposit hash across a lost raw broadcast reply', async () => {
      const config = makeBrowserExtensionConfig();
      const provider = new EvmWalletProvider(config);
      const lost = new Error('connection closed during broadcast');
      const serializedTransaction = '0x02abcdef' as const;
      vi.spyOn(config.walletClient, 'prepareTransactionRequest').mockResolvedValue({
        ...RAW_TX,
        chainId: sonic.id,
      });
      const sign = vi.spyOn(config.walletClient, 'signTransaction').mockResolvedValue(serializedTransaction);
      const broadcast = vi.spyOn(config.walletClient, 'sendRawTransaction').mockRejectedValue(lost);

      await expect(provider.sendTransaction(RAW_TX, { preserveDepositOutcome: true })).rejects.toMatchObject({
        name: 'IndeterminateOutcomeError',
        cause: lost,
        txHash: keccak256(serializedTransaction),
      });
      expect(sign).toHaveBeenCalledOnce();
      expect(broadcast).toHaveBeenCalledExactlyOnceWith({ serializedTransaction });
    });

    it('keeps a browser deposit pending on a missing response and does not reinterpret refusal', async () => {
      const config = makeConnectedWalletConfig();
      const provider = new EvmWalletProvider(config);
      const refused = Object.assign(new Error('user refused'), { code: 4001 });
      const lost = new Error('wallet channel closed');
      const send = vi
        .spyOn(config.walletClient, 'sendTransaction')
        .mockRejectedValueOnce(refused)
        .mockRejectedValueOnce(lost);
      await expect(provider.sendTransaction(RAW_TX, { preserveDepositOutcome: true })).rejects.toBe(refused);
      await expect(provider.sendTransaction(RAW_TX, { preserveDepositOutcome: true })).rejects.toMatchObject({
        name: 'IndeterminateOutcomeError',
        cause: lost,
        recovery: { kind: 'evm-deposit', chainId: sonic.id, transaction: RAW_TX },
      });
      send.mockResolvedValueOnce('0x');
      await expect(provider.sendTransaction(RAW_TX, { preserveDepositOutcome: true })).rejects.toMatchObject({
        name: 'IndeterminateOutcomeError',
        recovery: { kind: 'evm-deposit', chainId: sonic.id, transaction: RAW_TX },
      });
      expect(send).toHaveBeenCalledTimes(3);
    });
  });

  describe('signMessage', () => {
    const HASH = `0x${'5a'.repeat(32)}` as const;

    it('signs the raw 32 bytes of the hash under EIP-191, recoverable to the account', async () => {
      const provider = new EvmWalletProvider({
        privateKey: PRIVATE_KEY,
        chainId: ChainKeys.SONIC_MAINNET,
        rpcUrl: RPC_URL,
      });
      const signature = await provider.signMessage(HASH);

      // Scheme 0 verifies `recoverMessageAddress({ message: { raw } })` — signing the hex text instead
      // would recover a different address.
      const recovered = await recoverMessageAddress({ message: { raw: HASH }, signature });
      expect(recovered).toBe(privateKeyToAccount(PRIVATE_KEY).address);
    });
  });

  describe('getEvmViemChain', () => {
    it('resolves Monad to its mainnet network id, not the relay routing id', () => {
      expect(getEvmViemChain(ChainKeys.MONAD_MAINNET).id).toBe(143);
    });
  });

  describe('EIP-5792 atomic batches', () => {
    const APPROVE_TX: EvmRawTransaction = {
      from: '0x0000000000000000000000000000000000000001',
      to: '0x0000000000000000000000000000000000000003',
      value: 0n,
      data: '0x095ea7b3',
    };
    const TRANSFER_TX: EvmRawTransaction = {
      from: '0x0000000000000000000000000000000000000001',
      to: '0x0000000000000000000000000000000000000004',
      value: 0n,
      data: '0xa9059cbb',
    };

    it('a private-key account reports batches unsupported and refuses to send one, without asking the RPC', async () => {
      const config = makeBrowserExtensionConfig();
      const provider = new EvmWalletProvider(config);
      const capabilitiesSpy = vi.spyOn(config.walletClient, 'getCapabilities');
      const sendCallsSpy = vi.spyOn(config.walletClient, 'sendCalls');

      await expect(provider.getAtomicBatchSupport(sonic.id)).resolves.toBe('unsupported');
      await expect(provider.sendAtomicBatch([APPROVE_TX], { expectedChainId: sonic.id })).rejects.toThrow(
        /need a connected wallet/,
      );
      expect(capabilitiesSpy).not.toHaveBeenCalled();
      expect(sendCallsSpy).not.toHaveBeenCalled();
    });

    describe('getAtomicBatchSupport', () => {
      it('passes through a ready status and reports unsupported when the chain or its atomic capability is missing', async () => {
        const config = makeConnectedWalletConfig();
        const provider = new EvmWalletProvider(config);
        const spy = vi
          .spyOn(config.walletClient, 'getCapabilities')
          .mockResolvedValueOnce({ atomic: { status: 'ready' } })
          // A wallet leaves out chains it cannot serve, though viem types the entry as present.
          .mockResolvedValueOnce(undefined as never)
          .mockResolvedValueOnce({});

        await expect(provider.getAtomicBatchSupport(8453)).resolves.toBe('ready');
        expect(spy).toHaveBeenCalledWith({ chainId: 8453 });
        await expect(provider.getAtomicBatchSupport(sonic.id)).resolves.toBe('unsupported');
        await expect(provider.getAtomicBatchSupport(sonic.id)).resolves.toBe('unsupported');
      });

      it('propagates a wallet that rejects wallet_getCapabilities', async () => {
        const config = makeConnectedWalletConfig();
        const provider = new EvmWalletProvider(config);
        vi.spyOn(config.walletClient, 'getCapabilities').mockRejectedValue(new Error('Method not found'));

        await expect(provider.getAtomicBatchSupport(sonic.id)).rejects.toThrow('Method not found');
      });
    });

    describe('sendAtomicBatch', () => {
      it('refuses to send when the wallet is on a different chain than expectedChainId', async () => {
        const config = makeConnectedWalletConfig();
        const provider = new EvmWalletProvider(config);
        vi.spyOn(config.walletClient, 'getChainId').mockResolvedValue(8453);
        const spy = vi.spyOn(config.walletClient, 'sendCalls');

        await expect(provider.sendAtomicBatch([APPROVE_TX], { expectedChainId: sonic.id })).rejects.toThrow(
          /connected to chain 8453 but the transaction targets chain 146/,
        );
        expect(spy).not.toHaveBeenCalled();
      });

      it('refuses when the wallet client is bound to a different chain than expectedChainId', async () => {
        const config = makeConnectedWalletConfig();
        const provider = new EvmWalletProvider(config);
        // The wallet is already on Base, but this client was built for Sonic: sendCalls would tag the batch 146.
        vi.spyOn(config.walletClient, 'getChainId').mockResolvedValue(8453);
        const spy = vi.spyOn(config.walletClient, 'sendCalls');

        await expect(provider.sendAtomicBatch([APPROVE_TX], { expectedChainId: 8453 })).rejects.toThrow(
          /bound to chain 146 but the batch targets chain 8453/,
        );
        expect(spy).not.toHaveBeenCalled();
      });

      it('sends the calls in order with atomic execution required and returns the batch id', async () => {
        const config = makeConnectedWalletConfig();
        const provider = new EvmWalletProvider(config);
        vi.spyOn(config.walletClient, 'getChainId').mockResolvedValue(sonic.id);
        const spy = vi.spyOn(config.walletClient, 'sendCalls').mockResolvedValue({ id: 'batch-1' });

        await expect(provider.sendAtomicBatch([APPROVE_TX, TRANSFER_TX], { expectedChainId: sonic.id })).resolves.toBe(
          'batch-1',
        );
        expect(spy).toHaveBeenCalledWith({
          calls: [
            { to: APPROVE_TX.to, value: APPROVE_TX.value, data: APPROVE_TX.data },
            { to: TRANSFER_TX.to, value: TRANSFER_TX.value, data: TRANSFER_TX.data },
          ],
          forceAtomic: true,
        });
      });
    });

    describe('waitForBatch', () => {
      it('maps a confirmed batch to its receipts and any other status to failure', async () => {
        const config = makeConnectedWalletConfig();
        const provider = new EvmWalletProvider(config);
        const spy = vi
          .spyOn(config.walletClient, 'waitForCallsStatus')
          .mockResolvedValueOnce(makeCallsStatus())
          .mockResolvedValueOnce(makeCallsStatus({ status: 'failure', statusCode: 500, receipts: undefined }))
          .mockResolvedValueOnce(makeCallsStatus({ status: undefined, statusCode: 400 }));

        await expect(provider.waitForBatch('batch-1')).resolves.toEqual({
          status: 'success',
          statusCode: 200,
          atomic: true,
          receipts: [{ transactionHash: '0xbatchtx', status: 'success' }],
        });
        expect(spy).toHaveBeenCalledWith({ id: 'batch-1' });
        await expect(provider.waitForBatch('batch-1')).resolves.toEqual({
          status: 'failure',
          statusCode: 500,
          atomic: true,
          receipts: [],
        });
        await expect(provider.waitForBatch('batch-1')).resolves.toMatchObject({ status: 'failure', statusCode: 400 });
      });

      it('applies defaults.waitForCallsStatus with per-call options winning', async () => {
        const config = makeConnectedWalletConfig();
        const provider = new EvmWalletProvider({
          ...config,
          defaults: { waitForCallsStatus: { timeout: 120_000, pollingInterval: 2_000 } },
        });
        const spy = vi.spyOn(config.walletClient, 'waitForCallsStatus').mockResolvedValue(makeCallsStatus());

        await provider.waitForBatch('batch-1', { timeout: 30_000 });

        expect(spy).toHaveBeenCalledWith({ id: 'batch-1', timeout: 30_000, pollingInterval: 2_000 });
      });

      it('gives up at once on a zero timeout instead of waiting forever', async () => {
        const config = makeConnectedWalletConfig();
        const provider = new EvmWalletProvider(config);
        const spy = vi.spyOn(config.walletClient, 'waitForCallsStatus').mockResolvedValue(makeCallsStatus());

        await provider.waitForBatch('batch-1', { timeout: 0 });

        expect(spy).toHaveBeenCalledWith({ id: 'batch-1', timeout: 1 });
      });

      it('propagates a wait that times out, so the caller can tell it from a failed batch', async () => {
        const config = makeConnectedWalletConfig();
        const provider = new EvmWalletProvider(config);
        const spy = vi
          .spyOn(config.walletClient, 'waitForCallsStatus')
          .mockRejectedValue(new WaitForCallsStatusTimeoutError({ id: 'batch-1' }));

        await expect(provider.waitForBatch('batch-1', { timeout: 60_000, pollingInterval: 1 })).rejects.toBeInstanceOf(
          WaitForCallsStatusTimeoutError,
        );
        expect(spy).toHaveBeenCalledOnce();
      });

      // viem ends its wait on the first failed status read; one RPC blip must not report a landing batch as lost.
      it('retries a failed status read within the timeout, up to a bounded number of reads', async () => {
        const config = makeConnectedWalletConfig();
        const provider = new EvmWalletProvider(config);
        const spy = vi
          .spyOn(config.walletClient, 'waitForCallsStatus')
          .mockRejectedValueOnce(new Error('network blip'))
          .mockResolvedValueOnce(makeCallsStatus());

        await expect(provider.waitForBatch('batch-1', { timeout: 60_000, pollingInterval: 1 })).resolves.toMatchObject({
          status: 'success',
        });
        expect(spy).toHaveBeenCalledTimes(2);

        spy.mockReset().mockRejectedValue(new Error('unknown bundle'));
        await expect(provider.waitForBatch('batch-1', { timeout: 60_000, pollingInterval: 1 })).rejects.toThrow(
          'unknown bundle',
        );
        expect(spy).toHaveBeenCalledTimes(3);
      });

      it('does not retry once the timeout leaves no room for another read', async () => {
        const config = makeConnectedWalletConfig();
        const provider = new EvmWalletProvider(config);
        const spy = vi.spyOn(config.walletClient, 'waitForCallsStatus').mockRejectedValue(new Error('network blip'));

        await expect(provider.waitForBatch('batch-1', { timeout: 1_000, pollingInterval: 5_000 })).rejects.toThrow(
          'network blip',
        );
        expect(spy).toHaveBeenCalledOnce();
      });
    });
  });
});
