/**
 * On-chain deposit-flow test for the SDK Tron integration — RELAY SKIPPED.
 *
 * Exercises the risky on-chain half of TronSpokeService.deposit using the REAL SDK helpers
 * (spliceMemo, assembleBroadcastHex, tronBase58ToHex) plus the wallet-provider signing shape:
 *   1. derive hubWallet exactly like the ingest: WalletFactory.getDeployedAddress(srcChainId, tronIdentityBytes)
 *   2. memo = payloadHash = keccak256(abi.encode(address hubWallet, bytes data))   (matches computePayloadHash)
 *   3. build a 1-TRX transfer to the reserve on Nile, splice the memo, sign the txID, broadcast
 *   4. confirm on Nile the tx landed carrying the memo
 *
 * The deposit is a REAL memo-mode deposit — it will mint on the hub once the relay ingest is back up.
 * Build the sdk first: `pnpm --filter=@sodax/sdk build`.
 *
 *   PRIVATE_KEY=<64-hex-nile-key> node packages/sdk/e2e/tron-testnet-onchain.mjs [--amount-trx 1] [--data 0x]
 */
import { createPublicClient, http, encodeAbiParameters, keccak256, sha256 } from 'viem';
import { privateKeyToAccount, sign } from 'viem/accounts';
import { assembleBroadcastHex, spliceMemo, tronBase58ToHex } from '@sodax/sdk';

// ---- fixed testnet infra (from the dashboard's baked env / state.json) ----
const NILE_RPC = 'https://nile.trongrid.io';
const RESERVE = 'TNxG5VtWtgoXv3uFqzkA795YUxCL933Xx3';
const SRC_CHAIN_ID = 728126428n;
const HUB_RPC = 'https://rpc.testnet.soniclabs.com';
const WALLET_FACTORY = '0x103328BFB6321AD198D5dc4075a171f01c0472E5';
const FACTORY_ABI = [
  {
    type: 'function',
    name: 'getDeployedAddress',
    stateMutability: 'view',
    inputs: [{ type: 'uint256' }, { type: 'bytes' }],
    outputs: [{ type: 'address' }],
  },
];

// ---- helpers ----
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const hex = u => Buffer.from(u).toString('hex');
const sha256d = bytes => sha256(sha256(bytes, 'bytes'), 'bytes');
const toB58check = bytes => {
  const chk = sha256d(bytes).slice(0, 4);
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
// EVM address (keccak(pubkey)[12:]) == Tron's 20-byte hash; Tron address = base58check(0x41 || hash).
const privToTron = p => {
  const evm = privateKeyToAccount(`0x${p}`).address; // 0x + 20 bytes
  return toB58check(Uint8Array.from([0x41, ...Buffer.from(evm.slice(2), 'hex')]));
};
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const post = async (path, body) =>
  (
    await fetch(`${NILE_RPC}${path}`, {
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
const AMOUNT_TRX = Number(arg('--amount-trx', '1'));
const DATA = arg('--data', '0x');
if (!/^[0-9a-fA-F]{64}$/.test(PRIVATE_KEY)) throw new Error('set PRIVATE_KEY to a 64-hex Nile key');

// The SDK wallet-provider signing contract (ITronWalletProvider.signTransaction): Tron signs the
// txID digest and wants r||s||v with v = recovery id (0/1).
const walletProvider = {
  chainType: 'TRON',
  getWalletAddress: async () => privToTron(PRIVATE_KEY),
  signTransaction: async tx => {
    const s = await sign({ hash: `0x${tx.txID}`, privateKey: `0x${PRIVATE_KEY}` });
    const sig = s.r.slice(2) + s.s.slice(2) + Number(s.yParity).toString(16).padStart(2, '0');
    return { ...tx, signature: [sig] };
  },
};

async function main() {
  const sender = privToTron(PRIVATE_KEY);
  log('sender      :', sender);

  const bal = BigInt((await post('/wallet/getaccount', { address: sender, visible: true })).balance ?? 0);
  log('balance     :', Number(bal) / 1e6, 'TRX');
  const amountSun = BigInt(Math.round(AMOUNT_TRX * 1e6));
  if (bal < amountSun + 2_000_000n) throw new Error('insufficient Nile TRX');

  // --- 1) derive hubWallet exactly like the ingest ---
  const identityHex = `0x${tronBase58ToHex(sender).slice(2)}`; // tronIdentityBytes: 20-byte hash, 0x41 dropped
  const hub = createPublicClient({ transport: http(HUB_RPC) });
  const hubWallet = await hub.readContract({
    address: WALLET_FACTORY,
    abi: FACTORY_ABI,
    functionName: 'getDeployedAddress',
    args: [SRC_CHAIN_ID, identityHex],
  });
  log('identity    :', identityHex);
  log('hubWallet   :', hubWallet);

  // --- 2) memo = payloadHash = keccak256(abi.encode(address, bytes)) ---
  const memo = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes' }], [hubWallet, DATA]));
  log('memo        :', memo, `(data=${DATA})`);

  // --- 3) build TRX transfer → splice memo (SDK) → txID → sign (wallet) → broadcast ---
  const created = await post('/wallet/createtransaction', {
    owner_address: sender,
    to_address: RESERVE,
    amount: Number(amountSun),
    visible: true,
  });
  if (!created.raw_data_hex) throw new Error(`createtransaction failed: ${JSON.stringify(created)}`);

  const rawWithMemo = spliceMemo(created.raw_data_hex, memo); // SDK
  const txID = sha256(`0x${rawWithMemo}`).slice(2); // same as TronSpokeService
  const signed = await walletProvider.signTransaction({ txID, raw_data_hex: rawWithMemo, visible: true });
  const envelope = assembleBroadcastHex(rawWithMemo, signed.signature[0]); // SDK

  const bc = await post('/wallet/broadcasthex', { transaction: envelope });
  if (!bc.result) throw new Error(`broadcast failed: ${JSON.stringify(bc)}`);
  log('deposit tx  :', `0x${txID}`);
  log('  https://nile.tronscan.org/#/transaction/' + txID);

  // --- 4) confirm on Nile the tx landed carrying the memo ---
  log('confirming on Nile ...');
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const info = await post('/wallet/gettransactioninfobyid', { value: txID });
    if (info.blockNumber) {
      const tx = await post('/wallet/gettransactionbyid', { value: txID });
      const onChainData = tx?.raw_data?.data; // Tron exposes the field-10 memo as raw_data.data (hex)
      const memoOnChain = onChainData ? `0x${onChainData}` : '(not found)';
      const ok = memoOnChain.toLowerCase() === memo.toLowerCase();
      log(`confirmed in block ${info.blockNumber} ✓`);
      log(`  on-chain memo: ${memoOnChain} ${ok ? '✓ matches derived memo' : '✗ MISMATCH'}`);
      log(`  bandwidth: ${info.receipt?.net_usage ?? 0}, net_fee: ${info.receipt?.net_fee ?? 0} sun`);
      if (!ok) process.exit(1);
      log('on-chain deposit flow OK — this deposit will mint once the relay ingest is back up.');
      return;
    }
  }
  log('broadcast done; confirmation slow — check the tx link.');
}
main().catch(e => {
  console.error('\n✗ FAILED:', e.message);
  process.exit(1);
});
