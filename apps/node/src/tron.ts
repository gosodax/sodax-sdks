import 'dotenv/config';

import { createPublicClient, http, type Hex } from 'viem';
import { Sodax, encodeContractCalls, tronIdentityBytes } from '@sodax/sdk';
import { TronWalletProvider } from '@sodax/wallet-sdk-core';

/**
 * Tron MPC-relay harness — one file, five endpoints, driving the REAL @sodax/sdk against the live
 * mainnet relay. Tron rides the MPC relay (memo-mode deposit, signature-mode withdraw), not the
 * intent relay, so these call TronSpokeService directly (`sodax.spoke.tron`) with the money-market
 * data builders (`sodax.moneyMarket.build*Data`).
 *
 *   cd apps/node && TRON_PRIVATE_KEY=<64-hex> pnpm tsx src/tron.ts <endpoint> [--amount-trx 3] [--token 0x..] [--to T..] [--data 0x..]
 *
 * Endpoints:
 *   hub        — print the derived hub wallet for the key (no funds)
 *   deposit    — Tron→hub: deposit TRX (or a TRC-20 via --token), mint on the hub wallet   [spends TRX]
 *   supply     — Tron→hub: deposit + supply into the money market (buildSupplyData)         [spends TRX]
 *   intent     — Tron→hub: deposit carrying an arbitrary hub payload (--data)               [spends TRX]
 *   borrow     — hub→Tron: sign a borrow authorization, relay releases to Tron (buildBorrowData)
 *   withdraw   — hub→Tron: sign a withdraw authorization, relay releases to Tron (buildWithdrawData)
 *   swap       — quote wTRX→outputToken via the solver (read-only); intent-data build is the TODO
 */

const NATIVE_TRX = '0x0000000000000000000000000000000000000000';
const TRON = 'tron' as const;
const HUB_RPC = 'https://rpc.soniclabs.com';
const W_TRX = '0x61cd7FFcf33E3F5EB8280b94bc5180bc617b1da9'; // wrapped TRX on the hub

// ---- key / args ----
const PK = (process.env.TRON_PRIVATE_KEY ?? '').replace(/^0x/, '');
if (!/^[0-9a-fA-F]{64}$/.test(PK)) throw new Error('set TRON_PRIVATE_KEY to a 64-hex Tron key');
const argv = process.argv.slice(2);
const endpoint = argv[0] ?? 'hub';
const arg = (n: string, d?: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : d;
};
const AMOUNT_TRX = Number(arg('--amount-trx', '3'));
const TOKEN = arg('--token', NATIVE_TRX) as string;
const TO = arg('--to'); // recipient Tron address for withdraw/borrow (defaults to self)
const DATA = (arg('--data', '0x') ?? '0x') as Hex;
const amountUnits = BigInt(Math.round(AMOUNT_TRX * 1e6)); // TRX/USDT are 6 decimals

// The real raw-key provider from @sodax/wallet-sdk-core — address derivation, deposit txID
// signing, and the scheme-1 TIP-191 withdraw-auth digest all live there. This harness deliberately
// keeps NO signing logic of its own: an earlier inline copy drifted from the provider and signed
// the bare message hash, which NEAR rejected with "Recovered address does not match sender".
const walletProvider = new TronWalletProvider({ privateKey: PK });

const sodax = new Sodax();
const tron = sodax.spoke.tron; // TronSpokeService, already constructed with the mainnet config
const log = (...a: unknown[]) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

const wtrxBalanceOf = (addr: string) =>
  createPublicClient({ transport: http(HUB_RPC) }).readContract({
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
    args: [addr as Hex],
  });

