/**
 * Compile-time contract for `BitcoinSpokeService`: Bitcoin only, a `string` txid when signed and
 * `BitcoinRawTransaction | string` when `raw: true`, with exact PSBT, UTXO, wallet and receipt types.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type { networks, Psbt } from 'bitcoinjs-lib';
import type {
  BitcoinRawTransaction,
  BitcoinRawTransactionReceipt,
  ChainKeys,
  DepositParams,
  IBitcoinWalletProvider,
  IEvmWalletProvider,
  OnDemandRelayData,
  Result,
  SendMessageParams,
  WalletBalanceMap,
} from '../../../index.js';
import type { BitcoinSpokeService, BitcoinUTXO } from './BitcoinSpokeService.js';

type BITCOIN = typeof ChainKeys.BITCOIN_MAINNET;
type BSC = typeof ChainKeys.BSC_MAINNET;
type Flat<A> = Omit<A, 'raw' | 'walletProvider'>;
type Receipt<R> = { status: 'success'; receipt: R } | { error: Error; status: 'failure' | 'timeout' };
// `TxReturnType<Bitcoin, true>` admits both the PSBT-carrying raw tx and a JSON payload string.
type BtcRaw = BitcoinRawTransaction | string;

declare const svc: BitcoinSpokeService;
declare const btc: IBitcoinWalletProvider;
declare const evm: IEvmWalletProvider;
declare const dep: Flat<DepositParams<BITCOIN, false>>;
declare const msg: Flat<SendMessageParams<BITCOIN, false>>;
declare const bscMsg: Flat<SendMessageParams<BSC, false>>;

describe('BitcoinSpokeService', () => {
  it('deposit, sendMessage and encodeWithdrawalData: string signed, BitcoinRawTransaction | string raw', () => {
    const rows = () =>
      ({
        deposit: [
          svc.deposit({ ...dep, walletProvider: btc }),
          svc.deposit({ ...dep, raw: true }),
          svc.deposit({ ...dep, raw: false, walletProvider: btc }),
        ],
        sendMessage: [
          svc.sendMessage({ ...msg, walletProvider: btc }),
          svc.sendMessage({ ...msg, raw: true, walletMode: 'TRADING' }),
          svc.sendMessage({ ...msg, raw: false, walletProvider: btc }),
        ],
        encodeWithdrawalData: [
          svc.encodeWithdrawalData({ ...msg, walletProvider: btc, walletMode: 'USER' }),
          svc.encodeWithdrawalData({ ...msg, raw: true }),
          svc.encodeWithdrawalData({ ...msg, raw: false, walletProvider: btc }),
        ],
      }) as const;
    type Row = readonly [Promise<string>, Promise<BtcRaw>, Promise<string>];
    expectTypeOf<ReturnType<typeof rows>>().toEqualTypeOf<{
      readonly deposit: Row;
      readonly sendMessage: Row;
      readonly encodeWithdrawalData: Row;
    }>();
    const runtime = (d: DepositParams<BITCOIN, boolean>, m: SendMessageParams<BITCOIN, boolean>) =>
      [svc.deposit(d), svc.sendMessage(m), svc.encodeWithdrawalData(m)] as const;
    type Both = Promise<string | BtcRaw>;
    expectTypeOf<ReturnType<typeof runtime>>().toEqualTypeOf<readonly [Both, Both, Both]>();
    const invalid = () => [
      // @ts-expect-error — raw: true forbids walletProvider.
      svc.deposit({ ...dep, raw: true, walletProvider: btc }),
      // @ts-expect-error — Bitcoin needs a Bitcoin wallet provider.
      svc.sendMessage({ ...msg, walletProvider: evm }),
      // @ts-expect-error — only Bitcoin chain keys are accepted.
      svc.encodeWithdrawalData({ ...bscMsg, raw: true }),
      // @ts-expect-error — walletMode is 'USER' or 'TRADING'.
      svc.sendMessage({ ...msg, raw: true, walletMode: 'HOT' }),
    ];
    expectTypeOf(invalid).toBeFunction();
  });

  it('wallets, UTXOs, PSBTs, reads and receipts pin one result type', () => {
    expectTypeOf<ReturnType<BitcoinSpokeService['getBtcNetwork']>>().toEqualTypeOf<networks.Network>();
    expectTypeOf<ReturnType<BitcoinSpokeService['getBalance']>>().toEqualTypeOf<Promise<bigint>>();
    expectTypeOf<ReturnType<BitcoinSpokeService['getWalletBalance']>>().toEqualTypeOf<Promise<bigint>>();
    expectTypeOf<ReturnType<BitcoinSpokeService['getWalletBalances']>>().toEqualTypeOf<Promise<WalletBalanceMap>>();
    expectTypeOf<ReturnType<BitcoinSpokeService['fetchScriptPubKey']>>().toEqualTypeOf<Promise<string>>();
    expectTypeOf<ReturnType<BitcoinSpokeService['getEffectiveWalletAddress']>>().toEqualTypeOf<Promise<string>>();
    expectTypeOf<ReturnType<BitcoinSpokeService['getTradingWalletAddress']>>().toEqualTypeOf<Promise<string>>();
    expectTypeOf<ReturnType<BitcoinSpokeService['getFeeRateEstimate']>>().toEqualTypeOf<Promise<number>>();
    expectTypeOf<ReturnType<BitcoinSpokeService['estimateGas']>>().toEqualTypeOf<Promise<bigint>>();
    expectTypeOf<ReturnType<BitcoinSpokeService['getDeposit']>>().toEqualTypeOf<Promise<bigint>>();
    expectTypeOf<ReturnType<BitcoinSpokeService['fundTradingWallet']>>().toEqualTypeOf<Promise<string>>();
    expectTypeOf<ReturnType<BitcoinSpokeService['getOnDemandRelayIdentity']>>().toEqualTypeOf<{
      srcTxHash: string;
      data: OnDemandRelayData;
      pollTxHash: string;
    }>();
    expectTypeOf<ReturnType<BitcoinSpokeService['buildBitcoinTransaction']>>().toEqualTypeOf<Promise<Psbt>>();
    expectTypeOf<ReturnType<BitcoinSpokeService['signAndSubmitRawTransaction']>>().toEqualTypeOf<Promise<string>>();
    expectTypeOf<ReturnType<BitcoinSpokeService['buildDepositPsbt']>>().toEqualTypeOf<Promise<Psbt>>();
    expectTypeOf<ReturnType<BitcoinSpokeService['fetchUTXOs']>>().toEqualTypeOf<Promise<BitcoinUTXO[]>>();
    expectTypeOf<ReturnType<BitcoinSpokeService['fetchRawTransaction']>>().toEqualTypeOf<Promise<string>>();
    expectTypeOf<ReturnType<BitcoinSpokeService['signAndBroadcastTransaction']>>().toEqualTypeOf<Promise<string>>();
    // Known gap against ADR 0001: declared as plain Result<T>, so the error is unknown.
    expectTypeOf<ReturnType<BitcoinSpokeService['waitForTransactionReceipt']>>().toEqualTypeOf<
      Promise<Result<Receipt<BitcoinRawTransactionReceipt>>>
    >();
  });
});
