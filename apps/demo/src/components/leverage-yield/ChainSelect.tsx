import React from 'react';
import type { SpokeChainKey } from '@sodax/dapp-kit';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { chainLogo, chainName } from './lib/chains';

/** Small and borderless, to sit inside a sentence ("on Base ▾"). */
export function ChainSelect({
  value,
  onChange,
  chains,
  label,
}: {
  value: SpokeChainKey;
  onChange: (chainKey: SpokeChainKey) => void;
  chains: readonly SpokeChainKey[];
  label: string;
}) {
  return (
    <Select value={value} onValueChange={next => onChange(chains.find(chainKey => chainKey === next) ?? value)}>
      <SelectTrigger
        aria-label={label}
        className="h-8 w-auto gap-1 rounded-full border-0 bg-transparent px-2 font-medium text-foreground shadow-none"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="leverage-yield-theme">
        {chains.map(chainKey => (
          <SelectItem key={chainKey} value={chainKey}>
            <span className="flex items-center gap-2">
              <img src={chainLogo(chainKey)} alt="" className="size-5 rounded-full" />
              {chainName(chainKey)}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
