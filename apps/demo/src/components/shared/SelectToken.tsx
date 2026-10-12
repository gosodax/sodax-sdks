'use client';

import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { useRadixSearchInput } from '@/hooks/useRadixSearchInput';
import { TokenIcon } from '@/components/shared/TokenIcon';

const MAX_NAME_CHARS = 24;

/** Long names (Robinhood equities run past 80 chars) are cut with two trailing dots so they cannot widen the menu. */
const shortName = (name: string): string =>
  name.length > MAX_NAME_CHARS ? `${name.slice(0, MAX_NAME_CHARS).trimEnd()}..` : name;

/** Searchable token dropdown; works for any token shape carrying name + symbol + address (XToken, SwapTokenV2). */
export function SelectToken<T extends { name: string; symbol: string; address: string }>({
  tokens,
  value,
  onSelect,
  className,
}: {
  tokens: readonly T[];
  /** Selected token symbol. */
  value?: string;
  onSelect: (token: T) => void;
  className?: string;
}) {
  const { search, inputProps, handleOpenChange } = useRadixSearchInput();
  const q = search.trim().toLowerCase();
  const filtered = q
    ? tokens.filter(t => t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q))
    : tokens;

  return (
    <Select
      value={value}
      onValueChange={v => {
        const token = tokens.find(t => t.symbol === v);
        if (token) onSelect(token);
      }}
      onOpenChange={handleOpenChange}
    >
      <SelectTrigger className={className}>
        <SelectValue placeholder="Token" />
      </SelectTrigger>
      {/* Fixed width so the long Robinhood equity names ellipsize instead of widening the menu; never
          narrower than the trigger, whose width the list inherits, or the list is clipped. */}
      <SelectContent className="w-[max(240px,var(--radix-select-trigger-width))]">
        <div className="sticky top-0 z-10 bg-white p-1">
          <Input autoFocus placeholder="Search token..." className="h-8" {...inputProps} />
        </div>
        {filtered.length === 0 ? (
          <div className="px-2 py-3 text-center text-sm text-muted-foreground">No token found</div>
        ) : (
          filtered.map(token => (
            <SelectItem
              key={`${token.address}-${token.symbol}`}
              value={token.symbol}
              description={<span className="block whitespace-nowrap pl-7">{shortName(token.name)}</span>}
            >
              <span className="flex items-center gap-2">
                <TokenIcon symbol={token.symbol} />
                {token.symbol}
              </span>
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );
}
