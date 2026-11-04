import type { SpokeChainKey } from '@sodax/dapp-kit';
import { readJson, writeJson } from './storage';

// Chain key + token SYMBOL only — the live XToken is re-resolved against the SDK's supported
// lists in BridgeManager, or balance readers would fetch a stale chain (see apps/demo/AGENTS.md).

const STORAGE_KEY = 'sodax-demo:bridge:last-selection';

type StoredLeg = { chain?: string; tokenSymbol?: string };
export type StoredBridgeSelection = { src?: StoredLeg; dst?: StoredLeg };

export function loadBridgeSelection(): StoredBridgeSelection {
  const parsed = readJson<StoredBridgeSelection>(STORAGE_KEY);
  return parsed && typeof parsed === 'object' ? parsed : {};
}

export function saveBridgeSelection(selection: {
  srcChain: SpokeChainKey;
  srcSymbol?: string;
  dstChain: SpokeChainKey;
  dstSymbol?: string;
}): void {
  writeJson(STORAGE_KEY, {
    src: { chain: selection.srcChain, tokenSymbol: selection.srcSymbol },
    dst: { chain: selection.dstChain, tokenSymbol: selection.dstSymbol },
  } satisfies StoredBridgeSelection);
}
