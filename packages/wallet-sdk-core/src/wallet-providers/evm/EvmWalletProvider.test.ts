import { describe, it, expect, vi, afterEach } from 'vitest';
import { EvmWalletProvider } from './EvmWalletProvider.js';
import type { BrowserExtensionEvmWalletConfig, EvmWalletConfig } from './types.js';
import type { EvmRawTransaction } from '@sodax/types';
import { ChainKeys } from '@sodax/types';
import {
  createWalletClient,
  createPublicClient,
  http,
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
    it('initializes with private key wallet config', () => {
      const provider = new EvmWalletProvider({
        privateKey: PRIVATE_KEY,
        chainId: ChainKeys.SONIC_MAINNET,
        rpcUrl: RPC_URL,
      });
      expect(provider).toBeInstanceOf(EvmWalletProvider);
      expect(provider.publicClient).toBeDefined();
      expect(provider.chainType).toBe('EVM');
    });

    it('initializes with browser extension wallet config', () => {
      const config = makeBrowserExtensionConfig();
      const provider = new EvmWalletProvider(config);
      expect(provider.publicClient).toBe(config.publicClient);
      expect(provider.chainType).toBe('EVM');
    });

    it('throws on invalid wallet config', () => {
      expect(() => new EvmWalletProvider({} as EvmWalletConfig)).toThrow('Invalid EVM wallet config');
    });

    it('accepts defaults without throwing', () => {
      const provider = new EvmWalletProvider({
        privateKey: PRIVATE_KEY,
        chainId: ChainKeys.SONIC_MAINNET,
        rpcUrl: RPC_URL,
        defaults: {
          transport: { timeout: 10_000, retryCount: 5 },
          publicClient: { pollingInterval: 4_000 },
          waitForTransactionReceipt: { confirmations: 2, timeout: 60_000 },
        },
      });
      expect(provider.chainType).toBe('EVM');
    });
  });

  describe('defaults — browser-extension mode', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('preserves the supplied publicClient instance unchanged when defaults are set', () => {
      const config = makeBrowserExtensionConfig();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const provider = new EvmWalletProvider({
        ...config,
        defaults: { transport: { timeout: 99_999 } }, // ignored — consumer brings their own client
      });
      expect(provider.publicClient).toBe(config.publicClient);
      warnSpy.mockRestore();
    });

    it('warns when ignored construction-time defaults are supplied', () => {
      const config = makeBrowserExtensionConfig();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      new EvmWalletProvider({
        ...config,
        defaults: { transport: { timeout: 99_999 } },
      });

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]?.[0]).toMatch(/ignored in browser-extension mode/);
    });

    it('does not warn when only method-level defaults are supplied', () => {
      const config = makeBrowserExtensionConfig();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      new EvmWalletProvider({
        ...config,
        defaults: { waitForTransactionReceipt: { confirmations: 1 } },
      });

      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe('waitForTransactionReceipt — option merge', () => {
    it('passes only { hash } when no defaults and no per-call options supplied', async () => {
      const config = makeBrowserExtensionConfig();
      const provider = new EvmWalletProvider(config);
      const spy = vi.spyOn(config.publicClient, 'waitForTransactionReceipt').mockResolvedValue(makeFakeReceipt());

      await provider.waitForTransactionReceipt('0xabc');

      expect(spy).toHaveBeenCalledWith({ hash: '0xabc' });
    });

    it('applies defaults when no per-call options supplied', async () => {
      const config = makeBrowserExtensionConfig();
      const provider = new EvmWalletProvider({
        ...config,
        defaults: { waitForTransactionReceipt: { confirmations: 3, timeout: 30_000 } },
      });
      const spy = vi.spyOn(config.publicClient, 'waitForTransactionReceipt').mockResolvedValue(makeFakeReceipt());

      await provider.waitForTransactionReceipt('0xabc');

      expect(spy).toHaveBeenCalledWith({ hash: '0xabc', confirmations: 3, timeout: 30_000 });
    });

    it('per-call options override defaults via shallow merge', async () => {
      const config = makeBrowserExtensionConfig();
      const provider = new EvmWalletProvider({
        ...config,
        defaults: { waitForTransactionReceipt: { confirmations: 1, timeout: 5_000 } },
      });
      const spy = vi.spyOn(config.publicClient, 'waitForTransactionReceipt').mockResolvedValue(makeFakeReceipt());

      await provider.waitForTransactionReceipt('0xabc', { confirmations: 5 });

      // Per-call confirmations wins; defaults timeout still applies (shallow merge)
      expect(spy).toHaveBeenCalledWith({ hash: '0xabc', confirmations: 5, timeout: 5_000 });
    });

    it('private-key flat defaults are picked up at runtime', async () => {
      const provider = new EvmWalletProvider({
        privateKey: PRIVATE_KEY,
        chainId: ChainKeys.SONIC_MAINNET,
        rpcUrl: RPC_URL,
        defaults: { waitForTransactionReceipt: { confirmations: 4, timeout: 12_345 } },
      });
      const spy = vi.spyOn(provider.publicClient, 'waitForTransactionReceipt').mockResolvedValue(makeFakeReceipt());

      await provider.waitForTransactionReceipt('0xabc');

      expect(spy).toHaveBeenCalledWith({ hash: '0xabc', confirmations: 4, timeout: 12_345 });
      spy.mockRestore();
    });
  });

  describe('sendTransaction — option merge', () => {
    const RAW_TX: EvmRawTransaction = {
      from: '0x0000000000000000000000000000000000000001',
      to: '0x0000000000000000000000000000000000000002',
      value: 1_000n,
      data: '0x',
    };

    it('passes raw tx fields through unchanged when no defaults and no per-call options', async () => {
      const config = makeBrowserExtensionConfig();
      const provider = new EvmWalletProvider(config);
      const spy = vi.spyOn(config.walletClient, 'sendTransaction').mockResolvedValue('0xtxhash');

      await provider.sendTransaction(RAW_TX);

      expect(spy).toHaveBeenCalledWith(expect.objectContaining(RAW_TX));
    });

    it('applies defaults.sendTransaction when no per-call options supplied', async () => {
      const config = makeBrowserExtensionConfig();
      const provider = new EvmWalletProvider({
        ...config,
        defaults: { sendTransaction: { gas: 100_000n } },
      });
      const spy = vi.spyOn(config.walletClient, 'sendTransaction').mockResolvedValue('0xtxhash');

      await provider.sendTransaction(RAW_TX);

      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ ...RAW_TX, gas: 100_000n }));
    });

    it('per-call options override defaults', async () => {
      const config = makeBrowserExtensionConfig();
      const provider = new EvmWalletProvider({
        ...config,
        defaults: { sendTransaction: { gas: 100_000n } },
      });
      const spy = vi.spyOn(config.walletClient, 'sendTransaction').mockResolvedValue('0xtxhash');

      await provider.sendTransaction(RAW_TX, { gas: 500_000n });

      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ ...RAW_TX, gas: 500_000n }));
    });

    // The guard must refuse a wallet sitting on a different chain than the calldata targets.
    it('refuses to send when the wallet is on a different chain than expectedChainId', async () => {
      const config = makeBrowserExtensionConfig();
      const provider = new EvmWalletProvider(config);
      vi.spyOn(config.walletClient, 'getChainId').mockResolvedValue(8453); // wallet moved to Base
      const spy = vi.spyOn(config.walletClient, 'sendTransaction').mockResolvedValue('0xtxhash');

      await expect(provider.sendTransaction(RAW_TX, { expectedChainId: sonic.id })).rejects.toThrow(
        /connected to chain 8453 but the transaction targets chain 146/,
      );
      expect(spy).not.toHaveBeenCalled();
    });

    it('sends when the wallet chain matches expectedChainId, without leaking the option into the tx', async () => {
      const config = makeBrowserExtensionConfig();
      const provider = new EvmWalletProvider(config);
      vi.spyOn(config.walletClient, 'getChainId').mockResolvedValue(sonic.id);
      const spy = vi.spyOn(config.walletClient, 'sendTransaction').mockResolvedValue('0xtxhash');

      await provider.sendTransaction(RAW_TX, { expectedChainId: sonic.id });

      expect(spy).toHaveBeenCalledWith(expect.objectContaining(RAW_TX));
      expect(spy).toHaveBeenCalledWith(expect.not.objectContaining({ expectedChainId: sonic.id }));
    });

    it('skips the chain check entirely when expectedChainId is not passed', async () => {
      const config = makeBrowserExtensionConfig();
      const provider = new EvmWalletProvider(config);
      const chainIdSpy = vi.spyOn(config.walletClient, 'getChainId').mockResolvedValue(8453);
      const spy = vi.spyOn(config.walletClient, 'sendTransaction').mockResolvedValue('0xtxhash');

      await provider.sendTransaction(RAW_TX);

      expect(chainIdSpy).not.toHaveBeenCalled();
      expect(spy).toHaveBeenCalledWith(expect.objectContaining(RAW_TX));
    });

    it('tx data is preserved alongside policy fields without collision', async () => {
      const config = makeBrowserExtensionConfig();
      const provider = new EvmWalletProvider({
        ...config,
        defaults: { sendTransaction: { gas: 100_000n, nonce: 5 } },
      });
      const spy = vi.spyOn(config.walletClient, 'sendTransaction').mockResolvedValue('0xtxhash');

      await provider.sendTransaction(RAW_TX, { maxFeePerGas: 2_000_000_000n });

      // Type system guarantees policy can never carry from/to/value/data, so tx data
      // and policy fields coexist without overriding each other.
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          ...RAW_TX,
          gas: 100_000n, // from defaults
          nonce: 5, // from defaults
          maxFeePerGas: 2_000_000_000n, // from per-call options
        }),
      );
    });

    it('rejects tx data fields in options at compile time', () => {
      const config = makeBrowserExtensionConfig();
      const provider = new EvmWalletProvider(config);
      vi.spyOn(config.walletClient, 'sendTransaction').mockResolvedValue('0xtxhash');

      // @ts-expect-error — `from` belongs to EvmRawTransaction, must not appear in EvmSendTransactionPolicy
      void provider.sendTransaction(RAW_TX, { from: '0xOther' });
      // @ts-expect-error — `value` belongs to EvmRawTransaction
      void provider.sendTransaction(RAW_TX, { value: 999n });
      // @ts-expect-error — `to` belongs to EvmRawTransaction
      void provider.sendTransaction(RAW_TX, { to: '0xOther' });
      // @ts-expect-error — `data` belongs to EvmRawTransaction
      void provider.sendTransaction(RAW_TX, { data: '0xdead' });
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

    describe('getAtomicBatchSupport', () => {
      it('reports unsupported for a private-key account without asking the RPC', async () => {
        const config = makeBrowserExtensionConfig();
        const provider = new EvmWalletProvider(config);
        const spy = vi.spyOn(config.walletClient, 'getCapabilities');

        await expect(provider.getAtomicBatchSupport(sonic.id)).resolves.toBe('unsupported');
        expect(spy).not.toHaveBeenCalled();
      });

      it.each(['supported', 'ready', 'unsupported'] as const)('passes through the %s status', async status => {
        const config = makeConnectedWalletConfig();
        const provider = new EvmWalletProvider(config);
        const spy = vi.spyOn(config.walletClient, 'getCapabilities').mockResolvedValue({ atomic: { status } });

        await expect(provider.getAtomicBatchSupport(8453)).resolves.toBe(status);
        expect(spy).toHaveBeenCalledWith({ chainId: 8453 });
      });

      it('reports unsupported when the wallet omits the chain', async () => {
        const config = makeConnectedWalletConfig();
        const provider = new EvmWalletProvider(config);
        // A wallet leaves out chains it cannot serve, though viem types the entry as present.
        vi.spyOn(config.walletClient, 'getCapabilities').mockResolvedValue(undefined as never);

        await expect(provider.getAtomicBatchSupport(sonic.id)).resolves.toBe('unsupported');
      });

      it('reports unsupported when the chain has no atomic capability', async () => {
        const config = makeConnectedWalletConfig();
        const provider = new EvmWalletProvider(config);
        vi.spyOn(config.walletClient, 'getCapabilities').mockResolvedValue({});

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
      it('refuses a private-key account', async () => {
        const config = makeBrowserExtensionConfig();
        const provider = new EvmWalletProvider(config);
        const spy = vi.spyOn(config.walletClient, 'sendCalls');

        await expect(provider.sendAtomicBatch([APPROVE_TX], { expectedChainId: sonic.id })).rejects.toThrow(
          /need a connected wallet/,
        );
        expect(spy).not.toHaveBeenCalled();
      });

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
      it('maps a confirmed batch to its receipts', async () => {
        const config = makeConnectedWalletConfig();
        const provider = new EvmWalletProvider(config);
        const spy = vi.spyOn(config.walletClient, 'waitForCallsStatus').mockResolvedValue(makeCallsStatus());

        await expect(provider.waitForBatch('batch-1')).resolves.toEqual({
          status: 'success',
          statusCode: 200,
          atomic: true,
          receipts: [{ transactionHash: '0xbatchtx', status: 'success' }],
        });
        expect(spy).toHaveBeenCalledWith({ id: 'batch-1' });
      });

      it('maps a reverted batch to failure and keeps the status code', async () => {
        const config = makeConnectedWalletConfig();
        const provider = new EvmWalletProvider(config);
        vi.spyOn(config.walletClient, 'waitForCallsStatus').mockResolvedValue(
          makeCallsStatus({ status: 'failure', statusCode: 500, receipts: undefined }),
        );

        await expect(provider.waitForBatch('batch-1')).resolves.toEqual({
          status: 'failure',
          statusCode: 500,
          atomic: true,
          receipts: [],
        });
      });

      it('treats a status the wallet left undefined as failure', async () => {
        const config = makeConnectedWalletConfig();
        const provider = new EvmWalletProvider(config);
        vi.spyOn(config.walletClient, 'waitForCallsStatus').mockResolvedValue(
          makeCallsStatus({ status: undefined, statusCode: 400 }),
        );

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
      it('retries a failed status read within the timeout', async () => {
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
      });

      it('gives up after a bounded number of failed status reads', async () => {
        const config = makeConnectedWalletConfig();
        const provider = new EvmWalletProvider(config);
        const spy = vi.spyOn(config.walletClient, 'waitForCallsStatus').mockRejectedValue(new Error('unknown bundle'));

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
