import { resolveHostOrigin } from './embedOrigin';
import { readUrlState } from './urlState';

/** Read once: the app owns the query string from its first render on. */
export const initialUrl = readUrlState(window.location.search);

/** The widget framed by our own builder page; a partner's frame always has another origin. */
export const inBuilderPreview =
  initialUrl.embed &&
  window.parent !== window &&
  resolveHostOrigin(window.location.ancestorOrigins, document.referrer) === window.location.origin;
