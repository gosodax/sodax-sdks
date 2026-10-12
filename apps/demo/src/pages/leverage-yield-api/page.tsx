import React, { useState } from 'react';
import LeverageCard from '@/components/leverage-yield-api/LeverageCard';
import OrderStatus, { type LeverageYieldApiOrder } from '@/components/leverage-yield-api/OrderStatus';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SolverEnv, useAppStore } from '@/zustand/useAppStore';

/**
 * Leverage Yield API showcase — deposits/withdrawals driven entirely by the backend
 * `sodax.api.leverageYield.*` HTTP client (via `@sodax/dapp-kit` `useLeverageYieldApi*` hooks).
 * The only client-side steps are allowance signing, sign-and-broadcast, and minor utils — every
 * quote/intent/relay decision is made by the API. Mirrors the swaps-api page.
 *
 * The solver-environment switcher is the same control as on `/solver` and `/leverage-yield`; it
 * re-keys the app-wide SDK config (see `providers.tsx`). Note the leverage-yield endpoints
 * themselves run against whatever backend the Sodax Settings "Leverage Yield API base URL" row
 * resolves to (`effectiveLeverageYieldApiBaseUrl`) — the switcher drives the client SDK's
 * solver/chain config, not that backend's own environment.
 */
export default function LeverageYieldApiPage() {
  const { solverEnvironment, setSolverEnvironment } = useAppStore();
  const [orders, setOrders] = useState<LeverageYieldApiOrder[]>([]);

  return (
    <main className="flex flex-col items-center content-center justify-center space-y-2 px-4 pt-8 pb-12">
      {orders.map((order, index) => (
        <OrderStatus key={`${order.txHash}-${index}`} order={order} />
      ))}

      <Tabs value={solverEnvironment} onValueChange={value => setSolverEnvironment(value as SolverEnv)}>
        <TabsList>
          <TabsTrigger value={SolverEnv.Staging}>Staging</TabsTrigger>
          <TabsTrigger value={SolverEnv.Production}>Production</TabsTrigger>
        </TabsList>
      </Tabs>

      <LeverageCard setOrders={setOrders} />
    </main>
  );
}
