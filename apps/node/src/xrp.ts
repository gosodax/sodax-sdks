import 'dotenv/config';

import { createPublicClient, http, type Hex } from 'viem';
import { Sodax, encodeContractCalls, xrpIdentityBytes } from '@sodax/sdk';
import { XrpWalletProvider } from '@sodax/wallet-sdk-core';

/**
 * XRPL MPC-relay harness — one file, driving the REAL @sodax/sdk against the live mainnet relay.
 * XRPL rides the MPC relay (memo-mode deposit, signature-mode withdraw) rather than the intent
 * relay, so these call `sodax.spoke.xrp` directly with the money-market data builders. Mirrors
 * `src/tron.ts`; the differences from Tron are all in the withdraw-auth scheme (3, not 1).
 *
 *   cd apps/node && XRP_PRIVATE_KEY=<64-hex ed25519 entropy> pnpm tsx src/xrp.ts <endpoint> [--amount-xrp 3] [--token 0x..|r..] [--to r..] [--data 0x..]
 *
 * Endpoints:
 *   hub        — print the derived hub wallet for the key (no funds)
 *   deposit    — XRPL→hub: deposit XRP (or an IOU via --token <issuer>), mint on the hub wallet  [spends XRP]
 *   supply     — XRPL→hub: deposit + supply into the money market (buildSupplyData)              [spends XRP]
 *   intent     — XRPL→hub: deposit carrying an arbitrary hub payload (--data)                    [spends XRP]
 *   borrow     — hub→XRPL: sign a borrow authorization, relay releases to XRPL (buildBorrowData)
 *   withdraw   — hub→XRPL: sign a withdraw authorization, relay releases to XRPL (buildWithdrawData)
 *   balance    — read the XRPL-side balance for --token (read-only)
 *   fee        — read the current ledger base fee in drops (read-only)
 *   swap       — quote wXRP→--output-token via the solver (read-only)
 *
 * The key MUST be ed25519 entropy: withdraw-auth scheme 3 verifies an ed25519 signature and derives
 * the identity as ripemd160(sha256(pubkey)). A secp256k1 XRPL account can deposit and then never
 * withdraw, so `XrpWalletProvider` pins the algorithm rather than inferring it.
 *
 * An IOU deposit additionally needs the RESERVE to already hold a trustline for that currency —
 * the Payment fails on ledger otherwise, before the relay ever sees it.
 */

const NATIVE_XRP = '0x0000000000000000000000000000000000000000';
const XRP = 'xrp' as const;
const HUB_RPC = 'https://rpc.soniclabs.com';
const W_XRP = '0xd4FE528Cb89A9228E3167db260A0036942A21277'; // wrapped XRP on the hub

// ---- key / args ----
const PK = (process.env.XRP_PRIVATE_KEY ?? '').replace(/^0x/, '');
if (!/^[0-9a-fA-F]{64}$/.test(PK)) throw new Error('set XRP_PRIVATE_KEY to 64-hex ed25519 entropy');
const argv = process.argv.slice(2);
const endpoint = argv[0] ?? 'hub';
const arg = (n: string, d?: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : d;
};
const AMOUNT_XRP = Number(arg('--amount-xrp', '3'));
const TOKEN = arg('--token', NATIVE_XRP) as string;
const TO = arg('--to'); // recipient XRPL classic address for withdraw/borrow (defaults to self)
const DATA = (arg('--data', '0x') ?? '0x') as Hex;
// XRP is 6 decimals (drops), and the relay registers its IOUs at 6 too.
const amountUnits = BigInt(Math.round(AMOUNT_XRP * 1e6));

// The real raw-key provider from @sodax/wallet-sdk-core — address derivation, Payment signing and
// the scheme-3 raw-hash signature all live there. This harness keeps NO signing logic of its own,
// so it cannot drift from the provider the SDK actually uses.
const walletProvider = new XrpWalletProvider({ privateKey: PK });

const sodax = new Sodax();
const xrp = sodax.spoke.xrp; // XrpSpokeService, already constructed with the mainnet config
const log = (...a: unknown[]) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

const wxrpBalanceOf = (addr: string) =>
  createPublicClient({ transport: http(HUB_RPC) }).readContract({
    address: W_XRP,
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
    args: [addr as Hex],
  });

