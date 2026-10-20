import React from 'react';
import { cn } from '@/lib/utils';

/** Pill-shaped segmented control, styled like the SDK/API toggle. `disabled` locks every option. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
  className,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <fieldset
      aria-label={label}
      disabled={disabled}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border bg-card p-1 text-sm disabled:opacity-60',
        className,
      )}
    >
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-full px-4 py-1.5 font-medium transition-colors',
            value === option.value
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground enabled:hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}
