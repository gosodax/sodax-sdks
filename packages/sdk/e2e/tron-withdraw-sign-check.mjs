/**
 * Offline validation of the SDK Tron withdraw signing path (no funds, no relay).
 *
 * Builds a withdraw-auth message with the REAL SDK helpers (computeSignedMessageHash,
 * tronIdentityBytes), signs it the way scheme 1 (Tron signMessageV2) expects, and proves the
 * signature recovers back to the Tron identity — exactly the check the relay/NEAR contract does
 * before accepting a withdrawal. If it recovers, a live withdraw would be accepted.
 *
 * If RELAY_URL is also set, it additionally drives the REAL TronSpokeService.sendMessage end-to-end.
 *
 *   PRIVATE_KEY=<64-hex> [RELAY_URL=<ingest url>] node packages/sdk/e2e/tron-withdraw-sign-check.mjs
 *
 * Build the sdk and wallet-sdk-core first: `pnpm --filter=@sodax/sdk --filter=@sodax/wallet-sdk-core build`.
 */
import { concat, keccak256, recoverAddress, stringToBytes, toBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { computeSignedMessageHash, tronIdentityBytes } from '@sodax/sdk';

const PRIVATE_KEY = (process.env.PRIVATE_KEY ?? '').replace(/^0x/, '');
if (!/^[0-9a-fA-F]{64}$/.test(PRIVATE_KEY)) throw new Error('set PRIVATE_KEY to a 64-hex key');

const SRC_CHAIN_ID = 728126428n;
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

// EVM address (keccak(pubkey)[12:]) == Tron's 20-byte hash; Tron base58 = base58check(0x41 || hash).
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const { sha256 } = await import('viem');
const hexbuf = u => Buffer.from(u).toString('hex');
const sha256d = b => sha256(sha256(b, 'bytes'), 'bytes');
const toB58check = bytes => {
  const chk = sha256d(bytes).slice(0, 4);
  const full = Uint8Array.from([...bytes, ...chk]);
  let n = BigInt(`0x${hexbuf(full)}`);
  let s = '';
  while (n > 0n) {
    s = B58[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of full) {
    if (b === 0) s = `1${s}`;
    else break;
  }
  return s;
};
const evm = privateKeyToAccount(`0x${PRIVATE_KEY}`).address;
const senderTron = toB58check(Uint8Array.from([0x41, ...Buffer.from(evm.slice(2), 'hex')]));

// @sodax/sdk does not depend on wallet-sdk-core, so load its workspace build (`pnpm --filter=@sodax/wallet-sdk-core build`).
const { TronWalletProvider } = await import(new URL('../../wallet-sdk-core/dist/index.mjs', import.meta.url).href);
const walletProvider = new TronWalletProvider({ privateKey: `0x${PRIVATE_KEY}` });

async function main() {
  const sender = tronIdentityBytes(senderTron); // 0x + 20-byte identity
  log('tron address :', senderTron);
  log('identity     :', sender);

  // A representative withdraw message (payload/hubWallet are placeholders for the offline check).
  const message = {
    to: '0x000000000000000000000000000000000000dEaD', // hub wallet (placeholder)
    data: '0x1234abcd', // encoded hub-wallet calls (placeholder)
    nonce: 1753142400000n,
    chainId: SRC_CHAIN_ID,
    sender,
  };
  const hash = computeSignedMessageHash(message); // SDK
  log('message hash :', hash);

  const sig = await walletProvider.signMessage(hash);
  // TIP-191 signs the lowercase 0x-hex text (66 characters), not the decoded hash bytes.
  const digest = keccak256(concat([toBytes('\x19TRON Signed Message:\n66'), stringToBytes(hash.toLowerCase())]));
  log('signature    :', sig, `(${(sig.length - 2) / 2} bytes)`);

  // The relay's scheme-1 check: recover the signer from the TRON-prefixed digest → must equal identity.
  const recovered = await recoverAddress({ hash: digest, signature: sig });
  const ok = recovered.toLowerCase() === sender.toLowerCase();
  log('recovered    :', recovered, ok ? '✓ matches identity' : '✗ MISMATCH');
  if (!ok) process.exit(1);
  log('withdraw signing OK — a live withdraw with this signature would be accepted (scheme 1).');

  if (process.env.RELAY_URL) {
    log('\nRELAY_URL set — driving TronSpokeService.sendMessage end-to-end ...');
    const { TronSpokeService } = await import('@sodax/sdk');
    const cfg = {
      getChainConfig: () => ({
        chain: {
          name: 'Tron Nile',
          key: 'tron',
          type: 'TRON',
          chainId: 728126428,
          mainnet: false,
          logo: '',
          explorer: { baseUrl: '', txUrl: '', addressUrl: '', contractUrl: '' },
        },
        rpcUrl: 'https://nile.trongrid.io',
        mpcRelayApiEndpoint: process.env.RELAY_URL,
        addresses: { reserve: 'TNxG5VtWtgoXv3uFqzkA795YUxCL933Xx3' },
        nativeToken: '0x0000000000000000000000000000000000000000',
        bnUSD: '',
        supportedTokens: {},
        pollingConfig: { pollingIntervalMs: 3000, maxTimeoutMs: 120000 },
      }),
      logger: { debug: () => {}, error: console.error, log: console.log, warn: console.warn },
    };
    const tron = new TronSpokeService(cfg);
    const trackingId = await tron.sendMessage({
      srcChainKey: 'tron',
      srcAddress: senderTron,
      dstChainKey: 'sonic',
      dstAddress: message.to,
      payload: message.data,
      walletProvider,
    });
    log('trackingId   :', trackingId);
    const res = await tron.waitForWithdrawal(trackingId);
    if (!res.ok) throw res.error;
    log('withdrawal released ✓', JSON.stringify(res.value));
  }
}
main().catch(e => {
  console.error('\n✗ FAILED:', e.message);
  process.exit(1);
});
