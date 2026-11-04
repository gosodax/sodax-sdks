/**
 * Leverage Positions page.
 *
 * The unpooled counterpart to /leverage-yield. A vault is one shared ERC-4626 position at a
 * single target LTV; a leverage position is one AAVE account per owner, so an owner can hold
 * several at different eMode categories and leverage tiers at once.
 *
 * Positions are owned by the user's **hub wallet**, never their EOA — the wallet router for a
 * Sonic user, the cross-chain wallet for a spoke user, both resolved by the one
 * `useGetUserHubWalletAddress` call. That is what makes this page chain-agnostic: nothing here
 * is special-cased for Sonic.
 */

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { ChainSelector } from '@/components/shared/ChainSelector';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SolverEnv, useAppStore } from '@/zustand/useAppStore';
import { useXAccount } from '@sodax/wallet-sdk-react';
import {
  ChainKeys,
  useGetUserHubWalletAddress,
  useLeveragePositionsForUser,
  type SpokeChainKey,
} from '@sodax/dapp-kit';
import { LeveragePositionsPanel } from './LeveragePositionsPanel';
import { CreatePositionCard } from './CreatePositionCard';
import { Disclosure, InfoHint, Notice } from './PositionSummary';
import { BookOpen, Clock } from 'lucide-react';
import type { Address } from 'viem';

export default function LeveragePositionsPage() {
  const [chain, setChain] = useState<SpokeChainKey>(ChainKeys.SONIC_MAINNET);
  const { solverEnvironment, setSolverEnvironment } = useAppStore();
  const account = useXAccount({ xChainId: chain });
  const { data: hubWallet } = useGetUserHubWalletAddress({
    params: { spokeChainId: chain, spokeAddress: account.address },
  });

  /**
   * Lifted out of the panel because the LAYOUT depends on it. Discovery goes through the spoke
   * address, which resolves the hub wallet that owns the positions — a raw EOA owns none of them.
   */
  const { data: positions, error: positionsError } = useLeveragePositionsForUser({
    params: { spokeChainKey: chain, spokeAddress: account.address },
  });
  const hasPanel = (positions?.length ?? 0) > 0 || !!positionsError;

  /**
   * Kept mounted for the length of the exit transition, so collapsing back to one column fades out
   * instead of vanishing mid-animation. Matches the 500ms on the grid and the opacity.
   */
  const [panelMounted, setPanelMounted] = useState(false);
  useEffect(() => {
    if (hasPanel) {
      setPanelMounted(true);
      return;
    }
    const timer = setTimeout(() => setPanelMounted(false), 500);
    return () => clearTimeout(timer);
  }, [hasPanel]);

  return (
    <div className="flex min-h-screen flex-col items-center gap-4 p-4">
      {/* Solver-environment switcher — the same control as on /leverage-yield and /swaps-sdk, and the
        same shared `solverEnvironment` state, so switching here or there is the same switch.
        It applies to positions because a position's leverage intent is reported to whichever
        solver this selects; providers.tsx remaps the SDK's solver config on change. */}
      <Tabs value={solverEnvironment} onValueChange={v => setSolverEnvironment(v as SolverEnv)}>
        <TabsList>
          <TabsTrigger value={SolverEnv.Staging}>Staging</TabsTrigger>
          <TabsTrigger value={SolverEnv.Production}>Production</TabsTrigger>
        </TabsList>
      </Tabs>

      {/**
       * Two columns wide, one column narrow — and one column at any width when there is nothing to
       * list, so the form sits centred rather than beside an empty half.
       *
       * The collapsed state is a real second track at `0fr` rather than a missing one, which is what
       * makes the change animate: `grid-template-columns` interpolates, so the form glides to the
       * left as the track opens instead of jumping there when a sibling appears.
       *
       * BOTH STATES MUST BE WRITTEN THE SAME WAY. `grid-cols-2` compiles to
       * `repeat(2, minmax(0, 1fr))`, and the browser will not interpolate that against a plain
       * `1fr 0fr` — measured, it snapped straight to the end value. Spelling the open state
       * `[1fr_1fr]` keeps both sides one form, and then it animates.
       */}
      <div
        className={`grid w-full max-w-[73rem] items-start gap-4 transition-[grid-template-columns] duration-500 ease-out ${
          hasPanel ? 'xl:grid-cols-[1fr_1fr]' : 'xl:grid-cols-[1fr_0fr]'
        }`}
      >
        <div className="mx-auto flex w-full max-w-xl min-w-0 flex-col gap-4">
          <Card className="w-full">
            <CardHeader>
              <CardTitle className="text-2xl font-bold text-center">Leverage positions</CardTitle>
              <CardDescription className="text-center">
                Open, monitor, adjust, and close your own leveraged accounts.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label>Your chain</Label>
                <ChainSelector selectedChainId={chain} selectChainId={setChain} />
              </div>

              <div className="grid grid-cols-[auto_minmax(0,1fr)] sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <span className="text-muted-foreground">Connected address</span>
                <span className="text-right font-mono text-xs break-all">{account.address ?? '—'}</span>
                <span className="flex items-center gap-1 text-muted-foreground">
                  Position owner
                  <InfoHint>
                    Positions belong to this hub wallet. It lets the same controls work from Sonic or any spoke chain.
                  </InfoHint>
                </span>
                <span className="text-right font-mono text-xs break-all">{hubWallet ?? '—'}</span>
              </div>

              <Notice icon={Clock}>
                Actions are async. You post an intent, a solver fills it later, and unfilled intents expire after 5
                minutes.
              </Notice>

              {/* The prose that used to open the page. Kept whole, one click away. */}
              <Disclosure icon={BookOpen} title="Before you start" summary="async fills, hub-wallet owner">
                <p className="text-xs text-muted-foreground">
                  Opening, adjusting, and closing all use solver intents. The transaction only posts the request; the
                  position changes after the fill.
                </p>
                <p className="text-xs text-muted-foreground">
                  Each position is a separate Aave account owned by the hub wallet above, so one wallet can hold
                  multiple leverage and eMode setups at the same time.
                </p>
              </Disclosure>
            </CardContent>
          </Card>

          <CreatePositionCard chain={chain} owner={hubWallet as Address | undefined} />
        </div>

        {panelMounted && (
          // `overflow-hidden` is what lets the track close over the card instead of the card
          // overflowing a zero-width column while the grid animates.
          <div
            className={`mx-auto w-full max-w-xl min-w-0 overflow-hidden transition-opacity duration-500 ease-out ${
              hasPanel ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <LeveragePositionsPanel
              chain={chain}
              positions={positions}
              error={positionsError}
              owner={hubWallet as Address | undefined}
            />
          </div>
        )}
      </div>
    </div>
  );
}
