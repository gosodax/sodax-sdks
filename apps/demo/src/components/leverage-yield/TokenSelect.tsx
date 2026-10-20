import React from 'react';
import type { XToken } from '@sodax/dapp-kit';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TokenIcon } from './TokenIcon';

export function TokenSelect({
  tokens,
  value,
  onChange,
}: {
  tokens: readonly XToken[];
  value: string | undefined;
  onChange: (address: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        aria-label="Token"
        className="h-10 w-auto shrink-0 gap-2 rounded-full border-0 bg-card pr-3 pl-1.5 font-semibold shadow-none"
      >
        <SelectValue placeholder="Token" />
      </SelectTrigger>
      <SelectContent className="leverage-yield-theme">
        {tokens.map(token => (
          <SelectItem key={token.address} value={token.address}>
            <span className="flex items-center gap-2">
              <TokenIcon symbol={token.symbol} className="size-6" />
              {token.symbol}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
