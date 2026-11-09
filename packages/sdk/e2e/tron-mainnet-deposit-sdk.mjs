/**
 * MAINNET deposit smoke for the SDK Tron integration — REAL FUNDS.
 *
 * Drives the REAL TronSpokeService.deposit against the live MPC relay (memo mode) using a raw-key
 * ITronWalletProvider, then polls the relay to `minted`. Small amount only (default 3 TRX).
 *
 *   PRIVATE_KEY=<64-hex> node packages/sdk/e2e/tron-mainnet-deposit-sdk.mjs [--amount-trx 3] [--data 0x]
 *
 * Build the sdk first: `pnpm --filter=@sodax/sdk build`.
 */
import { createPublicClient, http, sha256 } from 'viem';
import { privateKeyToAccount, sign } from 'viem/accounts';
import { TronSpokeService } from '@sodax/sdk';

// ---- live mainnet infra (matches spokeChainConfig[TRON_MAINNET] + CLAUDE.md) ----
const RELAY = 'https://e3e55uxnxd.execute-api.us-east-2.amazonaws.com';
const NILE = 'https://api.trongrid.io';
const RESERVE = 'TKEsLgfqRdC9PX88hvW1WWnMhH53qCMe92';
const HUB_RPC = 'https://rpc.soniclabs.com';
const W_TRX = '0x61cd7FFcf33E3F5EB8280b94bc5180bc617b1da9'; // wrapped TRX on the hub

// ---- helpers ----
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
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
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const post = async (base, path, body) =>
  (
    await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  ).json();

// ---- args ----
const PRIVATE_KEY = (process.env.PRIVATE_KEY ?? '').replace(/^0x/, '');
const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : d;
};
const AMOUNT_TRX = Number(arg('--amount-trx', '3'));
const DATA = arg('--data', '0x');
if (!/^[0-9a-fA-F]{64}$/.test(PRIVATE_KEY)) throw new Error('set PRIVATE_KEY to a 64-hex mainnet key');

const evm = privateKeyToAccount(`0x${PRIVATE_KEY}`).address;
const sender = toB58check(Uint8Array.from([0x41, ...Buffer.from(evm.slice(2), 'hex')]));

// Minimal ConfigService stub returning the mainnet Tron config.
const cfg = {
  getChainConfig: () => ({
    chain: {
      name: 'Tron',
      key: 'tron',
      type: 'TRON',
      chainId: 728126428,
      mainnet: true,
      logo: '',
      explorer: { baseUrl: '', txUrl: '', addressUrl: '', contractUrl: '' },
    },
    rpcUrl: NILE,
    mpcRelayApiEndpoint: RELAY,
    addresses: { reserve: RESERVE },
    nativeToken: '0x0000000000000000000000000000000000000000',
    bnUSD: '',
    supportedTokens: {},
    pollingConfig: { pollingIntervalMs: 5000, maxTimeoutMs: 300000 },
  }),
  logger: { debug: () => {}, error: console.error, log: console.log, warn: console.warn },
};

// Full ITronWalletProvider (raw key): signs the txID (deposit) and messages (withdraw).
const walletProvider = {
  chainType: 'TRON',
  getWalletAddress: async () => sender,
  signTransaction: async tx => {
    const s = await sign({ hash: `0x${tx.txID}`, privateKey: `0x${PRIVATE_KEY}` });
    return { ...tx, signature: [s.r.slice(2) + s.s.slice(2) + Number(s.yParity).toString(16).padStart(2, '0')] };
  },
  signMessage: async hash => {
    const s = await sign({ hash, privateKey: `0x${PRIVATE_KEY}` });
    return `0x${s.r.slice(2)}${s.s.slice(2)}${Number(s.yParity).toString(16).padStart(2, '0')}`;
  },
};

const wtrxBalanceOf = async addr => {
  const hub = createPublicClient({ transport: http(HUB_RPC) });
  return hub.readContract({
    address: W_TRX,
    abi: [
      {
        type: 'function',
        name: 'balanceOf',
        stateMutability: 'view',
        inputs: [{ type: 'address' }],
        outputs: [{ type: 'uint256' }],
      },
    ],
    functionName: 'balanceOf',
    args: [addr],
  });
};

async function main() {
  console.log('────────── Tron MAINNET deposit via SDK (REAL FUNDS) ──────────');
  log('sender   :', sender);
  const bal = BigInt(
    (await post(NILE, '/wallet/getaccount', { address: sender, visible: true }).catch(() => ({}))).balance ?? 0,
  );
  log('balance  :', Number(bal) / 1e6, 'TRX');
  const amountSun = BigInt(Math.round(AMOUNT_TRX * 1e6));
  if (bal < amountSun + 1_500_000n)
    throw new Error(`insufficient — need ${AMOUNT_TRX} TRX + ~1.5 for bandwidth; fund ${sender}`);

  const tron = new TronSpokeService(cfg);
  log(`depositing ${AMOUNT_TRX} TRX (data=${DATA}) — mints wTRX to the derived hub wallet`);

  const txHash = await tron.deposit({
    srcChainKey: 'tron',
    srcAddress: sender,
    token: '0x0000000000000000000000000000000000000000',
    amount: amountSun,
    to: '0x0000000000000000000000000000000000000000',
    data: DATA,
    walletProvider,
  });
  log('deposit tx:', txHash);
  log('  https://tronscan.org/#/transaction/' + String(txHash).replace(/^0x/, ''));

  log('waiting for hub mint via relay (~25-50s) ...');
  const res = await tron.waitForDeposit(String(txHash));
  if (!res.ok) throw res.error;
  const rec = res.value;
  log('MINTED ✓');
  log('  hubWallet:', rec.to, '| wTRX balance now:', Number(await wtrxBalanceOf(rec.to)) / 1e6);
  log('  txs:', JSON.stringify(rec.txs));
}
main().catch(e => {
  console.error('\n✗ FAILED:', e.message);
  process.exit(1);
});
