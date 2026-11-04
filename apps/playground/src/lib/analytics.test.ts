import { describe, expect, it } from 'vitest';
import { type PairDimensions, buildEvent, quoteEventKey, tagPolicy } from './analytics';

const PAIR: PairDimensions = {
  source_chain: '0x2105.base',
  destination_chain: 'solana',
  input_token_symbol: 'ETH',
  output_token_symbol: 'TSLAx',
  input_amount: '0.1',
  has_partner_fee: false,
};

describe('tagPolicy', () => {
  it('loads nothing without a container id', () => {
    expect(tagPolicy({ gtmId: undefined, embedded: false, allowInEmbed: false })).toBe('no-container');
  });

  it('loads on our own page', () => {
    expect(tagPolicy({ gtmId: 'GTM-TEST', embedded: false, allowInEmbed: false })).toBe('load');
  });

  it('stays out of a partner page unless that deployment opts in', () => {
    expect(tagPolicy({ gtmId: 'GTM-TEST', embedded: true, allowInEmbed: false })).toBe('embed-opt-out');
    expect(tagPolicy({ gtmId: 'GTM-TEST', embedded: true, allowInEmbed: true })).toBe('load');
  });
});

describe('buildEvent', () => {
  it('names the event and stamps the surface it fired on', () => {
    const event = buildEvent('quote_received', { ...PAIR }, { embedded: true, internal: false });

    expect(event).toMatchObject({ event: 'quote_received', source_chain: '0x2105.base', is_embedded: true });
    expect(event.traffic_type).toBeUndefined();
  });

  it('marks a flagged team browser so the GA4 filter can drop it', () => {
    const event = buildEvent('widget_viewed', {}, { embedded: false, internal: true });

    expect(event.traffic_type).toBe('internal');
  });

  it('keeps the frontend parameter names the GA4 dimensions are registered against', () => {
    const event = buildEvent('exchange_handoff_clicked', { ...PAIR }, { embedded: false, internal: false });

    expect(Object.keys(event)).toEqual([
      'event',
      'source_chain',
      'destination_chain',
      'input_token_symbol',
      'output_token_symbol',
      'input_amount',
      'has_partner_fee',
      'is_embedded',
    ]);
  });
});

describe('swap funnel events', () => {
  it('reports a completed swap under the parameter names sodax.com registered', () => {
    const event = buildEvent('swap_completed', { ...PAIR }, { embedded: false, internal: false });

    expect(event).toMatchObject({
      event: 'swap_completed',
      source_chain: '0x2105.base',
      destination_chain: 'solana',
      input_token_symbol: 'ETH',
      output_token_symbol: 'TSLAx',
    });
  });

  it('carries a groupable reason on a failure, never a raw error', () => {
    const event = buildEvent('swap_failed', { ...PAIR, reason: 'rejected' }, { embedded: true, internal: false });

    expect(event).toMatchObject({ event: 'swap_failed', reason: 'rejected', is_embedded: true });
  });

  it('never emits a transaction hash or an address', () => {
    for (const name of ['swap_submitted', 'swap_completed', 'swap_failed'] as const) {
      const event = buildEvent(name, { ...PAIR, reason: 'settlement_failed' }, { embedded: true, internal: false });

      expect(Object.keys(event)).not.toContain('transaction_hash');
      expect(Object.keys(event)).not.toContain('wallet_address');
      expect(Object.keys(event)).not.toContain('recipient');
      expect(JSON.stringify(event)).not.toMatch(/0x[\da-f]{20,}/i);
    }
  });
});

describe('quoteEventKey', () => {
  it('is stable across refetches of the same configured pair', () => {
    expect(quoteEventKey(PAIR)).toBe(quoteEventKey({ ...PAIR }));
  });

  it('changes when the amount, the pair or the fee changes', () => {
    const base = quoteEventKey(PAIR);

    expect(quoteEventKey({ ...PAIR, input_amount: '0.2' })).not.toBe(base);
    expect(quoteEventKey({ ...PAIR, output_token_symbol: 'AAPLx' })).not.toBe(base);
    expect(quoteEventKey({ ...PAIR, has_partner_fee: true })).not.toBe(base);
  });
});
