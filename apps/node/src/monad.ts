import 'dotenv/config';

import { formatUnits, parseUnits, type Hex } from 'viem';
import { Sodax, encodeContractCalls, encodeRecipient, spokeChainConfig, ChainKeys } from '@sodax/sdk';
import { EvmWalletProvider } from '@sodax/wallet-sdk-core';

/**
 * Monad MPC-relay harness — one file, driving the REAL @sodax/sdk against the live mainnet relay.
 * Monad is EVM for wallets but rides the MPC relay in ADDRESS mode (deposit to a per-payload derived
 * address, swept by the relay) with scheme-0 (EIP-191) withdraw auth, so these call
 * `sodax.spoke.monad` directly with the money-market data builders. Mirrors `src/tron.ts`/`src/xrp.ts`.
 *
 *   cd apps/node && MONAD_PRIVATE_KEY=0x<64-hex> pnpm tsx src/monad.ts <endpoint> [--amount 0.1] [--token 0x..] [--to 0x..] [--data 0x..]
 *
 * Endpoints:
 *   hub        — print the derived hub wallet for the key (no funds)
 *   deposit    — Monad→hub: deposit MON (or USDC via --token), mint on the hub wallet  [spends funds]
 *   supply     — Monad→hub: deposit + supply into the money market (USDC only)         [spends funds]
 *   intent     — Monad→hub: deposit carrying an arbitrary hub payload (--data)        [spends funds]
 *   borrow     — hub→Monad: sign a borrow authorization, relay releases to Monad
 *   withdraw   — hub→Monad: sign a withdraw authorization, relay releases to Monad
 *   balance    — read the Monad-side balance for --token (read-only)
 */

const MONAD = ChainKeys.MONAD_MAINNET;
const NATIVE_MON = '0x0000000000000000000000000000000000000000';

const PK = process.env.MONAD_PRIVATE_KEY ?? '';
if (!/^0x[0-9a-fA-F]{64}$/.test(PK)) throw new Error('set MONAD_PRIVATE_KEY to a 0x-prefixed 64-hex private key');
const argv = process.argv.slice(2);
const endpoint = argv[0] ?? 'hub';
const arg = (n: string, d?: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : d;
};
const TOKEN = arg('--token', NATIVE_MON) as Hex;
const TO = arg('--to') as Hex | undefined; // recipient for withdraw/borrow (defaults to self)
const DATA = (arg('--data', '0x') ?? '0x') as Hex;

function resolveToken() {
  const found = Object.values(spokeChainConfig[MONAD].supportedTokens).find(
    t => t.address.toLowerCase() === TOKEN.toLowerCase(),
  );
  if (!found) throw new Error(`--token ${TOKEN} is not a supported Monad token`);
  return found;
}
const token = resolveToken();
const amountUnits = parseUnits(arg('--amount', '0.1') as string, token.decimals);

// The real raw-key provider — transaction sending and the scheme-0 signature both live there.
const walletProvider = new EvmWalletProvider({ privateKey: PK as Hex, chainId: MONAD });

const sodax = new Sodax();
const monad = sodax.spoke.monad;
const log = (...a: unknown[]) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

async function main() {
  const SENDER = await walletProvider.getWalletAddress();
  const hubWallet = await sodax.hubProvider.getUserHubWalletAddress(SENDER, MONAD);
  log('sender    :', SENDER);
  log('hubWallet :', hubWallet);
  log('endpoint  :', endpoint);

  switch (endpoint) {
    case 'hub':
      return;

    case 'balance': {
      const balance = await monad.getDeposit({ srcChainKey: MONAD, srcAddress: SENDER, token: TOKEN });
      log('balance   :', `${formatUnits(balance, token.decimals)} ${token.symbol}`);
      return;
    }

    case 'deposit':
    case 'supply':
    case 'intent': {
      // A plain deposit still needs an ENCODED empty call array, not a literal '0x': the relay treats
      // non-empty bytes as the signal to deploy the user's hub wallet.
      const data: Hex =
        endpoint === 'supply'
          ? sodax.moneyMarket.buildSupplyData(MONAD, TOKEN, amountUnits, hubWallet)
          : endpoint === 'intent'
            ? DATA
            : encodeContractCalls([]);
      log(`deposit ${formatUnits(amountUnits, token.decimals)} ${token.symbol}`);

      const txHash = await monad.deposit({
        srcChainKey: MONAD,
        srcAddress: SENDER,
        token: TOKEN,
        amount: amountUnits,
        to: hubWallet, // asserted against the hub wallet the relay derives from srcAddress
        data,
        walletProvider,
      });
      log('deposit tx:', txHash, `\n  https://monadscan.com/tx/${txHash}`);
      log('waiting for hub mint via relay ...');
      const res = await monad.waitForDeposit(String(txHash));
      if (!res.ok) throw res.error;
      log('MINTED ✓', JSON.stringify(res.value));
      return;
    }

    case 'borrow':
    case 'withdraw': {
      const recipient = TO ?? SENDER;
      // Monad releases to a plain 20-byte address; `encodeRecipient` returns that for EVM MPC chains.
      const dstAddress = encodeRecipient(MONAD, recipient);
      const payload: Hex =
        endpoint === 'borrow'
          ? sodax.moneyMarket.buildBorrowData(hubWallet, dstAddress, TOKEN, amountUnits, MONAD)
          : sodax.moneyMarket.buildWithdrawData(hubWallet, dstAddress, TOKEN, amountUnits, MONAD);
      log(`${endpoint} ${formatUnits(amountUnits, token.decimals)} ${token.symbol} → ${recipient}`);

      const trackingId = await monad.sendMessage({
        srcChainKey: MONAD,
        srcAddress: SENDER,
        dstChainKey: 'sonic',
        dstAddress: hubWallet,
        payload,
        walletProvider,
      });
      log('trackingId:', trackingId);
      log('waiting for release to Monad via relay ...');
      const res = await monad.waitForWithdrawal(String(trackingId));
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
