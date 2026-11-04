import { type CSSProperties, type KeyboardEvent, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { navigateIndex, typeaheadIndex, typeaheadText } from '../lib/dropdown';

/** Tallest the panel grows before it scrolls; also what decides whether it opens up or down. */
const PANEL_MAX = 264;

/** The design system's 12px chevron: a 6×3 leaf on a 1.5 stroke, centred in a 12px box. */
export function Chevron({ up, className }: { up: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" fill="none" aria-hidden="true" className={className}>
      <path
        d={up ? 'M9 7.5 6 4.5 3 7.5' : 'M3 4.5 6 7.5 9 4.5'}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export type DropdownOption<T extends string> = { value: T; label: string };

export type DropdownProps<T extends string> = {
  label: string;
  value: T | undefined;
  options: readonly DropdownOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
};

/**
 * The B2B design system's navigation menu as a form control: a trigger stating the current value and
 * a floating panel of rows. Replaces `<select>`, whose popup the OS draws and no theme can reach.
 */
export function Dropdown<T extends string>({
  label,
  value,
  options,
  onChange,
  placeholder = 'None available',
}: DropdownProps<T>) {
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<CSSProperties>();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: '', at: 0 });
  const listId = useId();

  const open = place !== undefined;
  const selected = options.findIndex(option => option.value === value);
  const current = options[selected];

  const show = (index: number) => {
    const box = trigger.current?.getBoundingClientRect();
    if (!box) return;
    const below = window.innerHeight - box.bottom;
    // Opening upward is what keeps the panel on screen when the trigger sits low in the column.
    const up = below < PANEL_MAX && box.top > below;
    setActive(index);
    setPlace({
      left: box.left,
      minWidth: box.width,
      ...(up ? { bottom: window.innerHeight - box.top + 4 } : { top: box.bottom + 4 }),
    });
  };

  const commit = (index: number) => {
    // The panel is in the top layer, so a fieldset disabling the trigger cannot reach its rows: an
    // open dropdown would still commit after the preview locked the builder. Ask the trigger.
    if (trigger.current?.matches(':disabled')) {
      setPlace(undefined);
      return;
    }
    const option = options[index];
    if (option) onChange(option.value);
    setPlace(undefined);
    trigger.current?.focus();
  };

  // The top layer is what frees the panel from the cards and scrolling columns it opens inside; the
  // trade is that its position is a snapshot, so anything that moves the trigger closes it.
  useLayoutEffect(() => {
    if (open && panel.current && !panel.current.matches(':popover-open')) panel.current.showPopover();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: Event) => {
      const target = event.target as Node;
      if (panel.current?.contains(target)) return;
      if (event.type === 'pointerdown' && trigger.current?.contains(target)) return;
      setPlace(undefined);
    };
    document.addEventListener('pointerdown', dismiss);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [open]);

  useEffect(() => {
    const list = open ? panel.current?.querySelector<HTMLElement>('.dropdown-list') : undefined;
    const row = list?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!list || !row) return;
    // Scrolling the list itself rather than `scrollIntoView`, which would also scroll the column
    // behind the panel — and any scroll out there closes it.
    if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop;
    else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight)
      list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight;
  }, [open, active]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!options.length) return;
    const from = open ? active : selected;

    const moved = navigateIndex(event.key, from, options.length);
    if (moved !== undefined) {
      event.preventDefault();
      if (open) setActive(moved);
      else show(moved);
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (open) commit(active);
      else show(Math.max(selected, 0));
      return;
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      setPlace(undefined);
      return;
    }
    if (event.key === 'Tab') {
      setPlace(undefined);
      return;
    }

    if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return;
    const now = Date.now();
    const text = typeaheadText(typed.current.text, event.key, now - typed.current.at);
    typed.current = { text, at: now };
    const hit = typeaheadIndex(
      options.map(option => option.label),
      text,
      from,
    );
    if (hit === undefined) return;
    event.preventDefault();
    if (open) setActive(hit);
    else show(hit);
  };

  return (
    <div className="dropdown">
      <button
        ref={trigger}
        type="button"
        className="dropdown-trigger"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
        disabled={!options.length}
        onClick={() => (open ? setPlace(undefined) : show(Math.max(selected, 0)))}
        onKeyDown={onKeyDown}
      >
        <span className="dropdown-value">{current?.label ?? placeholder}</span>
        <Chevron up={open} className="dropdown-chevron" />
      </button>
      {open && (
        <div ref={panel} className="dropdown-panel" popover="manual" style={place}>
          <div className="dropdown-list" id={listId} role="listbox" aria-label={label}>
            {options.map((option, index) => (
              // Focus stays on the combobox and `aria-activedescendant` points here, so a row is
              // programmatically focusable but never its own tab stop.
              <div
                key={option.value}
                id={`${listId}-${index}`}
                role="option"
                tabIndex={-1}
                aria-selected={option.value === value}
                data-index={index}
                className={`dropdown-option${option.value === value ? ' dropdown-option-selected' : ''}${
                  index === active ? ' dropdown-option-active' : ''
                }`}
                onPointerMove={() => setActive(index)}
                onClick={() => commit(index)}
              >
                {option.label}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
