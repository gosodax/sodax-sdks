/**
 * The embed's theme API: the query parameters a partner sets on the `<iframe>` src so the widget
 * looks like their product instead of like ours. CSS cannot reach into an iframe, so the URL is the
 * only channel a one-line embed has.
 *
 * Two rules shape the whole module.
 *
 * **Every value is validated to a closed shape.** A colour is `#rrggbb` and nothing else; a font,
 * radius or density is a key of a constant map. These land in CSS custom properties, so an
 * unvalidated one is a stylesheet injection — `--accent: red } body { background: url(…)` — and the
 * declarations this module emits are the only untrusted-adjacent text in the document.
 *
 * **The widget derives the rest.** A partner sets four colours at most and the ~30 semantic roles
 * behind them are computed, so a brand colour cannot produce a CTA nobody can read: the button
 * label is chosen by the fill's own luminance, and a colour used as text is nudged toward the
 * surface's ink until it clears 4.5:1. That is what keeps layer 2's brand rules enforceable while
 * the palette underneath belongs to someone else.
 */

/** `auto` follows the visitor's OS; the other two pin it, which is what a partner's page wants. */
const THEME_CHOICES = { light: null, dark: null, auto: null } as const;
export type ThemeChoice = keyof typeof THEME_CHOICES;

/**
 * Cards, panels, insets — and `pill`, which is what buttons, badges and the search field take.
 * A disc stays a hardcoded 9999px: a token logo and a chain badge are round images, not shapes a
 * brand gets to restyle. Without `pill` a squared-off brand still rendered pill buttons, which is
 * the single loudest shape in the widget and made every palette read as the same product.
 */
export const RADIUS_SCALES = {
  square: { large: '0px', regular: '0px', inset: '0px', small: '0px', pill: '0px' },
  sharp: { large: '8px', regular: '6px', inset: '4px', small: '3px', pill: '4px' },
  soft: { large: '24px', regular: '16px', inset: '12px', small: '8px', pill: '9999px' },
  round: { large: '32px', regular: '24px', inset: '18px', small: '12px', pill: '9999px' },
} as const;
export type RadiusChoice = keyof typeof RADIUS_SCALES;

/**
 * Loaded already or resolvable from the visitor's system — no webfont is fetched on a URL
 * parameter's say-so, even an allowlisted one. A partner's own licensed face needs an entry here.
 */
export const FONT_STACKS = {
  inter: '"Inter", system-ui, sans-serif',
  manrope: '"Manrope", system-ui, sans-serif',
  grotesk: '"Space Grotesk", system-ui, sans-serif',
  archivo: '"Archivo", system-ui, sans-serif',
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  helvetica: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  serif: '"Inria Serif", Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
} as const;
export type FontChoice = keyof typeof FONT_STACKS;

/** Spacing and the two display sizes, so a tight sidebar gets a shorter iframe. */
export const DENSITIES = {
  comfortable: {},
  compact: {
    '--space-8': '6px',
    '--space-16': '12px',
    '--space-24': '18px',
    '--text-hero': '32px',
    '--text-amount': '30px',
    '--text-symbol': '20px',
  },
} as const;
export type DensityChoice = keyof typeof DENSITIES;

export type Brand = {
  theme: ThemeChoice | undefined;
  /** Emphasis and, unless `cta` overrides it, the primary button. */
  accent: string | undefined;
  cta: string | undefined;
  /** The widget's ground. Text is derived from it when `text` is unset. */
  surface: string | undefined;
  text: string | undefined;
  radius: RadiusChoice | undefined;
  font: FontChoice | undefined;
  density: DensityChoice | undefined;
};

export const NO_BRAND: Brand = {
  theme: undefined,
  accent: undefined,
  cta: undefined,
  surface: undefined,
  text: undefined,
  radius: undefined,
  font: undefined,
  density: undefined,
};

export function isBranded(brand: Brand): boolean {
  return Object.values(brand).some(value => value !== undefined);
}

/* ── Reading the URL ─────────────────────────────────────────────────────── */

const HEX = /^#?(?:[\da-f]{3}|[\da-f]{6})$/i;

/**
 * Normalized to `#rrggbb`, the only colour shape that ever reaches a custom property. The `#` is
 * optional because a partner writing the iframe by hand would otherwise have to escape it as `%23`.
 */
