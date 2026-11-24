import 'dotenv/config';

import {
  ChainKeys,
  encodeContractCalls,
  encodeRecipient,
  getMpcPayoutMinimum,
  Sodax,
  zcashSupportedTokens,
} from '@sodax/sdk';
import { ZcashWalletProvider } from '@sodax/wallet-sdk-core';
import { parseUnits } from 'viem';

const ZCASH = ChainKeys.ZCASH_MAINNET;
const token = zcashSupportedTokens.ZEC;

function isHttpsUrl(value: string): value is `https://${string}` {
  return value.startsWith('https://');
}

async function main() {
  const [command, amountText = '0.002'] = process.argv.slice(2);
  if (command === '--help' || command === undefined) {
    console.log('pnpm zcash deposit|supply|withdraw [amount in ZEC]');
    console.log('Set ZCASH_PRIVATE_KEY and ZCASH_RPC_URL. Supply before withdrawing from the money market.');
    return;
  }
  if (command !== 'deposit' && command !== 'supply' && command !== 'withdraw') {
    throw new Error('Expected deposit, supply or withdraw');
  }
  if (!/^\d+(?:\.\d{1,8})?$/.test(amountText)) throw new Error('Expected a ZEC amount with at most 8 decimals');
  const amount = parseUnits(amountText, token.decimals);
  if (amount <= 0n) throw new Error('Amount must be positive');
  const minimum = getMpcPayoutMinimum(token);
  if (command === 'withdraw' && (minimum === undefined || amount <= minimum)) {
    throw new Error('Zcash withdrawal must exceed the configured payout floor (0.001 ZEC)');
  }

  const privateKey = process.env.ZCASH_PRIVATE_KEY;
  const rpcUrl = process.env.ZCASH_RPC_URL;
  if (!privateKey || !rpcUrl || !isHttpsUrl(rpcUrl)) {
    throw new Error('Set ZCASH_PRIVATE_KEY and an HTTPS ZCASH_RPC_URL with address indexing');
  }
  const walletProvider = new ZcashWalletProvider({ privateKey });
  const srcAddress = await walletProvider.getWalletAddress();
  const sodax = new Sodax({ chains: { [ZCASH]: { rpcUrl } } });
  const spoke = sodax.spoke.zcash;
  const hubWallet = await sodax.hubProvider.getUserHubWalletAddress(srcAddress, ZCASH);

  if (command === 'withdraw') {
    const payload = sodax.moneyMarket.buildWithdrawData(
      hubWallet,
      encodeRecipient(ZCASH, srcAddress),
      token.address,
      amount,
      ZCASH,
    );
    const trackingId = await spoke.sendMessage<false>({
      srcChainKey: ZCASH,
      srcAddress,
      dstChainKey: ChainKeys.SONIC_MAINNET,
      dstAddress: hubWallet,
      payload,
      walletProvider,
    });
    console.log('Withdrawal tracking ID:', trackingId);
    const settled = await spoke.waitForWithdrawal(trackingId);
    if (!settled.ok) throw settled.error;
    console.log('Withdrawal settled:', settled.value);
    return;
  }

  const data =
    command === 'supply'
      ? sodax.moneyMarket.buildSupplyData(ZCASH, token.address, amount, hubWallet)
      : encodeContractCalls([]);
  const txid = await spoke.deposit({
    srcChainKey: ZCASH,
    srcAddress,
    to: hubWallet,
    token: token.address,
    amount,
    data,
    walletProvider,
  });
  console.log('Deposit transaction ID:', txid);
  const settled = await spoke.waitForDeposit(txid);
  if (!settled.ok) throw settled.error;
  console.log('Deposit settled:', settled.value);
}

main().catch((error: unknown) => {
  // Relay and wallet errors may contain credentials or signed request data in their causes.
  if (typeof error === 'object' && error !== null) {
    if ('txHash' in error && typeof error.txHash === 'string') console.error('Resume deposit:', error.txHash);
    if ('trackingId' in error && typeof error.trackingId === 'string')
      console.error('Resume withdrawal:', error.trackingId);
  }
  console.error('Zcash smoke step failed. Check any original transaction identifier before repeating a send.');
  process.exitCode = 1;
});
