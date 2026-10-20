import type { XAccount } from '@/types/index.js';
import { XConnector } from '@/core/index.js';
import type { TronWebLike } from '@sodax/wallet-sdk-core';

// Self-contained data URI (the TRON mark) — avoids cross-origin/CORS image fetches.
const TRONLINK_ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='16' fill='%23EF0027'/%3E%3Cpath d='M7 9l13 2.5 5 3.5-9 12L11 15z' fill='none' stroke='%23fff' stroke-width='1.3' stroke-linejoin='round'/%3E%3C/svg%3E";
const TRONLINK_INSTALL_URL = 'https://www.tronlink.org/';

/** TIP-6963 discovery handshake, the Tron analogue of EIP-6963. */
const TRON_TIP6963_REQUEST = 'TIP6963:requestProvider';
const TRON_TIP6963_ANNOUNCE = 'TIP6963:announceProvider';

/** How long to let wallets answer the announce broadcast. Extensions reply near-immediately. */
const TRON_DISCOVERY_WINDOW_MS = 300;

/** EIP-1193 code for a user-rejected request. */
const TRON_USER_REJECTED_CODE = 4001;

/** Connector identity, as the wallet modal and stored connections refer to it. */
const TRON_CONNECTOR_NAME = 'TronLink';
const TRON_CONNECTOR_ID = 'TronLink';

/** How long to wait for the wallet to publish its base58 address after authorizing. */
const TRON_ADDRESS_WAIT_MS = 2000;

/** A Tron wallet provider. Authorize with `eth_requestAccounts`; the legacy call does not prompt. */
interface TronProvider {
  request: (args: { method: string; params?: unknown }) => Promise<unknown>;
  tronWeb?: TronWebLike;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
}

/** One TIP-6963 announcement: who the wallet is, plus its provider handle. */
interface Tip6963ProviderDetail {
  info?: { uuid?: string; name?: string; icon?: string; rdns?: string };
  provider: TronProvider;
}

type TronWindow = {
  tron?: TronProvider;
  tronLink?: TronProvider;
  tronWeb?: TronWebLike;
};

function tronWindow(): TronWindow | undefined {
  return typeof window === 'undefined' ? undefined : (window as unknown as TronWindow);
}

function isTronLinkDetail(detail: Tip6963ProviderDetail): boolean {
  return /tronlink/i.test(detail.info?.name ?? '') || /tronlink/i.test(detail.info?.rdns ?? '');
}

/** Discover Tron providers via TIP-6963, so TronLink is identified rather than inferred. */
async function discoverProviders(timeoutMs = TRON_DISCOVERY_WINDOW_MS): Promise<Tip6963ProviderDetail[]> {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return [];

  const found: Tip6963ProviderDetail[] = [];
  const onAnnounce = (event: Event): void => {
    const detail = (event as CustomEvent<Tip6963ProviderDetail>).detail;
    if (detail?.provider && !found.some(d => d.provider === detail.provider)) found.push(detail);
  };

  window.addEventListener(TRON_TIP6963_ANNOUNCE, onAnnounce);
  window.dispatchEvent(new Event(TRON_TIP6963_REQUEST));
  await new Promise(resolve => setTimeout(resolve, timeoutMs));
  window.removeEventListener(TRON_TIP6963_ANNOUNCE, onAnnounce);

  // TronLink first; another announcing wallet is still usable when it is all that is present.
  return [...found.filter(isTronLinkDetail), ...found.filter(d => !isTronLinkDetail(d))];
}

/** Tron's canonical account form: base58check, always `T`-prefixed. */
function isBase58Address(value: string): boolean {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value);
}

/** Wait briefly: `eth_requestAccounts` can resolve before `tronWeb.defaultAddress` is populated. */
async function waitForBase58(provider: TronProvider, timeoutMs = TRON_ADDRESS_WAIT_MS): Promise<string | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const address = provider.tronWeb?.defaultAddress?.base58;
    if (typeof address === 'string' && isBase58Address(address)) return address;
    if (Date.now() >= deadline) return undefined;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

/** Cached announcement: the provider getters are sync, so after a reload they have nothing to await. */
let announcedProvider: TronProvider | undefined;
/** The window the cache belongs to — a different one means a different page, so start over. */
let primedFor: unknown;