async function main() {
  // Derived by the provider from the key, so the address and the signer can never disagree.
  const SENDER = await walletProvider.getWalletAddress();
  const hubWallet = await sodax.hubProvider.getUserHubWalletAddress(SENDER, TRON);
  log('sender    :', SENDER);
  log('hubWallet :', hubWallet);
  log('endpoint  :', endpoint);

  switch (endpoint) {
    case 'hub':
      return;

    // ---- Tron → hub ----
    case 'deposit':
    case 'supply':
    case 'intent': {
      // A plain deposit still needs an ENCODED empty call array, not a literal '0x': the relay
      // treats those non-empty bytes as the signal to deploy the user's hub wallet, so '0x' mints
      // to a wallet that was never deployed.
      const data: Hex =
        endpoint === 'supply'
          ? sodax.moneyMarket.buildSupplyData(TRON, TOKEN, amountUnits, hubWallet)
          : endpoint === 'intent'
            ? DATA
            : encodeContractCalls([]);
      log(`deposit ${AMOUNT_TRX} TRX  data=${data.slice(0, 42)}${data.length > 42 ? '…' : ''}`);

      const txHash = await tron.deposit({
        srcChainKey: TRON,
        srcAddress: SENDER,
        token: TOKEN,
        amount: amountUnits,
        to: hubWallet, // asserted against the hub wallet the relay derives from srcAddress
        data,
        walletProvider,
      });
      log('deposit tx:', txHash, `\n  https://tronscan.org/#/transaction/${String(txHash).replace(/^0x/, '')}`);
      log('waiting for hub mint via relay ...');
      const res = await tron.waitForDeposit(String(txHash));
      if (!res.ok) throw res.error;
      log('MINTED ✓', JSON.stringify(res.value));
      if (endpoint === 'deposit') log('wTRX balance:', Number(await wtrxBalanceOf(hubWallet)) / 1e6);
      return;
    }

    // ---- hub → Tron (signature-mode release) ----
    case 'borrow':
    case 'withdraw': {
      const recipient = TO ?? SENDER;
      const payload: Hex =
        endpoint === 'borrow'
          ? sodax.moneyMarket.buildBorrowData(hubWallet, tronIdentityBytes(recipient), TOKEN, amountUnits, TRON)
          : sodax.moneyMarket.buildWithdrawData(hubWallet, tronIdentityBytes(recipient), TOKEN, amountUnits, TRON);
      log(`${endpoint} ${AMOUNT_TRX} → ${recipient}  payload=${payload.slice(0, 42)}…`);

      const trackingId = await tron.sendMessage({
        srcChainKey: TRON,
        srcAddress: SENDER,
        dstChainKey: 'sonic',
        dstAddress: hubWallet,
        payload,
        walletProvider,
      });
      log('trackingId:', trackingId);
      log('waiting for release to Tron via relay ...');
      const res = await tron.waitForWithdrawal(String(trackingId));
      if (!res.ok) throw res.error;
      log('RELEASED ✓', JSON.stringify(res.value));
      return;
    }

    // ---- read-only solver quote ----
    case 'swap': {
      // Quotes are keyed by the SPOKE-side address (what `swapSupportedTokens` lists), not the hub
      // asset — passing wTRX here is rejected as an unsupported token_src for the chain.
      const outputToken = arg('--output-token', TOKEN) as string;
      const dstChain = arg('--dst-chain', TRON) as 'tron';
      const quote = await sodax.swaps.getQuote({
        token_src: TOKEN,
        token_src_blockchain_id: TRON,
        token_dst: outputToken,
        token_dst_blockchain_id: dstChain,
        amount: amountUnits,
        quote_type: 'exact_input',
      });
      // The solver returns bigint amounts, which JSON.stringify refuses outright.
      const j = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));
      log('quote:', quote.ok ? j(quote.value) : `failed: ${j(quote.error?.detail ?? quote.error)}`);
      return;
    }

    default:
      throw new Error(`unknown endpoint "${endpoint}" (hub|deposit|supply|intent|borrow|withdraw|swap)`);
  }
}

main().catch(e => {
  console.error('\n✗ FAILED:', e.message);
  process.exit(1);
});