async function main() {
  // Derived by the provider from the key, so the address and the signer can never disagree.
  const SENDER = await walletProvider.getWalletAddress();
  const hubWallet = await sodax.hubProvider.getUserHubWalletAddress(SENDER, XRP);
  log('sender    :', SENDER);
  log('publicKey :', await walletProvider.getPublicKey());
  log('hubWallet :', hubWallet);
  log('endpoint  :', endpoint);

  switch (endpoint) {
    case 'hub':
      return;

    // ---- read-only ----
    case 'balance': {
      const balance = await xrp.getDeposit({ srcChainKey: XRP, srcAddress: SENDER, token: TOKEN });
      log('balance   :', `${Number(balance) / 1e6} (${balance} base units)`);
      log('wXRP (hub):', Number(await wxrpBalanceOf(hubWallet)) / 1e6);
      return;
    }

    case 'fee': {
      // XRPL charges a flat per-transaction fee rather than metering execution, so the estimate
      // does not depend on `tx` — it is passed only because the shared params type requires it.
      const { fee } = await xrp.estimateGas({
        chainKey: XRP,
        tx: { from: SENDER, to: SENDER, value: amountUnits, data: '0x', token: TOKEN },
      });
      log('base fee  :', `${fee} drops`);
      return;
    }

    // ---- XRPL → hub ----
    case 'deposit':
    case 'supply':
    case 'intent': {
      // A plain deposit still needs an ENCODED empty call array, not a literal '0x': the relay
      // treats those non-empty bytes as the signal to deploy the user's hub wallet, so '0x' mints
      // to a wallet that was never deployed.
      const data: Hex =
        endpoint === 'supply'
          ? sodax.moneyMarket.buildSupplyData(XRP, TOKEN, amountUnits, hubWallet)
          : endpoint === 'intent'
            ? DATA
            : encodeContractCalls([]);
      log(`deposit ${AMOUNT_XRP} ${TOKEN === NATIVE_XRP ? 'XRP' : TOKEN}  data=${data.slice(0, 42)}${data.length > 42 ? '…' : ''}`);

      const txHash = await xrp.deposit({
        srcChainKey: XRP,
        srcAddress: SENDER,
        token: TOKEN,
        amount: amountUnits,
        to: hubWallet, // asserted against the hub wallet the relay derives from srcAddress
        data,
        walletProvider,
      });
      log('deposit tx:', txHash, `\n  https://livenet.xrpl.org/transactions/${String(txHash).replace(/^0x/, '')}`);
      log('waiting for hub mint via relay ...');
      const res = await xrp.waitForDeposit(String(txHash));
      if (!res.ok) throw res.error;
      log('MINTED ✓', JSON.stringify(res.value));
      if (endpoint === 'deposit') log('wXRP balance:', Number(await wxrpBalanceOf(hubWallet)) / 1e6);
      return;
    }

    // ---- hub → XRPL (signature-mode release) ----
    case 'borrow':
    case 'withdraw': {
      const recipient = TO ?? SENDER;
      // The same encoding the SDK's own `moneyMarket.borrow`/`withdraw` apply via `encodeAddress`,
      // so this harness exercises the real path instead of a hand-rolled variant that could drift.
      const dstAddress = xrpIdentityBytes(recipient);
      const payload: Hex =
        endpoint === 'borrow'
          ? sodax.moneyMarket.buildBorrowData(hubWallet, dstAddress, TOKEN, amountUnits, XRP)
          : sodax.moneyMarket.buildWithdrawData(hubWallet, dstAddress, TOKEN, amountUnits, XRP);
      log(`${endpoint} ${AMOUNT_XRP} → ${recipient}  payload=${payload.slice(0, 42)}…`);

      const trackingId = await xrp.sendMessage({
        srcChainKey: XRP,
        srcAddress: SENDER,
        dstChainKey: 'sonic',
        dstAddress: hubWallet,
        payload,
        walletProvider,
      });
      log('trackingId:', trackingId);
      log('waiting for release to XRPL via relay ...');
      const res = await xrp.waitForWithdrawal(String(trackingId));
      if (!res.ok) throw res.error;
      log('RELEASED ✓', JSON.stringify(res.value));
      return;
    }

    // ---- read-only solver quote ----
    case 'swap': {
      // Quotes are keyed by the SPOKE-side address (what `swapSupportedTokens` lists), not the hub
      // asset — passing wXRP here is rejected as an unsupported token_src for the chain.
      const outputToken = arg('--output-token', TOKEN) as string;
      const dstChain = arg('--dst-chain', XRP) as 'xrp';
      const quote = await sodax.swaps.getQuote({
        token_src: TOKEN,
        token_src_blockchain_id: XRP,
        token_dst: outputToken,
        token_dst_blockchain_id: dstChain,
        amount: amountUnits,
        quote_type: 'exact_input',
      });
      const j = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));
      log('quote:', quote.ok ? j(quote.value) : `failed: ${j(quote.error?.detail ?? quote.error)}`);
      return;
    }

    default:
      throw new Error(`unknown endpoint "${endpoint}" (hub|deposit|supply|intent|borrow|withdraw|balance|fee|swap)`);
  }
}

main().catch(e => {
  console.error('\n✗ FAILED:', e.message);
  process.exit(1);
});
