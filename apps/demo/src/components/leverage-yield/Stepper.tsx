import React, { type ReactNode } from 'react';
import { CheckIcon, Loader2Icon, XIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type StepStatus = 'pending' | 'active' | 'done' | 'skipped' | 'error';

export function Stepper({ steps }: { steps: { label: string; status: StepStatus; detail?: ReactNode }[] }) {
  return (
    <ol className="flex flex-col gap-3">
      {steps.map(step => (
        <li key={step.label} className="flex items-start gap-3">
          <span
            className={cn(
              'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs',
              step.status === 'done' && 'border-success bg-success text-white',
              step.status === 'active' && 'border-primary text-primary',
              step.status === 'error' && 'border-destructive bg-destructive text-white',
              (step.status === 'pending' || step.status === 'skipped') && 'text-subtle-foreground',
            )}
          >
            {step.status === 'done' && <CheckIcon className="size-3.5" />}
            {step.status === 'active' && <Loader2Icon className="size-3.5 animate-spin" />}
            {step.status === 'error' && <XIcon className="size-3.5" />}
          </span>
          <div className="flex min-w-0 flex-col">
            <span
              className={cn(
                'text-sm',
                step.status === 'active' && 'font-semibold',
                (step.status === 'pending' || step.status === 'skipped') && 'text-muted-foreground',
              )}
            >
              {step.label}
              {step.status === 'skipped' && ' (not needed)'}
            </span>
            {step.detail && <span className="wrap-anywhere text-xs text-muted-foreground">{step.detail}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}
