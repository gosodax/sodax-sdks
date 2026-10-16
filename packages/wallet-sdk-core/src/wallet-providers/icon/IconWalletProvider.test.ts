import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IcxCallTransaction } from '@sodax/types';

const mockLoadPrivateKey = vi.fn().mockReturnValue({ getAddress: () => 'hxabc' });
const sendTransactionExecute = vi.fn().mockResolvedValue('0xtxhash');
const sendTransactionFn = vi.fn().mockReturnValue({ execute: sendTransactionExecute });
const builderState: Record<string, unknown> = {};

vi.mock('icon-sdk-js', () => {
  class IconService {
    static HttpProvider = class {};
    static SignedTransaction = class {
      constructor(
        public readonly builtTx: unknown,
        public readonly wallet: unknown,
      ) {}
    };
    sendTransaction = sendTransactionFn;
    waitTransactionResult() {
      return { execute: vi.fn() };
    }
  }
  const Wallet = { loadPrivateKey: mockLoadPrivateKey };
  const Converter = { toHex: (n: number | string) => `0x${Number(n).toString(16)}` };
  class CallTransactionBuilder {
    from(value: unknown) {
      builderState.from = value;
      return this;
    }
    to(value: unknown) {
      builderState.to = value;
      return this;
    }
    stepLimit(value: unknown) {
      builderState.stepLimit = value;
      return this;
    }
    nid(value: unknown) {
      builderState.nid = value;
      return this;
    }
    version(value: unknown) {
      builderState.version = value;
      return this;
    }
    timestamp(value: unknown) {
      builderState.timestamp = value;
      return this;
    }
    value(value: unknown) {
      builderState.value = value;
      return this;
    }
    method(value: unknown) {
      builderState.method = value;
      return this;
    }
    params(value: unknown) {
      builderState.params = value;
      return this;
    }
    build() {
      return { ...builderState };
    }
  }
  const sdk = { IconService, Wallet, Converter, CallTransactionBuilder };
  return { ...sdk, default: sdk };
});

const { IconWalletProvider, requestAddress, requestSigning, requestJsonRpc } = await import('./IconWalletProvider.js');

const PRIVATE_KEY = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as const;
const RPC_URL = 'https://ctz.solidwallet.io/api/v3' as const;

const TX_BASE: IcxCallTransaction = {
  from: 'hxfrom',
  to: 'cxto',
  nid: '0x1',
  value: '0x0',
  method: 'doThing',
  params: { foo: 'bar' },
};

function makeProvider(defaults?: ConstructorParameters<typeof IconWalletProvider>[0]['defaults']) {
  return new IconWalletProvider({ privateKey: PRIVATE_KEY, rpcUrl: RPC_URL, defaults });
}

