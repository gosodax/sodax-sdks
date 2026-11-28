import { describe, expect, it } from 'vitest';
import { type FeeBumpTransaction, Keypair, Networks, type Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import type { StellarSponsorConfig } from '@sodax/types';
import { isSodaxError } from '../../errors/SodaxError.js';
import {
  assertSignedByAccount,
  buildSponsoredCreate,
  deriveSponsorBaseFee,
  resolveTimeboundSeconds,
  SPONSOR_TIMEBOUND_SECONDS,
} from './stellarSponsoredCreate.js';

const SPONSOR = Keypair.random();
const NEW_ACCOUNT = Keypair.random();
const OTHER = Keypair.random();
const SPONSOR_SEQUENCE = '4294967296';

const config = (overrides: Partial<StellarSponsorConfig> = {}): StellarSponsorConfig => ({
  sponsorAccount: SPONSOR.publicKey(),
  networkPassphrase: Networks.PUBLIC,
  minTotalFeeStroops: '3000',
  maxTotalFeeStroops: '10000',
  operationCount: 3,
  minPerOperationFeeStroops: '1000',
  maxPerOperationFeeStroops: '3333',
  recommendedPerOperationFeeStroops: '1000',
  maxTimeboundSeconds: 3600,
  requiredStartingBalance: '0',
  ...overrides,
});

const build = (overrides: Partial<StellarSponsorConfig> = {}) =>
  buildSponsoredCreate({
    config: config(overrides),
    sponsorSequence: SPONSOR_SEQUENCE,
    address: NEW_ACCOUNT.publicKey(),
  });

const caught = (fn: () => unknown): unknown => {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error;
  }
};

describe('deriveSponsorBaseFee — published per-operation fee', () => {
  it('uses recommendedPerOperationFeeStroops verbatim, with no arithmetic', () => {
    // The server owns the per-operation fee; clients must not recompute it.
    expect(
      deriveSponsorBaseFee({
        minTotalFeeStroops: '3000',
        maxTotalFeeStroops: '10000',
        operationCount: 3,
        minPerOperationFeeStroops: '1000',
        maxPerOperationFeeStroops: '3333',
        recommendedPerOperationFeeStroops: '1234',
      }),
    ).toEqual({ baseFee: '1234', totalFee: 3702n });
  });

  it('rejects a published per-op fee whose total falls outside the published band', () => {
    const outOfBand: Partial<StellarSponsorConfig>[] = [
      // Above the total ceiling; the per-op band is wide enough that only the total band can reject it.
      { maxPerOperationFeeStroops: '9000', recommendedPerOperationFeeStroops: '9000' },
      // Below the total floor.
      { minPerOperationFeeStroops: '100', recommendedPerOperationFeeStroops: '100' },
      // No integer per-operation fee totals exactly 10000 across three operations.
      {
        minTotalFeeStroops: '10000',
        maxTotalFeeStroops: '10000',
        maxPerOperationFeeStroops: '4000',
        recommendedPerOperationFeeStroops: '3334',
      },
    ];
    for (const overrides of outOfBand) {
      const error = caught(() => deriveSponsorBaseFee(config(overrides)));
      expect(isSodaxError(error)).toBe(true);
      expect((error as Error).message).toMatch(/outside the accepted band/);
    }
  });

  it('rejects an operationCount that disagrees with the shape this builder emits, as a feature error', () => {
    // The wire schema permits numbers; classify fractional values before BigInt conversion.
    for (const operationCount of [4, 3.5]) {
      const error = caught(() => deriveSponsorBaseFee(config({ operationCount })));
      expect(isSodaxError(error)).toBe(true);
      expect((error as Error).message).toMatch(/this builder emits/);
    }
  });
});

describe('deriveSponsorBaseFee — fee band validation', () => {
  it('rejects an unparseable total band, per-operation fee or per-operation bound', () => {
    const unparseable: Partial<StellarSponsorConfig>[] = [
      { minTotalFeeStroops: 'not-a-number' },
      { maxTotalFeeStroops: 'oops' },
      { recommendedPerOperationFeeStroops: 'oops' },
      { minPerOperationFeeStroops: 'oops' },
      { maxPerOperationFeeStroops: 'oops' },
    ];
    for (const overrides of unparseable) {
      const error = caught(() => deriveSponsorBaseFee(config(overrides)));
      expect(isSodaxError(error)).toBe(true);
      expect((error as Error).message).toMatch(/not a valid integer/);
    }
  });

  it('rejects a non-positive floor and an inverted band', () => {
    expect(
      isSodaxError(caught(() => deriveSponsorBaseFee(config({ minTotalFeeStroops: '0', maxTotalFeeStroops: '10' })))),
    ).toBe(true);
    expect(
      isSodaxError(
        caught(() => deriveSponsorBaseFee(config({ minTotalFeeStroops: '9000', maxTotalFeeStroops: '3000' }))),
      ),
    ).toBe(true);
  });
});

