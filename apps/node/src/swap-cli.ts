import 'dotenv/config';
import {
  Sodax,
  ChainKeys,
  SolverIntentStatusCode,
  getChainType,
  type CreateIntentParams,
  type EvmChainKey,
  type SolverIntentQuoteRequest,
  type SpokeChainKey,
  type XToken,
} from '@sodax/sdk';
import { EvmWalletProvider } from '@sodax/wallet-sdk-core';
import type { Hex } from '@sodax/types';
import { createInterface } from 'node:readline';
import { formatUnits, isAddress, parseUnits } from 'viem';

const USAGE = `Swap between any two chains from the command line (EVM source chain).

Usage:
  pnpm swap:cli --from <chain>:<TOKEN> --to <chain>:<TOKEN> --amount <n> [options]

Examples:
  pnpm swap:cli --from robinhood:USDG --to polygon:POL --amount 2.7             # quote only
  pnpm swap:cli --from robinhood:USDG --to polygon:POL --amount 2.7 --execute   # really swap

Options:
  --from <chain>:<TOKEN>   source chain and token symbol (chain key or short name, e.g. robinhood, polygon, base)
  --to <chain>:<TOKEN>     destination chain and token symbol
  --amount <n>             input amount in the token's own units (2.7 = 2.7 USDG), not base units
  --execute                send the swap. Without it nothing is signed and no key is needed
  --slippage <pct>         accepted shortfall against the quote, default 5
  --recipient <address>    destination address. Defaults to your wallet address; required for non-EVM destinations
  --deadline <seconds>     intent deadline, default 300
  --prompt-key             ask for the signer key with hidden input (overrides EVM_PRIVATE_KEY; never on the command line)
  --rpc <url>              source chain RPC override (default: the SDK's configured RPC)
  --no-wait                do not poll the solver for the final status after sending

--execute signs and broadcasts on MAINNET with --prompt-key or EVM_PRIVATE_KEY from apps/node/.env. Use a dedicated test wallet.`;

type Options = {
  from: string;
  to: string;
  amount: string;
  execute: boolean;
  slippagePct: number;
  recipient?: string;
  deadlineSeconds: bigint;
  rpc?: `http${string}`;
  promptKey: boolean;
  wait: boolean;
};

class UsageError extends Error {}

function promptHidden(question: string): Promise<string> {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const write = (rl as unknown as { _writeToOutput: (text: string) => void })._writeToOutput.bind(rl);
    (rl as unknown as { _writeToOutput: (text: string) => void })._writeToOutput = text => {
      if (text.startsWith(question)) write(text);
    };
    rl.question(question, answer => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

const isHttpUrl = (value: string): value is `http${string}` => value.startsWith('http');

function parseArgs(argv: string[]): Options {
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined || !arg.startsWith('--')) throw new UsageError(`Unexpected argument "${arg}"`);
    const name = arg.slice(2);
    if (['execute', 'no-wait', 'help', 'prompt-key'].includes(name)) {
      flags.set(name, true);
      continue;
    }
    const value = argv[++i];
    if (value === undefined || value.startsWith('--')) throw new UsageError(`--${name} needs a value`);
    flags.set(name, value);
  }
  if (flags.has('help')) throw new UsageError('');

  const text = (name: string): string | undefined => {
    const value = flags.get(name);
    return typeof value === 'string' ? value : undefined;
  };
  const from = text('from');
  const to = text('to');
  const amount = text('amount');
  if (!from || !to || !amount) throw new UsageError('--from, --to and --amount are required');

  const slippagePct = Number(text('slippage') ?? '5');
  if (!Number.isFinite(slippagePct) || slippagePct < 0 || slippagePct >= 100) {
    throw new UsageError('--slippage must be a percentage from 0 up to (not including) 100');
  }
  const deadline = Number(text('deadline') ?? '300');
  if (!Number.isInteger(deadline) || deadline <= 0) throw new UsageError('--deadline must be a positive whole number of seconds');

  const rpcText = text('rpc');
  if (rpcText !== undefined && !isHttpUrl(rpcText)) throw new UsageError('--rpc must be an http(s) URL');
  const rpcUrl = rpcText;

  return {
    from,
    to,
    amount,
    execute: flags.has('execute'),
    slippagePct,
    recipient: text('recipient'),
    deadlineSeconds: BigInt(deadline),
    rpc: rpcUrl,
    promptKey: flags.has('prompt-key'),
    wait: !flags.has('no-wait'),
  };
}

