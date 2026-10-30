import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChainKeys, spokeChainConfig, type StellarAssetTrustline, type XToken } from '@sodax/types';
import {
  Asset,
  Horizon,
  Keypair,
  Networks,
  NotFoundError,
  SorobanDataBuilder,
  StrKey,
  nativeToScVal,
  type rpc,
} from '@stellar/stellar-sdk';
import { StellarXService } from './StellarXService.js';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const OWNER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1)).publicKey();

const trustlineConfig = (assetCode: string): StellarAssetTrustline => {
  const config = spokeChainConfig[ChainKeys.STELLAR_MAINNET].trustlineConfigs.find(
    trustline => trustline.assetCode === assetCode,
  );
  if (!config) throw new Error(`no Stellar trustline config for ${assetCode}`);
  return config;
};

const token = (symbol: string, address: string): XToken => ({
  symbol,
  name: symbol,
  decimals: 7,
  address,
  chainKey: ChainKeys.STELLAR_MAINNET,
  hubAsset: ZERO_ADDRESS,
  vault: ZERO_ADDRESS,
});

const USDC_CONFIG = trustlineConfig('USDC');
const XLM = token('XLM', Asset.native().contractId(Networks.PUBLIC));
const USDC = token('USDC', USDC_CONFIG.contractId);
const MSFT = token('MSFT', trustlineConfig('MSFT').contractId);
const CUSTOM = token('CUSTOM', StrKey.encodeContract(Buffer.alloc(32, 9)));

const nativeLine = (balance: string, sellingLiabilities = '0.0000000'): Horizon.HorizonApi.BalanceLineNative => ({
  balance,
  asset_type: 'native',
  buying_liabilities: '0.0000000',
  selling_liabilities: sellingLiabilities,
});

const trustline = (config: StellarAssetTrustline, balance: string): Horizon.HorizonApi.BalanceLineAsset => ({
  balance,
  limit: '922337203685.4775807',
  asset_type: 'credit_alphanum4',
  asset_code: config.assetCode,
  asset_issuer: config.assetIssuer,
  buying_liabilities: '0.0000000',
  selling_liabilities: '0.0000000',
  last_modified_ledger: 1,
  is_authorized: true,
  is_authorized_to_maintain_liabilities: true,
  is_clawback_enabled: false,
});

const account = (balances: Horizon.HorizonApi.BalanceLine[], { numSponsoring = 0, numSponsored = 0 } = {}) =>
  new Horizon.AccountResponse({
    _links: { self: { href: '' } },
    id: OWNER,
    paging_token: '',
    account_id: OWNER,
    sequence: '1',
    subentry_count: balances.filter(line => line.asset_type !== 'native').length,
    last_modified_ledger: 1,
    last_modified_time: '',
    thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
    flags: { auth_immutable: false, auth_required: false, auth_revocable: false, auth_clawback_enabled: false },
    balances,
    signers: [],
    data: vi.fn(),
    data_attr: {},
    num_sponsoring: numSponsoring,
    num_sponsored: numSponsored,
    transactions: vi.fn(),
    effects: vi.fn(),
    offers: vi.fn(),
    operations: vi.fn(),
    payments: vi.fn(),
    trades: vi.fn(),
  });

const simulationSuccess = (balance: bigint): rpc.Api.SimulateTransactionSuccessResponse => ({
  id: '1',
  latestLedger: 1,
  events: [],
  _parsed: true,
  transactionData: new SorobanDataBuilder(),
  minResourceFee: '0',
  result: { auth: [], retval: nativeToScVal(balance, { type: 'i128' }) },
});

const simulationError = (error: string): rpc.Api.SimulateTransactionErrorResponse => ({
  id: '1',
  latestLedger: 1,
  events: [],
  _parsed: true,
  error,
});

// The XService singleton is module-level state — reset it so servers spied on in one test don't leak into the next.
function resetSingleton() {
  (StellarXService as unknown as { instance?: unknown }).instance = undefined;
}

function makeService(balances: Horizon.HorizonApi.BalanceLine[]) {
  const service = StellarXService.getInstance();
  const loadAccount = vi.spyOn(service.server, 'loadAccount').mockResolvedValue(account(balances));
  const simulateTransaction = vi
    .spyOn(service.sorobanServer, 'simulateTransaction')
    .mockResolvedValue(simulationSuccess(42n));
  return { service, loadAccount, simulateTransaction };
}

beforeEach(resetSingleton);
afterEach(() => {
  resetSingleton();
  vi.restoreAllMocks();
});