/** Start discovery once per page so the announced provider is cached before it is needed. */
function primeDiscovery(): void {
  const w = tronWindow();
  if (!w || primedFor === w) return;
  primedFor = w;
  announcedProvider = undefined;
  void discoverProviders().then(found => {
    announcedProvider ??= found[0]?.provider;
  });
}

/** The provider handle available without awaiting discovery. */
function syncProvider(): TronProvider | undefined {
  const w = tronWindow();
  if (primedFor !== w) announcedProvider = undefined;
  // The announced provider first: it is the connected one, and the globals may not be.
  return announcedProvider ?? w?.tron ?? w?.tronLink;
}

/** The provider to authorize against: the TIP-6963 announcement first, then the injected globals. */
async function resolveProvider(): Promise<TronProvider | undefined> {
  const announced = await discoverProviders();
  announcedProvider = announced[0]?.provider ?? announcedProvider;
  return announcedProvider ?? syncProvider();
}

/**
 * TronLink connector over TIP-6963. The registry reads {@link getTronWeb} to build the wallet provider.
 */
export class TronXConnector extends XConnector {
  /** Set by `connect()`, so the registry builds from the wallet that actually authorized. */
  private connected?: TronProvider;

  constructor() {
    super('TRON', TRON_CONNECTOR_NAME, TRON_CONNECTOR_ID);
    // A reload rebuilds this connector without re-running `connect()`, so warm the cache now.
    primeDiscovery();
  }

  async connect(): Promise<XAccount | undefined> {
    const provider = await resolveProvider();
    if (!provider || typeof provider.request !== 'function') {
      throw new Error('TronLink is not installed. Install the extension and reload the page.');
    }

    let accounts: string[] | undefined;
    try {
      accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[] | undefined;
    } catch (error) {
      const { code, message } = (error ?? {}) as { code?: number; message?: string };
      if (code === TRON_USER_REJECTED_CODE) {
        throw new Error('Tron connection request was rejected in the wallet.');
      }
      throw new Error(`Could not connect a Tron account${message ? `: ${message}` : ''}.`);
    }

    // Wait for the base58 form rather than use `accounts[0]`, which is hex.
    const address = (await waitForBase58(provider)) ?? accounts?.[0];
    if (!address) {
      throw new Error('Tron wallet authorized but returned no account. Reload the page and retry.');
    }
    if (!isBase58Address(address)) {
      throw new Error(
        `Tron wallet returned a non-base58 account (${address}). Reload the page so the wallet can publish its T… address, then retry.`,
      );
    }

    this.connected = provider;
    return { address, xChainType: this.xChainType };
  }

  async disconnect(): Promise<void> {
    // TronLink has no programmatic disconnect; clearing the app-side connection is enough.
    this.connected = undefined;
  }

  public override get icon(): string {
    return TRONLINK_ICON;
  }

  public override get isInstalled(): boolean {
    // Sync getter on the render path, so it cannot run TIP-6963 discovery, which is async.
    const w = tronWindow();
    return w?.tron != null || w?.tronLink != null;
  }

  public override get installUrl(): string | undefined {
    return TRONLINK_INSTALL_URL;
  }

  /** The authorized provider, for the registry to sign through. */
  public getProvider(): TronProvider | undefined {
    return this.connected ?? syncProvider();
  }

  /** The authorized provider's TronWeb. Never the global `window.tronWeb`, which cannot sign. */
  public getTronWeb(): TronWebLike | undefined {
    return this.connected?.tronWeb ?? syncProvider()?.tronWeb;
  }

  /** Subscribe to wallet-side account/network changes. Returns an unsubscribe function. */
  public onWalletEvents(handler: (event: 'accountsChanged' | 'chainChanged', payload: unknown) => void): () => void {
    const provider = this.connected ?? syncProvider();
    if (!provider?.on) return () => undefined;
    const onAccounts = (...args: unknown[]): void => handler('accountsChanged', args[0]);
    const onChain = (...args: unknown[]): void => handler('chainChanged', args[0]);
    provider.on('accountsChanged', onAccounts);
    provider.on('chainChanged', onChain);
    return () => {
      provider.removeListener?.('accountsChanged', onAccounts);
      provider.removeListener?.('chainChanged', onChain);
    };
  }
}
