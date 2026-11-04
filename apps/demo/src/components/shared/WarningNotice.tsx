import React, { type ReactNode } from 'react';

/** Amber notice for a condition that keeps an action disabled until the user changes the input. */
export function WarningNotice({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="min-w-0 w-full text-xs text-amber-600 dark:text-amber-500 bg-amber-50 dark:bg-amber-950/30 p-2 rounded-lg border border-amber-200 dark:border-amber-900"
    >
      {children}
    </p>
  );
}
