import React, { useState } from 'react';
import BridgeCard from '@/components/bridge-api/BridgeCard';
import OrderStatus, { type BridgeApiOrder } from '@/components/bridge-api/OrderStatus';

export default function BridgeApiPage() {
  const [orders, setOrders] = useState<BridgeApiOrder[]>([]);

  return (
    <main className="flex flex-col items-center content-center justify-center space-y-2 px-4 pt-8 pb-12">
      {orders.map((order, index) => (
        <OrderStatus key={`${order.txHash}-${index}`} order={order} />
      ))}

      <BridgeCard setOrders={setOrders} />
    </main>
  );
}
