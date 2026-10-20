import { minAmountAfterSlippage } from './format';
import { quoteErrorMessage } from './errors';

/** Slippage in basis points (100 = 1%), applied to every quote's `minOutputAmount`. */
export const DEFAULT_SLIPPAGE_BPS = 100;

/** What every quote hook returns, whichever direction or transport. */
export type QuoteState = {
  /** Expected output (smallest units of the output token; lsoda* shares are 18 dp). */
  amountOut: bigint | undefined;
  /** Output after DEFAULT_SLIPPAGE_BPS. Use as `minOutputAmount`; never 0. */
  minAmountOut: bigint | undefined;
  error: string | undefined;
  /** True while the user is typing (debounce pending) or the first quote is loading. */
  isLoading: boolean;
  refetch: () => unknown;
};

export function quoteState(args: {
  amountOut: bigint | undefined;
  error: unknown;
  typing: boolean;
  waiting: boolean;
  refetch: () => unknown;
}): QuoteState {
  return {
    amountOut: args.amountOut,
    minAmountOut:
      args.amountOut !== undefined ? minAmountAfterSlippage(args.amountOut, DEFAULT_SLIPPAGE_BPS) : undefined,
    error: args.error ? quoteErrorMessage(args.error) : undefined,
    isLoading: args.typing || args.waiting,
    refetch: args.refetch,
  };
}
