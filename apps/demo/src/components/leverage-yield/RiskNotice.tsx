import React from 'react';
import { Callout } from './Callout';

/** Shown before any deposit. The demo handles real mainnet funds. */
export function RiskNotice() {
  return (
    <Callout>
      <p className="font-semibold">Before you deposit</p>
      <ul className="mt-2 list-disc space-y-1 pl-4 text-muted-foreground">
        <li>This uses real funds on mainnet. Deposit only what you are prepared to lose.</li>
        <li>
          Vault shares are held for you in your SODAX hub wallet on Sonic. They won't appear in your wallet app, but
          this page shows them.
        </li>
        <li>Withdraw later from the same network you deposit from.</li>
        <li>
          The vault is leveraged: the APR can change or turn negative, and the share price can fall. Solvers may be
          unable to fill very small amounts.
        </li>
      </ul>
    </Callout>
  );
}
