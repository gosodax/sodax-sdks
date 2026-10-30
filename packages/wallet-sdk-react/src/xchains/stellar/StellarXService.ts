import { XService } from '@/core/XService.js';
import { StellarWalletsKit, WalletNetwork, allowAllModules } from '@creit.tech/stellar-wallets-kit';
import * as StellarSdk from '@stellar/stellar-sdk';
import CustomSorobanServer from './CustomSorobanServer.js';
import { getTokenBalance, getTrustlineBalances, parseStellarAmount } from './utils.js';
import { ChainKeys, spokeChainConfig, type XToken } from '@sodax/types';
import { STELLAR_DEFAULT_HORIZON_RPC_URL, STELLAR_DEFAULT_SOROBAN_RPC_URL } from '@/constants.js';
import { isNativeToken } from '@/utils/index.js';

/** Base reserve in stroops (0.5 XLM). Each subentry (trustline, signer, data entry, offer) adds one base reserve. */
const STELLAR_BASE_RESERVE_STROOPS = 5_000_000;

/** Issuer of each token contract that wraps a classic asset: any other account holds it only through a trustline. */
const TRUSTLINE_ASSET_ISSUERS: ReadonlyMap<string, string> = new Map(
  spokeChainConfig[ChainKeys.STELLAR_MAINNET].trustlineConfigs.map(trustline => [
    trustline.contractId,
    trustline.assetIssuer,
  ]),
);

/** What a Stellar Asset Contract's `balance()` reports for the asset's own issuer, which can always pay it out. */
const ISSUER_BALANCE = 2n ** 63n - 1n;

/** Spendable XLM in stroops: the native balance minus the account's minimum balance. */
function getAvailableXlmStroops(stellarAccount: StellarSdk.Horizon.AccountResponse): bigint {
  const xlmBalance = stellarAccount.balances.find(
    (balance): balance is StellarSdk.Horizon.HorizonApi.BalanceLineNative => balance.asset_type === 'native',
  );
  if (!xlmBalance) return BigInt(0);

  const rawBalanceStroops = parseStellarAmount(xlmBalance.balance);
  const sellingLiabilitiesStroops = xlmBalance.selling_liabilities
    ? parseStellarAmount(xlmBalance.selling_liabilities)
    : BigInt(0);
  // Minimum balance = (2 + subentry_count + num_sponsoring - num_sponsored) * base_reserve + selling_liabilities.
  // Reserves another account sponsors (num_sponsored) are not locked in this account's own balance.
  const reserveCount = Math.max(
    0,
    2 + stellarAccount.subentry_count + stellarAccount.num_sponsoring - stellarAccount.num_sponsored,
  );
  const minBalanceStroops = BigInt(reserveCount) * BigInt(STELLAR_BASE_RESERVE_STROOPS) + sellingLiabilitiesStroops;
  return rawBalanceStroops > minBalanceStroops ? rawBalanceStroops - minBalanceStroops : BigInt(0);
}

export class StellarXService extends XService {
  private static instance: StellarXService;

  public walletsKit: StellarWalletsKit;
  public server: StellarSdk.Horizon.Server;
  public sorobanServer: CustomSorobanServer;

  private constructor(horizonRpcUrl?: string, sorobanRpcUrl?: string) {
    super('STELLAR');

    this.walletsKit = new StellarWalletsKit({
      network: WalletNetwork.PUBLIC,
      modules: allowAllModules(),
    });

    this.server = new StellarSdk.Horizon.Server(horizonRpcUrl ?? STELLAR_DEFAULT_HORIZON_RPC_URL, { allowHttp: true });
    this.sorobanServer = new CustomSorobanServer(sorobanRpcUrl ?? STELLAR_DEFAULT_SOROBAN_RPC_URL, {});
  }

  public static getInstance(horizonRpcUrl?: string, sorobanRpcUrl?: string): StellarXService {
    if (!StellarXService.instance) {
      StellarXService.instance = new StellarXService(horizonRpcUrl, sorobanRpcUrl);
    } else {
      if (horizonRpcUrl) {
        StellarXService.instance.server = new StellarSdk.Horizon.Server(horizonRpcUrl, { allowHttp: true });
      }
      if (sorobanRpcUrl) {
        StellarXService.instance.sorobanServer = new CustomSorobanServer(sorobanRpcUrl, {});
      }
    }
    return StellarXService.instance;
  }

  /**
   * Reads every balance from one Horizon account load: XLM and classic-asset tokens come from the account's
   * balance lines, and only custom Soroban tokens are simulated. Rejects when a request fails, so a failed
   * (e.g. rate-limited) request is never reported as a zero balance. An account never funded reads as all zeros.
   */
  override async getBalances(address: string | undefined, xTokens: readonly XToken[]): Promise<Record<string, bigint>> {
    if (!address) return {};

    let stellarAccount: StellarSdk.Horizon.AccountResponse;
    try {
      stellarAccount = await this.server.loadAccount(address);
    } catch (error) {
      if (error instanceof StellarSdk.NotFoundError) {
        return Object.fromEntries(xTokens.map(xToken => [xToken.address, BigInt(0)]));
      }
      throw error;
    }
    const trustlineBalances = getTrustlineBalances(stellarAccount.balances, StellarSdk.Networks.PUBLIC);

    const readBalance = async (xToken: XToken): Promise<bigint> => {
      if (isNativeToken(xToken)) return getAvailableXlmStroops(stellarAccount);

      const trustlineBalance = trustlineBalances.get(xToken.address);
      if (trustlineBalance !== undefined) return trustlineBalance;
      const assetIssuer = TRUSTLINE_ASSET_ISSUERS.get(xToken.address);
      if (assetIssuer !== undefined) return assetIssuer === address ? ISSUER_BALANCE : BigInt(0);
      // No contract can exist at a malformed id, so it holds nothing; rejecting would drop every other balance.
      if (!StellarSdk.StrKey.isValidContract(xToken.address)) return BigInt(0);

      const txBuilder = new StellarSdk.TransactionBuilder(stellarAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: StellarSdk.Networks.PUBLIC,
      });
      return getTokenBalance(address, xToken.address, txBuilder, this.sorobanServer);
    };

    return Object.fromEntries(
      await Promise.all(xTokens.map(async xToken => [xToken.address, await readBalance(xToken)] as const)),
    );
  }

  override async getBalance(address: string | undefined, xToken: XToken): Promise<bigint> {
    const balances = await this.getBalances(address, [xToken]);
    return balances[xToken.address] ?? BigInt(0);
  }
}
