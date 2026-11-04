import { useEffect } from 'react';
import { resolveHostOrigin } from '../lib/embedOrigin';

export function useEmbedSize(embedded: boolean): void {
  useEffect(() => {
    if (!embedded || window.parent === window) return;
    // The widget's own box, not the ground it sits on: that ground fills the frame the host gives
    // us, so measuring it would report the height we were handed instead of the height we need.
    const content = document.querySelector('.app-embed-content');
    if (!content) return;
    const hostOrigin = resolveHostOrigin(window.location.ancestorOrigins, document.referrer);
    if (!hostOrigin) return;
    const report = () =>
      window.parent.postMessage(
        { type: 'sodax:resize', height: Math.ceil(content.getBoundingClientRect().height) },
        hostOrigin,
      );
    const observer = new ResizeObserver(report);
    observer.observe(content);
    report();
    return () => observer.disconnect();
  }, [embedded]);
}
