/**
 * Koios REST reads for building a Cardano deposit: the account's UTXOs, the chain tip, the protocol parameters
 * and a transaction's depth. Every field is validated before use: these numbers feed a fee and a payment, and a
 * misbehaving endpoint must fail the read rather than shape the transaction.
 */
import type { CardanoProtocolParams, CardanoUtxo } from './cardano-tx.js';

/** Per-request budget for a Koios call, covering the body read. */
const KOIOS_TIMEOUT_MS = 15_000;
/** Koios' PostgREST `max-rows`: no page holds more, so a shorter page is the last. */
const KOIOS_PAGE_ROWS = 1000;
/** A bound on paging, so a misbehaving endpoint cannot loop a read forever. */
const MAX_UTXO_PAGES = 50;

/** A UTXO as Koios reports it, with what decides whether it can be spent without moving anything else. */
export type KoiosUtxo = CardanoUtxo & { hasAssets: boolean; hasReferenceScript: boolean };

type Row = Record<string, unknown>;

function fail(where: string, what: string): never {
  throw new Error(`koios ${where}: ${what}`);
}

function asArray(value: unknown, where: string, what: string): unknown[] {
  return Array.isArray(value) ? value : fail(where, `${what} is not an array`);
}

function asRow(value: unknown, where: string, what: string): Row {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Row)
    : fail(where, `${what} is not an object`);
}

/** A non-negative integer, as a JSON number or a decimal string. */
function asQuantity(value: unknown, where: string, what: string): bigint {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === 'string' && /^[0-9]+$/.test(value)) return BigInt(value);
  return fail(where, `${what} is not a non-negative integer`);
}

function asCount(value: unknown, where: string, what: string): number {
  const n = asQuantity(value, where, what);
  return n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : fail(where, `${what} is too large`);
}

function asTxHash(value: unknown, where: string): string {
  const hash = typeof value === 'string' ? value.toLowerCase() : '';
  return /^[0-9a-f]{64}$/.test(hash) ? hash : fail(where, 'tx_hash is not a 64-character hex id');
}

export type KoiosClient = {
  /** Every spendable UTXO of `address`. */
  getUtxos(address: string): Promise<KoiosUtxo[]>;
  /** The absolute slot of the chain tip. */
  getTipSlot(): Promise<bigint>;
  getProtocolParams(): Promise<CardanoProtocolParams>;
  /** Total lovelace held at `address`. */
  getBalance(address: string): Promise<bigint>;
  /** Blocks on top of the transaction's block (0 in the tip block), or `null` when it is not in a block. */
  getTxDepth(txHash: string): Promise<number | null>;
};

export function createKoiosClient(baseUrl: string): KoiosClient {
  const base = baseUrl.replace(/\/+$/, '');
  if (base.length === 0)
    throw new Error('Cardano rpcUrl is empty: set a Koios base URL (https://…/api/v1) through the chain config');

  async function call(method: 'GET' | 'POST', path: string, json?: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), KOIOS_TIMEOUT_MS);
    try {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: { Accept: 'application/json', ...(json === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: json === undefined ? undefined : JSON.stringify(json),
        signal: controller.signal,
      });
      if (!res.ok) fail(path, `HTTP ${res.status}`);
      return await res.json();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') fail(path, `timed out after ${KOIOS_TIMEOUT_MS}ms`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async getUtxos(address) {
      const utxos = new Map<string, KoiosUtxo>();
      for (let page = 0; page < MAX_UTXO_PAGES; page++) {
        const path = `/address_utxos?order=tx_hash.asc,tx_index.asc&offset=${page * KOIOS_PAGE_ROWS}&limit=${KOIOS_PAGE_ROWS}`;
        // `_extended: true` is what fills `asset_list`; it is null otherwise.
        const rows = asArray(
          await call('POST', path, { _addresses: [address], _extended: true }),
          path,
          'the UTXO page',
        );
        if (rows.length > KOIOS_PAGE_ROWS) fail(path, `a page holds more than the ${KOIOS_PAGE_ROWS} rows asked for`);
        for (const item of rows) {
          const row = asRow(item, path, 'a UTXO');
          if (row.is_spent === true) continue;
          if (row.address !== address) fail(path, 'a UTXO belongs to a different address');
          const assets = row.asset_list;
          const utxo: KoiosUtxo = {
            txHash: asTxHash(row.tx_hash, path),
            index: asCount(row.tx_index, path, 'tx_index'),
            lovelace: asQuantity(row.value, path, 'value'),
            hasAssets: Array.isArray(assets) ? assets.length > 0 : assets !== null && assets !== undefined,
            // A reference script on a spent input adds a ledger fee the balancer does not price.
            hasReferenceScript: row.reference_script !== null && row.reference_script !== undefined,
          };
          utxos.set(`${utxo.txHash}#${utxo.index}`, utxo);
        }
        if (rows.length < KOIOS_PAGE_ROWS) return [...utxos.values()];
      }
      return fail('/address_utxos', `more than ${MAX_UTXO_PAGES} pages of UTXOs`);
    },

    async getTipSlot() {
      const rows = asArray(await call('GET', '/tip'), '/tip', 'the tip');
      const tip = asRow(rows[0], '/tip', 'the tip');
      return asQuantity(tip.abs_slot, '/tip', 'abs_slot');
    },

    async getProtocolParams() {
      const params = asRow(await call('GET', '/cli_protocol_params'), '/cli_protocol_params', 'the parameters');
      const where = '/cli_protocol_params';
      return {
        minFeeA: asQuantity(params.txFeePerByte, where, 'txFeePerByte'),
        minFeeB: asQuantity(params.txFeeFixed, where, 'txFeeFixed'),
        coinsPerUtxoByte: asQuantity(params.utxoCostPerByte, where, 'utxoCostPerByte'),
        maxTxSize: asCount(params.maxTxSize, where, 'maxTxSize'),
      };
    },

    async getBalance(address) {
      const rows = asArray(
        await call('POST', '/address_info', { _addresses: [address] }),
        '/address_info',
        'the address info',
      );
      // Koios answers an address it has never seen with an empty array.
      if (rows.length === 0) return 0n;
      return asQuantity(asRow(rows[0], '/address_info', 'the address info').balance, '/address_info', 'balance');
    },

    async getTxDepth(txHash) {
      const rows = asArray(await call('POST', '/tx_status', { _tx_hashes: [txHash] }), '/tx_status', 'tx_status');
      const row = rows
        .map(item => asRow(item, '/tx_status', 'a status row'))
        .find(r => asTxHash(r.tx_hash, '/tx_status') === txHash);
      if (!row) fail('/tx_status', 'no row for the requested tx');
      return row.num_confirmations === null ? null : asCount(row.num_confirmations, '/tx_status', 'num_confirmations');
    },
  };
}