describe('deriveSponsorBaseFee — per-operation band validation', () => {
  it('rejects a fee below the per-operation floor or above its ceiling even when the total lands inside the total band', () => {
    // 500/op and 3000/op both total inside [1000, 10000]; only the per-operation band rejects them.
    for (const perOp of ['500', '3000']) {
      const error = caught(() =>
        deriveSponsorBaseFee(
          config({
            minTotalFeeStroops: '1000',
            maxTotalFeeStroops: '10000',
            minPerOperationFeeStroops: '1000',
            maxPerOperationFeeStroops: '2000',
            recommendedPerOperationFeeStroops: perOp,
          }),
        ),
      );
      expect(isSodaxError(error)).toBe(true);
      expect((error as Error).message).toMatch(/outside the accepted per-operation band/);
    }
  });

  it('rejects a non-positive per-operation floor and an inverted per-operation band', () => {
    const nonPositive = caught(() => deriveSponsorBaseFee(config({ minPerOperationFeeStroops: '0' })));
    expect(isSodaxError(nonPositive)).toBe(true);
    expect((nonPositive as Error).message).toMatch(/minPerOperationFeeStroops must be positive/);

    const inverted = caught(() =>
      deriveSponsorBaseFee(config({ minPerOperationFeeStroops: '4000', maxPerOperationFeeStroops: '1000' })),
    );
    expect(isSodaxError(inverted)).toBe(true);
    expect((inverted as Error).message).toMatch(/per-operation fee band is inverted/);
  });
});

describe('resolveTimeboundSeconds', () => {
  it('uses the module default under a generous ceiling and clamps DOWN to a tightened one rather than failing', () => {
    expect(resolveTimeboundSeconds({ maxTimeboundSeconds: 3600 })).toBe(SPONSOR_TIMEBOUND_SECONDS);
    expect(resolveTimeboundSeconds({ maxTimeboundSeconds: 120 })).toBe(120);
  });

  it('rejects a ceiling that leaves no usable window (setTimeout(0) means unbounded maxTime)', () => {
    expect(isSodaxError(caught(() => resolveTimeboundSeconds({ maxTimeboundSeconds: 0 })))).toBe(true);
    expect(isSodaxError(caught(() => resolveTimeboundSeconds({ maxTimeboundSeconds: -1 })))).toBe(true);
  });
});

describe('buildSponsoredCreate', () => {
  it('builds begin/create/end in order, sponsor-sourced except the end op, all aimed at the new account', () => {
    const tx = build();
    expect(tx.operations).toHaveLength(3);
    expect(tx.operations[0]?.type).toBe('beginSponsoringFutureReserves');
    expect(tx.operations[1]?.type).toBe('createAccount');
    expect(tx.operations[2]?.type).toBe('endSponsoringFutureReserves');

    const begin = tx.operations[0] as Operation.BeginSponsoringFutureReserves;
    const create = tx.operations[1] as Operation.CreateAccount;
    expect(begin.sponsoredId).toBe(NEW_ACCOUNT.publicKey());
    expect(create.destination).toBe(NEW_ACCOUNT.publicKey());

    expect(tx.source).toBe(SPONSOR.publicKey());
    // The server validates each effective source as `op.source ?? tx.source`.
    expect(tx.operations[0]?.source ?? tx.source).toBe(SPONSOR.publicKey());
    expect(tx.operations[1]?.source ?? tx.source).toBe(SPONSOR.publicKey());
    // The explicit end-op source is what compels the new account's signature.
    expect(tx.operations[2]?.source).toBe(NEW_ACCOUNT.publicKey());
  });

  it('sets a startingBalance the server accepts as zero, and carries a configured one through', () => {
    const create = build().operations[1] as Operation.CreateAccount;
    // stellar-sdk normalizes zero, while the server validates its numeric value.
    expect(create.startingBalance).not.toMatch(/[1-9]/);
    expect(Number(create.startingBalance)).toBe(0);

    const configured = build({ requiredStartingBalance: '0.0000001' }).operations[1] as Operation.CreateAccount;
    expect(Number(configured.startingBalance)).toBe(0.0000001);
  });

  it('sets an in-band fee, no memo, a bounded maxTime and the next sponsor sequence on the envelope', () => {
    const tx = build();
    // TransactionBuilder multiplies its per-operation fee into the envelope total — NEVER the 300 BASE_FEE yields.
    expect(tx.fee).toBe('3000');
    expect(BigInt(tx.fee)).toBeGreaterThanOrEqual(3000n);
    expect(BigInt(tx.fee)).toBeLessThanOrEqual(10000n);
    expect(tx.fee).not.toBe('300');

    expect(tx.memo.type).toBe('none');

    expect(tx.timeBounds).toBeDefined();
    const maxTime = Number(tx.timeBounds?.maxTime);
    expect(maxTime).toBeGreaterThan(0); // Zero means TimeoutInfinite, which the server rejects.
    const delta = maxTime - Math.floor(Date.now() / 1000);
    expect(delta).toBeGreaterThan(0);
    expect(delta).toBeLessThanOrEqual(3600);

    expect(tx.sequence).toBe((BigInt(SPONSOR_SEQUENCE) + 1n).toString());
  });

  it('rejects a non-public network or a malformed / contract-address destination locally, before any wallet prompt', () => {
    const error = caught(() => build({ networkPassphrase: Networks.TESTNET }));
    expect(isSodaxError(error)).toBe(true);
    expect((error as Error).message).toMatch(/public network/);

    for (const address of ['not-a-key', 'CA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ']) {
      const addressError = caught(() =>
        buildSponsoredCreate({ config: config(), sponsorSequence: SPONSOR_SEQUENCE, address }),
      );
      expect(isSodaxError(addressError)).toBe(true);
      expect((addressError as Error).message).toMatch(/not a valid Stellar ed25519 public key/);
    }
  });
});

