/**
 * Read-out primitives shared by the create form and the per-position controls.
 *
 * Both had grown the same shape: every derived number in one flat list, at one size, with the two
 * that actually decide whether to press the button buried among the rest. These split that into
 * the two things a reader does — glance at the outcome, then dig only if the outcome looks wrong.
 *
 * `SummaryTiles` is the glance, capped at three on purpose: what you end up with, how risky it is,
 * what it costs to get in. Everything each tile leaves out lives in its `info` tooltip, so folding
 * the detail away does not lose the explanation that made this page worth reading.
 *
 * `Disclosure` is the dig — collapsed by default, but its header carries the current values, so a
 * folded section still says what is inside it rather than hiding that anything is there.
 */

import React, { useState } from 'react';
import { ChevronRight, Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getHealthFactorState } from '@/lib/utils';

/**
 * Colour by meaning rather than by brand. `getHealthFactorState` returns `text-cherry-soda` for a
 * safe position, which is the same brick red as a real problem — so a healthy 2.81 read as a
 * warning. Dropping the class on `safe` leaves colour meaning exactly one thing: act on this.
 */
export function healthTone(hf: number): { label: string; className: string; tone: Tone } {
  const state = getHealthFactorState(hf);
  return { label: state.label, className: state.tone === 'safe' ? '' : state.className, tone: state.tone };
}

/** What a value MEANS, which is what decides whether it is coloured at all. */
export type Tone = 'safe' | 'caution' | 'danger';

/** Small `?` affordance. Carries the sentence the layout no longer has room to print. */
export function InfoHint({ children }: { children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="-m-1.5 p-1.5 text-muted-foreground/70 hover:text-muted-foreground"
          aria-label="More info"
        >
          <Info className="h-3 w-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent variant="soft" sideOffset={6} className="max-w-[16rem] leading-snug">
        {children}
      </TooltipContent>
    </Tooltip>
  );
}

export function SummaryTiles({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 rounded-md border bg-muted/30 p-2 sm:grid-cols-3 sm:gap-2">{children}</div>
  );
}

export function SummaryTile({
  icon: Icon,
  label,
  value,
  hint,
  info,
  className,
  emphasis = false,
  tone = 'safe',
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  /** One line under the number — the unit, the verdict, or the denominator. */
  hint?: string;
  info?: React.ReactNode;
  className?: string;
  /** The number the group is read for. At most one per group, or the emphasis means nothing. */
  emphasis?: boolean;
  /** Tints the tile, so a position needing attention is findable without reading any of it. */
  tone?: Tone;
}) {
  const toneClass = tone === 'danger' ? 'bg-negative/10' : tone === 'caution' ? 'bg-yellow-soda/20' : '';
  return (
    <div
      className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 rounded-sm px-1 py-1 text-left sm:block sm:space-y-0.5 sm:text-center ${toneClass}`}
    >
      <div className="flex items-center justify-start gap-1 text-[10px] text-muted-foreground sm:justify-center">
        <Icon className="h-3 w-3" />
        <span>{label}</span>
        {info && <InfoHint>{info}</InfoHint>}
      </div>
      <div className={`font-mono leading-tight ${emphasis ? 'text-lg font-semibold' : 'text-base'} ${className ?? ''}`}>
        {value}
      </div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function DetailGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">{children}</div>;
}

export function DetailRow({
  label,
  value,
  info,
  className,
}: {
  label: string;
  value: React.ReactNode;
  info?: React.ReactNode;
  className?: string;
}) {
  return (
    <>
      <span className="flex items-center gap-1 text-muted-foreground">
        {label}
        {info && <InfoHint>{info}</InfoHint>}
      </span>
      <span className={`text-right font-mono text-xs ${className ?? ''}`}>{value}</span>
    </>
  );
}

/**
 * A short coloured callout. `danger` is for something the user must act on before the button will
 * work; `warn` for a risk they are taking knowingly; `muted` for a note.
 */
export function Notice({
  tone = 'muted',
  icon: Icon,
  children,
}: {
  tone?: 'muted' | 'warn' | 'danger';
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  const toneClass =
    tone === 'danger'
      ? 'border-negative/40 bg-negative/10 text-negative'
      : tone === 'warn'
        ? 'border-yellow-dark/40 bg-yellow-soda/10 text-foreground'
        : 'border-transparent bg-muted/40 text-muted-foreground';
  return (
    <div className={`flex gap-1.5 rounded-md border px-2 py-1.5 text-[10px] leading-snug ${toneClass}`}>
      {Icon && <Icon className="mt-px h-3 w-3 shrink-0" />}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Disclosure({
  icon: Icon,
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  /** Current values, shown while collapsed — a folded section should still say what is in it. */
  summary?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t pt-2">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full min-h-9 items-center gap-1 text-left sm:min-h-0"
        aria-expanded={open}
      >
        <ChevronRight className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
        {Icon && <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />}
        <span className="text-xs font-semibold">{title}</span>
        {!open && summary && <span className="ml-auto truncate text-[10px] text-muted-foreground">{summary}</span>}
      </button>
      {open && <div className="space-y-2 pt-2">{children}</div>}
    </div>
  );
}
