import { describe, expect, it } from 'vitest';
import {
  type Brand,
  DEFAULT_SURFACE,
  NO_BRAND,
  brandStyles,
  contrast,
  isBranded,
  readBrand,
  readBrandField,
  readColor,
  resolvedColors,
  surfaceTheme,
  writeBrand,
} from './brand';

/** The emitted sheet as records, in source order: `:root` first, then the dark block. */
function blocks(css: string): Record<string, string>[] {
  return css
    .split('\n\n')
    .filter(Boolean)
    .map(block =>
      Object.fromEntries(
        block
          .split('\n')
          .slice(1, -1)
          .map(line => {
            const [name, value] = line.trim().replace(/;$/, '').split(': ');
            return [name, value];
          }),
      ),
    );
}

function brand(overrides: Partial<Brand>): Brand {
  return { ...NO_BRAND, ...overrides };
}

describe('readColor', () => {
  it.each([
    ['#7c3aed', '#7c3aed'],
    ['7c3aed', '#7c3aed'],
    ['#7C3AED', '#7c3aed'],
    ['abc', '#aabbcc'],
    ['#fff', '#ffffff'],
  ])('normalizes %j to %j', (value, expected) => {
    expect(readColor(value)).toBe(expected);
  });

  // The only shape that reaches a custom property. Anything else is a stylesheet injection.
  it.each([
    'red',
    'rgb(0,0,0)',
    '#12345',
    '#1234567',
    'var(--cta-bg)',
    'red;}body{background:url(https://evil.test)',
    '#fff;}:root{--cta-fg:#fff',
    'currentColor',
    '',
  ])('drops %j', value => {
    expect(readColor(value)).toBeUndefined();
  });

  it('drops a null parameter', () => {
    expect(readColor(null)).toBeUndefined();
  });
});

describe('readBrand', () => {
  it('is all-undefined for an empty query string', () => {
    expect(readBrand('')).toEqual(NO_BRAND);
    expect(isBranded(NO_BRAND)).toBe(false);
  });

  it('reads the whole API off one link', () => {
    const read = readBrand(
      '?theme=dark&accent=7c3aed&cta=101828&surface=fff&text=101828&radius=sharp&font=system&density=compact',
    );

    expect(read).toEqual({
      theme: 'dark',
      accent: '#7c3aed',
      cta: '#101828',
      surface: '#ffffff',
      text: '#101828',
      radius: 'sharp',
      font: 'system',
      density: 'compact',
    });
  });

  // `Object.hasOwn`, not `in`: `in` walks the prototype and these would pass as valid choices.
  it.each(['toString', 'constructor', 'hasOwnProperty', '__proto__'])('drops the inherited key %j', value => {
    const read = readBrand(`?font=${encodeURIComponent(value)}&radius=${encodeURIComponent(value)}`);

    expect(read.font).toBeUndefined();
    expect(read.radius).toBeUndefined();
  });

  it.each(['pill', 'SHARP', 'none', ''])('drops the unknown radius %j', value => {
    expect(readBrand(`?radius=${encodeURIComponent(value)}`).radius).toBeUndefined();
  });

  it.each(['comic-sans', 'Inter', 'system-ui, sans-serif'])('drops the unlisted font %j', value => {
    expect(readBrand(`?font=${encodeURIComponent(value)}`).font).toBeUndefined();
  });

  it.each(['system-ui', 'auto', 'true'])('drops the unknown theme %j', value => {
    expect(readBrand(`?theme=${encodeURIComponent(value)}`).theme).toBe(value === 'auto' ? 'auto' : undefined);
  });
});

describe('readBrandField', () => {
  it('gates a control the same way it gates a link', () => {
    expect(readBrandField('accent', '#7c3aed')).toBe('#7c3aed');
    expect(readBrandField('radius', 'round')).toBe('round');
    expect(readBrandField('font', 'toString')).toBeUndefined();
    expect(readBrandField('accent', 'red')).toBeUndefined();
    expect(readBrandField('theme', null)).toBeUndefined();
  });
});

