import type { HttpUrl, SpokeChainKey, Hex } from '@sodax/types';

export type RelayExtraData = { address: Hex; payload: Hex };

/**
 * Bitcoin on-demand payload (borrow/withdraw), sent as a JSON object, not a string; there is no broadcast tx.
 * `public_key` is required because BIP-322 signatures are not public-key-recoverable.
 */
export type OnDemandRelayData = { payload_hex: string; signature?: string; public_key?: string };

export type IntentDeliveryInfo = {
  srcChainKey: SpokeChainKey;
  srcTxHash: string;
  srcAddress: string;
  dstChainKey: SpokeChainKey;
  dstTxHash: string;
  dstAddress: string;
};

export type RelayTxStatus = 'pending' | 'validating' | 'executing' | 'executed';

export type PacketData = {
  src_chain_id: number;
  src_tx_hash: string;
  src_address: string;
  status: RelayTxStatus;
  dst_chain_id: number;
  conn_sn: number;
  dst_address: string;
  dst_tx_hash: string;
  signatures: string[];
  payload: string;
};

export type WaitUntilIntentExecutedPayload = {
  intentRelayChainId: string;
  srcTxHash: string;
  timeout?: number;
  apiUrl: HttpUrl;
  /** Picks among packets of one src tx (already filtered by hash and chain); undefined keeps polling. Defaults to the first. */
  selectPacket?: (packets: PacketData[]) => PacketData | undefined;
};

export type RelayAction = 'submit' | 'get_transaction_packets' | 'get_packet';

export type IntentRelayRequest<T extends RelayAction> = {
  action: T;
  params: T extends 'submit'
    ? { chain_id: string; tx_hash: string; data?: RelayExtraData | OnDemandRelayData }
    : T extends 'get_transaction_packets'
      ? { chain_id: string; tx_hash: string }
      : T extends 'get_packet'
        ? { chain_id: string; tx_hash: string; conn_sn: string }
        : never;
};
