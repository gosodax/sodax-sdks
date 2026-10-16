/**
 * Ready-made brands, so the first thing a visitor does with the style panel is see the widget
 * become someone else's product rather than pick eight values from nothing.
 *
 * A preset is a starting point, not a mode: applying one fills the same `Brand` state the colour
 * pickers and selects edit, so every control still works afterwards and the copied embed carries
 * the result as ordinary parameters.
 *
 * Each is declared as the query string a partner could have written by hand and parsed with
 * `readBrand`, which is the same gate a URL goes through. A preset therefore cannot express
 * anything a link could not, and a typo here fails closed to `undefined` instead of reaching a
 * custom property.
 */

import { type Brand, readBrand } from './brand.js';

export type Preset = {
  id: string;
  label: string;
  /** Which product this register suits, shown as the chip's tooltip. */
  blurb: string;
  brand: Brand;
};

type PresetSpec = Omit<Preset, 'brand'> & { params: Record<string, string> };

/**
 * Fonts are the one place a preset approximates rather than matches: these registers were drawn
 * with webfonts, and `FONT_STACKS` only offers faces already loaded or resolvable from the system.
 * Radius follows the same rule — the nearest step on the widget's four-value scale.
 */
const SPECS: readonly PresetSpec[] = [
  {
    id: 'midnight',
    label: 'Midnight',
    blurb: 'Hushed premium — violet-black ground, one muted sage accent. Wealth and portfolio apps.',
    params: {
      theme: 'dark',
      surface: '#1b1926',
      text: '#f1eff6',
      accent: '#8fbfae',
      cta: '#8fbfae',
      radius: 'soft',
      font: 'manrope',
      density: 'comfortable',
    },
  },
  {
    id: 'terminal',
    label: 'Terminal',
    blurb: 'Dev-tool dark — true black, one neon signal hue, mono throughout. Dashboards and consoles.',
    params: {
      theme: 'dark',
      surface: '#101214',
      text: '#f4f5f3',
      accent: '#00dc87',
      cta: '#00dc87',
      radius: 'square',
      font: 'mono',
      density: 'compact',
    },
  },
  {
    id: 'kinetic',
    label: 'Kinetic',
    blurb: 'Bright consumer — violet brand on white, generous radii. Marketing sites and launch pages.',
    params: {
      theme: 'light',
      surface: '#ffffff',
      text: '#14102b',
      accent: '#6e56cf',
      cta: '#6e56cf',
      radius: 'round',
      font: 'grotesk',
      density: 'comfortable',
    },
  },
  {
    id: 'editorial',
    label: 'Editorial',
    blurb: 'Cool paper and serif — forest-green links, ink button, no rounding. Publications and docs.',
    params: {
      theme: 'light',
      surface: '#e9edec',
      text: '#1a1e1b',
      accent: '#1f5e42',
      cta: '#1a1e1b',
      radius: 'square',
      font: 'serif',
      density: 'comfortable',
    },
  },
  {
    id: 'console',
    label: 'Console',
    blurb: 'Instrument panel — steel-blue neutrals, right angles, tight rows. Ops and admin tools.',
    params: {
      theme: 'light',
      surface: '#dce8f5',
      text: '#0d1220',
      accent: '#154aaa',
      cta: '#154aaa',
      radius: 'sharp',
      font: 'archivo',
      density: 'compact',
    },
  },
];

/**
 * The default chip's swatch. SODAX is the absence of a brand rather than a `Brand` of its own, so
 * it has no derived colours to draw — these are layer 1's lockup, 1:1 with `index.css`.
 */
export const SODAX_SWATCH = ['#ffffff', '#a55c55', '#ffd92f'] as const;

export const PRESETS: readonly Preset[] = SPECS.map(({ params, ...rest }) => ({
  ...rest,
  brand: readBrand(new URLSearchParams(params).toString()),
}));

/** Which preset the current brand still is, so an applied chip stays pressed until a field moves. */
export function activePreset(brand: Brand): Preset | undefined {
  return PRESETS.find(preset => (Object.keys(brand) as (keyof Brand)[]).every(key => brand[key] === preset.brand[key]));
}
