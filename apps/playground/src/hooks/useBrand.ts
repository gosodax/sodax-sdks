import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type Brand,
  NO_BRAND,
  type ThemeChoice,
  readBrandField,
  brandStyles,
  isBranded,
  resolvedColors,
  surfaceTheme,
} from '../lib/brand';
import { initialUrl } from '../lib/initialUrl';

export type Theme = 'light' | 'dark';

/** Kept in sync with the pre-paint script in index.html, which owns the first resolution. */
export const THEME_STORAGE_KEY = 'sodax-playground-theme';

const STYLE_ID = 'sodax-brand';

function prefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function storedTheme(): Theme | undefined {
  // An embed can run with site data blocked; resolution must still land on something.
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'dark' || stored === 'light' ? stored : undefined;
  } catch {
    return undefined;
  }
}

/**
 * `?theme=light|dark` wins: in an embed the partner's page has already decided, and the visitor's
 * own stored preference is for our demo page, not for a widget inside someone else's product.
 * `auto` asks for the OS explicitly, so it is honoured even against a brand's own surface.
 *
 * With no theme parameter a brand that states a surface resolves to that surface's own theme, not
 * to the stored choice or the OS. Inverting a ground a partner chose is never what silence meant,
 * and it is what left a light brand carrying our dark alerts, tooltips and disabled controls.
 */
export function resolveTheme(brand: Brand, systemDark: boolean): Theme {
  if (brand.theme === 'light' || brand.theme === 'dark') return brand.theme;
  if (brand.theme === 'auto') return systemDark ? 'dark' : 'light';
  if (brand.surface) return surfaceTheme(brand.surface);
  return storedTheme() ?? (systemDark ? 'dark' : 'light');
}

/**
 * Writes the derived roles into one `<style>` in the head, last in the cascade so it outranks the
 * layer-2 defaults. Exported imperatively as well as through the hook because `index.tsx` applies
 * it before the first render — from an effect, a framed widget would paint our palette and then
 * the partner's.
 */
export function applyBrandStyles(css: string): void {
  const existing = document.getElementById(STYLE_ID);
  const element = existing ?? document.createElement('style');
  element.id = STYLE_ID;
  element.textContent = css;
  if (!existing) document.head.append(element);
}

/**
 * A theme the visitor picked is also this page's own preference, so it survives a reload with no
 * parameters. `auto` and a reset clear it again — otherwise "follow the visitor" would keep
 * answering with a choice they had already taken back.
 */
function pinTheme(theme: ThemeChoice | undefined): void {
  try {
    if (theme === 'light' || theme === 'dark') localStorage.setItem(THEME_STORAGE_KEY, theme);
    else localStorage.removeItem(THEME_STORAGE_KEY);
  } catch {}
}

export type BrandControls = ReturnType<typeof useBrand>;

/**
 * The theme and brand the widget is rendering under. One owner: this hook resolves the theme
 * attribute and the derived stylesheet, and the demo page's controls edit the same state, so a
 * visitor's tweak lands in the query string and the copied embed snippet carries it.
 */
export function useBrand(applyToDocument = true) {
  const [brand, setBrand] = useState<Brand>(initialUrl.brand);
  const [systemDark, setSystemDark] = useState(prefersDark);

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystemDark(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const theme = resolveTheme(brand, systemDark);
  const { css, notes } = useMemo(() => brandStyles(brand), [brand]);

  useEffect(() => {
    if (applyToDocument) applyBrandStyles(css);
  }, [css, applyToDocument]);

  useEffect(() => {
    if (applyToDocument) document.documentElement.dataset.theme = theme;
  }, [theme, applyToDocument]);

  const update = useCallback(
    <K extends keyof Brand>(key: K, value: Brand[K]) => {
      if (applyToDocument && key === 'theme') pinTheme(readBrandField('theme', value ?? null));
      setBrand(previous => ({ ...previous, [key]: value }));
    },
    [applyToDocument],
  );

  /**
   * Every field at once, for a preset. The controls then edit it like any other brand.
   *
   * Deliberately does not pin the theme: trying on a dark preset is a preview, not the visitor
   * saying they want this page dark. Pinning it here left every later reset stuck on dark.
   */
  const apply = useCallback((next: Brand) => setBrand(next), []);

  const reset = useCallback(() => {
    if (applyToDocument) pinTheme(undefined);
    setBrand(NO_BRAND);
  }, [applyToDocument]);

  const colors = resolvedColors(brand, theme);
  return { brand, theme, colors, notes: notes[theme], isBranded: isBranded(brand), update, apply, reset };
}
