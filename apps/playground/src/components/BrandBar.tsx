import { useState } from 'react';
import type { BrandControls } from '../hooks/useBrand';
import { type Brand, type ColorField, DENSITIES, FONT_STACKS, RADIUS_SCALES, readBrandField } from '../lib/brand';
import { PRESETS, SODAX_SWATCH, activePreset } from '../lib/presets';
import { Dropdown } from './Dropdown';

/** Hints are `title` tooltips, not a line under each cell: eight of those cost ~90px of height. */
const COLOR_FIELDS: readonly { key: ColorField; label: string; hint: string }[] = [
  { key: 'accent', label: 'Accent', hint: 'Emphasis, and the button unless one is set below' },
  { key: 'cta', label: 'Button', hint: 'Its label colour is derived from this fill' },
  { key: 'surface', label: 'Surface', hint: 'Borders, insets and the text ramp follow it' },
  { key: 'text', label: 'Text', hint: 'Adjusted if it is hard to read on the surface' },
];

/** Layer 2's own values, so the control shows what is rendering before a partner overrides it. */
const CHOICE_FIELDS = [
  {
    key: 'theme',
    label: 'Theme',
    choices: { auto: null, light: null, dark: null },
    fallback: 'auto',
    hint: 'auto follows the visitor; a surface colour sets the starting theme',
  },
  {
    key: 'radius',
    label: 'Radius',
    choices: RADIUS_SCALES,
    fallback: 'soft',
    hint: 'Cards, panels and buttons; round images stay round',
  },
  {
    key: 'font',
    label: 'Font',
    choices: FONT_STACKS,
    fallback: 'inter',
    hint: 'Faces already loaded or on the system',
  },
  {
    key: 'density',
    label: 'Density',
    choices: DENSITIES,
    fallback: 'comfortable',
    hint: 'compact gives a shorter iframe',
  },
] as const satisfies readonly {
  key: keyof Brand;
  label: string;
  choices: object;
  fallback: string;
  hint: string;
}[];

const ROLES = ['surface', 'accent', 'button'] as const;

/** Surface, accent and button, overlapped so a preset reads as one mark at chip size. */
function Swatch({ colors }: { colors: readonly (string | undefined)[] }) {
  return (
    <span className="preset-swatch" aria-hidden="true">
      {/* Fixed three roles, not a reorderable list, so the position is the identity. */}
      {ROLES.map((role, index) => (
        <span key={role} style={{ background: colors[index] }} />
      ))}
    </span>
  );
}

/** Edits the same validated brand state carried by the exported embed. */
export function BrandBar({ controls }: { controls: BrandControls }) {
  const { brand, colors, notes, isBranded, update, apply, reset } = controls;
  const [advanced, setAdvanced] = useState(false);
  const active = activePreset(brand);

  return (
    <section className="brand-card card">
      <header className="brand-head">
        <h3 className="brand-title">Appearance</h3>
      </header>

      <p className="brand-lead small">Start with a preset, then make it yours.</p>

      {/* SODAX sits in the shelf rather than beside it: it is the default look, a peer of the other
          five, and as a chip it can show itself selected — which a "Reset" button never could. */}
      <fieldset className="preset-row" aria-label="Style presets">
        <button
          type="button"
          className="btn preset-chip"
          title="The widget's own look — follows your light or dark setting"
          aria-pressed={!isBranded}
          onClick={reset}
        >
          <Swatch colors={SODAX_SWATCH} />
          SODAX
        </button>
        {PRESETS.map(preset => (
          <button
            type="button"
            className="btn preset-chip"
            key={preset.id}
            title={preset.blurb}
            aria-pressed={active?.id === preset.id}
            onClick={() => apply(preset.brand)}
          >
            <Swatch colors={[preset.brand.surface, preset.brand.accent, preset.brand.cta]} />
            {preset.label}
          </button>
        ))}
      </fieldset>

      <div className="brand-grid">
        {COLOR_FIELDS.filter(field => advanced || field.key === 'cta' || field.key === 'surface').map(field => (
          <label className="brand-cell" key={field.key} title={field.hint}>
            <span className="brand-label">{field.label}</span>
            <span className="brand-control">
              <input
                type="color"
                className="brand-swatch"
                aria-label={field.label}
                value={colors[field.key]}
                onChange={event => update(field.key, readBrandField(field.key, event.target.value))}
              />
              <input
                key={colors[field.key]}
                className="input brand-hex"
                aria-label={`${field.label} hex color`}
                defaultValue={colors[field.key]}
                maxLength={7}
                onBlur={event => {
                  const value = readBrandField(field.key, event.target.value);
                  if (value) update(field.key, value);
                  else event.target.value = colors[field.key];
                }}
                onKeyDown={event => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
              />
              {brand[field.key] && (
                <button
                  type="button"
                  className="btn brand-clear"
                  onClick={() => update(field.key, undefined)}
                  aria-label={`Clear ${field.label.toLowerCase()}`}
                >
                  Clear
                </button>
              )}
            </span>
          </label>
        ))}

        {CHOICE_FIELDS.filter(field => advanced || field.key === 'theme').map(field => (
          <div className="brand-cell" key={field.key} title={field.hint}>
            <span className="brand-label">{field.label}</span>
            <Dropdown
              label={field.label}
              value={brand[field.key] ?? field.fallback}
              options={Object.keys(field.choices).map(option => ({ value: option, label: option }))}
              onChange={option => update(field.key, readBrandField(field.key, option))}
            />
          </div>
        ))}
      </div>

      <button
        className="btn advanced-toggle"
        type="button"
        aria-expanded={advanced}
        onClick={() => setAdvanced(!advanced)}
      >
        {advanced ? 'Fewer options' : 'Advanced appearance'}
      </button>
      {notes.length > 0 && (
        <ul className="brand-notes small">
          {notes.map(note => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
