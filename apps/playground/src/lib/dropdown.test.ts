import { describe, expect, it } from 'vitest';
import { TYPEAHEAD_RESET_MS, navigateIndex, typeaheadIndex, typeaheadText } from './dropdown';

describe('navigateIndex', () => {
  it('steps within bounds without wrapping', () => {
    expect(navigateIndex('ArrowDown', 0, 3)).toBe(1);
    expect(navigateIndex('ArrowDown', 2, 3)).toBe(2);
    expect(navigateIndex('ArrowUp', 2, 3)).toBe(1);
    expect(navigateIndex('ArrowUp', 0, 3)).toBe(0);
  });

  it('jumps to the ends', () => {
    expect(navigateIndex('Home', 2, 3)).toBe(0);
    expect(navigateIndex('End', 0, 3)).toBe(2);
  });

  it('opens on the first option when nothing is selected', () => {
    expect(navigateIndex('ArrowDown', -1, 3)).toBe(0);
    expect(navigateIndex('ArrowUp', -1, 3)).toBe(0);
  });

  it('ignores keys that do not navigate and empty lists', () => {
    expect(navigateIndex('a', 0, 3)).toBeUndefined();
    expect(navigateIndex('Enter', 0, 3)).toBeUndefined();
    expect(navigateIndex('ArrowDown', 0, 0)).toBeUndefined();
  });
});

describe('typeaheadText', () => {
  it('grows while the previous key is recent and restarts once it is stale', () => {
    expect(typeaheadText('s', 'o', 100)).toBe('so');
    expect(typeaheadText('so', 'l', 100)).toBe('sol');
    expect(typeaheadText('sol', 'a', TYPEAHEAD_RESET_MS)).toBe('a');
  });

  it('keeps a repeated key a one-letter search so it cycles instead of matching nothing', () => {
    expect(typeaheadText('s', 's', 100)).toBe('s');
    expect(typeaheadText('', 's', 100)).toBe('s');
  });
});

describe('typeaheadIndex', () => {
  const labels = ['Arbitrum', 'Avalanche', 'Base', 'Solana', 'Sonic'];

  it('matches case-insensitively from the start of a label', () => {
    expect(typeaheadIndex(labels, 'b', -1)).toBe(2);
    expect(typeaheadIndex(labels, 'sol', -1)).toBe(3);
    expect(typeaheadIndex(labels, 'ARB', -1)).toBe(0);
  });

  it('cycles past the current row on a repeated letter', () => {
    expect(typeaheadIndex(labels, 's', 2)).toBe(3);
    expect(typeaheadIndex(labels, 's', 3)).toBe(4);
    expect(typeaheadIndex(labels, 's', 4)).toBe(3);
  });

  it('keeps the current row while a buffer grows into it', () => {
    expect(typeaheadIndex(labels, 'a', -1)).toBe(0);
    expect(typeaheadIndex(labels, 'av', 0)).toBe(1);
    expect(typeaheadIndex(labels, 'ava', 1)).toBe(1);
  });

  it('returns nothing for an empty buffer, empty list or no match', () => {
    expect(typeaheadIndex(labels, '', 0)).toBeUndefined();
    expect(typeaheadIndex([], 'a', 0)).toBeUndefined();
    expect(typeaheadIndex(labels, 'z', 0)).toBeUndefined();
  });
});
