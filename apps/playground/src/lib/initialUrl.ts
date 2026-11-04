import { readUrlState } from './urlState';

/** Read once: the app owns the query string from its first render on. */
export const initialUrl = readUrlState(window.location.search);
