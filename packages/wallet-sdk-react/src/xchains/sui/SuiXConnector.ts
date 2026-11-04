import type { XAccount } from '@/types/index.js';

import { getWalletUniqueIdentifier, type UiWallet } from '@mysten/dapp-kit-react';
import { XConnector } from '@/core/index.js';
import { SuiXService } from './SuiXService.js';
import { assert } from '@/shared/guards.js';

export class SuiXConnector extends XConnector {
  public readonly wallet: { id: string; name: string; icon?: string };

  constructor(wallet: UiWallet) {
    // `UiWallet` carries no `id` of its own — dApp Kit derives it from the underlying wallet.
    // Use the same helper SuiHydrator/SuiActions use, or connect-by-id stops matching.
    const id = getWalletUniqueIdentifier(wallet);
    assert(typeof id === 'string' && id.length > 0, '[SuiXConnector] invalid wallet id');

    super('SUI', wallet.name, id);
    this.wallet = { id, name: wallet.name, icon: wallet.icon };
  }

  getXService(): SuiXService {
    return SuiXService.getInstance();
  }

  async connect(): Promise<XAccount | undefined> {
    return;
  }

  async disconnect(): Promise<void> {}

  public override get icon(): string | undefined {
    return this.wallet.icon;
  }
}
