import { readJson, writeJson } from '@/lib/storage';

// Persists whether the swap-history panel is collapsed, so the user's show/hide choice survives a
// reload. Keyed per feature (mirrors the per-feature order keys) so the solver and swaps-api
// panels remember independently.
export const SOLVER_PANEL_KEY = 'sodax-demo:solver:history-collapsed';
export const SWAPS_API_PANEL_KEY = 'sodax-demo:swaps-api:history-collapsed';

export function loadPanelCollapsed(storageKey: string): boolean {
  return readJson<boolean>(storageKey) === true;
}

export function savePanelCollapsed(storageKey: string, collapsed: boolean): void {
  writeJson(storageKey, collapsed);
}
