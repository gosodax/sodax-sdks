'use client';

// biome-ignore lint/style/useImportType: React is needed for JSX transformation
import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';

import { cn } from '@/lib/utils';

type TooltipVariant = 'default' | 'soft';

function TooltipProvider({ delayDuration = 0, ...props }: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" delayDuration={delayDuration} {...props} />;
}

type TapToggle = { open: boolean; setOpen: (open: boolean) => void };
const TapToggleContext = React.createContext<TapToggle | null>(null);

function Tooltip({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const open = openProp ?? uncontrolledOpen;
  const setOpen = React.useCallback(
    (next: boolean) => {
      setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );
  const tapToggle = React.useMemo(() => ({ open, setOpen }), [open, setOpen]);

  return (
    <TooltipProvider>
      <TapToggleContext.Provider value={tapToggle}>
        <TooltipPrimitive.Root data-slot="tooltip" open={open} onOpenChange={setOpen} {...props} />
      </TapToggleContext.Provider>
    </TooltipProvider>
  );
}

function TooltipTrigger({ onPointerDown, onClick, ...props }: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  const tapToggle = React.useContext(TapToggleContext);
  // Radix Tooltip ignores touch: note the state before its pointerdown closes it, then toggle on the tap's click.
  const openBeforeTap = React.useRef<boolean | null>(null);

  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      onPointerDown={event => {
        onPointerDown?.(event);
        openBeforeTap.current = event.pointerType === 'touch' && tapToggle ? tapToggle.open : null;
      }}
      onClick={event => {
        onClick?.(event);
        if (tapToggle && openBeforeTap.current !== null) {
          event.preventDefault();
          tapToggle.setOpen(!openBeforeTap.current);
          openBeforeTap.current = null;
        }
      }}
      {...props}
    />
  );
}

function TooltipContent({
  className,
  sideOffset = -10,
  variant = 'default',
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content> & {
  variant?: TooltipVariant;
}) {
  const isSoft = variant === 'soft';

  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          // shared animation
          'animate-in fade-in-0 zoom-in-95',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2',
          'data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
          'z-50 w-fit text-xs rounded-md',
          // default (backward compatible)
          !isSoft && 'bg-cherry-soda text-primary-foreground px-3 py-1.5',
          // soft (new)
          isSoft && 'bg-cream-white text-espresso px-4 py-2 shadow-lg border border-clay-light/20',
          className,
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
