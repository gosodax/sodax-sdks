import React, { type ComponentProps } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const calloutVariants = cva('rounded-md border-l-4 p-4 text-sm', {
  variants: {
    variant: {
      /** Neutral notice, e.g. "real funds" or custody warnings. */
      notice: 'border-primary bg-notice text-foreground',
      destructive: 'border-destructive bg-destructive-muted text-destructive',
      success: 'border-success bg-success-muted text-success',
    },
  },
  defaultVariants: { variant: 'notice' },
});

export function Callout({
  className,
  variant,
  ...props
}: ComponentProps<'div'> & VariantProps<typeof calloutVariants>) {
  return <div role="note" className={cn(calloutVariants({ variant }), className)} {...props} />;
}
