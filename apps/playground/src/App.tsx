import { useEffect } from 'react';
import { useEmbedMessages } from './hooks/useEmbedMessages';
import { useEmbedSize } from './hooks/useEmbedSize';
import { useBrand } from './hooks/useBrand';
import { useSwapFlow } from './hooks/useSwapFlow';
import { initialUrl } from './lib/initialUrl';
import { SwapView, SwapWidget } from './views/SwapView';

export default function App() {
  const brand = useBrand(initialUrl.embed);
  const flow = useSwapFlow({ brand: brand.brand });
  useEmbedSize(initialUrl.embed);
  useEmbedMessages(initialUrl.embed, brand);
  const previewBusy = !!(
    flow.execution.phase ||
    flow.execution.review ||
    flow.execution.connectType ||
    flow.execution.activity ||
    flow.execution.destinationGate.busy
  );
  useEffect(() => {
    if (initialUrl.embed && window.parent !== window) {
      window.parent.postMessage({ type: 'sodax:preview-busy', busy: previewBusy }, window.location.origin);
    }
  }, [previewBusy]);
  // Embed mode without a frame is the new tab the link below opens: the window is the host there, so
  // the widget keeps its embed width rather than stretching across it, and the link has nowhere left to go.
  const framed = window.parent !== window;

  // What a host page frames: the widget, nothing around it. The demo chrome below is ours.
  if (initialUrl.embed) {
    return (
      <div className={framed ? 'app app-embed' : 'app app-embed app-standalone'}>
        {/* The widget's own box: the ground around it fills the frame, this is what gets measured. */}
        <div className="app-embed-content">
          <SwapWidget flow={flow} />
          {framed && (
            <a className="link standalone-link" href={window.location.href} target="_blank" rel="noreferrer">
              Open in a new tab ↗
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="app app-studio">
      <header className="app-header">
        <h1 className="app-title">
          SODAX <em>Widget</em>
        </h1>
        <p className="hero-note">
          <a href="https://docs.sodax.com/" target="_blank" rel="noreferrer">
            Developer docs ↗
          </a>
        </p>
      </header>

      {/* The exchange's stage: one rounded panel on the cherry ground, holding the whole app. */}
      <div className="stage">
        <main className="app-main">
          <SwapView flow={flow} brandControls={brand} />
        </main>

        <footer className="app-footer muted small">Built with SODAX. Non-custodial swaps across networks.</footer>
      </div>
    </div>
  );
}
