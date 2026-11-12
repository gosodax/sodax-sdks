import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { type Brand, writeBrand } from '../lib/brand';
import { fromHost } from '../lib/embedMessages';

/** A real iframe contains its own dialogs, media queries, styles, and wallet connection. */
export function WidgetPreview({
  setupUrl,
  brand,
  mobile,
  onBusy,
}: {
  setupUrl: string;
  brand: Brand;
  mobile: boolean;
  onBusy: (busy: boolean) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(680);
  const [loaded, setLoaded] = useState(false);
  const [src] = useState(() => {
    const url = new URL(setupUrl);
    writeBrand(url.searchParams, brand);
    return url.href;
  });
  const params = new URLSearchParams();
  writeBrand(params, brand);
  const search = params.toString();
  const origin = new URL(setupUrl).origin;
  useEffect(() => {
    const receive = (event: MessageEvent<unknown>) => {
      if (!fromHost(event, frame.current?.contentWindow, origin)) return;
      const data = event.data;
      if (data && typeof data === 'object' && 'type' in data && data.type === 'sodax:ready') {
        frame.current?.contentWindow?.postMessage({ type: 'sodax:preview-brand', search }, origin);
      }
      if (
        data &&
        typeof data === 'object' &&
        'type' in data &&
        data.type === 'sodax:preview-busy' &&
        'busy' in data &&
        typeof data.busy === 'boolean'
      )
        onBusy(data.busy);
      if (
        data &&
        typeof data === 'object' &&
        'type' in data &&
        data.type === 'sodax:resize' &&
        'height' in data &&
        typeof data.height === 'number' &&
        Number.isFinite(data.height)
      ) {
        setHeight(Math.max(360, Math.min(1600, data.height)));
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [origin, onBusy, search]);
  useEffect(() => {
    if (loaded) frame.current?.contentWindow?.postMessage({ type: 'sodax:preview-brand', search }, origin);
  }, [search, loaded, origin]);
  // A property rather than a height: stacked it floors the frame, side by side it sets it.
  const sizing: CSSProperties & Record<'--widget-height', string> = { '--widget-height': `${height}px` };
  return (
    <div className={`preview-frame${mobile ? ' preview-frame-mobile' : ''}`} style={sizing}>
      {!loaded && (
        <p className="muted small" role="status">
          Loading widget…
        </p>
      )}
      <iframe
        ref={frame}
        title="Live swap widget preview"
        src={src}
        allow="ethereum; solana; clipboard-write"
        onLoad={() => setLoaded(true)}
      />
    </div>
  );
}
