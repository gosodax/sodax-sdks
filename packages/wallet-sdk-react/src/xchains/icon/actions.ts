import { useXWalletStore } from '@/useXWalletStore.js';
import { isIconAddress } from '@sodax/wallet-sdk-core';
import {
  ICONEX_HYDRATION_TIMEOUT_MS,
  ICONexRequestEventType,
  ICONexResponseEventType,
  request,
} from './iconex/index.js';

// On failure this rejects (persisted connection left untouched) — the caller logs it.
export const reconnectIcon = async () => {
  const iconConnection = useXWalletStore.getState().xConnections.ICON;
  if (!iconConnection) return;

  const recentXConnectorId = iconConnection.xConnectorId;

  // Short timeout: an unanswered hydration request must not hold the queue against a user connect.
  const detail = await request({ type: ICONexRequestEventType.REQUEST_ADDRESS }, ICONEX_HYDRATION_TIMEOUT_MS);

  if (detail?.type === ICONexResponseEventType.RESPONSE_ADDRESS && isIconAddress(detail.payload)) {
    useXWalletStore.getState().setXConnection('ICON', {
      xAccount: {
        address: detail.payload,
        xChainType: 'ICON',
      },
      xConnectorId: recentXConnectorId,
    });
  }
};
