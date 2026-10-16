/**
 * Solver quote for one leg of a position operation, and the follow-up that tells a pair the solver
 * cannot route from a leg that is merely too small.
 *
 * App-level shaping only. The pair, the gross quote and the reading of a refusal live in
 * `sodax.leverageYield.getPositionLegQuote` and `isNoRouteRefusal`, so an integrator gets them
 * without this file; what stays here is React Query and the shape three call sites already read.
 *
 * THE PROBE STAYS HERE on purpose. Its size is a USD notional, and this module's own stance is that
 * prices come from the caller — the SDK owns the rule, the app owns the price.
 */

import { useMemo } from 'react';
import { isNoRouteRefusal, useSodaxContext } from '@sodax/dapp-kit';
import { useQuery } from '@tanstack/react-query';
import { parseUnits, type Address } from 'viem';

export type LegQuote = {
  /** Amount the solver expects to deliver, in output-token units. */
  outputAmount: bigint;
  outputDecimals: number;
  outputSymbol: string;
};

export type LegQuoteState = {
  data: LegQuote | undefined;
  isLoading: boolean;
  error: Error | undefined;
  /** Whether the refusal was a routing one — which also covers a leg that is only too small. */
  isNoRoute: boolean;
};

/**
 * @param inputHubToken  Hub reserve given up (the borrow token when levering up, collateral when down).
 * @param outputHubToken Hub reserve expected back.
 * @param amount         Input amount in input-token units. Zero/undefined disables the query.
 */
export function useLegQuote({
  inputHubToken,
  outputHubToken,
  amount,
}: {
  inputHubToken: Address | undefined;
  outputHubToken: Address | undefined;
  amount: bigint | undefined;
}): LegQuoteState {
  const { sodax } = useSodaxContext();
  const enabled = !!inputHubToken && !!outputHubToken && !!amount && amount > 0n;

  const { data, isLoading } = useQuery({
    queryKey: ['leverageYield', 'positionLegQuote', inputHubToken, outputHubToken, amount?.toString()],
    queryFn: async () => {
      if (!inputHubToken || !outputHubToken || !amount) throw new Error('leg is incomplete');
      return sodax.leverageYield.getPositionLegQuote({ inputHubToken, outputHubToken, amount });
    },
    enabled,
    // A leg the solver will not route does not become routable on a timer, and polling turns one bad
    // size into a request every few seconds for as long as the card is open.
    refetchInterval: query => (query.state.data?.ok === false ? false : 3000),
    staleTime: 3000,
    retry: false,
  });

  // Hub reserves have no spoke-token entry on Sonic, so decimals and symbol come from the
  // hub-asset lookup that exists for exactly this case.
  const outToken = outputHubToken ? sodax.config.getXTokenFromHubAsset(outputHubToken) : undefined;
  const failure = data?.ok === false ? data.error : undefined;
  const message = failure && 'detail' in failure ? failure.detail.message : failure?.message;

  return useMemo(
    () => ({
      data: data?.ok
        ? {
            outputAmount: data.value.quotedAmount,
            outputDecimals: outToken?.decimals ?? 18,
            outputSymbol: outToken?.symbol ?? 'out',
          }
        : undefined,
      isLoading,
      // Rebuilt only when the wording changes, so it stays stable across refetches.
      error: message ? new Error(message) : undefined,
      isNoRoute: isNoRouteRefusal(failure),
    }),
    [data, isLoading, message, failure, outToken?.decimals, outToken?.symbol],
  );
}

/**
 * Notional to re-ask a refused leg at, in the pool oracle's USD.
 *
 * Priced, not scaled: the routing floor is a notional and the distance to it is unbounded — a first
 * attempt multiplied the failed size by 100 and a leg at 1e8 wei still probed below a floor sitting
 * between 1e13 and 3e13. $100 is two orders of magnitude inside the window measured on both
 * directions of sodaETH/sodaS, which quotes from $1 to $10,000 and refuses $100,000.
 */
const PROBE_USD = 100;

/**
 * Whether the pair routes at a healthy size, when it has just refused the one the user asked for.
 *
 * The answer only means "too small" when the failed leg was UNDER the probe — the window closes at
 * the top as well, and a leg that is too large must not be told to grow.
 */
export function useLegRoutesAtProbeSize({
  inputHubToken,
  outputHubToken,
  amount,
  inputPriceUsd,
  inputDecimals,
  enabled,
}: {
  inputHubToken: Address | undefined;
  outputHubToken: Address | undefined;
  amount: bigint | undefined;
  inputPriceUsd: number | undefined;
  inputDecimals: number | undefined;
  enabled: boolean;
}): boolean {
  const { sodax } = useSodaxContext();

  const probe = useMemo(() => {
    if (!enabled || !inputPriceUsd || inputPriceUsd <= 0 || inputDecimals === undefined) return undefined;
    try {
      const tokens = parseUnits((PROBE_USD / inputPriceUsd).toFixed(inputDecimals), inputDecimals);
      return tokens > 0n ? tokens : undefined;
    } catch {
      return undefined;
    }
  }, [enabled, inputPriceUsd, inputDecimals]);

  const { data } = useQuery({
    queryKey: ['leverageYield', 'positionLegRoutable', inputHubToken, outputHubToken, probe?.toString()],
    queryFn: async () => {
      if (!inputHubToken || !outputHubToken || !probe) throw new Error('leg is incomplete');
      return sodax.leverageYield.getPositionLegQuote({ inputHubToken, outputHubToken, amount: probe });
    },
    enabled: !!inputHubToken && !!outputHubToken && !!probe,
    // Routability does not move the way a price does, and this only ever runs on a failure.
    staleTime: 5 * 60_000,
    retry: false,
  });

  return data?.ok === true && amount !== undefined && probe !== undefined && amount < probe;
}
