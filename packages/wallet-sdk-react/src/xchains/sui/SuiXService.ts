import { XService } from '@/core/XService.js';
import type { XToken } from '@sodax/types';
import { isNativeToken } from '@/utils/index.js';

// Hydrated by SuiHydrator from @mysten/dapp-kit-react hooks. Typed structurally so this file
// carries no @mysten/sui import; `core.getBalance` is the only method called here.
interface SuiClientLike {
  core: {
    getBalance(input: { owner: string; coinType: string }): Promise<{ balance: { balance: string } }>;
  };
}

export class SuiXService extends XService {
  private static instance: SuiXService;

  // Hydrated by SuiHydrator. Start undefined because wallet may not be connected yet.
  // suiWallet/suiAccount are opaque — stored for consumers, not used by this class.
  public suiClient: SuiClientLike | undefined;
  public suiWallet: unknown;
  public suiAccount: unknown;

  private constructor() {
    super('SUI');
  }

  public static getInstance(): SuiXService {
    if (!SuiXService.instance) {
      SuiXService.instance = new SuiXService();
    }
    return SuiXService.instance;
  }

  override async getBalances(address: string | undefined, xTokens: readonly XToken[]): Promise<Record<string, bigint>> {
    if (!address || !this.suiClient) return {};
    // Capture in local so the closure sees a narrowed (non-undefined) reference.
    const client = this.suiClient;
    try {
      const balancePromises = xTokens.map(async xToken => {
        let coinType = isNativeToken(xToken) ? '0x2::sui::SUI' : xToken.address;

        //  TODO: hard coded for getting legacy bnUSD balance
        if (
          coinType ===
          '0x03917a812fe4a6d6bc779c5ab53f8a80ba741f8af04121193fc44e0f662e2ceb::balanced_dollar::BALANCED_DOLLAR'
        ) {
          coinType =
            '0x3917a812fe4a6d6bc779c5ab53f8a80ba741f8af04121193fc44e0f662e2ceb::balanced_dollar::BALANCED_DOLLAR';
        }

        const result = await client.core.getBalance({
          owner: address,
          coinType: coinType,
        });

        return {
          address: xToken.address,
          balance: result ? BigInt(result.balance.balance) : undefined,
        };
      });

      const results = await Promise.all(balancePromises);

      const tokenMap: Record<string, bigint> = {};
      results.forEach(result => {
        if (result.balance !== undefined) {
          tokenMap[result.address] = result.balance;
        }
      });

      return tokenMap;
    } catch (error) {
      console.error('[wallet-sdk-react] SUI getBalances failed:', error);
      return {};
    }
  }
}
