/**
 * Tests for SuiGrpcTransport — the `client.core` → `@sodax/types` translation.
 *
 * `@mysten/sui` is NOT module-mocked: the real `SuiGrpcClient` and `Transaction` constructors run
 * and only the `client.core` methods under test are spied per-test, matching the spoke-service
 * tests. Fixtures use the real chain config so a config rename surfaces here.
 */
import { bcs } from '@mysten/sui/bcs';
import { Transaction } from '@mysten/sui/transactions';
import { ChainKeys, spokeChainConfig } from '@sodax/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SuiGrpcTransport } from './SuiGrpcTransport.js';

const suiConfig = spokeChainConfig[ChainKeys.SUI_MAINNET];
const SUI_BNUSD = suiConfig.bnUSD;
const SUI_ASSET_MGR_CONFIG_ID = suiConfig.addresses.assetManagerConfigId;
const OWNER = `0x${'11'.repeat(32)}`;
const TX_DIGEST = '7g6sQdY5RrZ4kRzBz7VLgY3qX2vN6Y4mT8L1J5K9A2Bx';

const transport = new SuiGrpcTransport(suiConfig.grpc_url);
// `client` is private; the tests spy on its core methods. The value type has to be callable —
// vitest 4's `spyOn` resolves to `never` for a key whose type is not a function.
const core = (transport as unknown as { ['client']: { core: Record<string, (...args: never[]) => Promise<unknown>> } })[
  'client'
].core;

// A locally-buildable transaction — nothing here touches the network.
const makeTx = (sender?: string): Transaction => {
  const tx = new Transaction();
  if (sender) tx.setSender(sender);
  return tx;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SuiGrpcTransport — construction', () => {
  it('exposes the endpoint it was built with', () => {
    expect(transport.endpoint).toBe(suiConfig.grpc_url);
  });
});

describe('SuiGrpcTransport.getCoins', () => {
  it('maps a ListCoinsResponse onto SuiPaginatedCoins', async () => {
    const spy = vi.spyOn(core, 'listCoins').mockResolvedValueOnce({
      objects: [
        {
          objectId: '0xc1',
          version: '7',
          digest: 'deadbeef',
          owner: { $kind: 'AddressOwner', AddressOwner: OWNER },
          type: `0x2::coin::Coin<${SUI_BNUSD}>`,
          balance: '100',
        },
      ],
      hasNextPage: true,
      cursor: 'next-page',
    } as never);

    await expect(transport.getCoins(OWNER, SUI_BNUSD)).resolves.toEqual({
      // `coinType` echoes the requested filter — gRPC reports the full `0x2::coin::Coin<T>` tag.
      data: [{ balance: '100', coinObjectId: '0xc1', coinType: SUI_BNUSD, digest: 'deadbeef', version: '7' }],
      hasNextPage: true,
      nextCursor: 'next-page',
    });
    expect(spy).toHaveBeenCalledWith({ owner: OWNER, coinType: SUI_BNUSD, limit: 10 });
  });

  it('forwards an explicit limit', async () => {
    const spy = vi
      .spyOn(core, 'listCoins')
      .mockResolvedValueOnce({ objects: [], hasNextPage: false, cursor: null } as never);

    await transport.getCoins(OWNER, SUI_BNUSD, 3);

    expect(spy).toHaveBeenCalledWith({ owner: OWNER, coinType: SUI_BNUSD, limit: 3 });
  });
});

describe('SuiGrpcTransport.simulate', () => {
  const commandResult = (value: bigint) => ({
    $kind: 'Transaction',
    Transaction: { digest: TX_DIGEST },
    commandResults: [{ returnValues: [{ bcs: bcs.U64.serialize(value).toBytes() }], mutatedReferences: [] }],
  });

  it('returns BCS bytes as a number[] with an empty type tag', async () => {
    vi.spyOn(core, 'simulateTransaction').mockResolvedValueOnce(commandResult(7_500n) as never);

    const result = await transport.simulate(makeTx(OWNER), OWNER);

    expect(result.returnValues).toHaveLength(1);
    const [bytes, typeTag] = result.returnValues?.[0] ?? [];
    expect(bcs.U64.parse(Uint8Array.from(bytes ?? []))).toBe('7500');
    expect(typeTag).toBe('');
  });

  it('disables validation checks so public non-entry Move functions can be inspected', async () => {
    const spy = vi.spyOn(core, 'simulateTransaction').mockResolvedValueOnce(commandResult(1n) as never);

    await transport.simulate(makeTx(OWNER), OWNER);

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ checksEnabled: false }));
  });

  it('sets the sender on the transaction — simulateTransaction reads it off the tx, not a param', async () => {
    vi.spyOn(core, 'simulateTransaction').mockResolvedValueOnce(commandResult(1n) as never);
    const tx = makeTx();

    await transport.simulate(tx, OWNER);

    expect(tx.getData().sender).toBe(OWNER);
  });

  it('leaves an already-set sender alone', async () => {
    vi.spyOn(core, 'simulateTransaction').mockResolvedValueOnce(commandResult(1n) as never);
    const preset = `0x${'22'.repeat(32)}`;
    const tx = makeTx(preset);

    await transport.simulate(tx, OWNER);

    expect(tx.getData().sender).toBe(preset);
  });

  it('rebuilds a transaction that only exposes toJSON() — the SuiTransport contract guarantees nothing more', async () => {
    const spy = vi.spyOn(core, 'simulateTransaction').mockResolvedValueOnce(commandResult(1n) as never);
    const json = await makeTx().toJSON();

    await transport.simulate({ toJSON: () => Promise.resolve(json) }, OWNER);

    const { transaction } = (spy.mock.calls[0]?.[0] ?? {}) as unknown as { transaction: Transaction };
    expect(transaction).toBeInstanceOf(Transaction);
    expect(transaction.getData().sender).toBe(OWNER);
  });

  it('throws when the simulation produced no command results', async () => {
    vi.spyOn(core, 'simulateTransaction').mockResolvedValueOnce({
      $kind: 'Transaction',
      Transaction: { digest: TX_DIGEST },
      commandResults: [],
    } as never);

    await expect(transport.simulate(makeTx(OWNER), OWNER)).rejects.toThrow(/transaction didn't return any values/);
  });
});

