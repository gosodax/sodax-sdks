import React from 'react';
import { Button } from '@/components/ui/button';

export function QuoteError({ message, onRetry }: { message: string; onRetry: () => unknown }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-destructive-muted p-3 text-sm text-destructive">
      <span className="wrap-anywhere">{message}</span>
      <Button size="sm" variant="outline" className="rounded-full bg-card" onClick={() => void onRetry()}>
        Retry
      </Button>
    </div>
  );
}