describe('writeBrand', () => {
  it('round-trips through readBrand', () => {
    const original = brand({ theme: 'light', accent: '#7c3aed', radius: 'round', font: 'serif', density: 'compact' });
    const params = new URLSearchParams();
    writeBrand(params, original);

    expect(readBrand(`?${params}`)).toEqual(original);
  });

  // The pre-paint script in index.html reads this URL and does no colour maths, so a link that left
  // the theme implicit would paint the stored or system one and then correct itself.
  it('spells out the theme a surface implies', () => {
    const params = new URLSearchParams();
    writeBrand(params, brand({ surface: '#101214' }));

    expect(params.get('theme')).toBe('dark');
    expect(readBrand(`?${params}`).theme).toBe('dark');
  });

  it('leaves the theme out when there is no surface to imply one', () => {
    const params = new URLSearchParams();
    writeBrand(params, brand({ accent: '#7c3aed' }));

    expect(params.get('theme')).toBeNull();
  });

  // A copied `<iframe>` should not be full of `%23`.
  it('writes a colour without the hash', () => {
    const params = new URLSearchParams();
    writeBrand(params, brand({ accent: '#7c3aed' }));

    expect(params.toString()).toBe('accent=7c3aed');
  });

  it('writes nothing for an unbranded state', () => {
    const params = new URLSearchParams();
    writeBrand(params, NO_BRAND);

    expect(params.toString()).toBe('');
  });
});

