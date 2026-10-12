import { describe, expect, it, vi } from 'vitest';
import { getAddress, hashDomain, hashStruct, numberToHex } from 'viem';
import { ONE_GWEI, TEST_ACCOUNT, TX_HASH, mainnet, mockRpcTransport } from '../shared/testkit.js';

const SERIALIZED_TX = '0x02f8aa'; // Trezor returns this verbatim; the provider broadcasts it

// `vi.mock` is hoisted above top-level consts, so mock data lives in `vi.hoisted`
// and uses the test key's checksummed address literal.
const trezor = vi.hoisted(() => {
  const ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
  return {
    init: vi.fn(async () => ({ success: true })),
    ethereumGetAddress: vi.fn(async () => ({ success: true, payload: { address: ADDRESS } })),
    ethereumSignTransaction: vi.fn(async () => ({
      success: true,
      payload: { v: '0x0', r: '0x', s: '0x', serializedTx: '0x02f8aa' },
    })),
    ethereumSignMessage: vi.fn(async () => ({
      success: true,
      payload: { address: ADDRESS, signature: 'aa'.repeat(65) },
    })),
    ethereumSignTypedData: vi.fn(async () => ({
      success: true,
      payload: { address: ADDRESS, signature: 'bb'.repeat(65) },
    })),
  };
});
vi.mock('@trezor/connect-web', () => ({ default: trezor }));

import { TrezorEvmProvider } from './TrezorEvmProvider.js';

const PATH = "m/44'/60'/0'/0/0";

function makeProvider() {
  const { transport, calls } = mockRpcTransport();
  const provider = new TrezorEvmProvider({
    derivationPath: PATH,
    account: TEST_ACCOUNT.address,
    chainId: mainnet.id,
    chains: [mainnet],
    transports: { [mainnet.id]: transport },
  });
  return { provider, calls };
}

const signedTx = () =>
  (trezor.ethereumSignTransaction.mock.calls.at(-1)?.[0] as { transaction: Record<string, unknown> }).transaction;

describe('TrezorEvmProvider', () => {
  it('returns the device account, chain id, and forwards reads to the RPC', async () => {
    const { provider, calls } = makeProvider();
    expect(await provider.request({ method: 'eth_accounts' })).toEqual([TEST_ACCOUNT.address]);
    expect(await provider.request({ method: 'eth_chainId' })).toBe(numberToHex(mainnet.id));
    expect(await provider.request({ method: 'eth_blockNumber' })).toBe('0x10');
    expect(calls.some(c => c.method === 'eth_blockNumber')).toBe(true);
  });

  it('signs personal_sign via Trezor Connect and 0x-prefixes the signature', async () => {
    const { provider } = makeProvider();
    const sig = await provider.request({ method: 'personal_sign', params: ['0xdeadbeef', TEST_ACCOUNT.address] });
    expect(trezor.ethereumSignMessage).toHaveBeenCalledWith({ path: PATH, message: 'deadbeef', hex: true });
    expect(sig).toBe(`0x${'aa'.repeat(65)}`);
  });

  it('signs EIP-712 typed data, passing precomputed hashes for firmware compatibility', async () => {
    const { provider } = makeProvider();
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
    const call = trezor.ethereumSignTypedData.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.path).toBe(PATH);
    expect(call.metamask_v4_compat).toBe(true);
    expect(call.domain_separator_hash).toBe(hashDomain({ domain: typedData.domain, types: typedData.types }));
    expect(call.message_hash).toBe(
      hashStruct({ data: typedData.message, primaryType: 'Intent', types: typedData.types }),
    );
    expect(sig).toBe(`0x${'bb'.repeat(65)}`);
  });

  it('fills an EIP-1559 transaction, signs via Trezor, and broadcasts the returned serialized tx', async () => {
    const { provider, calls } = makeProvider();
    const to = getAddress(`0x${'ab'.repeat(20)}`);
    const hash = await provider.request({
      method: 'eth_sendTransaction',
      params: [{ from: TEST_ACCOUNT.address, to, value: numberToHex(1000n), data: '0x' }],
    });
    expect(hash).toBe(TX_HASH);

    const tx = signedTx();
    expect(tx).toMatchObject({
      to,
      nonce: '0x5',
      gasLimit: '0x5208',
      maxPriorityFeePerGas: numberToHex(ONE_GWEI),
      maxFeePerGas: numberToHex(7n * 2n + ONE_GWEI),
      chainId: mainnet.id,
    });
    expect('gasPrice' in tx).toBe(false);
    expect(calls.find(c => c.method === 'eth_sendRawTransaction')?.params).toEqual([SERIALIZED_TX]);
  });

  it('builds a legacy transaction when gasPrice is supplied', async () => {
    const { provider } = makeProvider();
    await provider.request({
      method: 'eth_sendTransaction',
      params: [
        { from: TEST_ACCOUNT.address, to: getAddress(`0x${'cd'.repeat(20)}`), gasPrice: numberToHex(2n * ONE_GWEI) },
      ],
    });
    const tx = signedTx();
    expect(tx.gasPrice).toBe(numberToHex(2n * ONE_GWEI));
    expect('maxFeePerGas' in tx).toBe(false);
  });

  it('throws a friendly error when Trezor returns failure', async () => {
    trezor.ethereumSignMessage.mockResolvedValueOnce({
      success: false,
      payload: { error: 'Cancelled' },
    } as unknown as Awaited<ReturnType<typeof trezor.ethereumSignMessage>>);
    const { provider } = makeProvider();
    await expect(provider.request({ method: 'personal_sign', params: ['0x00', TEST_ACCOUNT.address] })).rejects.toThrow(
      /Trezor failed to sign message: Cancelled/,
    );
  });

  it('switches the active chain id', async () => {
    const { provider } = makeProvider();
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: numberToHex(8453) }] });
    expect(provider.getChainId()).toBe(8453);
  });
});
