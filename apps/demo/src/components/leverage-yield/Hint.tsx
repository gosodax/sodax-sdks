import React, { type ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** Dark tooltip on `children` (the trigger). Portaled, so it carries the page theme itself. */
export function Hint({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent sideOffset={6} className="leverage-yield-theme max-w-xs bg-foreground px-3 py-2 text-background">
        {content}
      </TooltipContent>
    </Tooltip>
  );
}