describe('assertSignedByAccount', () => {
  const signWith = (keypair: Keypair, networkPassphrase: string): string => {
    const tx = TransactionBuilder.fromXDR(build().toXDR(), networkPassphrase) as Exclude<
      ReturnType<typeof TransactionBuilder.fromXDR>,
      FeeBumpTransaction
    >;
    tx.sign(keypair);
    return tx.toXDR();
  };

  it('accepts a transaction signed by the new account on the public network', () => {
    const tx = build();
    const signed = TransactionBuilder.fromXDR(tx.toXDR(), Networks.PUBLIC) as Exclude<
      ReturnType<typeof TransactionBuilder.fromXDR>,
      FeeBumpTransaction
    >;
    signed.sign(NEW_ACCOUNT);
    expect(() =>
      assertSignedByAccount({
        signedXdr: signed.toXDR(),
        address: NEW_ACCOUNT.publicKey(),
        unsignedHash: tx.hash(),
      }),
    ).not.toThrow();
  });

  it('rejects a WRONG-network signature, one from a different account, an unsigned transaction and unparseable XDR', () => {
    const tx = build();
    // Network-mismatched signatures remain well-formed XDR — the silent failure this check exists for.
    const wrongNetwork = caught(() =>
      assertSignedByAccount({
        signedXdr: signWith(NEW_ACCOUNT, Networks.TESTNET),
        address: NEW_ACCOUNT.publicKey(),
        unsignedHash: tx.hash(),
      }),
    );
    expect(isSodaxError(wrongNetwork)).toBe(true);
    expect((wrongNetwork as Error).message).toMatch(/different Stellar network/);

    for (const signedXdr of [signWith(OTHER, Networks.PUBLIC), tx.toXDR(), 'not-xdr']) {
      const error = caught(() =>
        assertSignedByAccount({ signedXdr, address: NEW_ACCOUNT.publicKey(), unsignedHash: tx.hash() }),
      );
      expect(isSodaxError(error)).toBe(true);
    }
  });

  it('rejects a wallet that altered the envelope before signing, or wrapped it in a fee-bump', () => {
    const tx = build();
    const tampered = build({ recommendedPerOperationFeeStroops: '2000' });
    const signed = TransactionBuilder.fromXDR(tampered.toXDR(), Networks.PUBLIC) as Exclude<
      ReturnType<typeof TransactionBuilder.fromXDR>,
      FeeBumpTransaction
    >;
    signed.sign(NEW_ACCOUNT);
    const error = caught(() =>
      assertSignedByAccount({
        signedXdr: signed.toXDR(),
        address: NEW_ACCOUNT.publicKey(),
        unsignedHash: tx.hash(),
      }),
    );
    expect(isSodaxError(error)).toBe(true);
    expect((error as Error).message).toMatch(/altered the transaction/);

    const inner = TransactionBuilder.fromXDR(tx.toXDR(), Networks.PUBLIC) as Exclude<
      ReturnType<typeof TransactionBuilder.fromXDR>,
      FeeBumpTransaction
    >;
    inner.sign(NEW_ACCOUNT);
    const bumped = TransactionBuilder.buildFeeBumpTransaction(SPONSOR, '20000', inner, Networks.PUBLIC);
    const bumpError = caught(() =>
      assertSignedByAccount({
        signedXdr: bumped.toXDR(),
        address: NEW_ACCOUNT.publicKey(),
        unsignedHash: tx.hash(),
      }),
    );
    expect(isSodaxError(bumpError)).toBe(true);
    expect((bumpError as Error).message).toMatch(/fee-bump/);
  });
});
