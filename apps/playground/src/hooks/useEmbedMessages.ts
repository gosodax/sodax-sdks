import { useEffect } from 'react';
import { readBrand } from '../lib/brand';
import { resolveHostOrigin } from '../lib/embedOrigin';
import { fromHost, postEmbedEvent, readThemeMessage } from '../lib/embedMessages';
import type { BrandControls } from './useBrand';

export function useEmbedMessages(embedded: boolean, controls: BrandControls): void {
  const { apply, brand } = controls;
  useEffect(() => {
    if (!embedded || window.parent === window) return;
    postEmbedEvent({ type: 'sodax:ready' });
  }, [embedded]);
  useEffect(() => {
    if (!embedded) return;
    const origin = resolveHostOrigin(window.location.ancestorOrigins, document.referrer);
    const receive = (event: MessageEvent<unknown>) => {
      if (!fromHost(event, window.parent, origin)) return;
      const theme = readThemeMessage(event.data);
      if (theme) apply({ ...brand, theme });
      const data = event.data;
      if (
        origin === window.location.origin &&
        data &&
        typeof data === 'object' &&
        'type' in data &&
        data.type === 'sodax:preview-brand' &&
        'search' in data &&
        typeof data.search === 'string' &&
        data.search.length < 2000
      ) {
        apply(readBrand(data.search));
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [embedded, apply, brand]);
}
