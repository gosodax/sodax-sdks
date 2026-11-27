import {
  BOUND_API_HOST,
  BOUND_COMPANION_HOSTS,
  DEPRECATED_BOUND_HOSTS,
  detectBitcoinAddressType,
  usesBip322MessageSigning,
  type IBitcoinWalletProvider,
  type RadfiConfig,
  type RadfiDepositTxResponse,
  type RadfiSigner,
} from '@sodax/types';
import type { RelayExtraData } from '../../types/relay-types.js';

/** Bound Exchange non-2xx body: detail usually at `error.details`; `code` is Bound-specific (e.g. "2002"). */
export type RadfiErrorBody = {
  code?: string;
  message?: string;
  details?: string;
  error?: { details?: string; message?: string };
};

/** Parsed Bound response; `data` is optional because Bound can answer 2xx with a logical-error envelope. */
export type RadfiResponseEnvelope<T = unknown> = RadfiErrorBody & { data?: T };

/** Bound Exchange HTTP error; the raw response body is preserved on `cause`. */
export class RadfiApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: string;
  override readonly cause?: unknown;

  constructor(status: number, body: RadfiErrorBody, fallback: string) {
    super(body?.message || fallback);
    this.name = 'RadfiApiError';
    this.status = status;
    this.code = body?.code;
    this.details = body?.error?.details || body?.details;
    this.cause = body;
  }
}

export type RadfiTradingWallet = {
  tradingAddress: string;
  userAddress: string;
  userPublicKey: string;
};

export type RadfiAuthResult = {
  accessToken: string;
  refreshToken: string;
  tradingAddress: string;
};

export type RadfiWalletBalance = {
  btcSatoshi: bigint;
  pendingSatoshi: bigint;
  externalPendingSatoshi: bigint;
  totalUtxos: number;
};

export type RadfiUtxo = {
  _id: string;
  txid: string;
  vout: number;
  txidVout: string;
  satoshi: number;
  amount: string;
  address: string;
  isSpent: boolean;
  status: string;
  source: string;
  runes?: Array<{
    runeid: string;
    amount: string;
    divisibility?: number;
    rune?: string;
    spacedRune?: string;
    symbol?: string;
  }>;
  height?: number;
  confirmations?: number;
  createdAt?: number;
  updatedAt?: number;
};

export type RadfiUtxoListResponse = {
  code: string;
  message: string;
  data: RadfiUtxo[];
};

export type RadfiBuildTxResponse = {
  base64Psbt: string;
  fee: { feeRate: number; totalFee: number };
  txId: string;
};

export type RadfiMaxSpentResponse = {
  maxSatsAmt: number;
  feeRate: number;
  fee: number;
};

/** Runtime (non-serializable) wiring for {@link RadfiProvider}; serializable config belongs on {@link RadfiConfig}. */
export type RadfiProviderOptions = {
  /** Attaches per-request headers to outbound Bound calls, e.g. a backend's HMAC closure. */
  signer?: RadfiSigner;
};

/**
 * Declared per call site, so an unrouted call fails to compile rather than defaulting to `apiUrl`.
 * No `'ums'` member on purpose: routing a UMS call through `request()` would move it to auth.
 */
export type RadfiHost = 'api' | 'auth' | 'transactions';

const stripSlash = (url: string): string => (url.endsWith('/') ? url.slice(0, -1) : url);
/** Blank is not a host: `''` from an env var or a form would survive `??` and make every URL relative. */
const normalizeUrl = (url: string | undefined): string | undefined => {
  const trimmed = url?.trim();
  return trimmed ? stripSlash(trimmed) : undefined;
};

export class RadfiProvider {
  private readonly config: RadfiConfig;
  private readonly hosts: Record<RadfiHost, string>;
  // Invoked per outbound Bound request on every routed host; UMS calls bypass `request()` and stay unsigned.
  private readonly signer?: RadfiSigner;
  public accessToken = '';
  public refreshToken = '';

