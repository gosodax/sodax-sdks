import {
  Address,
  Asset,
  Contract,
  type Horizon,
  type Memo,
  type MemoType,
  type Operation,
  rpc,
  TimeoutInfinite,
  type Transaction,
  type TransactionBuilder,
  scValToBigInt,
} from '@stellar/stellar-sdk';
import type CustomSorobanServer from './CustomSorobanServer.js';

// Can be used whenever you need an Address argument for a contract method
export const accountToScVal = (account: string) => new Address(account).toScVal();

/** Parse a Horizon amount string (7 decimal places, e.g. "198.8944970") to integer units (1 XLM = 10^7 stroops). */
export function parseStellarAmount(amount: string): bigint {
  const parts = amount.split('.');
  const whole = parts[0] ?? '0';
  const frac = (parts[1] ?? '').padEnd(7, '0').slice(0, 7);
  return BigInt(whole + frac);
}

/**
 * Maps the Stellar Asset Contract id of each classic trustline to its balance. The contract's `balance()`
 * returns the raw trustline balance, so this matches a simulated read without any RPC call.
 */
export const getTrustlineBalances = (
  balanceLines: readonly Horizon.HorizonApi.BalanceLine[],
  networkPassphrase: string,
): Map<string, bigint> => {
  const balances = new Map<string, bigint>();
  for (const line of balanceLines) {
    if (!('asset_issuer' in line)) continue;
    balances.set(
      new Asset(line.asset_code, line.asset_issuer).contractId(networkPassphrase),
      parseStellarAmount(line.balance),
    );
  }
  return balances;
};

export const simulateTx = (
  tx: Transaction<Memo<MemoType>, Operation[]>,
  server: CustomSorobanServer,
): Promise<rpc.Api.SimulateTransactionResponse> => server.simulateTransaction(tx);

/** Reads a token balance by simulating `balance()`. A failed simulation reads as 0n; a failed RPC request rejects. */
export const getTokenBalance = async (
  address: string,
  tokenId: string,
  txBuilder: TransactionBuilder,
  server: CustomSorobanServer,
) => {
  const params = [accountToScVal(address)];
  const contract = new Contract(tokenId);
  const tx = txBuilder
    .addOperation(contract.call('balance', ...params))
    .setTimeout(TimeoutInfinite)
    .build();

  const result = await simulateTx(tx, server);

  if (!rpc.Api.isSimulationSuccess(result)) {
    return 0n;
  }

  return result.result ? scValToBigInt(result.result.retval) : 0n;
};
