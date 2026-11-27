import { describe, expect, it, vi } from 'vitest';
import type { ChainType } from '@sodax/types';
import type { IXConnector } from '@/types/interfaces.js';
import type { XConnection } from '@/types/index.js';
import {
  resolveDisconnectTargets,
  runBatchDisconnect,
  type BatchDisconnectProgressEvent,
} from './useBatchDisconnect.js';

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

const connection = (chainType: ChainType, address: string, xConnectorId: string): XConnection => ({
  xAccount: { address, xChainType: chainType },
  xConnectorId,
});

// ─── resolveDisconnectTargets ───────────────────────────────────────────────

describe('resolveDisconnectTargets', () => {
  it('returns every chain with an active address when connectors filter is undefined', () => {
    const connections = {
      EVM: connection('EVM', '0xabc', 'io.hana.wallet'),
      ICON: connection('ICON', 'hx123', 'hana'),
      SUI: { xAccount: { address: undefined, xChainType: 'SUI' as const }, xConnectorId: 'hana' },
    };
    expect(resolveDisconnectTargets(undefined, connections, {})).toEqual(['ICON', 'EVM']);
  });

  it('keeps only chains whose active connector matches any identifier', () => {
    const connections = {
      EVM: connection('EVM', '0xabc', 'io.hana.wallet'),
      ICON: connection('ICON', 'hx123', 'hana'),
      SOLANA: connection('SOLANA', 'sol-addr', 'phantom'),
    };
    const connectorsByChain = {
      EVM: [makeConnector('EVM', 'io.hana.wallet', 'Hana')],
      ICON: [makeConnector('ICON', 'hana', 'Hana')],
      SOLANA: [makeConnector('SOLANA', 'phantom', 'Phantom')],
    };

    expect(resolveDisconnectTargets(['hana'], connections, connectorsByChain)).toEqual(['ICON', 'EVM']);
    expect(resolveDisconnectTargets(['hana', 'phantom'], connections, connectorsByChain)).toEqual([
      'ICON',
      'EVM',
      'SOLANA',
    ]);
  });

  it('skips connections whose connectorId does not match any registered connector', () => {
    const connections = { EVM: connection('EVM', '0xabc', 'unknown-connector') };
    const connectorsByChain = { EVM: [makeConnector('EVM', 'hana', 'Hana')] };

    expect(resolveDisconnectTargets(['hana'], connections, connectorsByChain)).toEqual([]);
  });
});

// ─── runBatchDisconnect ─────────────────────────────────────────────────────

describe('runBatchDisconnect', () => {
  it('disconnects every chain sequentially, in input order', async () => {
    const disconnect = vi.fn(async () => undefined);
    const result = await runBatchDisconnect(['ICON', 'SOLANA', 'EVM'], disconnect);

    expect(result).toEqual({ successful: ['ICON', 'SOLANA', 'EVM'], failed: [] });
    expect(disconnect.mock.calls).toEqual([
      [{ xChainType: 'ICON' }],
      [{ xChainType: 'SOLANA' }],
      [{ xChainType: 'EVM' }],
    ]);
  });

  it('collects failures without throwing and reports each outcome through onProgress', async () => {
    const events: BatchDisconnectProgressEvent[] = [];
    const evmError = new Error('extension closed');
    const disconnect = vi.fn(async ({ xChainType }: { xChainType: ChainType }) => {
      if (xChainType === 'EVM') throw evmError;
    });

    const result = await runBatchDisconnect(['EVM', 'ICON'], disconnect, e => events.push(e));

    expect(result).toEqual({ successful: ['ICON'], failed: [{ chainType: 'EVM', error: evmError }] });
    expect(events).toEqual([
      { chainType: 'EVM', outcome: 'failure', error: evmError },
      { chainType: 'ICON', outcome: 'success' },
    ]);
  });

  it('wraps non-Error throws into Error', async () => {
    const disconnect = vi.fn(async () => {
      throw 'string-error';
    });
    const result = await runBatchDisconnect(['EVM'], disconnect);

    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.error).toBeInstanceOf(Error);
    expect(result.failed[0]?.error.message).toBe('string-error');
  });

  it('isolates throwing onProgress callback — batch still completes', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const disconnect = vi.fn(async () => undefined);

    const result = await runBatchDisconnect(['EVM'], disconnect, () => {
      throw new Error('progress threw');
    });

    expect(result.successful).toEqual(['EVM']);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