describe('StellarXService.getBalances', () => {
  it('reads XLM and trustline balances from one account load, with no simulation', async () => {
    const { service, loadAccount, simulateTransaction } = makeService([
      nativeLine('100.0000000'),
      trustline(USDC_CONFIG, '12.3456789'),
    ]);

    // 100 XLM minus the (2 + 1 trustline) * 0.5 XLM minimum balance.
    expect(await service.getBalances(OWNER, [XLM, USDC])).toEqual({
      [XLM.address]: 985_000_000n,
      [USDC.address]: 123_456_789n,
    });
    expect(loadAccount).toHaveBeenCalledTimes(1);
    expect(simulateTransaction).not.toHaveBeenCalled();
  });

  it('holds back sponsorship-adjusted reserves and selling liabilities from XLM', async () => {
    const { service, loadAccount } = makeService([]);
    loadAccount.mockResolvedValue(
      account([nativeLine('100.0000000', '1.0000000'), trustline(USDC_CONFIG, '1.0000000')], {
        numSponsoring: 2,
        numSponsored: 1,
      }),
    );

    // (2 + 1 subentry + 2 sponsoring - 1 sponsored) * 0.5 XLM + 1 XLM selling liabilities = 3 XLM held back.
    expect(await service.getBalances(OWNER, [XLM])).toEqual({ [XLM.address]: 970_000_000n });
  });

  it('reads every token as zero for an account that was never funded', async () => {
    const { service, loadAccount, simulateTransaction } = makeService([]);
    loadAccount.mockRejectedValue(new NotFoundError('Not Found', {}));

    expect(await service.getBalances(OWNER, [XLM, USDC, CUSTOM])).toEqual({
      [XLM.address]: 0n,
      [USDC.address]: 0n,
      [CUSTOM.address]: 0n,
    });
    expect(simulateTransaction).not.toHaveBeenCalled();
  });

  it('reads a classic asset without a trustline as zero and simulates only custom contracts', async () => {
    const { service, simulateTransaction } = makeService([nativeLine('10.0000000')]);

    expect(await service.getBalances(OWNER, [MSFT, CUSTOM])).toEqual({
      [MSFT.address]: 0n,
      [CUSTOM.address]: 42n,
    });
    expect(simulateTransaction).toHaveBeenCalledTimes(1);
  });

  it("reads an asset's own issuer as the i64 maximum the asset contract reports", async () => {
    const { service, simulateTransaction } = makeService([nativeLine('10.0000000')]);

    expect(await service.getBalances(USDC_CONFIG.assetIssuer, [USDC, MSFT])).toEqual({
      [USDC.address]: 2n ** 63n - 1n,
      [MSFT.address]: 0n,
    });
    expect(simulateTransaction).not.toHaveBeenCalled();
  });

  it('reads a failed simulation as zero', async () => {
    const { service, simulateTransaction } = makeService([nativeLine('10.0000000')]);
    simulateTransaction.mockResolvedValue(simulationError('HostError: Error(Contract, #13)'));

    expect(await service.getBalances(OWNER, [CUSTOM])).toEqual({ [CUSTOM.address]: 0n });
  });

  it('reads a malformed token address as zero without failing the rest of the batch', async () => {
    const { service, simulateTransaction } = makeService([
      nativeLine('10.0000000'),
      trustline(USDC_CONFIG, '1.0000000'),
    ]);
    const malformed = token('MALFORMED', 'not-a-contract-id');

    expect(await service.getBalances(OWNER, [USDC, malformed])).toEqual({
      [USDC.address]: 10_000_000n,
      [malformed.address]: 0n,
    });
    expect(simulateTransaction).not.toHaveBeenCalled();
  });

  it('rejects the whole batch instead of reporting zero when a Soroban request fails', async () => {
    const { service, simulateTransaction } = makeService([
      nativeLine('10.0000000'),
      trustline(USDC_CONFIG, '1.0000000'),
    ]);
    simulateTransaction.mockRejectedValue(new Error('HTTP error simulating TX! status: 429'));

    await expect(service.getBalances(OWNER, [XLM, USDC, CUSTOM])).rejects.toThrow('status: 429');
  });

  it('rejects when the account cannot be loaded', async () => {
    const { service, loadAccount } = makeService([]);
    loadAccount.mockRejectedValue(new Error('horizon down'));

    await expect(service.getBalances(OWNER, [XLM])).rejects.toThrow('horizon down');
  });

  it('returns nothing without an address', async () => {
    const { service, loadAccount } = makeService([]);

    expect(await service.getBalances(undefined, [XLM])).toEqual({});
    expect(await service.getBalance(undefined, XLM)).toBe(0n);
    expect(loadAccount).not.toHaveBeenCalled();
  });
});

describe('StellarXService.getBalance', () => {
  it('reads one token through the batched path', async () => {
    const { service, loadAccount } = makeService([nativeLine('10.0000000'), trustline(USDC_CONFIG, '1.5000000')]);

    expect(await service.getBalance(OWNER, USDC)).toBe(15_000_000n);
    expect(loadAccount).toHaveBeenCalledTimes(1);
  });
});

// getBalances reads listed assets only from trustlines, so a wrong id here would show a held asset as zero.
describe('Stellar trustline config', () => {
  const stellar = spokeChainConfig[ChainKeys.STELLAR_MAINNET];

  it('lists each classic asset under its Stellar Asset Contract id', () => {
    const mismatched = stellar.trustlineConfigs
      .filter(
        config => new Asset(config.assetCode, config.assetIssuer).contractId(Networks.PUBLIC) !== config.contractId,
      )
      .map(config => config.assetCode);

    expect(mismatched).toEqual([]);
  });

  it('uses canonical contract ids for every Stellar token, since balances are matched by exact address', () => {
    const nonCanonical = Object.values(stellar.supportedTokens)
      .filter(xToken => !StrKey.isValidContract(xToken.address))
      .map(xToken => xToken.symbol);

    expect(nonCanonical).toEqual([]);
  });
});
