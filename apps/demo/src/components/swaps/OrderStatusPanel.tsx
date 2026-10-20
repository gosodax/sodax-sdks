import React, { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import OrderStatus, { orderId, type FinalStatus, type Order } from '@/components/swaps/OrderStatus';
import { loadPanelCollapsed, savePanelCollapsed } from '@/lib/panelPrefs';
import { cn } from '@/lib/utils';

// Lists every in-flight swap — newest on top, each updating in realtime via its own OrderStatus
// hooks. Responsive: below the form in normal flow until xl, where there is finally room beside a
// window-centered form for a fixed left sidebar (docked under the header, scrolls internally).
//
// The header doubles as a show/hide toggle: clicking it collapses the list with a smooth
// grid-rows animation, and the collapsed state is persisted per feature via `storageKey`.
export default function OrderStatusPanel({
  orders,
  onDismiss,
  onSettle,
  storageKey,
}: {
  orders: Order[];
  onDismiss: (id: string) => void;
  onSettle: (id: string, final: FinalStatus) => void;
  storageKey: string;
}) {
  const [collapsed, setCollapsed] = useState(() => loadPanelCollapsed(storageKey));

  useEffect(() => {
    savePanelCollapsed(storageKey, collapsed);
  }, [storageKey, collapsed]);

  if (orders.length === 0) {
    return null;
  }

  // Newest order first (orders are appended as swaps fire).
  const newestFirst = [...orders].reverse();

  return (
    <aside className="thin-scrollbar flex w-full max-w-lg flex-col xl:fixed xl:left-4 xl:top-24 xl:z-40 xl:max-h-[calc(100vh-7rem)] xl:w-[23rem] xl:max-w-none xl:overflow-y-auto xl:p-2 2xl:w-[26rem]">
      <button
        type="button"
        onClick={() => setCollapsed(c => !c)}
        aria-expanded={!collapsed}
        className="flex items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-cherry-soda/10"
      >
        <span className="text-sm font-semibold text-cherry-dark">Swaps</span>
        <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-cherry-soda px-1.5 text-xs font-semibold text-white">
          {orders.length}
        </span>
        <ChevronDown
          className={cn(
            'ml-auto h-4 w-4 text-cherry-dark transition-transform duration-300 ease-out',
            collapsed && '-rotate-90',
          )}
        />
      </button>

      {/* 0fr → 1fr collapse animates to auto content height without a measured pixel height. */}
      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-300 ease-out',
          collapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]',
        )}
      >
        <div className="overflow-hidden">
          <div className="flex flex-col gap-3 pt-3">
            {newestFirst.map(order => {
              const id = orderId(order);
              return <OrderStatus key={id} order={order} onDismiss={() => onDismiss(id)} onSettle={onSettle} />;
            })}
          </div>
        </div>
      </div>
    </aside>
  );
}
