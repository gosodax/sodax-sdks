import 'dotenv/config';

import { formatUnits, parseUnits, type Hex } from 'viem';
import { Sodax, encodeContractCalls, encodeRecipient, spokeChainConfig, ChainKeys, tonWalletAddress } from '@sodax/sdk';
import { TonWalletProvider } from '@sodax/wallet-sdk-core';

/**
 * TON MPC-relay harness — one file, driving the REAL @sodax/sdk against the live mainnet relay. TON rides the
 * MPC relay in memo mode, addressed by the account's PUBLIC KEY (the relay identity), and sends from the key's
 * wallet-v4R2 address. Mirrors `src/monad.ts` / `src/xrp.ts`.
 *
 *   cd apps/node && TON_PRIVATE_KEY=<64-hex ed25519 seed> pnpm tsx src/ton.ts <endpoint> [--amount 0.1] [--token <jetton master>]
 *
 * Endpoints:
 *   hub        — print the public key, wallet address and derived hub wallet (no funds)
 *   deposit    — TON→hub: deposit TON (or USDT via --token), mint on the hub wallet  [spends funds]
 *   supply     — TON→hub: deposit + supply into the money market (USDT only)       [spends funds]
 *   intent     — TON→hub: deposit carrying an arbitrary hub payload (--data)       [spends funds]
 *   borrow     — hub→TON: sign a borrow authorization, relay releases to the key's wallet-v4R2 address
 *   withdraw   — hub→TON: sign a withdraw authorization, relay releases to the key's wallet-v4R2 address
 *   balance    — read the TON-side balance for --token (read-only)
 *
 * Set TONCENTER_API_KEY to lift toncenter's ~1 req/s keyless limit, and TON_SIGN_DATA_DOMAIN to the app
 * domain the relay expects in withdraw signatures.
 */

const TON = ChainKeys.TON_MAINNET;
const NATIVE_TON = '0x0000000000000000000000000000000000000000';

const PK = (process.env.TON_PRIVATE_KEY ?? '').replace(/^0x/, '');
if (!/^[0-9a-fA-F]{64}$/.test(PK)) throw new Error('set TON_PRIVATE_KEY to a 64-hex ed25519 seed');
const argv = process.argv.slice(2);
const endpoint = argv[0] ?? 'hub';
const arg = (n: string, d?: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : d;
};
const TOKEN = arg('--token', NATIVE_TON) as string;
const DATA = (arg('--data', '0x') ?? '0x') as Hex;

function resolveToken() {
  const found = Object.values(spokeChainConfig[TON].supportedTokens).find(t => t.address === TOKEN);
  if (!found) throw new Error(`--token ${TOKEN} is not a supported TON token`);
  return found;
}
const token = resolveToken();
const amountUnits = parseUnits(arg('--amount', '0.1') as string, token.decimals);

const walletProvider = new TonWalletProvider({
  privateKey: PK,
  ...(process.env.TONCENTER_API_KEY ? { apiKey: process.env.TONCENTER_API_KEY } : {}),
  ...(process.env.TON_SIGN_DATA_DOMAIN ? { signDataDomain: process.env.TON_SIGN_DATA_DOMAIN } : {}),
});

const sodax = new Sodax();
const ton = sodax.spoke.ton;
const log = (...a: unknown[]) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

async function main() {
  const PUBKEY = await walletProvider.getWalletAddress();
  const hubWallet = await sodax.hubProvider.getUserHubWalletAddress(PUBKEY, TON);
  log('publicKey :', PUBKEY);
  log('wallet    :', await walletProvider.getAccountAddress(), '(wallet-v4R2 — fund this)');
  log('hubWallet :', hubWallet);
  log('endpoint  :', endpoint);

  switch (endpoint) {
    case 'hub':
      return;

    case 'balance': {
      const balance = await ton.getDeposit({ srcChainKey: TON, srcAddress: PUBKEY, token: TOKEN });
      log('balance   :', `${formatUnits(balance, token.decimals)} ${token.symbol}`);
      return;
    }

    case 'deposit':
    case 'supply':
    case 'intent': {
      // A plain deposit still needs an ENCODED empty call array, not a literal '0x'.
      const data: Hex =
        endpoint === 'supply'
          ? sodax.moneyMarket.buildSupplyData(TON, TOKEN, amountUnits, hubWallet)
          : endpoint === 'intent'
            ? DATA
            : encodeContractCalls([]);
      log(`deposit ${formatUnits(amountUnits, token.decimals)} ${token.symbol}`);

      const txHash = await ton.deposit({
        srcChainKey: TON,
        srcAddress: PUBKEY,
        token: TOKEN,
        amount: amountUnits,
        to: hubWallet, // asserted against the hub wallet the relay derives from the public key
        data,
        walletProvider,
      });
      log('reserve tx:', txHash, `\n  https://tonviewer.com/transaction/${String(txHash).replace(/^0x/, '')}`);
      log('waiting for hub mint via relay ...');
      const res = await ton.waitForDeposit(String(txHash));
      if (!res.ok) throw res.error;
      log('MINTED ✓', JSON.stringify(res.value));
      return;
    }

    case 'borrow':
    case 'withdraw': {
      // The release pays the key's wallet-v4R2 address — the same encoding the SDK's money-market flows apply.
      const dstAddress = encodeRecipient(TON, PUBKEY);
      const payload: Hex =
        endpoint === 'borrow'
          ? sodax.moneyMarket.buildBorrowData(hubWallet, dstAddress, TOKEN, amountUnits, TON)
          : sodax.moneyMarket.buildWithdrawData(hubWallet, dstAddress, TOKEN, amountUnits, TON);
      log(
        `${endpoint} ${formatUnits(amountUnits, token.decimals)} ${token.symbol} → ${tonWalletAddress(PUBKEY).toString({ bounceable: false })}`,
      );

      const trackingId = await ton.sendMessage({
        srcChainKey: TON,
        srcAddress: PUBKEY,
        dstChainKey: 'sonic',
        dstAddress: hubWallet,
        payload,
        walletProvider,
      });
      log('trackingId:', trackingId);
      log('waiting for release to TON via relay ...');
      const res = await ton.waitForWithdrawal(String(trackingId));
      if (!res.ok) throw res.error;
      log('RELEASED ✓', JSON.stringify(res.value));
      return;
    }

    default:
      throw new Error(`unknown endpoint "${endpoint}" (hub|deposit|supply|intent|borrow|withdraw|balance)`);
  }
}

main().catch(e => {
  console.error('\n✗ FAILED:', e.message);
  process.exit(1);
});
