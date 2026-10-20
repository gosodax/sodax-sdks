import React, { type ReactNode } from 'react';

/** Heading for a page section ("Your vaults", "All vaults"), with an optional hint on the right. */
export function SectionHeading({ id, title, hint }: { id: string; title: string; hint?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h3 id={id} className="font-display text-xl font-semibold">
        {title}
      </h3>
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
    </div>
  );
}
