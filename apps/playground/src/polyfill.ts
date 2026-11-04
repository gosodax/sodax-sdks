import { Buffer } from 'buffer';

// Must be the first import in index.tsx: bitcoinjs-lib reads global Buffer, and ESM hoists later imports.
if (!window.Buffer) {
  window.Buffer = Buffer;
}