  constructor(config: RadfiConfig, options?: RadfiProviderOptions) {
    this.config = config;
    this.signer = options?.signer;
    // Seed a pre-provisioned session so server-side callers (no interactive BIP322 sign-in) can authenticate.
    this.accessToken = config.accessToken ?? '';
    this.refreshToken = config.refreshToken ?? '';
    if (config.umsUrl?.endsWith('/')) {
      this.config.umsUrl = config.umsUrl.slice(0, -1);
    }

    const api = normalizeUrl(config.apiUrl) ?? config.apiUrl;
    // Companions are registered per api host; an unknown apiUrl sends every family to itself.
    const companions = BOUND_COMPANION_HOSTS[api] ?? {};

    this.hosts = {
      api,
      auth: normalizeUrl(config.authUrl) ?? companions.auth ?? api,
      transactions: normalizeUrl(config.transactionsUrl) ?? companions.transactions ?? api,
    };

    // Refuse a retired host outright rather than deferring the failure; the replacement differs per field.
    const packaged = BOUND_COMPANION_HOSTS[BOUND_API_HOST] ?? {};
    const replacementFor = {
      apiUrl: BOUND_API_HOST,
      authUrl: packaged.auth ?? BOUND_API_HOST,
      transactionsUrl: packaged.transactions ?? BOUND_API_HOST,
    } as const;

    for (const field of ['apiUrl', 'authUrl', 'transactionsUrl'] as const) {
      const url = normalizeUrl(config[field]);
      if (url && DEPRECATED_BOUND_HOSTS.includes(url)) {
        throw new Error(
          `Bound Exchange has retired ${url}. Set chains.bitcoin.radfi.${field} to ${replacementFor[field]}, or remove it to take the packaged default.`,
        );
      }
    }
  }

  /** BIP322/ECDSA-signs a login message and authenticates with Bound Exchange. */
  public async authenticateWithWallet(
    walletProvider: IBitcoinWalletProvider,
    cachedPublicKey?: string,
  ): Promise<{ accessToken: string; refreshToken: string; tradingAddress: string; publicKey: string }> {
    const address = await walletProvider.getWalletAddress();

    let publicKey = cachedPublicKey;
    if (!publicKey) {
      if (!walletProvider.getPublicKey) {
        throw new Error('Wallet provider does not support getPublicKey');
      }
      publicKey = await walletProvider.getPublicKey();
    }
    if (!publicKey) {
      throw new Error('Failed to retrieve public key from wallet. Please unlock your wallet and try again.');
    }

    const message = `${Date.now()}`;
    // Pick the message-signing scheme by address type: P2WPKH/P2TR sign via BIP322, P2SH/P2PKH via ECDSA.
    const signature = usesBip322MessageSigning(detectBitcoinAddressType(address))
      ? await walletProvider.signBip322Message(message)
      : await walletProvider.signEcdsaMessage(message);

    const result = await this.authenticate({ message, signature, address, publicKey });
    this.setRadfiAccessToken(result.accessToken, result.refreshToken);
    return { ...result, publicKey };
  }

  /** Refreshes the access token if possible, otherwise falls back to full re-authentication (wallet signature). */
  public async ensureRadfiAccessToken(walletProvider: IBitcoinWalletProvider): Promise<void> {
    if (this.refreshToken) {
      try {
        const { accessToken, refreshToken } = await this.refreshAccessToken(this.refreshToken);
        this.setRadfiAccessToken(accessToken, refreshToken);
        return;
      } catch (error) {
        // Refresh failed — keep the error visible, then fall through to full re-authentication below.
        console.warn('[ensureRadfiAccessToken] refresh failed, falling back to full re-auth', error);
      }
    }

    this.accessToken = '';
    this.refreshToken = '';
    await this.authenticateWithWallet(walletProvider);
  }

  public setRadfiAccessToken(token: string, refreshToken?: string) {
    this.accessToken = token;
    if (refreshToken !== undefined) {
      this.refreshToken = refreshToken;
    }
  }

