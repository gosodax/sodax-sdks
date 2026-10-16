import { getSupportedSolverTokens, type SpokeChainKey, type XToken } from '@sodax/dapp-kit';
import { readJson, writeJson } from '@/lib/storage';

// Persists the last picked solver swap chain + token so From/To restore on reload.
// Store the chain key + token SYMBOL only — never a serialized XToken object: the live token must
// be re-resolved from getSupportedSolverTokens(chain) on the target chain, or the restored chain
// and token disagree and `useBalances` silently reads the wrong chain as `0n` — it never errors on
// a mismatch, so nothing downstream would catch it. See apps/demo/AGENTS.md.

const STORAGE_KEY = 'sodax-demo:solver:last-selection';

export type SelectionLeg = { chain: SpokeChainKey; token: XToken };

type StoredLeg = { chain: string; tokenSymbol: string };
type StoredSelection = { src?: StoredLeg; dst?: StoredLeg };

function resolveLeg(leg: StoredLeg | undefined): SelectionLeg | undefined {
  if (!leg?.chain || !leg.tokenSymbol) {
    return undefined;
  }
  const chain = leg.chain as SpokeChainKey;
  let tokens: readonly XToken[];
  try {
    tokens = getSupportedSolverTokens(chain);
  } catch {
    return undefined; // chain no longer supports solver
  }
  if (!tokens?.length) {
    return undefined;
  }
  const token = tokens.find(t => t.symbol === leg.tokenSymbol) ?? tokens[0];
  return token ? { chain, token } : undefined;
}

export function loadLastSelection(): { src?: SelectionLeg; dst?: SelectionLeg } {
  const parsed = readJson<StoredSelection>(STORAGE_KEY);
  if (!parsed) {
    return {};
  }
  return { src: resolveLeg(parsed.src), dst: resolveLeg(parsed.dst) };
}

export function saveLastSelection(src: SelectionLeg, dst: SelectionLeg): void {
  writeJson(STORAGE_KEY, {
    src: { chain: src.chain, tokenSymbol: src.token.symbol },
    dst: { chain: dst.chain, tokenSymbol: dst.token.symbol },
  } satisfies StoredSelection);
}