describe('brandStyles', () => {
  it('emits nothing at all when nothing is set', () => {
    expect(brandStyles(NO_BRAND)).toEqual({ css: '', notes: { light: [], dark: [] } });
  });

  // index.css maps its dark roles under `:root[data-theme="dark"]`, which outranks a bare `:root`.
  it('emits both theme blocks, or dark would win the colours back', () => {
    const { css } = brandStyles(brand({ accent: '#7c3aed' }));

    expect(css).toContain(':root {');
    expect(css).toContain(':root[data-theme="dark"] {');
  });

  it('keeps shape roles out of the dark block, where they would only repeat', () => {
    const [light, dark] = blocks(brandStyles(brand({ radius: 'sharp', font: 'mono', density: 'compact' })).css);

    expect(light['--radius-regular']).toBe('6px');
    expect(light['--font-body']).toContain('ui-monospace');
    expect(light['--space-16']).toBe('12px');
    expect(dark).toBeUndefined();
  });

  it('derives the button label from the fill, so a pale brand colour cannot ship white-on-yellow', () => {
    const [light] = blocks(brandStyles(brand({ accent: '#ffd92f' })).css);

    expect(light['--cta-bg']).toBe('#ffd92f');
    expect(contrast(light['--cta-fg'], '#ffd92f')).toBeGreaterThanOrEqual(4.5);
  });

  it('derives a light label on a dark fill', () => {
    const [light] = blocks(brandStyles(brand({ cta: '#0a0a5e' })).css);

    expect(light['--cta-fg']).toBe('#ffffff');
    expect(contrast(light['--cta-fg'], '#0a0a5e')).toBeGreaterThanOrEqual(4.5);
  });

  // The same parameter needs correcting on white and not on our dark card, which is the whole
  // reason the two blocks are computed separately rather than emitted twice.
  it('corrects an accent used as text per theme, and reports it under that theme only', () => {
    const { css, notes } = brandStyles(brand({ accent: '#ffd92f' }));
    const [light, dark] = blocks(css);

    expect(contrast(light['--accent'], DEFAULT_SURFACE.light)).toBeGreaterThanOrEqual(4.5);
    expect(light['--accent']).not.toBe('#ffd92f');
    expect(dark['--accent']).toBe('#ffd92f');
    expect(notes.light).toHaveLength(1);
    expect(notes.dark).toEqual([]);
  });

  it('leaves the flow title on the exact brand colour, being decorative-large', () => {
    const [light] = blocks(brandStyles(brand({ accent: '#ffd92f' })).css);

    expect(light['--lockup-accent']).toBe('#ffd92f');
  });

  it('re-derives the text ramp from a partner surface, or their ground would carry our ink', () => {
    const [, dark] = blocks(brandStyles(brand({ surface: '#101828' })).css);

    expect(dark['--surface-card']).toBe('#101828');
    expect(contrast(dark['--text-heading'], '#101828')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark['--text-body'], '#101828')).toBeGreaterThanOrEqual(4.5);
  });

  // A brand states one ground, and the theme it is renders it exactly. The other theme has to come
  // from somewhere, and ours would be their accent on our palette — so it is derived from theirs.
  it('derives the counterpart ground from the surface, and reports it under that theme', () => {
    const { css, notes } = brandStyles(brand({ surface: '#ffffff' }));
    const [light, dark] = blocks(css);

    expect(light['--surface-card']).toBe('#ffffff');
    expect(contrast(dark['--surface-card'], '#ffffff')).toBeGreaterThan(4.5);
    expect(notes.dark.some(note => note.includes('the dark theme darkens it'))).toBe(true);
    expect(notes.light).toEqual([]);
  });

  it.each([
    '#777777',
    '#808080',
    '#ffffff',
    '#000000',
  ])('keeps all derived text and the button label readable in both themes, from %s', surface => {
    for (const roles of blocks(brandStyles(brand({ surface, cta: surface, text: '#777777' })).css)) {
      for (const role of ['--text-heading', '--text-body', '--text-muted', '--text-faint']) {
        expect(contrast(roles[role], roles['--surface-card'])).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(roles['--cta-fg'], roles['--cta-bg'])).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('accepts a readable text colour as given', () => {
    const [light] = blocks(brandStyles(brand({ surface: '#ffffff', text: '#101828' })).css);

    expect(light['--text-heading']).toBe('#101828');
    expect(brandStyles(brand({ surface: '#ffffff', text: '#101828' })).notes.light).toEqual([]);
  });

  it('reports a text colour it had to move rather than correcting it silently', () => {
    const { css, notes } = brandStyles(brand({ surface: '#ffffff', text: '#f5f5f5' }));
    const [light] = blocks(css);

    expect(contrast(light['--text-heading'], '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(notes.light.some(note => note.includes('Text colour adjusted'))).toBe(true);
  });

  // Editorial's register: an ink button on paper, which on a ground we derived would be ink on ink.
  it('keeps a button visible on a ground it derived, while rendering it as stated on the other', () => {
    const { css, notes } = brandStyles(brand({ surface: '#e9edec', cta: '#1a1e1b' }));
    const [light, dark] = blocks(css);

    expect(light['--cta-bg']).toBe('#1a1e1b');
    expect(contrast(dark['--cta-bg'], dark['--surface-card'])).toBeGreaterThanOrEqual(3);
    expect(notes.dark.some(note => note.includes('Button colour adjusted'))).toBe(true);
    expect(notes.light).toEqual([]);
  });

  it('prefers an explicit cta over the accent for the button only', () => {
    const [light] = blocks(brandStyles(brand({ accent: '#0a0a5e', cta: '#7c3aed' })).css);

    expect(light['--cta-bg']).toBe('#7c3aed');
    expect(light['--lockup-accent']).toBe('#0a0a5e');
  });

  // Every value is either a normalized hex or a constant from this module, so no parameter text
  // reaches the sheet — this is the property the whole module exists to hold.
  it('emits only hex colours and its own constants', () => {
    const { css } = brandStyles(
      readBrand('?accent=%23fff%3B%7Dbody%7Bbackground%3Aurl(x)&surface=red&font=</style><script>&radius=0'),
    );

    expect(css).toBe('');
  });

  it('never lets a value carry a declaration or block delimiter', () => {
    const { css } = brandStyles(
      brand({ accent: '#7c3aed', surface: '#101828', text: '#ffffff', radius: 'round', font: 'system' }),
    );

    for (const block of blocks(css)) {
      for (const value of Object.values(block)) {
        expect(value).not.toMatch(/[;{}]/);
      }
    }
  });
});

// What a brand with no `theme` resolves to, and what the pre-paint script in index.html mirrors:
// a partner who states a ground has chosen a theme, whether or not they named one.
describe('surfaceTheme', () => {
  it.each([
    ['#ffffff', 'light'],
    ['#f5f2f2', 'light'],
    ['#e9edec', 'light'],
    ['#808080', 'light'],
    ['#777777', 'dark'],
    ['#101828', 'dark'],
    ['#1b1926', 'dark'],
    ['#000000', 'dark'],
  ] as const)('reads %s as a %s ground', (surface, expected) => {
    expect(surfaceTheme(surface)).toBe(expected);
  });

  it('agrees with the ground each theme block actually renders', () => {
    for (const surface of ['#ffffff', '#101828', '#dce8f5', '#1b1926']) {
      const theme = surfaceTheme(surface);
      const [light, dark] = blocks(brandStyles(brand({ surface })).css);

      expect((theme === 'dark' ? dark : light)['--surface-card']).toBe(surface);
    }
  });
});

describe('resolved color controls', () => {
  it('matches the dark widget instead of showing light fallback swatches', () => {
    expect(resolvedColors(NO_BRAND, 'dark')).toEqual({
      accent: '#ffd92f',
      cta: '#ecc100',
      surface: '#17100f',
      text: '#ffffff',
    });
  });
  it('shows derived button and corrected text values', () => {
    const values = resolvedColors(brand({ accent: '#ffd92f', surface: '#ffffff', text: '#eeeeee' }), 'light');
    expect(values.cta).toBe('#ffd92f');
    expect(values.text).not.toBe('#eeeeee');
    expect(contrast(values.text, values.surface)).toBeGreaterThanOrEqual(4.5);
  });
});