  public async authenticate(params: {
    message: string;
    signature: string;
    address: string;
    publicKey: string;
  }): Promise<RadfiAuthResult> {
    const res = await this.request('auth', '/auth/authenticate', {
      method: 'POST',
      body: JSON.stringify(params),
    });

    const body = await this.parseJsonBody<{
      accessToken?: string;
      refreshToken?: string;
      tradingAddress?: string;
      wallet?: { tradingAddress?: string };
    }>(res, 'Bound Exchange authentication failed');
    if (!res.ok) {
      throw new RadfiApiError(res.status, body, 'Bound Exchange authentication failed');
    }

    return {
      accessToken: body.data?.accessToken ?? '',
      refreshToken: body.data?.refreshToken ?? '',
      tradingAddress: body.data?.tradingAddress ?? body.data?.wallet?.tradingAddress ?? '',
    };
  }

  public async refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const res = await this.request('auth', '/auth/refresh-token', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    });

    const body = await this.parseJsonBody<{ accessToken?: string; refreshToken?: string }>(res, 'Token refresh failed');
    if (!res.ok) {
      throw new RadfiApiError(res.status, body, 'Token refresh failed');
    }

    return {
      accessToken: body.data?.accessToken ?? '',
      refreshToken: body.data?.refreshToken ?? refreshToken,
    };
  }

  public async createTradingWallet(
    params: {
      walletAddress: string;
      publicKey: string;
    },
    accessToken: string,
  ): Promise<RadfiTradingWallet> {
    const res = await this.request('auth', '/wallets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.resolveAuth(accessToken)}`,
      },
      body: JSON.stringify(params),
    });

    const body = await this.parseJsonBody<RadfiTradingWallet>(res, 'Failed to create trading wallet');
    if (!res.ok || !body.data) {
      throw new RadfiApiError(res.status, body, 'Failed to create trading wallet');
    }

    return body.data;
  }

  public async getTradingWallet(userAddress: string): Promise<RadfiTradingWallet> {
    const res = await this.request('auth', `/wallets/details/${userAddress}`, {
      method: 'GET',
    });

    // A non-2xx may be an HTML gateway/WAF page; parseJsonBody surfaces it with the real HTTP status.
    const body = await this.parseJsonBody<RadfiTradingWallet>(res, 'Trading wallet not found');
    if (!res.ok || !body.data) {
      throw new RadfiApiError(res.status, body, 'Trading wallet not found');
    }
    return body.data;
  }

  // UMS call: deliberately unsigned (UMS doesn't verify the backend signature), so it bypasses `request()`.
  public async getBalance(address: string): Promise<RadfiWalletBalance> {
    if (!this.config.umsUrl) {
      throw new Error('RadfiConfig.umsUrl is required for getBalance');
    }
    const umsUrl = this.config.umsUrl;
    const res = await fetch(`${umsUrl}/wallets/balance?address=${address}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!res.ok) {
      throw new Error('Failed to fetch wallet balance');
    }

    const { data } = await this.parseJsonBody<{
      btcSatoshi?: string | number;
      pendingSatoshi?: string | number;
      externalPendingSatoshi?: string | number;
      totalUtxos?: string | number;
    }>(res, 'Failed to fetch wallet balance');
    return {
      btcSatoshi: BigInt(data?.btcSatoshi ?? '0'),
      pendingSatoshi: BigInt(data?.pendingSatoshi ?? '0'),
      externalPendingSatoshi: BigInt(data?.externalPendingSatoshi ?? '0'),
      totalUtxos: Number(data?.totalUtxos ?? 0),
    };
  }

  public async checkIfTradingWalletExists(userAddress: string): Promise<boolean> {
    try {
      await this.getTradingWallet(userAddress);
      return true;
    } catch (error) {
      console.error(error);
      return false;
    }
  }

  public async createWithdrawTransaction(
    params: {
      token: string;
      amount: bigint;
      recipient: string;
      userAddress: string;
      data: string;
    },
    accessToken: string,
  ): Promise<RadfiDepositTxResponse> {
    const res = await this.request('api', '/sodax/transaction', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.resolveAuth(accessToken)}`,
      },
      body: JSON.stringify({
        type: 'sodax-withdraw',
        params: {
          amount: params.amount.toString(),
          tokenId: params.token,
          sodaxData: params.data,
        },
      }),
    });

    // Bound can return HTTP 200 with a logical-error envelope and no `data`; surface it as RadfiApiError.
    const body = await this.parseJsonBody<RadfiDepositTxResponse>(res, 'Bound Exchange transaction request failed');
    if (!res.ok || !body.data) {
      throw new RadfiApiError(res.status, body, 'Bound Exchange transaction request failed');
    }

    return body.data;
  }

  /**
   * Co-signs and broadcasts a `sodax-withdraw` deposit. Optional `relayData` lets Bound auto-resubmit
   * a stuck relay (otherwise a stuck relay eventually refunds instead of completing).
   */
  public async requestRadfiSignature(
    params: {
      userAddress: string;
      signedBase64Tx: string;
      relayData?: RelayExtraData;
    },
    accessToken: string,
  ): Promise<string> {
    const res = await this.request('api', '/sodax/transaction/sign', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.resolveAuth(accessToken)}`,
      },
      body: JSON.stringify({
        type: 'sodax-withdraw',
        params,
      }),
    });

    const body = await this.parseJsonBody<{ txId?: string }>(res, 'Bound Exchange signature request failed');
    if (!res.ok || !body.data?.txId) {
      throw new RadfiApiError(res.status, body, 'Bound Exchange signature request failed');
    }

    return body.data.txId;
  }

  /** Fetches expired UTXOs from UMS; unsigned by design, like `getBalance`. */
  public async getExpiredUtxos(
    tradingAddress: string,
    params?: { page?: number; pageSize?: number },
  ): Promise<RadfiUtxoListResponse> {
    if (!this.config.umsUrl) {
      throw new Error('RadfiConfig.umsUrl is required for getExpiredUtxos');
    }
    const page = params?.page ?? 1;
    const pageSize = params?.pageSize ?? 100;
    const url = `${this.config.umsUrl}/utxos?address_eq=${tradingAddress}&isSpent_eq=false&isExpired_eq=true&page=${page}&pageSize=${pageSize}`;

    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!res.ok) {
      throw new Error('Failed to fetch expired UTXOs');
    }

    const body = await this.parseJsonBody<RadfiUtxo[]>(res, 'Failed to fetch expired UTXOs');
    return { code: body.code ?? '', message: body.message ?? '', data: body.data ?? [] };
  }

  /** Returns an unsigned renew-utxo PSBT for the user to sign. */
  public async buildRenewUtxoTransaction(
    params: { userAddress: string; txIdVouts: string[] },
    accessToken: string,
  ): Promise<RadfiBuildTxResponse> {
    const res = await this.request('transactions', '/transactions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        type: 'renew-utxo',
        params: {
          userAddress: params.userAddress,
          txIdVouts: params.txIdVouts,
        },
      }),
    });

    const body = await this.parseJsonBody<RadfiBuildTxResponse>(res, 'Failed to build renew-utxo transaction');
    if (!res.ok || !body.data) {
      throw new RadfiApiError(res.status, body, 'Failed to build renew-utxo transaction');
    }

    return body.data;
  }

  /** The user signs the PSBT first; Bound Exchange then co-signs and broadcasts. */
  public async signAndBroadcastRenewUtxo(
    params: { userAddress: string; signedBase64Tx: string },
    accessToken: string,
  ): Promise<string> {
    const res = await this.request('transactions', '/transactions/sign', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        type: 'renew-utxo',
        params,
      }),
    });

    const body = await this.parseJsonBody<{ txId?: string }>(
      res,
      'Failed to sign and broadcast renew-utxo transaction',
    );
    if (!res.ok || !body.data?.txId) {
      throw new RadfiApiError(res.status, body, 'Failed to sign and broadcast renew-utxo transaction');
    }

    return body.data.txId;
  }

  /** Withdraws BTC from the trading wallet to the user's wallet; returns an unsigned PSBT. */
  public async withdrawToUser(
    params: {
      userAddress: string;
      amount: string;
      tokenId: string;
      withdrawTo: string;
    },
    accessToken: string,
  ): Promise<RadfiBuildTxResponse> {
    const res = await this.request('transactions', '/transactions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        type: 'withdraw',
        params,
      }),
    });

    const body = await this.parseJsonBody<RadfiBuildTxResponse>(res, 'Failed to build withdraw transaction');
    if (!res.ok || !body.data) {
      throw new RadfiApiError(res.status, body, 'Failed to build withdraw transaction');
    }

    return body.data;
  }

  public async signAndBroadcastWithdraw(
    params: { userAddress: string; signedBase64Tx: string },
    accessToken: string,
  ): Promise<string> {
    const res = await this.request('transactions', '/transactions/sign', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        type: 'withdraw',
        params,
      }),
    });

    const body = await this.parseJsonBody<{ txId?: string | { data?: string } }>(
      res,
      'Failed to sign and broadcast withdraw transaction',
    );
    if (!res.ok) {
      throw new RadfiApiError(res.status, body, 'Failed to sign and broadcast withdraw transaction');
    }

    const raw = body.data?.txId;
    // API may return nested response: { txId: { data: "actualTxId" } }
    const txId = typeof raw === 'object' ? raw?.data : raw;
    if (!txId) {
      throw new RadfiApiError(res.status, body, 'Failed to sign and broadcast withdraw transaction');
    }
    return txId;
  }

  /** Max spendable withdraw amount after fee. */
  public async getMaxWithdrawable(
    params: {
      userAddress: string;
      amount: string;
      tokenId: string;
      withdrawTo: string;
    },
    accessToken: string,
  ): Promise<RadfiMaxSpentResponse> {
    const res = await this.request('transactions', '/transactions/max-spent', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        type: 'withdraw',
        params,
      }),
    });

    const body = await this.parseJsonBody<RadfiMaxSpentResponse>(res, 'Failed to get max withdrawable amount');
    if (!res.ok || !body.data) {
      throw new RadfiApiError(res.status, body, 'Failed to get max withdrawable amount');
    }

    return body.data;
  }

  /**
   * Fails fast without a credential: an empty `Bearer ` otherwise gets an opaque 403 from Bound's gateway.
   * Token contents are not validated here; an invalid token surfaces as 401/403 via `parseJsonBody`.
   */
  private resolveAuth(accessToken: string): string {
    const auth = accessToken || this.config.apiKey;
    if (!auth) {
      throw new RadfiApiError(
        401,
        {
          message:
            'Bound Exchange access token (or apiKey) is required but none was set. Inject one via sodax.spoke.bitcoin.radfi.setRadfiAccessToken(token) or new Sodax({ ... }) with radfi.accessToken.',
        },
        'Missing Bound Exchange credentials',
      );
    }
    return auth;
  }

  /** Bound or an upstream gateway may answer with HTML; parse as text first so the real status surfaces. */
  private async parseJsonBody<T = unknown>(res: Response, fallback: string): Promise<RadfiResponseEnvelope<T>> {
    const text = await res.text();
    try {
      return text.length ? (JSON.parse(text) as RadfiResponseEnvelope<T>) : {};
    } catch {
      const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 200);
      throw new RadfiApiError(
        res.status,
        { message: `Bound Exchange returned a non-JSON response (HTTP ${res.status})${snippet ? `: ${snippet}` : ''}` },
        fallback,
      );
    }
  }

  private async request(host: RadfiHost, endpoint: string, options?: RequestInit): Promise<Response> {
    // Signed per request so a time-boxed signature stays inside its validity window.
    const baseUrl = this.hosts[host];
    const signed = this.signer
      ? await this.signer({ method: options?.method ?? 'GET', path: endpoint, baseUrl })
      : undefined;
    return fetch(`${baseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers || {}),
        ...signed,
      },
    });
  }
}
