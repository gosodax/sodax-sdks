import './polyfill';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { gtmId, trackInEmbed } from './config';
import { applyBrandStyles } from './hooks/useBrand';
import './index.css';
import { initAnalytics } from './lib/analytics';
import { brandStyles } from './lib/brand';
import { initialUrl } from './lib/initialUrl';
import Providers from './providers';

// bigint serialization — wallet SDKs serialize state to JSON in places.
// `Object.defineProperty` adds the method without asserting the prototype shape.
Object.defineProperty(BigInt.prototype, 'toJSON', {
  value: function toJSON(this: bigint) {
    return this.toString();
  },
  writable: true,
  configurable: true,
});

initAnalytics({ gtmId, embedded: initialUrl.embed, allowInEmbed: trackInEmbed });

// Before the first render, not from an effect: a framed widget must not paint our palette and then
// the partner's. `useBrand` takes the same stylesheet over from here.
if (initialUrl.embed) applyBrandStyles(brandStyles(initialUrl.brand).css);

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element not found');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Providers>
        <App />
      </Providers>
    </ErrorBoundary>
  </React.StrictMode>,
);
