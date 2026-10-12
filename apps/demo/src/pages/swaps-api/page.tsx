import React, { useCallback, useEffect, useState } from 'react';
import SwapCard from '@/components/swaps-api/SwapCard';
import { type FinalStatus, type Order, orderId } from '@/components/swaps/OrderStatus';
import OrderStatusPanel from '@/components/swaps/OrderStatusPanel';
import { loadOrders, saveOrders, SWAPS_API_ORDERS_KEY } from '@/lib/orderHistory';
import { SWAPS_API_PANEL_KEY } from '@/lib/panelPrefs';

export default function SwapsApiPage() {
  const [orders, setOrders] = useState<Order[]>(() => loadOrders(SWAPS_API_ORDERS_KEY));

  // Persist swap history so in-flight swaps survive a refresh and still show on completion.
  useEffect(() => {
    saveOrders(SWAPS_API_ORDERS_KEY, orders);
  }, [orders]);

  const handleDismissOrder = (id: string) => {
    setOrders(prev => prev.filter(order => orderId(order) !== id));
  };

  // Snapshot a swap's terminal status so a reload renders it statically (no polling/fetch).
  const handleSettleOrder = useCallback((id: string, final: FinalStatus) => {
    setOrders(prev => prev.map(order => (orderId(order) === id ? { ...order, final } : order)));
  }, []);

  return (
    <main className="flex flex-col items-center content-center justify-center space-y-2 px-4 pt-8 pb-12">
      <SwapCard setOrders={setOrders} />

      {/* Below the form on small screens; a fixed left sidebar on xl+ (see OrderStatusPanel). */}
      <OrderStatusPanel
        orders={orders}
        onDismiss={handleDismissOrder}
        onSettle={handleSettleOrder}
        storageKey={SWAPS_API_PANEL_KEY}
      />
    </main>
  );
}