export function readColor(value: string | null): string | undefined {
  if (!value || !HEX.test(value)) return undefined;
  const digits = value.replace('#', '').toLowerCase();
  return `#${digits.length === 3 ? [...digits].map(digit => digit + digit).join('') : digits}`;
}

// `Object.hasOwn`, not `in`: `in` walks the prototype, so `?font=toString` would pass and then be
// indexed for a stack that does not exist.
function readChoice<T extends string>(choices: Record<T, unknown>, value: string | null): T | undefined {
  return value && Object.hasOwn(choices, value) ? (value as T) : undefined;
}

export function readBrand(search: string): Brand {
  const params = new URLSearchParams(search);

  return {
    theme: readChoice(THEME_CHOICES, params.get('theme')),
    accent: readColor(params.get('accent')),
    cta: readColor(params.get('cta')),
    surface: readColor(params.get('surface')),
    text: readColor(params.get('text')),
    radius: readChoice(RADIUS_SCALES, params.get('radius')),
    font: readChoice(FONT_STACKS, params.get('font')),
    density: readChoice(DENSITIES, params.get('density')),
  };
}

/**
 * One field, through the same gate a URL goes through. The playground's controls use this rather
 * than casting their own values, so nothing the UI can set is anything a link could not.
 */
export function readBrandField<K extends keyof Brand>(key: K, value: string | null): Brand[K] {
  const params = new URLSearchParams();
  if (value !== null) params.set(key, value);
  return readBrand(params.toString())[key];
}

/**
 * Colours are written without the `#`, so a copied `<iframe>` carries no `%23` noise.
 *
 * A surface with no theme writes the theme it implies rather than nothing. `resolveTheme` would
 * derive the same value, but the pre-paint script in `index.html` reads the URL and does no colour
 * maths — spelling it out is what keeps the first painted theme and the rendered one the same.
 */
export function writeBrand(params: URLSearchParams, brand: Brand): void {
  if (brand.theme) params.set('theme', brand.theme);
  else if (brand.surface) params.set('theme', surfaceTheme(brand.surface));
  if (brand.accent) params.set('accent', brand.accent.slice(1));
  if (brand.cta) params.set('cta', brand.cta.slice(1));
  if (brand.surface) params.set('surface', brand.surface.slice(1));
  if (brand.text) params.set('text', brand.text.slice(1));
  if (brand.radius) params.set('radius', brand.radius);
  if (brand.font) params.set('font', brand.font);
  if (brand.density) params.set('density', brand.density);
}

/* ── Colour maths ────────────────────────────────────────────────────────── */

type Rgb = [number, number, number];

/** The two brand inks a derived foreground picks between: charcoal and white, 1:1 with layer 1. */
const INK_DARK = '#1d1414';
const INK_LIGHT = '#ffffff';

/** Layer 2's `--surface-card` per theme, so a brand with no surface still derives against the real one. */
export const DEFAULT_SURFACE: Record<'light' | 'dark', string> = { light: '#ffffff', dark: '#241a19' };

/**
 * Where the playground's colour inputs start when a field is unset — layer 2's own light values,
 * mirrored because `<input type="color">` has no empty state. Nothing renders from these.
 */
export const BRAND_DEFAULTS = {
  accent: '#a55c55',
  cta: '#a55c55',
  surface: '#ffffff',
  text: '#483434',
} as const;
export type ColorField = keyof typeof BRAND_DEFAULTS;

const AA_TEXT = 4.5;
/** WCAG's bar for a control's own edge against what is behind it, rather than for its label. */
const AA_CONTROL = 3;

function toRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function toHex(rgb: Rgb): string {
  const channel = (value: number) =>
    Math.round(Math.min(255, Math.max(0, value)))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(rgb[0])}${channel(rgb[1])}${channel(rgb[2])}`;
}

function linear(value: number): number {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

export function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

function mix(from: string, to: string, weight: number): string {
  const [r1, g1, b1] = toRgb(from);
  const [r2, g2, b2] = toRgb(to);
  const blend = (a: number, b: number) => a + (b - a) * weight;
  return toHex([blend(r1, r2), blend(g1, g2), blend(b1, b2)]);
}

/** Whichever brand ink is readable on `background`. This is what stops white-on-yellow. */
function ink(background: string): string {
  if (contrast(INK_DARK, background) >= AA_TEXT) return INK_DARK;
  return contrast(INK_LIGHT, background) >= AA_TEXT ? INK_LIGHT : '#000000';
}

/**
 * Which theme a ground already is, decided by the ink it needs rather than a luminance threshold, so
 * every colour classifies. A brand states one surface; this is what the other theme derives from.
 */
export function surfaceTheme(surface: string): 'light' | 'dark' {
  return contrast(INK_LIGHT, surface) > contrast(INK_DARK, surface) ? 'dark' : 'light';
}

/** Toward the colour's own ink: darkens a light colour, lightens a dark one. */
function step(hex: string, weight: number): string {
  return mix(hex, ink(hex), weight);
}

/** Away from it, which is the other half of a hover/active pair whichever way round it is. */
function lift(hex: string, weight: number): string {
  return mix(hex, ink(hex) !== INK_LIGHT ? INK_LIGHT : INK_DARK, weight);
}

/** Both themes frame the app in something darker than the card, so this one goes to black either way. */
function darken(hex: string, weight: number): string {
  return mix(hex, '#000000', weight);
}

/** Far enough to invert the ground, short of the extreme so a saturated surface keeps a trace of hue. */
const COUNTERPART = 0.9;

/**
 * The ground a theme renders on. A brand names one surface, and asked for the other theme — a partner
 * page that toggles, or `theme=auto` on a visitor whose OS disagrees — the counterpart is derived from
 * it. Dropping the brand instead would answer a theme switch with our palette wearing their accent.
 */
function ground(brand: Brand, theme: 'light' | 'dark'): string {
  if (!brand.surface) return DEFAULT_SURFACE[theme];
  if (surfaceTheme(brand.surface) === theme) return brand.surface;
  return mix(brand.surface, theme === 'dark' ? '#000000' : '#ffffff', COUNTERPART);
}

/** Nudges a colour toward the surface's ink until it clears `target`, so brand text stays readable. */
function readable(color: string, surface: string, target: number): { value: string; corrected: boolean } {
  if (contrast(color, surface) >= target) return { value: color, corrected: false };

  const toward = ink(surface);
  for (let weight = 0.1; weight < 1; weight += 0.1) {
    const candidate = mix(color, toward, weight);
    if (contrast(candidate, surface) >= target) return { value: candidate, corrected: true };
  }
  return { value: toward, corrected: true };
}

/* ── Deriving the roles ──────────────────────────────────────────────────── */

type Declarations = Record<string, string>;

/** Reported back to the playground so a partner sees the correction rather than wondering. */
export type BrandNote = string;

function colorRoles(brand: Brand, theme: 'light' | 'dark'): { decls: Declarations; notes: BrandNote[] } {
  const decls: Declarations = {};
  const notes: BrandNote[] = [];
  const surface = ground(brand, theme);
  const onSurface = ink(surface);
  const derivedGround = Boolean(brand.surface) && surface !== brand.surface;

  if (brand.surface) {
    if (derivedGround) {
      const shade = theme === 'light' ? 'lightens' : 'darkens';
      notes.push(`Your surface is ${surfaceTheme(brand.surface)}, so the ${theme} theme ${shade} it.`);
    }

    Object.assign(decls, {
      '--surface-card': surface,
      '--surface-page': surface,
      '--surface-embed': surface,
      '--form-surface': surface,
      // The demo page's own frame and stage. Left alone, a partner's palette sat in a cherry
      // surround on our gradient, which read as our page holding their widget.
      '--surface-ground': darken(surface, onSurface === INK_DARK ? 0.26 : 0.45),
      '--stage-bg': surface,
      '--stage-border': step(surface, 0.04),
      '--surface-inset': step(surface, 0.04),
      '--surface-note': step(surface, 0.04),
      '--panel-halo': step(surface, 0.09),
      '--panel-halo-hover': step(surface, 0.15),
      '--border-subtle': step(surface, 0.12),
      '--border-inset': step(surface, 0.08),
      '--border-strong': step(surface, 0.22),
      '--flip-bg': step(surface, 0.12),
      '--flip-bg-hover': step(surface, 0.2),
      '--flip-fg': onSurface,
      '--chip-shadow': step(surface, 0.28),
      '--logo-shadow': step(surface, 0.2),
    });
  }

  // A partner-set surface re-derives the whole text ramp even with no `text`, or their ground would
  // carry our ink — a dark surface with charcoal body copy. A derived ground drops their `text` too:
  // it was picked for the ground they stated, and correcting it across only reaches a washed-out grey.
  const heading = derivedGround ? onSurface : (brand.text ?? (brand.surface ? onSurface : undefined));

  if (heading) {
    const checked = readable(heading, surface, AA_TEXT);
    if (checked.corrected) notes.push('Text colour adjusted — yours was hard to read on this background.');

    Object.assign(decls, {
      '--text-heading': checked.value,
      '--text-body': readable(mix(checked.value, surface, 0.12), surface, AA_TEXT).value,
      '--text-muted': readable(mix(checked.value, surface, 0.34), surface, AA_TEXT).value,
      '--text-faint': readable(mix(checked.value, surface, 0.52), surface, AA_TEXT).value,
    });
  }

  if (brand.accent) {
    const checked = readable(brand.accent, surface, AA_TEXT);
    if (checked.corrected) notes.push('Accent adjusted — yours was hard to read on this background.');

    decls['--accent'] = checked.value;
    decls['--accent-hover'] = step(checked.value, 0.14);
    // The flow title is decorative-large, so it keeps the brand colour exactly as given.
    decls['--lockup-accent'] = brand.accent;
  }

  const cta = brand.cta ?? brand.accent;

  if (cta) {
    // A stated fill is rendered as given. On a ground we derived, an ink button on ink-black paper
    // would vanish into a ground its owner never chose, so that one case is corrected.
    const fill = derivedGround ? readable(cta, surface, AA_CONTROL) : { value: cta, corrected: false };
    if (fill.corrected) notes.push('Button colour adjusted — yours was hard to see on this background.');

    Object.assign(decls, {
      '--cta-bg': fill.value,
      '--cta-bg-hover': step(fill.value, 0.12),
      '--cta-bg-active': lift(fill.value, 0.14),
      '--cta-fg': ink(fill.value),
      '--cta-ring': lift(fill.value, 0.2),
    });
  }

  return { decls, notes };
}

/** Theme-invariant: a radius, a font stack and a spacing scale mean the same thing in either theme. */
function shapeRoles(brand: Brand): Declarations {
  const decls: Declarations = {};

  if (brand.radius) {
    const scale = RADIUS_SCALES[brand.radius];
    decls['--radius-large'] = scale.large;
    decls['--radius-regular'] = scale.regular;
    decls['--radius-inset'] = scale.inset;
    decls['--radius-small'] = scale.small;
    decls['--radius-pill'] = scale.pill;
  }

  if (brand.font) {
    decls['--font-body'] = FONT_STACKS[brand.font];
    decls['--font-display'] = FONT_STACKS[brand.font];
  }

  Object.assign(decls, brand.density ? DENSITIES[brand.density] : {});

  return decls;
}

function block(selector: string, decls: Declarations): string {
  const body = Object.entries(decls)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n');
  return body ? `${selector} {\n${body}\n}` : '';
}

export type BrandStyles = { css: string; notes: Record<'light' | 'dark', BrandNote[]> };

/**
 * The stylesheet a brand resolves to, as one block per theme.
 *
 * The dark block is not optional even when the two derive to the same values: `index.css` maps its
 * dark roles under `:root[data-theme="dark"]`, which outranks a bare `:root`, so a light-only
 * override would be won back on every token the dark theme sets.
 *
 * Notes stay per theme rather than pooled: a correction the theme on screen did not make is noise.
 */
export function brandStyles(brand: Brand): BrandStyles {
  const light = colorRoles(brand, 'light');
  const dark = colorRoles(brand, 'dark');

  const css = [block(':root', { ...shapeRoles(brand), ...light.decls }), block(':root[data-theme="dark"]', dark.decls)]
    .filter(Boolean)
    .join('\n\n');

  return { css, notes: { light: light.notes, dark: dark.notes } };
}

/**
 * Resolved values for the controls, including the active theme and derived text corrections. The
 * surface is the exception: the picker edits that field, so it shows what was set, not the ground a
 * derived counterpart is rendering.
 */
export function resolvedColors(brand: Brand, theme: 'light' | 'dark'): Record<ColorField, string> {
  const { decls } = colorRoles(brand, theme);
  return {
    accent: decls['--accent'] ?? (theme === 'dark' ? '#ffd92f' : '#a55c55'),
    cta: decls['--cta-bg'] ?? (theme === 'dark' ? '#ecc100' : '#a55c55'),
    surface: brand.surface ?? (theme === 'dark' ? '#17100f' : '#f5f2f2'),
    text: decls['--text-heading'] ?? (theme === 'dark' ? '#ffffff' : '#483434'),
  };
}
