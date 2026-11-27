import { describe, expect, it, vi } from 'vitest';
import type { ChainType } from '@sodax/types';
import type { IXConnector } from '@/types/interfaces.js';
import type { XAccount } from '@/types/index.js';
import { resolveBatchTargets, runBatchConnect, type BatchConnectProgressEvent } from './useBatchConnect.js';

const makeConnector = (chainType: ChainType, id: string, name = id): IXConnector =>
  ({
    xChainType: chainType,
    id,
    name,
    _id: id,
    isInstalled: true,
    installUrl: undefined,
    icon: undefined,
    connect: vi.fn(),
    disconnect: vi.fn(),
  }) as unknown as IXConnector;

const account = (address: string, chainType: ChainType): XAccount => ({ address, xChainType: chainType });

// ─── resolveBatchTargets ────────────────────────────────────────────────────

describe('resolveBatchTargets', () => {
  it('returns one target per chain whose connector matches an identifier', () => {
    const evmHana = makeConnector('EVM', 'io.hana.wallet', 'Hana');
    const iconHana = makeConnector('ICON', 'hana', 'Hana');

    const targets = resolveBatchTargets(['hana'], { EVM: [evmHana], ICON: [iconHana] });

    expect(targets).toEqual([
      { chainType: 'ICON', connector: iconHana },
      { chainType: 'EVM', connector: evmHana },
    ]);
  });

  it('emits every matching identifier per chain in priority order, skipping identifiers without a match', () => {
    const phantom = makeConnector('SOLANA', 'phantom', 'Phantom');
    const hana = makeConnector('SOLANA', 'hana', 'Hana');

    const targets = resolveBatchTargets(['hana', 'okx', 'phantom'], { SOLANA: [phantom, hana] });

    expect(targets).toEqual([
      { chainType: 'SOLANA', connector: hana },
      { chainType: 'SOLANA', connector: phantom },
    ]);
  });

  it('returns no target for chains with no connectors or no matching identifier', () => {
    const phantom = makeConnector('SOLANA', 'phantom', 'Phantom');
    expect(resolveBatchTargets(['hana'], { ICON: [], SOLANA: [phantom] })).toEqual([]);
    expect(resolveBatchTargets([], { SOLANA: [phantom] })).toEqual([]);
  });
});

// ─── runBatchConnect ────────────────────────────────────────────────────────