/** A chain by its key value (`robinhood`, `0x89.polygon`), its constant name (`POLYGON_MAINNET`) or its short name (`polygon`). */
function resolveChain(input: string): SpokeChainKey {
  const wanted = input.trim().toLowerCase();
  for (const [name, key] of Object.entries(ChainKeys)) {
    const short = name.toLowerCase().replace(/_mainnet$/, '');
    if (wanted === key.toLowerCase() || wanted === name.toLowerCase() || wanted === short) return key;
  }
  throw new UsageError(`Unknown chain "${input}". Known: ${Object.keys(ChainKeys).map(n => n.toLowerCase().replace(/_mainnet$/, '')).join(', ')}`);
}

function resolveToken(sodax: Sodax, spec: string): { chainKey: SpokeChainKey; token: XToken } {
  const [chainPart, symbolPart, ...rest] = spec.split(':');
  if (!chainPart || !symbolPart || rest.length > 0) throw new UsageError(`"${spec}" must look like <chain>:<TOKEN>, e.g. robinhood:USDG`);
  const chainKey = resolveChain(chainPart);
  const tokens: XToken[] = Object.values(sodax.config.spokeChainConfig[chainKey].supportedTokens);
  const token = tokens.find(t => t.symbol.toLowerCase() === symbolPart.toLowerCase());
  if (!token) {
    throw new UsageError(`No token "${symbolPart}" on ${chainKey}. Known there: ${tokens.map(t => t.symbol).join(', ')}`);
  }
  return { chainKey, token };
}

