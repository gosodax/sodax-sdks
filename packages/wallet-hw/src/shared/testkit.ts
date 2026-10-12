import { type Hex, custom, http, numberToHex } from 'viem';
import { mainnet } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import type { CreateConnectorFn } from 'wagmi';
import { vi } from 'vitest';

// Shared fixtures for the device tests. Hardhat test account #1 — its key lets the
// Ledger test sign real digests so recovery resolves to a known signer.
export const TEST_PRIVATE_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
export const TEST_ACCOUNT = privateKeyToAccount(TEST_PRIVATE_KEY);
/** Checksummed address of {@link TEST_ACCOUNT} (literal, for `vi.hoisted` mock factories). */
export const TEST_ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const;
export const ONE_GWEI = 1_000_000_000n;
export const TX_HASH = `0x${'11'.repeat(32)}` as Hex;
export { mainnet };

/** A viem transport with canned RPC responses, plus the list of forwarded calls. */
export function mockRpcTransport() {
  const calls: { method: string; params?: unknown }[] = [];
  const transport = custom({
    async request({ method, params }) {
      calls.push({ method, params });
      switch (method) {
        case 'eth_getTransactionCount':
          return '0x5';
        case 'eth_estimateGas':
          return '0x5208'; // 21000
        case 'eth_maxPriorityFeePerGas':
          return numberToHex(ONE_GWEI);
        case 'eth_getBlockByNumber':
          return { baseFeePerGas: numberToHex(7n) };
        case 'eth_sendRawTransaction':
          return TX_HASH;
        case 'eth_blockNumber':
          return '0x10';
        default:
          throw new Error(`unexpected RPC method: ${method}`);
      }
    },
  });
  return { transport, calls };
}

/** Instantiate a wagmi connector factory against a single-chain (mainnet) test config. */
export function instantiateConnector<provider>(factory: CreateConnectorFn<provider>) {
  const emit = vi.fn();
  const config = {
    chains: [mainnet],
    transports: { [mainnet.id]: http() },
    emitter: { emit },
  } as unknown as Parameters<CreateConnectorFn<provider>>[0];
  return { connector: factory(config), emit };
}
