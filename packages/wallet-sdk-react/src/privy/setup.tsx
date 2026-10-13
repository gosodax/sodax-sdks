import type { ReactNode } from 'react';
import { PrivyProvider } from '@privy-io/react-auth';
import type { PrivySourceContext, PrivySourceSetup } from '@/providers/evm/privySource.js';
import { buildPrivyConfig, type PrivyOptions } from './privyConfig.js';
import { PrivyBridge } from './PrivyBridge.js';
import { privyConnector } from './privyConnector.js';
import { AppErrorPassThrough, PrivyStartupGuard } from './PrivyStartupGuard.js';
import { createPrivyRuntime } from './runtime.js';

/** Runs once per `SodaxWalletProvider` mount: the connector and the host share this mount's runtime. */
export function createPrivySetup(
  options: PrivyOptions,
  defaultChainId: number,
  ctx: PrivySourceContext,
): PrivySourceSetup {
  const runtime = createPrivyRuntime();
  const config = buildPrivyConfig(options, defaultChainId, ctx);

  function PrivyHost({ children }: { children?: ReactNode }) {
    const app = <AppErrorPassThrough>{children}</AppErrorPassThrough>;
    return (
      <PrivyStartupGuard runtime={runtime} fallback={app}>
        <PrivyProvider appId={options.appId} clientId={options.clientId} config={config}>
          <PrivyBridge runtime={runtime} />
          {app}
        </PrivyProvider>
      </PrivyStartupGuard>
    );
  }

  const { connector, disconnect } = privyConnector({
    runtime,
    getState: ctx.getState,
    defaultChainId,
    disconnectBehavior: options.disconnectBehavior,
  });
  return { connector, disconnect, Host: PrivyHost };
}
