import React from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** The page's pill-shaped buttons; `lg` is the full-width call to action. */
export function PillButton({ className, size, ...props }: ButtonProps) {
  return (
    <Button size={size} className={cn('rounded-full', size === 'lg' && 'h-12 px-6 text-base', className)} {...props} />
  );
}
