import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ChainKeys } from '@sodax/types';
import type { SuiTypeConfig } from '@/types/config.js';

const { createDAppKit, grpcCtor } = vi.hoisted(() => ({
  createDAppKit: vi.fn<(options: { createClient: (network: string) => unknown }) => unknown>(() => ({
    signTransaction: vi.fn(),
  })),
  grpcCtor: vi.fn<(options: { baseUrl: string }) => void>(),
}));

vi.mock('@mysten/dapp-kit-react', () => ({
  createDAppKit,
  DAppKitProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@mysten/sui/grpc', () => ({
  // vitest 4 builds the instance with Reflect.construct, so a `new`-ed mock needs a class impl.
  SuiGrpcClient: vi.fn(
    class {
      core = {};
      constructor(opts: { baseUrl: string }) {
        grpcCtor(opts);
      }
    },
  ),
}));

// The trio's other two members do their own hydration; this file only covers endpoint resolution.
vi.mock('./SuiHydrator.js', () => ({ SuiHydrator: () => null }));
vi.mock('./SuiActions.js', () => ({ SuiActions: () => null }));

import { SuiProvider } from './SuiProvider.js';

const renderWith = (config: SuiTypeConfig) =>
  render(
    <SuiProvider config={config}>
      <div />
    </SuiProvider>,
  );

/** The client factory is only invoked by dApp Kit, so call it to see the URL it would build. */
const resolvedEndpoint = (): string | undefined => {
  createDAppKit.mock.calls[0]?.[0]?.createClient('mainnet');
  return grpcCtor.mock.calls[0]?.[0]?.baseUrl;
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SuiProvider — endpoint resolution', () => {
  it('defaults to the packaged mainnet gRPC endpoint', () => {
    renderWith({});
    expect(resolvedEndpoint()).toBe('https://fullnode.mainnet.sui.io');
  });

  it('uses a configured grpcUrl', () => {
    renderWith({ chains: { [ChainKeys.SUI_MAINNET]: { grpcUrl: 'https://my-grpc.example' } } });
    expect(resolvedEndpoint()).toBe('https://my-grpc.example');
  });

  it('honors the pre-gRPC `rpcUrl` name so existing configs keep working', () => {
    renderWith({ chains: { [ChainKeys.SUI_MAINNET]: { rpcUrl: 'https://my-node.example' } } });
    expect(resolvedEndpoint()).toBe('https://my-node.example');
  });

  // The entry type rejects this at compile time; the cast stands in for an untyped JS caller.
  it('rejects both names instead of silently picking one', () => {
    expect(() =>
      renderWith({
        chains: {
          [ChainKeys.SUI_MAINNET]: { grpcUrl: 'https://my-grpc.example', rpcUrl: 'https://my-node.example' },
        },
      } as unknown as SuiTypeConfig),
    ).toThrow(/`grpcUrl` or `rpcUrl`, not both/);
  });

  it('has a packaged endpoint for every network the config type offers', () => {
    renderWith({ network: 'testnet' });
    expect(resolvedEndpoint()).toBe('https://fullnode.testnet.sui.io');
  });

  // The union rejects this at compile time; the cast stands in for an untyped JS caller.
  it('throws for a network it ships no endpoint for', () => {
    expect(() => renderWith({ network: 'devnet' } as unknown as SuiTypeConfig)).toThrow(/no default gRPC endpoint/);
  });
});
