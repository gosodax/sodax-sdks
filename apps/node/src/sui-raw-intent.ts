import 'dotenv/config';

import { Sodax, ChainKeys, type SuiSpokeChainConfig } from '@sodax/sdk';
import { Transaction } from '@mysten/sui/transactions';

// NO private key needed. `raw: true` only BUILDS the unsigned source tx — nothing is signed here —
// so a plain source address is enough. This mirrors how a backend uses the SDK: it builds the
// unsigned transaction server-side and hands it to the client to sign.
//
// Native SUI is deliberate as the input token. The non-native branch calls `getCoins(srcAddress)`
// and needs a funded account, while native splits from the gas coin — so this runs for anyone.
// Point SRC_ADDRESS at a funded account and set INPUT_TOKEN to exercise the non-native branch.
//
// A Sui address is exactly 32 bytes — 64 hex chars. The SDK rejects anything else before it
// reaches the chain, so an address that is one nibble short fails here, not on-chain.
const srcAddress = process.env.SRC_ADDRESS ?? '0x6d7b6956589c17b2755193a67bf2d4b68827e58a6d7b6956589c17b2755193a6';
const inputToken =
  process.env.INPUT_TOKEN ?? '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';

// No-arg Sodax uses the packaged static defaults (hub RPC, spoke configs, solver, relay).
const sodax = new Sodax();

/**
 * Does the Sui raw path still produce a signable transaction over gRPC?
 *
 * Read-only: raw mode builds and returns the unsigned tx — it never broadcasts. It is NOT offline,
 * though: the asset-manager package id is read from the chain on every call, and a non-native input
 * token additionally reads the sender's coins. Those reads are the reason this script exists —
 * they are what moved from JSON-RPC to gRPC-web.
 */
async function testSuiRawIntent(): Promise<void> {
  const suiConfig = sodax.config.getChainConfig(ChainKeys.SUI_MAINNET) as SuiSpokeChainConfig;
  console.log('endpoint    :', sodax.spoke.sui.transport.endpoint);
  console.log('grpc_url    :', suiConfig.grpc_url);
  console.log('srcAddress  :', srcAddress);
  console.log('inputToken  :', inputToken);

  const result = await sodax.swaps.createIntent({
    params: {
      srcChainKey: ChainKeys.SUI_MAINNET,
      dstChainKey: ChainKeys.BASE_MAINNET,
      inputToken,
      outputToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
      inputAmount: 1_000_000n,
      minOutputAmount: 1n, // any value — fillability isn't checked at build time
      deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
      allowPartialFill: false,
      srcAddress,
      dstAddress: '0x1468d3529032106291433B7e9e3026dF1Ff78F31',
      data: '0x',
    },
    raw: true, // ← returns the unsigned tx, no broadcast (walletProvider is forbidden in raw mode)
  });

  if (!result.ok) {
    console.error('❌ createIntent FAILED:', result.error);
    process.exit(1);
  }

  const { tx, intent } = result.value;
  console.log('intentId    :', intent.intentId);

  // A Sui raw tx carries the serialized PTB in `data`. The signing side rehydrates it with
  // `Transaction.from(...)`, so a payload that does not round-trip is useless even if it looks fine.
  const data = (tx as { data?: string }).data;
  if (typeof data !== 'string' || data.length === 0) {
    console.error('❌ FAIL — raw tx carries no serialized transaction');
    process.exit(1);
  }
  console.log(`✅ raw tx    : ${data.length} chars`);

  const json = JSON.parse(await Transaction.from(data).toJSON()) as {
    commands: unknown[];
    sender: string | null;
    gasData?: { budget: string | null };
  };
  if (json.commands.length === 0) {
    console.error('❌ FAIL — round-tripped transaction has no commands');
    process.exit(1);
  }
  // Sender and gas are intentionally unset: the wallet fills them at build({ client }) time.
  console.log(
    `✅ round trip: ${json.commands.length} commands, sender=${json.sender}, gasBudget=${json.gasData?.budget ?? null}`,
  );

  // A backend typically quotes gas before handing the tx over, and that is a second live gRPC read.
  const gas = await sodax.spoke.sui.estimateGas({ tx: tx as never, chainKey: ChainKeys.SUI_MAINNET });
  if (!gas || typeof gas.computationCost !== 'string') {
    console.error('❌ FAIL — estimateGas returned no computation cost:', gas);
    process.exit(1);
  }
  console.log('✅ estimateGas:', gas);

  console.log('✅ PASS — Sui raw intent built and round-tripped over gRPC');
}

testSuiRawIntent();