describe('runBatchConnect', () => {
  const evmHana = makeConnector('EVM', 'hana', 'Hana');
  const iconHana = makeConnector('ICON', 'hana', 'Hana');

  it('connects every target sequentially, in target order', async () => {
    const connect = vi.fn(async (c: IXConnector) => account(`addr-${c.xChainType}`, c.xChainType));
    const result = await runBatchConnect(
      [
        { chainType: 'ICON', connector: iconHana },
        { chainType: 'EVM', connector: evmHana },
      ],
      { connect, isConnected: () => false, skipConnected: false },
    );

    expect(result).toEqual({ successful: ['ICON', 'EVM'], failed: [], skipped: [] });
    expect(connect.mock.calls).toEqual([[iconHana], [evmHana]]);
  });

  it('collects failures without throwing and reports each outcome through onProgress', async () => {
    const events: BatchConnectProgressEvent[] = [];
    const evmError = new Error('user rejected');
    const connect = vi.fn(async (c: IXConnector) => {
      if (c.xChainType === 'EVM') throw evmError;
      return account('addr-icon', 'ICON');
    });

    const result = await runBatchConnect(
      [
        { chainType: 'EVM', connector: evmHana },
        { chainType: 'ICON', connector: iconHana },
      ],
      { connect, isConnected: () => false, skipConnected: false, onProgress: e => events.push(e) },
    );

    expect(result).toEqual({ successful: ['ICON'], failed: [{ chainType: 'EVM', error: evmError }], skipped: [] });
    expect(events).toEqual([
      { chainType: 'EVM', outcome: 'failure', error: evmError },
      { chainType: 'ICON', outcome: 'success' },
    ]);
  });

  it('wraps non-Error throws into Error', async () => {
    const connect = vi.fn(async () => {
      throw 'string-error';
    });
    const result = await runBatchConnect([{ chainType: 'EVM', connector: evmHana }], {
      connect,
      isConnected: () => false,
      skipConnected: false,
    });
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.error).toBeInstanceOf(Error);
    expect(result.failed[0]?.error.message).toBe('string-error');
  });

  it('isolates throwing onProgress callback — batch still completes', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const connect = vi.fn(async (c: IXConnector) => account('addr', c.xChainType));

    const result = await runBatchConnect([{ chainType: 'EVM', connector: evmHana }], {
      connect,
      isConnected: () => false,
      skipConnected: false,
      onProgress: () => {
        throw new Error('progress threw');
      },
    });

    expect(result.successful).toEqual(['EVM']);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  // ─── skipConnected ────────────────────────────────────────────────────────

  const evmHanaConnector = makeConnector('EVM', 'io.hana.wallet', 'Hana');
  const evmPhantomConnector = makeConnector('EVM', 'app.phantom', 'Phantom');

  it('skipConnected skips an already-connected chain once, dropping its later targets without retrying', async () => {
    const events: BatchConnectProgressEvent[] = [];
    const connect = vi.fn(async (c: IXConnector) => account(`addr-${c.xChainType}`, c.xChainType));
    const isConnected = (chain: ChainType) => chain === 'EVM';

    const result = await runBatchConnect(
      [
        { chainType: 'EVM', connector: evmHanaConnector },
        { chainType: 'EVM', connector: evmPhantomConnector },
        { chainType: 'ICON', connector: iconHana },
      ],
      { connect, isConnected, skipConnected: true, onProgress: e => events.push(e) },
    );

    expect(result).toEqual({ successful: ['ICON'], failed: [], skipped: ['EVM'] });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith(iconHana);
    expect(events).toEqual([
      { chainType: 'EVM', outcome: 'skipped' },
      { chainType: 'ICON', outcome: 'success' },
    ]);
  });

  it('does not skip already-connected chains when skipConnected is off', async () => {
    const connect = vi.fn(async (c: IXConnector) => account(`addr-${c.xChainType}`, c.xChainType));

    const result = await runBatchConnect([{ chainType: 'EVM', connector: evmHana }], {
      connect,
      isConnected: () => true,
      skipConnected: false,
    });

    expect(result).toEqual({ successful: ['EVM'], failed: [], skipped: [] });
  });

  // ─── Fallback-on-failure behavior ─────────────────────────────────────────

  it('skips later targets for the same chain once one succeeds', async () => {
    const connect = vi.fn(async (c: IXConnector) => account(`addr-${c.id}`, c.xChainType));

    const result = await runBatchConnect(
      [
        { chainType: 'EVM', connector: evmHanaConnector },
        { chainType: 'EVM', connector: evmPhantomConnector },
      ],
      { connect, isConnected: () => false, skipConnected: false },
    );

    expect(result).toEqual({ successful: ['EVM'], failed: [], skipped: [] });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith(evmHanaConnector);
  });

  it('falls back to the next target for the same chain when the earlier one fails, emitting each attempt', async () => {
    const events: BatchConnectProgressEvent[] = [];
    const hanaErr = new Error('Hana popup denied');
    const connect = vi.fn(async (c: IXConnector) => {
      if (c.id === 'io.hana.wallet') throw hanaErr;
      return account(`addr-${c.id}`, c.xChainType);
    });

    const result = await runBatchConnect(
      [
        { chainType: 'EVM', connector: evmHanaConnector },
        { chainType: 'EVM', connector: evmPhantomConnector },
      ],
      { connect, isConnected: () => false, skipConnected: false, onProgress: e => events.push(e) },
    );

    expect(result).toEqual({ successful: ['EVM'], failed: [], skipped: [] });
    expect(connect).toHaveBeenCalledTimes(2);
    expect(events).toEqual([
      { chainType: 'EVM', outcome: 'failure', error: hanaErr },
      { chainType: 'EVM', outcome: 'success' },
    ]);
  });

  it('records the latest error when every target for a chain fails', async () => {
    const hanaErr = new Error('Hana popup denied');
    const phantomErr = new Error('Phantom popup denied');
    const connect = vi.fn(async (c: IXConnector) => {
      throw c.id === 'io.hana.wallet' ? hanaErr : phantomErr;
    });

    const result = await runBatchConnect(
      [
        { chainType: 'EVM', connector: evmHanaConnector },
        { chainType: 'EVM', connector: evmPhantomConnector },
      ],
      { connect, isConnected: () => false, skipConnected: false },
    );

    expect(result.successful).toEqual([]);
    expect(result.failed).toEqual([{ chainType: 'EVM', error: phantomErr }]);
  });
});