function isEvmChainKey(chainKey: SpokeChainKey): chainKey is EvmChainKey {
  return getChainType(chainKey) === 'EVM';
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** Polls the solver until the intent is solved or fails; returns whether it ended solved. */
async function waitForFill(sodax: Sodax, dstTxHash: string, maxAttempts = 60, intervalMs = 5000): Promise<boolean> {
  let notFound = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const status = await sodax.swaps.getStatus({ intent_tx_hash: dstTxHash as Hex });
    if (status.ok) {
      const { status: code, fill_tx_hash } = status.value;
      if (code === SolverIntentStatusCode.SOLVED) {
        console.log(`[${attempt}] Solved.${fill_tx_hash ? ` Fill tx: ${fill_tx_hash}` : ''}`);
        return true;
      }
      if (code === SolverIntentStatusCode.FAILED) {
        console.log(`[${attempt}] The solver reported the swap as FAILED.`);
        return false;
      }
      if (code === SolverIntentStatusCode.NOT_FOUND && ++notFound >= 3) {
        console.log(`[${attempt}] The solver has no record of this intent. Check the hub tx hash manually.`);
        return false;
      }
      console.log(`[${attempt}] Still processing (solver status ${code})...`);
    } else {
      console.log(`[${attempt}] Status check failed, retrying:`, status.error);
    }
    await sleep(intervalMs);
  }
  console.log('Gave up waiting for a final status. The swap may still complete; check the hub tx hash.');
  return false;
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));

  const sodax = new Sodax();
  await sodax.initialize();

  const src = resolveToken(sodax, options.from);
  const dst = resolveToken(sodax, options.to);
  const srcChainKey = src.chainKey;
  const dstChainKey = dst.chainKey;
  if (!isEvmChainKey(srcChainKey)) {
    throw new UsageError(`This CLI signs with an EVM key, so the source must be an EVM chain; ${srcChainKey} is not.`);
  }

  let inputAmount: bigint;
  try {
    inputAmount = parseUnits(options.amount, src.token.decimals);
  } catch {
    throw new UsageError(`--amount "${options.amount}" is not a number with at most ${src.token.decimals} decimals`);
  }
  if (inputAmount <= 0n) throw new UsageError('--amount must be greater than zero');

  const privateKey = options.execute && options.promptKey ? await promptHidden('Private key (input hidden): ') : process.env.EVM_PRIVATE_KEY;
  if (options.execute && !privateKey) throw new UsageError('--execute needs --prompt-key or EVM_PRIVATE_KEY in apps/node/.env');
  if (options.execute && !/^0x[0-9a-fA-F]{64}$/.test(privateKey ?? '')) throw new UsageError('The private key must be 0x followed by 64 hex characters');

  console.log(`Swap ${options.amount} ${src.token.symbol} (${srcChainKey}) -> ${dst.token.symbol} (${dstChainKey})`);

  // Step 1: quote.
  const quoteRequest: SolverIntentQuoteRequest = {
    token_src: src.token.address,
    token_dst: dst.token.address,
    token_src_blockchain_id: srcChainKey,
    token_dst_blockchain_id: dstChainKey,
    amount: inputAmount,
    quote_type: 'exact_input',
  };
  const quote = await sodax.swaps.getQuote(quoteRequest);
  if (!quote.ok) {
    console.error('Quote failed:', JSON.stringify(quote.error));
    return 1;
  }
  const quoted = quote.value.quoted_amount;
  const minOutput = (quoted * BigInt(Math.round((100 - options.slippagePct) * 100))) / 10_000n;
  console.log(`Quote:        ${formatUnits(quoted, dst.token.decimals)} ${dst.token.symbol}`);
  console.log(`Minimum out:  ${formatUnits(minOutput, dst.token.decimals)} ${dst.token.symbol} (${options.slippagePct}% slippage)`);

  if (!options.execute) {
    console.log('\nQuote only: nothing was signed or sent. Add --execute to swap for real.');
    return 0;
  }

  // Step 2: wallet and balance.
  const walletProvider = new EvmWalletProvider({ privateKey: privateKey as Hex, chainId: srcChainKey, rpcUrl: options.rpc });
  const walletAddress = await walletProvider.getWalletAddress();
  console.log(`Wallet:       ${walletAddress}`);

  const balance = await sodax.spoke.getWalletBalance({ srcChainKey, srcAddress: walletAddress, token: src.token });
  if (!balance.ok) {
    console.error('Could not read your balance, not sending:', balance.error);
    return 1;
  }
  console.log(`Balance:      ${formatUnits(balance.value, src.token.decimals)} ${src.token.symbol}`);
  if (balance.value < inputAmount) {
    console.error(`Not enough ${src.token.symbol}: need ${options.amount}, have ${formatUnits(balance.value, src.token.decimals)}.`);
    return 1;
  }

  const recipient = options.recipient ?? (isEvmChainKey(dstChainKey) ? walletAddress : undefined);
  if (!recipient) throw new UsageError(`${dstChainKey} is not an EVM chain, so --recipient is required`);
  if (isEvmChainKey(dstChainKey) && !isAddress(recipient)) throw new UsageError(`--recipient "${recipient}" is not a valid EVM address`);
  console.log(`Recipient:    ${recipient}`);

  const deadline = await sodax.swaps.getSwapDeadline(options.deadlineSeconds);
  if (!deadline.ok) {
    console.error('Could not compute the swap deadline:', deadline.error);
    return 1;
  }

  const params: CreateIntentParams<EvmChainKey> = {
    inputToken: src.token.address,
    outputToken: dst.token.address,
    inputAmount,
    minOutputAmount: minOutput,
    deadline: deadline.value,
    allowPartialFill: false,
    srcChainKey,
    dstChainKey,
    srcAddress: walletAddress,
    dstAddress: recipient,
    solver: '0x0000000000000000000000000000000000000000',
    data: '0x',
  };

  // Step 3: approve if the spoke needs an allowance.
  const allowance = await sodax.swaps.isAllowanceValid({ params, raw: false, walletProvider });
  if (!allowance.ok) {
    console.error('Allowance check failed:', allowance.error);
    return 1;
  }
  if (allowance.value) {
    console.log('Approval:     not needed');
  } else {
    console.log('Approval:     sending...');
    const approval = await sodax.swaps.approve({ params, raw: false, walletProvider });
    if (!approval.ok) {
      console.error('Approval failed:', approval.error);
      return 1;
    }
    console.log(`Approval tx:  ${approval.value}`);
    if (typeof approval.value !== 'string') throw new Error('Unexpected approval result');
    await walletProvider.waitForTransactionReceipt(approval.value);
    console.log('Approval confirmed');
  }

  // Step 4: swap.
  console.log('Swapping...');
  const swap = await sodax.swaps.swap({ params, raw: false, walletProvider });
  if (!swap.ok) {
    const { code, message, context, cause } = swap.error;
    console.error(`Swap failed: ${code}: ${message}`);
    if (code === 'TX_SUBMIT_FAILED') console.error('The source tx landed but relay submission failed: retry the submission, do not send again.');
    if (context) console.error('Context:', context);
    if (cause) console.error('Caused by:', cause);
    return 1;
  }

  const { intentDeliveryInfo } = swap.value;
  console.log(`Source tx:    ${intentDeliveryInfo.srcTxHash}`);
  console.log(`Hub tx:       ${intentDeliveryInfo.dstTxHash}`);

  if (!options.wait) return 0;
  return (await waitForFill(sodax, intentDeliveryInfo.dstTxHash)) ? 0 : 1;
}

try {
  process.exitCode = await main();
} catch (error) {
  if (error instanceof UsageError) {
    if (error.message) console.error(`Error: ${error.message}\n`);
    console.log(USAGE);
    process.exitCode = error.message ? 2 : 0;
  } else {
    console.error('Unexpected error:', error);
    process.exitCode = 1;
  }
}