describe('SuiGrpcTransport.estimateGas', () => {
  const gasUsed = {
    computationCost: '1000',
    storageCost: '2000',
    storageRebate: '500',
    nonRefundableStorageFee: '100',
  };

  it('returns the gas summary unchanged — GasCostSummary already matches SuiGasEstimate', async () => {
    const spy = vi.spyOn(core, 'simulateTransaction').mockResolvedValueOnce({
      $kind: 'Transaction',
      Transaction: { digest: TX_DIGEST, effects: { gasUsed } },
    } as never);

    await expect(transport.estimateGas(makeTx(OWNER), OWNER)).resolves.toEqual(gasUsed);
    // Unlike `simulate`, gas estimation keeps validation on for dry-run parity.
    expect(spy).toHaveBeenCalledWith(expect.not.objectContaining({ checksEnabled: false }));
  });

  it('reads effects off a failed transaction too — a reverted tx still reports gas', async () => {
    vi.spyOn(core, 'simulateTransaction').mockResolvedValueOnce({
      $kind: 'FailedTransaction',
      FailedTransaction: { digest: TX_DIGEST, effects: { gasUsed } },
    } as never);

    await expect(transport.estimateGas(makeTx(OWNER), OWNER)).resolves.toEqual(gasUsed);
  });

  it('throws when the simulation returned no effects', async () => {
    vi.spyOn(core, 'simulateTransaction').mockResolvedValueOnce({
      $kind: 'Transaction',
      Transaction: { digest: TX_DIGEST },
    } as never);

    await expect(transport.estimateGas(makeTx(OWNER), OWNER)).rejects.toThrow(
      'Transaction simulation returned no effects',
    );
  });
});

describe('SuiGrpcTransport.fetchLatestPackageId', () => {
  const objectWithJson = (json: unknown) => ({ object: { objectId: SUI_ASSET_MGR_CONFIG_ID, json } });
  const PKG = 'af63819d3ad01f93eb0a17b18077b8ef59ab657f0486c23ed384d38b38d9b54c';

  it('reads latest_package_id out of the object JSON', async () => {
    const spy = vi.spyOn(core, 'getObject').mockResolvedValueOnce(objectWithJson({ latest_package_id: PKG }) as never);

    await expect(transport.fetchLatestPackageId(SUI_ASSET_MGR_CONFIG_ID)).resolves.toBe(PKG);
    expect(spy).toHaveBeenCalledWith({
      objectId: SUI_ASSET_MGR_CONFIG_ID,
      include: { json: true },
      signal: expect.any(AbortSignal),
    });
  });

  it('bounds the read with a live timeout signal', async () => {
    let seen: AbortSignal | undefined;
    vi.spyOn(core, 'getObject').mockImplementationOnce((async (options: { signal?: AbortSignal }) => {
      seen = options.signal;
      return objectWithJson({ latest_package_id: PKG });
    }) as never);

    await transport.fetchLatestPackageId(SUI_ASSET_MGR_CONFIG_ID);

    // No signal, or one that already fired, would let a hung node stall every caller sharing the read.
    expect(seen?.aborted).toBe(false);
  });

  it('throws when getObject rejects, keeping the transport error as cause', async () => {
    const transportError = new Error('not found');
    vi.spyOn(core, 'getObject').mockRejectedValueOnce(transportError);

    // The cause is the only place the gRPC status survives — the wrapper message is fixed.
    await expect(transport.fetchLatestPackageId(SUI_ASSET_MGR_CONFIG_ID)).rejects.toThrow(
      expect.objectContaining({ message: 'Failed to fetch asset manager id', cause: transportError }),
    );
  });

  it('throws when the response carries no object', async () => {
    vi.spyOn(core, 'getObject').mockResolvedValueOnce({} as never);

    await expect(transport.fetchLatestPackageId(SUI_ASSET_MGR_CONFIG_ID)).rejects.toThrow(
      'Asset manager id not found (no data)',
    );
  });

  it('throws when the object is not a Move object (no JSON payload)', async () => {
    vi.spyOn(core, 'getObject').mockResolvedValueOnce(objectWithJson(null) as never);

    await expect(transport.fetchLatestPackageId(SUI_ASSET_MGR_CONFIG_ID)).rejects.toThrow(
      'Asset manager id not found (not a move object)',
    );
  });

  it('throws when the JSON lacks latest_package_id', async () => {
    vi.spyOn(core, 'getObject').mockResolvedValueOnce(objectWithJson({}) as never);

    await expect(transport.fetchLatestPackageId(SUI_ASSET_MGR_CONFIG_ID)).rejects.toThrow(
      'Asset manager id not found (no latest package id)',
    );
  });

  it('throws when latest_package_id is not a string', async () => {
    vi.spyOn(core, 'getObject').mockResolvedValueOnce(objectWithJson({ latest_package_id: 12345 }) as never);

    await expect(transport.fetchLatestPackageId(SUI_ASSET_MGR_CONFIG_ID)).rejects.toThrow(
      'Asset manager id invalid (latest package id is not a string)',
    );
  });

  it('throws when latest_package_id is an empty string', async () => {
    vi.spyOn(core, 'getObject').mockResolvedValueOnce(objectWithJson({ latest_package_id: '' }) as never);

    await expect(transport.fetchLatestPackageId(SUI_ASSET_MGR_CONFIG_ID)).rejects.toThrow(
      'Asset manager id not found (no latest package id)',
    );
  });
});

