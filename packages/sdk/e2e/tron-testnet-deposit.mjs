/**
 * Live testnet smoke for the SDK Tron integration (Nile).
 *
 * Drives the REAL TronSpokeService.deposit against the testnet MPC relay + Nile, using a raw-key
 * ITronWalletProvider. Keeps the deposit tiny (default 1 TRX) — testnet TRX only.
 *
 *   RELAY_URL=<ingest api url> PRIVATE_KEY=<64-hex> \
 *     node packages/sdk/e2e/tron-testnet-deposit.mjs [--amount-trx 1] [--data 0x...]
 *
 * Build the sdk first (`pnpm --filter=@sodax/sdk build`) so the import below resolves.
 */
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';
import { TronSpokeService } from '@sodax/sdk';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const H = h => Uint8Array.from(Buffer.from(h.replace(/^0x/, ''), 'hex'));
const hex = u => Buffer.from(u).toString('hex');
const toB58 = bytes => {
  const chk = nobleSha256(nobleSha256(bytes)).slice(0, 4);
  const full = Uint8Array.from([...bytes, ...chk]);
  let n = BigInt(`0x${hex(full)}`);
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
const privToTron = p =>
  toB58(Uint8Array.from([0x41, ...keccak_256(secp256k1.getPublicKey(H(p), false).slice(1)).slice(12)]));

// ---- args / env ----
const RELAY_URL = process.env.RELAY_URL;
const PRIVATE_KEY = (process.env.PRIVATE_KEY ?? '').replace(/^0x/, '');
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : def;
};
const AMOUNT_TRX = Number(arg('--amount-trx', '1'));
const DATA = arg('--data', '0x');

if (!RELAY_URL) throw new Error('set RELAY_URL to the testnet ingest api url');
if (!/^[0-9a-fA-F]{64}$/.test(PRIVATE_KEY)) throw new Error('set PRIVATE_KEY to a 64-hex Nile key');

const sender = privToTron(PRIVATE_KEY);

// ---- testnet Tron chain config (from v2/deploy/testnet/state.json) ----
const testnetTronConfig = {
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
  mpcRelayApiEndpoint: RELAY_URL,
  addresses: { reserve: 'TNxG5VtWtgoXv3uFqzkA795YUxCL933Xx3' },
  nativeToken: '0x0000000000000000000000000000000000000000',
  bnUSD: '',
  supportedTokens: {},
  pollingConfig: { pollingIntervalMs: 3000, maxTimeoutMs: 120000 },
};

// Minimal ConfigService stub — TronSpokeService only reads getChainConfig() + logger.
const configStub = {
  getChainConfig: () => testnetTronConfig,
  logger: {
    debug: (...a) => console.debug('[debug]', ...a),
    error: (...a) => console.error('[error]', ...a),
    log: console.log,
    warn: console.warn,
  },
};

// Raw-key ITronWalletProvider: signs the txID Tron actually signs (r||s||v).
const walletProvider = {
  chainType: 'TRON',
  getWalletAddress: async () => sender,
  signTransaction: async tx => {
    const sig = secp256k1.sign(H(tx.txID), H(PRIVATE_KEY), { prehash: false, format: 'recovered' });
    return { ...tx, signature: [hex(Uint8Array.from([...sig.slice(1), sig[0]]))] };
  },
  waitForTransactionReceipt: async () => ({ id: '' }),
};

const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

async function main() {
  const tron = new TronSpokeService(configStub);
  log('sender          :', sender);
  log('reserve         :', testnetTronConfig.addresses.reserve);
  log('relay           :', RELAY_URL);
  log(`depositing      : ${AMOUNT_TRX} TRX (data=${DATA})`);

  const txHash = await tron.deposit({
    srcAddress: sender,
    srcChainKey: 'tron',
    token: testnetTronConfig.nativeToken,
    amount: BigInt(Math.round(AMOUNT_TRX * 1e6)),
    to: '0x0000000000000000000000000000000000000000',
    data: DATA,
    walletProvider,
  });
  log('deposit tx      :', txHash);
  log('  https://nile.tronscan.org/#/transaction/' + String(txHash).replace(/^0x/, ''));

  log('waiting for hub mint via relay ...');
  const res = await tron.waitForDeposit(String(txHash));
  if (!res.ok) throw res.error;
  log('deposit minted ✓', JSON.stringify(res.value));
}
main().catch(e => {
  console.error('\n✗ FAILED:', e.message);
  process.exit(1);
});
