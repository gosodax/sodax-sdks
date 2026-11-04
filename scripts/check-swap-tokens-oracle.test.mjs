import assert from 'node:assert/strict';
import test from 'node:test';
import { compareTokensToOracle, driftCount, formatReport } from './check-swap-tokens-oracle.mjs';

const chainInfo = {
  sonic: { name: 'Sonic', type: 'EVM' },
  base: { name: 'Base', type: 'EVM' },
  sui: { name: 'Sui', type: 'SUI' },
};
const relayChainIdMap = { sonic: 146, base: 30, sui: 21 };

const compare = (swapTokens, oracle) => compareTokensToOracle({ swapTokens, relayChainIdMap, chainInfo, oracle });
const chain = (results, chainKey) => results.find(r => r.chainKey === chainKey);

test('a token the oracle carries for that chain is not missing', () => {
  const results = compare({ sonic: [{ symbol: 'WETH', address: '0xAAA' }] }, [
    { chainId: '146', address: '0xaaa', symbol: 'WETH' },
  ]);
  assert.deepEqual(chain(results, 'sonic').missing, []);
  assert.equal(driftCount(results), 0);
});

test('addresses join case-insensitively', () => {
  const results = compare({ sonic: [{ symbol: 'WETH', address: '0xAaBbCc' }] }, [
    { chainId: '146', address: '0XAABBCC', symbol: 'WETH' },
  ]);
  assert.deepEqual(chain(results, 'sonic').missing, []);
});

test('the oracle chain id is matched numerically-as-string, not by chain key', () => {
  const results = compare({ sonic: [{ symbol: 'WETH', address: '0xAAA' }] }, [
    { chainId: 146, address: '0xaaa', symbol: 'WETH' },
  ]);
  assert.deepEqual(chain(results, 'sonic').missing, []);
});

test('the same address on a different chain does not satisfy the join', () => {
  const results = compare({ sonic: [{ symbol: 'WETH', address: '0xAAA' }] }, [
    { chainId: '30', address: '0xaaa', symbol: 'WETH' },
  ]);
  assert.deepEqual(
    chain(results, 'sonic').missing.map(t => t.symbol),
    ['WETH'],
  );
  assert.equal(driftCount(results), 1);
});

test('an EVM token absent from the oracle is drift', () => {
  const results = compare({ base: [{ symbol: 'SODA', address: '0xBBB' }] }, [
    { chainId: '30', address: '0xccc', symbol: 'USDC' },
  ]);
  assert.equal(driftCount(results), 1);
});

test('a non-EVM token absent from the oracle is reported but never drift', () => {
  const results = compare({ sui: [{ symbol: 'SUI', address: '0x2::sui::SUI' }] }, [
    { chainId: '21', address: '0x0000002', symbol: 'SUI' },
  ]);
  assert.equal(chain(results, 'sui').missing.length, 1);
  assert.equal(driftCount(results), 0);
});

test('a chain with no RelayChainIdMap entry finds no oracle tokens', () => {
  const results = compareTokensToOracle({
    swapTokens: { base: [{ symbol: 'SODA', address: '0xBBB' }] },
    relayChainIdMap: {},
    chainInfo,
    oracle: [{ chainId: '30', address: '0xbbb', symbol: 'SODA' }],
  });
  assert.equal(chain(results, 'base').oracleCount, 0);
  assert.equal(driftCount(results), 1);
});

test('an unknown chain is treated as non-EVM so it cannot fail the run on a guess', () => {
  const results = compareTokensToOracle({
    swapTokens: { mystery: [{ symbol: 'X', address: '0xDDD' }] },
    relayChainIdMap: { mystery: 999 },
    chainInfo: {},
    oracle: [{ chainId: '1', address: '0xeee', symbol: 'Y' }],
  });
  assert.equal(chain(results, 'mystery').isEvm, false);
  assert.equal(driftCount(results), 0);
});

test('oracle tokens absent from the SDK list are reported as extra, not as drift', () => {
  const results = compare({ base: [] }, [{ chainId: '30', address: '0xccc', symbol: 'USDC' }]);
  assert.deepEqual(
    chain(results, 'base').extra.map(t => t.symbol),
    ['USDC'],
  );
  assert.equal(driftCount(results), 0);
});

test('the report names each missing token and skips chains with no SDK tokens', () => {
  const report = formatReport(
    compare({ base: [{ symbol: 'SODA', address: '0xBBB' }], sui: [] }, [
      { chainId: '30', address: '0xccc', symbol: 'USDC' },
    ]),
  );
  assert.match(report, /Base \[30\]: 1 in SDK, 1 in oracle/);
  assert.match(report, /missing from oracle: SODA \(0xBBB\)/);
  assert.match(report, /in oracle, not in this list: USDC/);
  assert.doesNotMatch(report, /Sui/);
});

test('the extras list is capped and says how many it elided', () => {
  const oracle = Array.from({ length: 12 }, (_, i) => ({
    chainId: '30',
    address: `0x${i}`,
    symbol: `T${i}`,
  }));
  const report = formatReport(compare({ base: [{ symbol: 'SODA', address: '0xBBB' }] }, oracle));
  assert.match(report, /… and 2 more/);
});