describe('SuiGrpcTransport.waitForTransaction', () => {
  const executed = (overrides: Record<string, unknown> = {}) => ({
    $kind: 'Transaction',
    Transaction: {
      digest: TX_DIGEST,
      epoch: '1215',
      effects: {
        status: { success: true, error: null },
        gasUsed: {
          computationCost: '1000',
          storageCost: '2000',
          storageRebate: '500',
          nonRefundableStorageFee: '100',
        },
        transactionDigest: TX_DIGEST,
        gasObject: {
          objectId: '0xg1',
          outputVersion: '9',
          outputDigest: 'gasdigest',
          outputOwner: { $kind: 'AddressOwner', AddressOwner: OWNER },
        },
        dependencies: [],
        eventsDigest: null,
        ...overrides,
      },
    },
  });

  it('translates a successful result into a SuiRawTransactionReceipt', async () => {
    vi.spyOn(core, 'waitForTransaction').mockResolvedValueOnce(executed() as never);

    const receipt = await transport.waitForTransaction({
      digest: TX_DIGEST,
      timeoutMs: 15_000,
      pollingIntervalMs: 500,
    });

    expect(receipt.digest).toBe(TX_DIGEST);
    expect(receipt.effects?.status).toEqual({ status: 'success' });
    expect(receipt.effects?.executedEpoch).toBe('1215');
    expect(receipt.effects?.gasObject).toEqual({
      owner: { AddressOwner: OWNER },
      reference: { objectId: '0xg1', version: '9', digest: 'gasdigest' },
    });
  });

  it('carries the abort message through on a failed transaction', async () => {
    vi.spyOn(core, 'waitForTransaction').mockResolvedValueOnce({
      $kind: 'FailedTransaction',
      FailedTransaction: {
        ...executed().Transaction,
        effects: {
          ...executed().Transaction.effects,
          status: { success: false, error: { message: 'MoveAbort' } },
        },
      },
    } as never);

    const receipt = await transport.waitForTransaction({
      digest: TX_DIGEST,
      timeoutMs: 15_000,
      pollingIntervalMs: 500,
    });

    expect(receipt.effects?.status).toEqual({ status: 'failure', error: 'MoveAbort' });
  });

  it('turns pollingIntervalMs into a two-step pollSchedule', async () => {
    const spy = vi.spyOn(core, 'waitForTransaction').mockResolvedValueOnce(executed() as never);

    await transport.waitForTransaction({ digest: TX_DIGEST, timeoutMs: 15_000, pollingIntervalMs: 500 });

    expect(spy).toHaveBeenCalledWith({
      digest: TX_DIGEST,
      include: { effects: true },
      timeout: 15_000,
      pollSchedule: [0, 500],
    });
  });

  it('floors the poll interval at 1ms so a 0 can never busy-loop', async () => {
    const spy = vi.spyOn(core, 'waitForTransaction').mockResolvedValueOnce(executed() as never);

    await transport.waitForTransaction({ digest: TX_DIGEST, timeoutMs: 15_000, pollingIntervalMs: 0 });

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ pollSchedule: [0, 1] }));
  });
});
