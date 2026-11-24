import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChainKeys, SolverIntentStatusCode, type Sodax } from '@sodax/sdk';
import { createSwapSdk, settleSwap } from './swap-cli-sdk.js';

const fillTxHash = `0x${'ab'.repeat(32)}`;
const chainId = ChainKeys.CARDANO_MAINNET;
const getStatus: Sodax['swaps']['getStatus'] = async () => ({
  ok: true,
  value: { status: SolverIntentStatusCode.SOLVED, fill_tx_hash: fillTxHash },
});

test('waits for destination delivery and prints the destination hash', async t => {
  const log = t.mock.method(console, 'log', () => {});
  const dstTxHash = 'bc'.repeat(32);
  const waitForIntentDelivery = t.mock.fn<Sodax['swaps']['waitForIntentDelivery']>(async () => ({
    ok: true,
    value: {
      source: 'mpcRelay',
      dstTxHash,
      release: { dstChainKey: chainId, hubChainId: '146', hubTxHash: fillTxHash, logIndex: 0 },
    },
  }));

  assert.equal(await settleSwap({ swaps: { getStatus, waitForIntentDelivery } }, chainId, '0x1234'), 0);
  assert.deepEqual(
    waitForIntentDelivery.mock.calls.map(call => call.arguments),
    [[{ chainId, fillTxHash }]],
  );
  assert.ok(log.mock.calls.some(call => call.arguments.join(' ').includes(dstTxHash)));
});

test('fails the CLI when the destination delivery fails after SOLVED', async t => {
  t.mock.method(console, 'log', () => {});
  const logError = t.mock.method(console, 'error', (_message: string, _error: unknown) => {});
  const error = new Error('release unavailable');
  const waitForIntentDelivery: Sodax['swaps']['waitForIntentDelivery'] = async () => ({ ok: false, error });

  assert.equal(await settleSwap({ swaps: { getStatus, waitForIntentDelivery } }, chainId, '0x1234'), 1);
  assert.ok(logError.mock.calls.some(call => call.arguments.includes(error)));
});

test('applies the source RPC override to the SDK chain config', () => {
  const chainKey = ChainKeys.POLYGON_MAINNET;
  const rpcUrl = 'https://rpc.example';
  assert.equal(createSwapSdk(chainKey, rpcUrl).config.getChainConfig(chainKey).rpcUrl, rpcUrl);
});
