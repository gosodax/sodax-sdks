import { describe, expect, it, vi } from 'vitest';
import {
  type Hex,
  getAddress,
  hashDomain,
  hashStruct,
  isAddressEqual,
  keccak256,
  numberToHex,
  parseTransaction,
  recoverTransactionAddress,
} from 'viem';
import { sign } from 'viem/accounts';
import type Eth from '@ledgerhq/hw-app-eth';
import { ONE_GWEI, TEST_ACCOUNT, TEST_PRIVATE_KEY, TX_HASH, mainnet, mockRpcTransport } from '../shared/testkit.js';
import { LedgerEvmProvider } from './LedgerEvmProvider.js';

const PATH = "44'/60'/0'/0/0";
const recoversToSigner = async (raw: Hex) =>
  isAddressEqual(await recoverTransactionAddress({ serializedTransaction: raw }), TEST_ACCOUNT.address);

// Fake `@ledgerhq/hw-app-eth`: signs the tx digest with the real key (so recovery
// resolves to TEST_ACCOUNT end to end) and returns canned message signatures.
function makeEth() {
  return {
    getAddress: vi.fn(async () => ({ address: TEST_ACCOUNT.address, publicKey: '0x' })),
    signPersonalMessage: vi.fn(async () => ({ r: 'aa'.repeat(32), s: 'bb'.repeat(32), v: 27 })),
    signEIP712HashedMessage: vi.fn(async () => ({ r: 'cc'.repeat(32), s: 'dd'.repeat(32), v: 28 })),
    signTransaction: vi.fn(async (_path: string, rawTxHex: string) => {
      const sig = await sign({ hash: keccak256(`0x${rawTxHex}`), privateKey: TEST_PRIVATE_KEY });
      return { r: sig.r.slice(2), s: sig.s.slice(2), v: (sig.yParity ?? 0).toString(16) };
    }),
  };
}

function makeProvider() {
  const eth = makeEth();
  const { transport, calls } = mockRpcTransport();
  const provider = new LedgerEvmProvider({
    eth: eth as unknown as Eth,
    derivationPath: PATH,
    account: TEST_ACCOUNT.address,
    chainId: mainnet.id,
    chains: [mainnet],
    transports: { [mainnet.id]: transport },
  });
  return { provider, eth, calls };
}

const sentRawTx = (calls: { method: string; params?: unknown }[]) =>
  (calls.find(c => c.method === 'eth_sendRawTransaction')?.params as [Hex])[0];

describe('LedgerEvmProvider', () => {
  it('returns the device account, chain id, and forwards reads to the RPC', async () => {
    const { provider, calls } = makeProvider();
    expect(await provider.request({ method: 'eth_accounts' })).toEqual([TEST_ACCOUNT.address]);
    expect(await provider.request({ method: 'eth_chainId' })).toBe(numberToHex(mainnet.id));
    expect(await provider.request({ method: 'eth_blockNumber' })).toBe('0x10');
    expect(calls.some(c => c.method === 'eth_blockNumber')).toBe(true);
  });

  it('assembles a personal_sign signature with v normalised to 27/28', async () => {
    const { provider } = makeProvider();
    const sig = await provider.request({ method: 'personal_sign', params: ['0xdeadbeef', TEST_ACCOUNT.address] });
    expect(sig).toBe(`0x${'aa'.repeat(32)}${'bb'.repeat(32)}1b`); // v 27 → 0x1b
  });

  it('hashes EIP-712 typed data with hashDomain/hashStruct and signs it', async () => {
    const { provider, eth } = makeProvider();
    const typedData = {
      domain: { name: 'Sodax', version: '1', chainId: 1, verifyingContract: getAddress(`0x${'00'.repeat(19)}01`) },
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' },
        ],
        Intent: [{ name: 'amount', type: 'uint256' }],
      },
      primaryType: 'Intent',
      message: { amount: '123' },
    };
    const sig = await provider.request({ method: 'eth_signTypedData_v4', params: [TEST_ACCOUNT.address, typedData] });
    const domain = hashDomain({ domain: typedData.domain, types: typedData.types });
    const struct = hashStruct({ data: typedData.message, primaryType: 'Intent', types: typedData.types });
    expect(eth.signEIP712HashedMessage).toHaveBeenCalledWith(PATH, domain.slice(2), struct.slice(2));
    expect(sig).toBe(`0x${'cc'.repeat(32)}${'dd'.repeat(32)}1c`); // v 28 → 0x1c
  });

  it('fills, signs (EIP-1559) and broadcasts a transaction recoverable to the signer', async () => {
    const { provider, eth, calls } = makeProvider();
    const to = getAddress(`0x${'ab'.repeat(20)}`);
    const hash = await provider.request({
      method: 'eth_sendTransaction',
      params: [{ from: TEST_ACCOUNT.address, to, value: numberToHex(1000n), data: '0x' }],
    });
    expect(hash).toBe(TX_HASH);
    // The unsigned payload handed to the device is an EIP-1559 (type 0x02) tx.
    expect((eth.signTransaction.mock.calls[0]?.[1] as string).startsWith('02')).toBe(true);

    const parsed = parseTransaction(sentRawTx(calls));
    expect(parsed.type).toBe('eip1559');
    expect(parsed.nonce).toBe(5);
    expect(parsed.gas).toBe(21000n);
    expect(parsed.maxPriorityFeePerGas).toBe(ONE_GWEI);
    expect(parsed.maxFeePerGas).toBe(7n * 2n + ONE_GWEI);
    expect(isAddressEqual(parsed.to as Hex, to)).toBe(true);
    expect(await recoversToSigner(sentRawTx(calls))).toBe(true);
  });

  it('signs a legacy transaction when gasPrice is supplied', async () => {
    const { provider, calls } = makeProvider();
    await provider.request({
      method: 'eth_sendTransaction',
      params: [
        { from: TEST_ACCOUNT.address, to: getAddress(`0x${'cd'.repeat(20)}`), gasPrice: numberToHex(2n * ONE_GWEI) },
      ],
    });
    const parsed = parseTransaction(sentRawTx(calls));
    expect(parsed.type).toBe('legacy');
    expect(parsed.gasPrice).toBe(2n * ONE_GWEI);
    expect(await recoversToSigner(sentRawTx(calls))).toBe(true);
  });

  it('switches the active chain id', async () => {
    const { provider } = makeProvider();
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: numberToHex(8453) }] });
    expect(provider.getChainId()).toBe(8453);
  });
});
