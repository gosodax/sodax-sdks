import { useState } from 'react';
import { trackSnippetCopied } from '../lib/analytics';
import type { Snippet } from '../lib/snippet';
import { CopyLabel } from './CopyLabel';
import { SnippetHint } from './SnippetHint';

/** Renders whichever flow's snippets it is handed — the view decides what those are. */
export function CodePanel({ snippets, initialId }: { snippets: Snippet[]; initialId: string }) {
  const [activeId, setActiveId] = useState(initialId);
  const [copyError, setCopyError] = useState('');
  const [copied, setCopied] = useState(false);

  const active = snippets.find(snippet => snippet.id === activeId) ?? snippets[0];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(active.code);
      setCopyError('');
    } catch {
      setCopyError('Clipboard unavailable. Select and copy the code below.');
      return;
    }
    trackSnippetCopied(active.id);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <section className="card code-card">
      <header className="code-header">
        <div className="tabs">
          {snippets.map(snippet => (
            <button
              type="button"
              key={snippet.id}
              className={snippet.id === activeId ? 'tab tab-active' : 'tab'}
              onClick={() => {
                setActiveId(snippet.id);
                setCopied(false);
              }}
              aria-pressed={snippet.id === activeId}
            >
              {snippet.label}
            </button>
          ))}
        </div>
        <div className="code-actions">
          <SnippetHint />
          <button type="button" className="btn" onClick={copy}>
            <CopyLabel label="Copy" copied={copied} />
          </button>
          <a className="btn btn-docs" href="https://docs.sodax.com/" target="_blank" rel="noreferrer">
            Docs ↗
          </a>
        </div>
      </header>
      {active.note && <p className="muted small snippet-note">{active.note}</p>}
      {copyError && (
        <p role="status" className="muted small">
          {copyError}
        </p>
      )}
      <pre className="code">
        <code>{active.code}</code>
      </pre>
    </section>
  );
}
