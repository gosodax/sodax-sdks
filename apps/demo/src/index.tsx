import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { logger } from './lib/logger';
import { loadPrivySource } from './privy';
import Providers from './providers';
import { Buffer } from 'buffer';

BigInt.prototype['toJSON'] = function () {
  return this.toString();
};

if (!window.Buffer) {
  window.Buffer = Buffer; // Optional, for packages expecting Buffer to be global
}

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
// SodaxWalletProvider reads its config once, so the optional Privy source is resolved before the first render;
// if loading it fails, the app still renders without it.
void loadPrivySource()
  .catch(error => {
    logger.error('Privy failed to load; continuing without it.', error);
    return undefined;
  })
  .then(privy =>
    root.render(
      <React.StrictMode>
        <Providers privy={privy}>
          <App />
        </Providers>
      </React.StrictMode>,
    ),
  );
