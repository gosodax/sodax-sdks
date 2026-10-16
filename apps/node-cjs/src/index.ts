/**
 * CommonJS reproduction for issue #939
 * https://github.com/icon-project/sodax-sdks/issues/939
 *
 * When @sodax/sdk is consumed from a CommonJS application,
 * Node.js throws ERR_PACKAGE_PATH_NOT_EXPORTED because near-api-js
 * is ESM-only and has no "require" export path.
 *
 * This app should be kept in order to reproduce and test cjs related issues.
 * IMPORTANT: Do not remove it unless you have a good reason to do so.
 */
import assert from 'node:assert/strict';
import { IconWalletProvider } from '@sodax/wallet-sdk-core';
import { ChainKeys, Sodax, encodeAddress, serializeAddressData, spokeChainConfig } from '@sodax/sdk';

console.log('Attempting to load @sodax/sdk in CommonJS...');

const sdk = new Sodax();
console.log('SDK loaded:', typeof sdk);
console.log('NEAR_MAINNET key:', ChainKeys.NEAR_MAINNET);
console.log('ICON_MAINNET key:', ChainKeys.ICON_MAINNET);

const iconWalletProvider = new IconWalletProvider({
  // Mock private key for ICON blockchain (testing only, do not use in production)
  privateKey: '0x11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff',
  rpcUrl: 'https://ctz.solidwallet.io/api/v3',
});
const iconChainConfig = spokeChainConfig[ChainKeys.ICON_MAINNET];

console.log('iconWalletProvider loaded:', typeof iconWalletProvider);
console.log('iconChainConfig loaded:', iconChainConfig.chain.name);

// The Sui transport constructs a SuiGrpcClient in the Sodax ctor above, so reaching this line
// at all proves `require('@mysten/sui/grpc')` resolved — the package is ESM-only.
assert.strictEqual(
  sdk.spoke.sui.transport.endpoint,
  spokeChainConfig[ChainKeys.SUI_MAINNET].grpc_url,
  'sdk → @mysten/sui/grpc (CJS): Sui transport endpoint regression',
);
console.log('Sui gRPC transport (CJS):', sdk.spoke.sui.transport.endpoint);

// Verify the sdk → @sodax/libs/stacks/core path resolves correctly under CJS.
// The libs bundle ships dual ESM (.mjs) + CJS (.cjs); ESM is exercised by
// `apps/node/test-libs` + `packages/libs/scripts/verify-runtime-smoke.mjs`,
// so this is the CJS side of that coverage — running `encodeAddress` /
// `serializeAddressData` here exercises bundled `Cl.principal` + `serializeCV`
// reached from a CJS consumer through the sdk barrel.
const stacksAddr = 'SP1D5PA98M0PF9Z4Q4N2CDTMTD7XSZ6GE7QQG5XBX';
const expectedHex = '0x05165a5b2928a02cf4fc972544c6ea9a69fb9f9a0e3d';
assert.strictEqual(
  encodeAddress(ChainKeys.STACKS_MAINNET, stacksAddr),
  expectedHex,
  'sdk → libs/stacks/core (CJS): encodeAddress regression',
);
assert.strictEqual(
  serializeAddressData(stacksAddr),
  expectedHex,
  'sdk → libs/stacks/core (CJS): serializeAddressData regression',
);
console.log('Stacks encode (CJS → libs/stacks/core):', expectedHex);

// Building an unsigned Sui transaction is the path a backend uses to hand a tx to a client for
// signing, and it runs through `@mysten/sui/transactions` + `@mysten/bcs` — both ESM-only. Loading
// the SDK proves they resolve; this proves they still *work* once called from CJS.
// `sendMessage` is the one raw builder that needs no network: its addresses come from the packaged
// spoke config, so this stays deterministic and offline.
void (async () => {
  // The explicit `<true>` keeps the return narrowed to `SuiRawTransaction`; a bare `raw: true`
  // widens to `boolean` and leaves the union unresolved.
  const raw = await sdk.spoke.sui.sendMessage<true>({
    srcAddress: '0x6d7b6956589c17b2755193a67bf2d4b68827e58a6d7b6956589c17b2755193a6',
    srcChainKey: ChainKeys.SUI_MAINNET,
    dstChainKey: ChainKeys.SONIC_MAINNET,
    dstAddress: '0x1468d3529032106291433B7e9e3026dF1Ff78F31',
    payload: '0xdeadbeef',
    raw: true,
  });

  assert.ok(
    typeof raw.data === 'string' && raw.data.length > 0,
    'sdk → @mysten/sui (CJS): raw tx carries no serialized transaction',
  );
  // It must be the Transaction JSON the signing side feeds to `Transaction.from()`, not an opaque blob.
  const ptb: unknown = JSON.parse(raw.data);
  assert.ok(
    ptb !== null && typeof ptb === 'object',
    'sdk → @mysten/sui (CJS): serialized transaction is not a JSON object',
  );
  console.log('Sui raw tx (CJS):', raw.data.length, 'chars,', raw.to);
})().catch((error: unknown) => {
  console.error('sdk → @mysten/sui (CJS): Sui raw tx build regression', error);
  process.exit(1);
});
