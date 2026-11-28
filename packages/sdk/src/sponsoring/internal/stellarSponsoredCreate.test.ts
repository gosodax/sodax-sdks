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

/** Asserts `fn` throws a SodaxError, with a message matching `message` when one is given. */
const expectSodaxThrow = (fn: () => unknown, message?: RegExp, label?: string): void => {
  let error: unknown;
  try {
    fn();
  } catch (thrown) {
    error = thrown;
  }
  expect(isSodaxError(error), label).toBe(true);
  if (message) expect((error as Error).message, label).toMatch(message);
};

describe('deriveSponsorBaseFee', () => {
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

  it('refuses a fee config it cannot satisfy or parse, as a feature error', () => {
    // 500/op and 3000/op both total inside [1000, 10000]; only the per-operation band rejects them.
    const perOpBand = (perOp: string): Partial<StellarSponsorConfig> => ({
      minTotalFeeStroops: '1000',
      maxTotalFeeStroops: '10000',
      minPerOperationFeeStroops: '1000',
      maxPerOperationFeeStroops: '2000',
      recommendedPerOperationFeeStroops: perOp,
    });
    const cases: [string, Partial<StellarSponsorConfig>, RegExp?][] = [
      // The per-op band is wide enough that only the total band can reject it.
      [
        'total above the ceiling',
        { maxPerOperationFeeStroops: '9000', recommendedPerOperationFeeStroops: '9000' },
        /outside the accepted band/,
      ],
      [
        'total below the floor',
        { minPerOperationFeeStroops: '100', recommendedPerOperationFeeStroops: '100' },
        /outside the accepted band/,
      ],
      [
        // No integer per-operation fee totals exactly 10000 across three operations.
        'no integer per-op fee hits the total',
        {
          minTotalFeeStroops: '10000',
          maxTotalFeeStroops: '10000',
          maxPerOperationFeeStroops: '4000',
          recommendedPerOperationFeeStroops: '3334',
        },
        /outside the accepted band/,
      ],
      // The wire schema permits numbers; classify fractional values before BigInt conversion.
      ['operationCount 4', { operationCount: 4 }, /this builder emits/],
      ['operationCount 3.5', { operationCount: 3.5 }, /this builder emits/],
      ['unparseable minTotalFeeStroops', { minTotalFeeStroops: 'not-a-number' }, /not a valid integer/],
      ['unparseable maxTotalFeeStroops', { maxTotalFeeStroops: 'oops' }, /not a valid integer/],
      [
        'unparseable recommendedPerOperationFeeStroops',
        { recommendedPerOperationFeeStroops: 'oops' },
        /not a valid integer/,
      ],
      ['unparseable minPerOperationFeeStroops', { minPerOperationFeeStroops: 'oops' }, /not a valid integer/],
      ['unparseable maxPerOperationFeeStroops', { maxPerOperationFeeStroops: 'oops' }, /not a valid integer/],
      ['non-positive total floor', { minTotalFeeStroops: '0', maxTotalFeeStroops: '10' }],
      ['inverted total band', { minTotalFeeStroops: '9000', maxTotalFeeStroops: '3000' }],
      ['below the per-op floor', perOpBand('500'), /outside the accepted per-operation band/],
      ['above the per-op ceiling', perOpBand('3000'), /outside the accepted per-operation band/],
      ['non-positive per-op floor', { minPerOperationFeeStroops: '0' }, /minPerOperationFeeStroops must be positive/],
      [
        'inverted per-op band',
        { minPerOperationFeeStroops: '4000', maxPerOperationFeeStroops: '1000' },
        /per-operation fee band is inverted/,
      ],
    ];
    for (const [label, overrides, message] of cases) {
      expectSodaxThrow(() => deriveSponsorBaseFee(config(overrides)), message, label);
    }
  });
});

describe('resolveTimeboundSeconds', () => {
  it('uses the module default under a generous ceiling and clamps DOWN to a tightened one rather than failing', () => {
    expect(resolveTimeboundSeconds({ maxTimeboundSeconds: 3600 })).toBe(SPONSOR_TIMEBOUND_SECONDS);
    expect(resolveTimeboundSeconds({ maxTimeboundSeconds: 120 })).toBe(120);
  });

  it('rejects a ceiling that leaves no usable window (setTimeout(0) means unbounded maxTime)', () => {
    expectSodaxThrow(() => resolveTimeboundSeconds({ maxTimeboundSeconds: 0 }), undefined, '0');
    expectSodaxThrow(() => resolveTimeboundSeconds({ maxTimeboundSeconds: -1 }), undefined, '-1');
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
    expectSodaxThrow(() => build({ networkPassphrase: Networks.TESTNET }), /public network/);

    for (const address of ['not-a-key', 'CA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ']) {
      expectSodaxThrow(
        () => buildSponsoredCreate({ config: config(), sponsorSequence: SPONSOR_SEQUENCE, address }),
        /not a valid Stellar ed25519 public key/,
        address,
      );
    }
  });
});

describe('assertSignedByAccount', () => {
  type Tx = Exclude<ReturnType<typeof TransactionBuilder.fromXDR>, FeeBumpTransaction>;
  const signWith = (keypair: Keypair, networkPassphrase: string, xdr = build().toXDR()): string => {
    const tx = TransactionBuilder.fromXDR(xdr, networkPassphrase) as Tx;
    tx.sign(keypair);
    return tx.toXDR();
  };

  it('accepts a transaction signed by the new account on the public network', () => {
    const tx = build();
    expect(() =>
      assertSignedByAccount({
        signedXdr: signWith(NEW_ACCOUNT, Networks.PUBLIC, tx.toXDR()),
        address: NEW_ACCOUNT.publicKey(),
        unsignedHash: tx.hash(),
      }),
    ).not.toThrow();
  });

  it('rejects a wrong-network, wrong-account, unsigned, unparseable, altered or fee-bumped envelope', () => {
    const tx = build();
    const tampered = build({ recommendedPerOperationFeeStroops: '2000' }).toXDR();
    const inner = TransactionBuilder.fromXDR(signWith(NEW_ACCOUNT, Networks.PUBLIC, tx.toXDR()), Networks.PUBLIC) as Tx;
    const bumped = TransactionBuilder.buildFeeBumpTransaction(SPONSOR, '20000', inner, Networks.PUBLIC).toXDR();
    const cases: [string, string, RegExp?][] = [
      // Network-mismatched signatures remain well-formed XDR — the silent failure this check exists for.
      ['wrong network', signWith(NEW_ACCOUNT, Networks.TESTNET), /different Stellar network/],
      ['other account', signWith(OTHER, Networks.PUBLIC)],
      ['unsigned', tx.toXDR()],
      ['unparseable', 'not-xdr'],
      ['altered before signing', signWith(NEW_ACCOUNT, Networks.PUBLIC, tampered), /altered the transaction/],
      ['fee-bump wrapped', bumped, /fee-bump/],
    ];
    for (const [label, signedXdr, message] of cases) {
      expectSodaxThrow(
        () => assertSignedByAccount({ signedXdr, address: NEW_ACCOUNT.publicKey(), unsignedHash: tx.hash() }),
        message,
        label,
      );
    }
  });
});
