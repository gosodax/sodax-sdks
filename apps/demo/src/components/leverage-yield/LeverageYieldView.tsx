import React, { useMemo, useState } from 'react';
import { type SpokeChainKey, useSodaxContext } from '@sodax/dapp-kit';
import { SolverEnv, useAppStore } from '@/zustand/useAppStore';
import { HowItWorks } from './HowItWorks';
import { useConnectedHolders } from './hooks/useSourceChains';
import { useUsdPrices, useVaultStats } from './hooks/useVaultReads';
import { Segmented } from './Segmented';
import { type Transport, TransportProvider, TransportToggle } from './transport';
import { VaultDialog, type VaultTab } from './VaultDialog';
import { VaultList } from './VaultList';
import { YourVaults } from './YourVaults';

const SOLVER_ENVS = [
  { value: SolverEnv.Staging, label: 'Staging' },
  { value: SolverEnv.Production, label: 'Production' },
] as const;

/**
 * Leverage Yield: browse the pooled lsoda* ERC-4626 vaults, deposit and withdraw via SODAX intents. Shared by the
 * SDK and API pages; `transport` decides whether reads, quotes and transactions go through the SDK or the REST API.
 */
export function LeverageYieldView({ transport }: { transport: Transport }) {
  return (
    <TransportProvider transport={transport}>
      <div className="leverage-yield-theme min-h-screen bg-background text-foreground">
        <Hero />
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
          <LeverageYieldContent />
        </div>
      </div>
    </TransportProvider>
  );
}

/** Primary-surface hero band. Display title in the display font, one accent word in the accent font. */
function Hero() {
  return (
    <section className="bg-primary text-primary-foreground">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-10 sm:px-6 sm:py-12">
        <h1 className="max-w-3xl font-display text-4xl leading-tight sm:text-5xl">
          Leveraged staking yield, <span className="font-accent text-yellow-soda">one</span> deposit.
        </h1>
        <p className="max-w-2xl text-lg font-light text-cherry-brighter">
          Deposit from the network you already use. Solvers route it into a pooled vault that earns leveraged staking
          yield.
        </p>
      </div>
    </section>
  );
}

function LeverageYieldContent() {
  const { sodax } = useSodaxContext();
  const vaults = useMemo(() => sodax.leverageYield.listVaults(), [sodax]);
  const holders = useConnectedHolders();
  // One read of every vault, shared by the list, "Your vaults" and the dialog.
  const stats = useVaultStats(vaults, holders);
  const prices = useUsdPrices();
  const { solverEnvironment, setSolverEnvironment } = useAppStore();
  const [open, setOpen] = useState<{ vaultName: string; tab: VaultTab; heldUnder?: SpokeChainKey } | null>(null);

  const openVault = open && vaults.find(vault => vault.name === open.vaultName);
  const openStats = openVault && stats.get(openVault.vault);
  const connected = holders.length > 0;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-3xl font-bold">Vaults</h2>
          <p className="text-muted-foreground">
            Deposit USDC, ETH and more from the network you use. Solvers turn it into vault shares in one order.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
          <span className="flex items-center gap-2">
            Solver
            <Segmented
              label="Solver environment"
              options={SOLVER_ENVS}
              value={solverEnvironment}
              onChange={setSolverEnvironment}
              className="[&>button]:px-3 [&>button]:py-1"
            />
          </span>
          <span className="flex items-center gap-2">
            Data source <TransportToggle />
          </span>
        </div>
      </div>

      {connected && (
        <YourVaults
          vaults={vaults}
          stats={stats}
          prices={prices}
          onWithdraw={(vaultName, heldUnder) => setOpen({ vaultName, tab: 'withdraw', heldUnder })}
        />
      )}
      <VaultList
        vaults={vaults}
        stats={stats}
        prices={prices}
        connected={connected}
        onOpen={vaultName => setOpen({ vaultName, tab: 'deposit' })}
      />
      <HowItWorks />

      {open && openVault && openStats && (
        <VaultDialog
          vault={openVault}
          stats={openStats}
          prices={prices}
          initialTab={open.tab}
          heldUnder={open.heldUnder}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