describe('IconWalletProvider', () => {
  describe('constructor', () => {
    it('initializes with private-key config', () => {
      const provider = new IconWalletProvider({ privateKey: PRIVATE_KEY, rpcUrl: RPC_URL });
      expect(provider.chainType).toBe('ICON');
      expect(provider.iconService).toBeDefined();
    });

    it('initializes with browser-extension config', () => {
      const provider = new IconWalletProvider({
        walletAddress: 'hx1234567890abcdef1234567890abcdef12345678',
        rpcUrl: RPC_URL,
      });
      expect(provider.chainType).toBe('ICON');
    });

    it('throws on invalid config', () => {
      expect(() => new IconWalletProvider({} as never)).toThrow('Invalid Icon wallet config');
    });

    it('accepts defaults without throwing', () => {
      const provider = new IconWalletProvider({
        privateKey: PRIVATE_KEY,
        rpcUrl: RPC_URL,
        defaults: { stepLimit: 5_000_000, version: '0x4', jsonRpcId: 42 },
      });
      expect(provider.chainType).toBe('ICON');
    });
  });

  describe('sendTransaction — option merge (PK path)', () => {
    beforeEach(() => {
      sendTransactionExecute.mockClear();
      sendTransactionFn.mockClear();
      for (const k of Object.keys(builderState)) delete builderState[k];
    });

    it('uses DEFAULT_STEP_LIMIT/DEFAULT_VERSION/DEFAULT_JSON_RPC_ID when no defaults nor tx fields', async () => {
      const provider = makeProvider();

      await provider.sendTransaction(TX_BASE);

      expect(builderState.stepLimit).toBe('0x2dc6c0'); // 3_000_000 in hex
      expect(builderState.version).toBe('0x3');
    });

    it('applies defaults.stepLimit/version when no per-call options nor tx fields', async () => {
      const provider = makeProvider({ stepLimit: 5_000_000, version: '0x4' });

      await provider.sendTransaction(TX_BASE);

      expect(builderState.stepLimit).toBe('0x4c4b40'); // 5_000_000 hex
      expect(builderState.version).toBe('0x4');
    });

    it('per-call options override defaults', async () => {
      const provider = makeProvider({ stepLimit: 5_000_000, version: '0x4' });

      await provider.sendTransaction(TX_BASE, { stepLimit: 1_000_000, version: '0x5' });

      expect(builderState.stepLimit).toBe('0xf4240'); // 1_000_000 hex
      expect(builderState.version).toBe('0x5');
    });

    it('tx-level version wins over both per-call options and defaults', async () => {
      const provider = makeProvider({ version: '0x4' });

      await provider.sendTransaction({ ...TX_BASE, version: '0x9' }, { version: '0x5' });

      expect(builderState.version).toBe('0x9');
    });

    it('tx-level timestamp wins over defaults.timestampProvider', async () => {
      const timestampProvider = vi.fn().mockReturnValue(1234);
      const provider = makeProvider({ timestampProvider });

      await provider.sendTransaction({ ...TX_BASE, timestamp: 0xabc });

      expect(timestampProvider).not.toHaveBeenCalled();
      expect(builderState.timestamp).toBe('0xabc');
    });

    it('invokes defaults.timestampProvider when tx.timestamp omitted', async () => {
      const timestampProvider = vi.fn().mockReturnValue(0x1000);
      const provider = makeProvider({ timestampProvider });

      await provider.sendTransaction(TX_BASE);

      expect(timestampProvider).toHaveBeenCalledTimes(1);
      expect(builderState.timestamp).toBe('0x1000');
    });
  });

  // WALLET-L-1: the ICONEX relay shares one window-event channel with no per-request
  // correlation id. The fix serializes requests (at most one in flight) and adds a timeout
  // with guaranteed listener cleanup. These tests guard those properties.
  describe('ICONEX relay helpers (WALLET-L-1)', () => {
    const FROM = 'hx1234567890abcdef1234567890abcdef12345678' as const;

    let win: any;

    // Flush pending microtasks (drains the serialization queue) via a real macrotask.
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));

    // Register a wallet stub that reacts to each outgoing ICONEX_RELAY_REQUEST.
    function onRequest(reply: (detail: any) => void) {
      win.addEventListener('ICONEX_RELAY_REQUEST', (event: Event) => {
        reply((event as CustomEvent).detail);
      });
    }

    function respond(detail: any) {
      win.dispatchEvent(new CustomEvent('ICONEX_RELAY_RESPONSE', { detail }));
    }

    beforeEach(() => {
      win = new EventTarget();
      globalThis.window = win;
    });

    afterEach(() => {
      (globalThis as { window?: unknown }).window = undefined;
      vi.useRealTimers();
    });

    it('resolves requestJsonRpc with a well-formed RESPONSE_JSON-RPC payload', async () => {
      onRequest(req => respond({ type: 'RESPONSE_JSON-RPC', payload: { id: req.payload.id, result: '0xhash' } }));

      await expect(requestJsonRpc({ tx: 1 }, 12345)).resolves.toEqual({ id: 12345, result: '0xhash' });
    });

    it('rejects requestJsonRpc immediately on a malformed RESPONSE_JSON-RPC (no string result)', async () => {
      // A JSON-RPC error response ({ id, error }) carries no string `result`; it must fail
      // fast, not hang until the timeout.
      onRequest(req =>
        respond({ type: 'RESPONSE_JSON-RPC', payload: { id: req.payload.id, error: { code: -1, message: 'nope' } } }),
      );

      await expect(requestJsonRpc({ tx: 1 }, 1)).rejects.toThrow('Invalid payload response type');
    });

    it('rejects requestJsonRpc on CANCEL_JSON-RPC', async () => {
      onRequest(() => respond({ type: 'CANCEL_JSON-RPC', payload: null }));

      await expect(requestJsonRpc({ tx: 1 }, 1)).rejects.toThrow('CANCEL_JSON-RPC');
    });

    it('serializes: at most one request is in flight, so a response cannot cross-resolve', async () => {
      // The wallet stub records requests but never answers on its own — the test drives
      // responses. This fails against non-serialized code (both requests would dispatch, and
      // the first response would resolve BOTH promises).
      const dispatched: string[] = [];
      win.addEventListener('ICONEX_RELAY_REQUEST', (event: Event) => {
        const d = (event as CustomEvent).detail;
        if (d.type === 'REQUEST_SIGNING') dispatched.push(d.payload.hash);
      });

      const p1 = requestSigning(FROM, 'HASH_A');
      const p2 = requestSigning(FROM, 'HASH_B');

      await tick();
      // Only the first request is in flight; the second is queued behind it.
      expect(dispatched).toEqual(['HASH_A']);

      respond({ type: 'RESPONSE_SIGNING', payload: 'sig:HASH_A' });
      await expect(p1).resolves.toBe('sig:HASH_A');

      await tick();
      // The queue advanced; the second request now dispatches.
      expect(dispatched).toEqual(['HASH_A', 'HASH_B']);

      respond({ type: 'RESPONSE_SIGNING', payload: 'sig:HASH_B' });
      await expect(p2).resolves.toBe('sig:HASH_B');
    });

    it('sendTransaction (browser-extension path) routes through requestJsonRpc and returns the result', async () => {
      onRequest(req => {
        if (req.type === 'REQUEST_JSON-RPC') {
          respond({ type: 'RESPONSE_JSON-RPC', payload: { id: req.payload.id, result: '0xbroadcasthash' } });
        }
      });

      const provider = new IconWalletProvider({ walletAddress: FROM, rpcUrl: RPC_URL });

      await expect(provider.sendTransaction(TX_BASE)).resolves.toBe('0xbroadcasthash');
    });

    it('rejects when there is no browser window, without wedging the shared queue', async () => {
      (globalThis as { window?: unknown }).window = undefined;
      await expect(requestAddress()).rejects.toThrow('require a browser environment');

      // Restore the window; a subsequent request must still resolve (the queue is not wedged).
      win = new EventTarget();
      globalThis.window = win;
      onRequest(() => respond({ type: 'RESPONSE_ADDRESS', payload: FROM }));

      await expect(requestAddress()).resolves.toBe(FROM);
    });

    it('times out and removes the exact response listener it added', async () => {
      vi.useFakeTimers();
      const addSpy = vi.spyOn(win, 'addEventListener');
      const removeSpy = vi.spyOn(win, 'removeEventListener');

      const pending = requestAddress();
      await vi.advanceTimersByTimeAsync(300_000);

      await expect(pending).rejects.toThrow('timed out');
      const addedHandler = addSpy.mock.calls.find((c: unknown[]) => c[0] === 'ICONEX_RELAY_RESPONSE')?.[1];
      expect(addedHandler).toBeDefined();
      expect(removeSpy).toHaveBeenCalledWith('ICONEX_RELAY_RESPONSE', addedHandler, false);
    });
  });
});
